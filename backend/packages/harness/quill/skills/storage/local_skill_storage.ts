/**
 * Local-filesystem implementation of `SkillStorage`.
 *
 * Mirrors `quill.skills.storage.local_skill_storage` from the Python backend.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import JSZip from "jszip";

import { getAppConfig, type AppConfig } from "../../config/app_config.js";
import { resolvePath } from "../../config/runtime_paths.js";
import { SkillsConfig } from "../../config/skills_config.js";
import {
  SkillAlreadyExistsError,
  moveStagedSkillIntoReservedTarget,
  resolveSkillDirFromArchive,
  safeExtractSkillArchive,
  scanSkillArchiveContentsOrRaise,
  type ZipFileLike,
  type ZipInfo,
} from "../installer.js";
import { makeSkillWrittenPathSandboxReadable } from "../permissions.js";
import { SkillCategory } from "../types.js";
import { validateSkillFrontmatter } from "../validation.js";
import { SKILL_MD_FILE, SkillStorage } from "./skill_storage.js";

export const DEFAULT_SKILLS_CONTAINER_PATH = "/mnt/skills";

// ---------------------------------------------------------------------------
// ZIP archive reading via `jszip`.
// ---------------------------------------------------------------------------
// `JSZip.loadAsync` is async, so `openZipFile` pre-reads every member into a
// Buffer up front and returns a synchronous `ZipFileLike`. This keeps
// `safeExtractSkillArchive` (which iterates + reads members synchronously)
// unchanged from the Python port's control flow.

interface PreloadedEntry {
  info: ZipInfo;
  buffer: Buffer;
}

/**
 * Open a ZIP archive and pre-load all members so the returned `ZipFileLike`
 * presents a synchronous read surface to the extraction logic.
 */
async function openZipFile(filePath: string): Promise<ZipFileLike> {
  const data = fs.readFileSync(filePath);
  const zip = await JSZip.loadAsync(data);
  const entries: PreloadedEntry[] = [];

  for (const name of Object.keys(zip.files)) {
    const obj = zip.files[name];
    if (obj === undefined) continue;
    const isDirEntry = obj.dir || name.endsWith("/");
    // jszip exposes the Unix mode via `unixPermissions`; Python's `external_attr`
    // stores it in the high 16 bits. Map back so `isSymlinkMember` works.
    const rawPerms = obj.unixPermissions;
    const unixMode = typeof rawPerms === "number" ? rawPerms : 0;
    const info: ZipInfo = {
      filename: name,
      externalAttr: (unixMode & 0o177777) << 16,
      isDir: () => isDirEntry,
    };
    const buffer = isDirEntry ? Buffer.alloc(0) : await obj.async("nodebuffer");
    entries.push({ info, buffer });
  }

  return {
    infolist: (): ZipInfo[] => entries.map((e) => e.info),
    readMember: (info: ZipInfo): Buffer => {
      const found = entries.find((e) => e.info.filename === info.filename);
      if (!found) {
        throw new Error(`ZIP member not found: ${info.filename}`);
      }
      return found.buffer;
    },
  };
}

function isDir(candidate: string): boolean {
  try {
    return fs.statSync(candidate).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Skill storage backed by the local filesystem.
 *
 * Layout:
 *   <root>/public/<name>/SKILL.md
 *   <root>/custom/<name>/SKILL.md
 *   <root>/custom/.history/<name>.jsonl
 */
export class LocalSkillStorage extends SkillStorage {
  private readonly hostRoot: string;

  constructor(hostPath: string | null = null, containerPath: string = DEFAULT_SKILLS_CONTAINER_PATH, appConfig: AppConfig | null = null) {
    super(containerPath);
    if (hostPath === null) {
      const config = appConfig ?? getAppConfig();
      const raw = (config.skills ?? {}) as Record<string, unknown>;
      const skillsConfig = new SkillsConfig({
        use: raw.use as string | undefined,
        path: (raw.path ?? null) as string | null,
        containerPath: raw.container_path as string | undefined,
      });
      this.hostRoot = skillsConfig.getSkillsPath();
    } else {
      this.hostRoot = resolvePath(hostPath);
    }
  }

  // ------------------------------------------------------------------
  // Abstract operation implementations
  // ------------------------------------------------------------------

  getSkillsRootPath(): string {
    return this.hostRoot;
  }

  customSkillExists(name: string): boolean {
    return fs.existsSync(this.getCustomSkillFile(name));
  }

  publicSkillExists(name: string): boolean {
    const normalizedName = SkillStorage.validateSkillName(name);
    return fs.existsSync(path.join(this.hostRoot, SkillCategory.PUBLIC, normalizedName, SKILL_MD_FILE));
  }

  protected *iterSkillFiles(): Iterable<[SkillCategory, string, string]> {
    if (!fs.existsSync(this.hostRoot)) {
      return;
    }
    for (const category of [SkillCategory.PUBLIC, SkillCategory.CUSTOM]) {
      const categoryPath = path.join(this.hostRoot, category);
      if (!isDir(categoryPath)) {
        continue;
      }
      yield* this.walkForSkillMd(category, categoryPath, categoryPath);
    }
  }

  private *walkForSkillMd(category: SkillCategory, categoryRoot: string, currentRoot: string): Iterable<[SkillCategory, string, string]> {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(currentRoot, { withFileTypes: true });
    } catch {
      return;
    }

    // Follow symlinks (os.walk followlinks=True), prune hidden dirs, sort.
    const dirNames = entries
      .map((entry) => entry.name)
      .filter((name) => !name.startsWith(".") && isDir(path.join(currentRoot, name)))
      .sort();

    const skillMd = path.join(currentRoot, SKILL_MD_FILE);
    if (fs.existsSync(skillMd) && !isDir(skillMd)) {
      yield [category, categoryRoot, skillMd];
    }

    for (const dirName of dirNames) {
      yield* this.walkForSkillMd(category, categoryRoot, path.join(currentRoot, dirName));
    }
  }

  readCustomSkill(name: string): string {
    if (!this.customSkillExists(name)) {
      throw new Error(`Custom skill '${name}' not found.`);
    }
    return fs.readFileSync(path.join(this.getCustomSkillDir(name), SKILL_MD_FILE), "utf-8");
  }

  writeCustomSkill(name: string, relativePath: string, content: string): void {
    const target = SkillStorage.validateRelativePath(relativePath, this.getCustomSkillDir(name));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const tmpPath = path.join(path.dirname(target), `.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    fs.writeFileSync(tmpPath, content, { encoding: "utf-8" });
    fs.renameSync(tmpPath, target);
    makeSkillWrittenPathSandboxReadable(this.getCustomSkillDir(name), target);
  }

  async ainstallSkillFromArchive(archivePath: string): Promise<Record<string, unknown>> {
    console.info(`Installing skill from ${archivePath}`);
    const archive = archivePath;
    const customDir = path.join(this.hostRoot, "custom");

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "quill-install-"));
    let skillName = "";
    try {
      let skillDir: string;
      let target: string;
      [skillDir, skillName, target] = await this.prepareSkillArchive(archive, tmp, customDir, archivePath);

      await scanSkillArchiveContentsOrRaise(skillDir, skillName);

      this.commitSkillInstall(skillDir, skillName, customDir, target);
      console.info(`Skill ${JSON.stringify(skillName)} installed to ${target}`);
    } finally {
      LocalSkillStorage.cleanupInstallTmp(tmp);
    }

    return {
      success: true,
      skill_name: skillName,
      message: `Skill '${skillName}' installed successfully`,
    };
  }

  private static cleanupInstallTmp(tmp: string): void {
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
      console.warn(`Failed to clean up skill install temp dir ${tmp}`);
    }
  }

  /** Extract and validate the archive. */
  private async prepareSkillArchive(archive: string, tmpPath: string, customDir: string, archivePath: string): Promise<[string, string, string]> {
    let stat: fs.Stats | null = null;
    try {
      stat = fs.statSync(archive);
    } catch {
      stat = null;
    }
    if (stat === null || !stat.isFile()) {
      if (stat === null) {
        throw new Error(`Skill file not found: ${archivePath}`);
      }
      throw new Error(`Path is not a file: ${archivePath}`);
    }
    if (path.extname(archive) !== ".skill") {
      throw new Error("File must have .skill extension");
    }

    fs.mkdirSync(customDir, { recursive: true });

    const zf = await openZipFile(archive);
    safeExtractSkillArchive(zf, tmpPath);

    const skillDir = resolveSkillDirFromArchive(tmpPath);

    const [isValid, message, skillName] = validateSkillFrontmatter(skillDir);
    if (!isValid) {
      throw new Error(`Invalid skill: ${message}`);
    }
    if (!skillName || skillName.includes("/") || skillName.includes("\\") || skillName.includes("..")) {
      throw new Error(`Invalid skill name: ${skillName}`);
    }

    const target = path.join(customDir, skillName);
    if (fs.existsSync(target)) {
      throw new SkillAlreadyExistsError(`Skill '${skillName}' already exists`);
    }

    return [skillDir, skillName, target];
  }

  /** Stage and move the validated skill into place. */
  private commitSkillInstall(skillDir: string, skillName: string, customDir: string, target: string): void {
    const stagingRoot = fs.mkdtempSync(path.join(customDir, `.installing-${skillName}-`));
    try {
      const stagingTarget = path.join(stagingRoot, skillName);
      fs.cpSync(skillDir, stagingTarget, { recursive: true });
      moveStagedSkillIntoReservedTarget(stagingTarget, target);
    } finally {
      fs.rmSync(stagingRoot, { recursive: true, force: true });
    }
  }

  deleteCustomSkill(name: string, historyMeta: Record<string, unknown> | null = null): void {
    SkillStorage.validateSkillName(name);
    this.ensureCustomSkillIsEditable(name);
    const target = this.getCustomSkillDir(name);
    if (historyMeta !== null && historyMeta !== undefined) {
      const prevContent = this.readCustomSkill(name);
      try {
        this.appendHistory(name, { ...historyMeta, prev_content: prevContent });
      } catch (e) {
        const code = (e as NodeJS.ErrnoException).code;
        if (code !== "EACCES" && code !== "EPERM" && code !== "EROFS") {
          throw e;
        }
        console.warn(
          `Skipping delete history write for custom skill ${name} due to readonly/permission failure; continuing with skill directory removal: ${String(e)}`
        );
      }
    }
    if (fs.existsSync(target)) {
      fs.rmSync(target, { recursive: true, force: true });
    }
  }

  appendHistory(name: string, record: Record<string, unknown>): void {
    SkillStorage.validateSkillName(name);
    const payload = { ts: new Date().toISOString(), ...record };
    const historyPath = this.getSkillHistoryFile(name);
    fs.mkdirSync(path.dirname(historyPath), { recursive: true });
    fs.appendFileSync(historyPath, `${JSON.stringify(payload)}\n`, { encoding: "utf-8" });
  }

  readHistory(name: string): Array<Record<string, unknown>> {
    SkillStorage.validateSkillName(name);
    const historyPath = this.getSkillHistoryFile(name);
    if (!fs.existsSync(historyPath)) {
      return [];
    }
    const records: Array<Record<string, unknown>> = [];
    for (const line of fs.readFileSync(historyPath, "utf-8").split("\n")) {
      if (!line.trim()) {
        continue;
      }
      records.push(JSON.parse(line) as Record<string, unknown>);
    }
    return records;
  }
}
