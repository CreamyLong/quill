/**
 * Middleware to inject uploaded files information into agent context.
 *
 * Faithful port of Python `UploadsMiddleware`. Reads uploaded-file metadata from
 * the last human message's `additional_kwargs.files`, scans the thread's uploads
 * directory for historical files, and prepends an `<uploaded_files>` block to the
 * last human message so the model knows which files are available.
 *
 * Deviations / dependency notes (report):
 * - Python's `before_agent` reads `thread_id` from `runtime.context` /
 *   `get_config()`; the TS hook receives only `state`, so `threadId` is supplied
 *   via options. When omitted, no uploads directory is scanned.
 * - `get_effective_user_id()` (quill.runtime.user_context) is not ported;
 *   pass `userId` explicitly for per-user isolation.
 * - There is no `before_agent` node in the TS factory; `beforeModel` is used.
 * - `Paths`/`getPaths`, `extractOutline`, `ORIGINAL_USER_CONTENT_KEY`, and
 *   `messageContentToText` are reused from their existing TS ports.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { HumanMessage } from "@langchain/core/messages";

import type { MiddlewareDefinition } from "../factory.js";
import type { ThreadState } from "../thread_state.js";
import { Paths, getPaths } from "../../config/paths.js";
import {
  extractOutline,
  type OutlineEntry,
  type OutlineItem,
} from "../../utils/file_conversion.js";
import { ORIGINAL_USER_CONTENT_KEY, messageContentToText } from "../../utils/messages.js";
import { getWorkspaceOverrideResolver } from "../../sandbox/local/provider.js";

const OUTLINE_PREVIEW_LINES = 5;

interface UploadedFile {
  filename: string;
  size: number;
  path: string;
  extension: string;
  outline?: OutlineItem[];
  outline_preview?: string[];
}

export interface UploadsMiddlewareOptions {
  /** Base directory for thread data. Defaults to Paths resolution. */
  baseDir?: string | null;
  /** Thread ID (normally sourced from runtime context in Python). */
  threadId?: string | null;
  /** Optional user ID for per-user path isolation. */
  userId?: string | null;
}

function isTruncated(entry: OutlineItem): boolean {
  return "truncated" in entry && entry.truncated === true;
}

function isOutlineEntry(entry: OutlineItem): entry is OutlineEntry {
  return "line" in entry;
}

/** Return the document outline and fallback preview for `filePath`. */
function extractOutlineForFile(filePath: string): [OutlineItem[], string[]] {
  const parsed = path.parse(filePath);
  const mdPath = path.join(parsed.dir, `${parsed.name}.md`);
  if (!fs.existsSync(mdPath) || !fs.statSync(mdPath).isFile()) {
    return [[], []];
  }

  const outline = extractOutline(mdPath);
  if (outline.length > 0) {
    console.debug(`Extracted ${outline.length} outline entries from ${path.basename(filePath)}`);
    return [outline, []];
  }

  // outline is empty — read the first few non-empty lines as a content preview.
  const preview: string[] = [];
  try {
    const text = fs.readFileSync(mdPath, "utf-8");
    for (const line of text.split("\n")) {
      const stripped = line.trim();
      if (stripped) {
        preview.push(stripped);
      }
      if (preview.length >= OUTLINE_PREVIEW_LINES) {
        break;
      }
    }
  } catch {
    console.debug(`Failed to read preview lines from ${mdPath}`);
  }
  return [[], preview];
}

/** Append a single file entry (name, size, path, optional outline) to `lines`. */
function formatFileEntry(file: UploadedFile, lines: string[]): void {
  const sizeKb = file.size / 1024;
  const sizeStr = sizeKb < 1024 ? `${sizeKb.toFixed(1)} KB` : `${(sizeKb / 1024).toFixed(1)} MB`;
  lines.push(`- ${file.filename} (${sizeStr})`);
  lines.push(`  Path: ${file.path}`);
  const outline = file.outline ?? [];
  if (outline.length > 0) {
    const truncated = isTruncated(outline[outline.length - 1]);
    const visible = outline.filter(isOutlineEntry);
    lines.push("  Document outline (use `read_file` with line ranges to read sections):");
    for (const entry of visible) {
      lines.push(`    L${entry.line}: ${entry.title}`);
    }
    if (truncated) {
      lines.push(
        `    ... (showing first ${visible.length} headings; use \`read_file\` to explore further)`
      );
    }
  } else {
    const preview = file.outline_preview ?? [];
    if (preview.length > 0) {
      lines.push("  No structural headings detected. Document begins with:");
      for (const text of preview) {
        lines.push(`    > ${text}`);
      }
    }
    lines.push(
      "  Use `grep` to search for keywords (e.g. `grep(pattern='keyword', path='/mnt/user-data/uploads/')`)."
    );
  }
  lines.push("");
}

/** Create a formatted message listing uploaded files. */
function createFilesMessage(newFiles: UploadedFile[], historicalFiles: UploadedFile[]): string {
  const lines: string[] = ["<uploaded_files>"];

  lines.push("The following files were uploaded in this message:");
  lines.push("");
  if (newFiles.length > 0) {
    for (const file of newFiles) {
      formatFileEntry(file, lines);
    }
  } else {
    lines.push("(empty)");
    lines.push("");
  }

  if (historicalFiles.length > 0) {
    lines.push("The following files were uploaded in previous messages and are still available:");
    lines.push("");
    for (const file of historicalFiles) {
      formatFileEntry(file, lines);
    }
  }

  lines.push("To work with these files:");
  lines.push(
    "- Read from the file first — use the outline line numbers and `read_file` to locate relevant sections."
  );
  lines.push("- Use `grep` to search for keywords when you are not sure which section to look at");
  lines.push("  (e.g. `grep(pattern='revenue', path='/mnt/user-data/uploads/')`).");
  lines.push("- Use `glob` to find files by name pattern");
  lines.push("  (e.g. `glob(pattern='**/*.md', path='/mnt/user-data/uploads/')`).");
  lines.push(
    "- Only fall back to web search if the file content is clearly insufficient to answer the question."
  );
  lines.push("</uploaded_files>");

  return lines.join("\n");
}

/** Extract file info from message additional_kwargs.files, or null. */
function filesFromKwargs(
  message: HumanMessage,
  uploadsDir: string | null
): UploadedFile[] | null {
  const kwargsFiles = (message.additional_kwargs ?? {})["files"];
  if (!Array.isArray(kwargsFiles) || kwargsFiles.length === 0) {
    return null;
  }

  const files: UploadedFile[] = [];
  for (const f of kwargsFiles) {
    if (f === null || typeof f !== "object") {
      continue;
    }
    const entry = f as Record<string, unknown>;
    const filename = (entry["filename"] as string) || "";
    if (!filename || path.basename(filename) !== filename) {
      continue;
    }
    if (uploadsDir !== null) {
      const full = path.join(uploadsDir, filename);
      if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
        continue;
      }
    }
    files.push({
      filename,
      size: Number(entry["size"] ?? 0) || 0,
      path: `/mnt/user-data/uploads/${filename}`,
      extension: path.extname(filename),
    });
  }
  return files.length > 0 ? files : null;
}

/** Inject uploaded files information before the model call. */
export function uploadsMiddleware(options: UploadsMiddlewareOptions = {}): MiddlewareDefinition {
  const paths: Paths = options.baseDir ? new Paths(options.baseDir) : getPaths();
  const threadId = options.threadId ?? null;
  const userId = options.userId ?? null;

  return {
    name: "UploadsMiddleware",
    beforeModel: (state: ThreadState): Partial<ThreadState> => {
      const messages = (state.messages ?? []).slice();
      if (messages.length === 0) {
        return {};
      }

      const lastMessageIndex = messages.length - 1;
      const lastMessage = messages[lastMessageIndex];
      if (!(lastMessage instanceof HumanMessage)) {
        return {};
      }

      const override = threadId ? getWorkspaceOverrideResolver()?.(threadId) : undefined;
      const uploadsDir = override
        ? path.join(override, "uploads")
        : threadId
          ? paths.sandboxUploadsDir(threadId, userId)
          : null;

      const newFiles = filesFromKwargs(lastMessage, uploadsDir) ?? [];

      const newFilenames = new Set(newFiles.map((f) => f.filename));
      const historicalFiles: UploadedFile[] = [];
      if (uploadsDir && fs.existsSync(uploadsDir)) {
        for (const name of fs.readdirSync(uploadsDir).sort()) {
          const full = path.join(uploadsDir, name);
          if (fs.statSync(full).isFile() && !newFilenames.has(name)) {
            const stat = fs.statSync(full);
            const [outline, preview] = extractOutlineForFile(full);
            historicalFiles.push({
              filename: name,
              size: stat.size,
              path: `/mnt/user-data/uploads/${name}`,
              extension: path.extname(name),
              outline,
              outline_preview: preview,
            });
          }
        }
      }

      if (uploadsDir) {
        for (const file of newFiles) {
          const physPath = path.join(uploadsDir, file.filename);
          const [outline, preview] = extractOutlineForFile(physPath);
          file.outline = outline;
          file.outline_preview = preview;
        }
      }

      if (newFiles.length === 0 && historicalFiles.length === 0) {
        return {};
      }

      const filesMessage = createFilesMessage(newFiles, historicalFiles);

      const originalContent = lastMessage.content;
      const additionalKwargs: Record<string, unknown> = { ...(lastMessage.additional_kwargs ?? {}) };
      if (!(ORIGINAL_USER_CONTENT_KEY in additionalKwargs)) {
        additionalKwargs[ORIGINAL_USER_CONTENT_KEY] = messageContentToText(originalContent);
      }

      let updatedContent: HumanMessage["content"];
      if (typeof originalContent === "string") {
        updatedContent = `${filesMessage}\n\n${originalContent}`;
      } else if (Array.isArray(originalContent)) {
        const filesBlock = { type: "text", text: `${filesMessage}\n\n` };
        updatedContent = [filesBlock, ...originalContent] as unknown as HumanMessage["content"];
      } else {
        updatedContent = originalContent;
      }

      const updatedMessage = new HumanMessage({
        content: updatedContent,
        id: lastMessage.id,
        name: lastMessage.name,
        additional_kwargs: additionalKwargs,
      });

      messages[lastMessageIndex] = updatedMessage;

      return {
        uploaded_files: newFiles as unknown as Array<Record<string, unknown>>,
        messages,
      };
    },
  };
}
