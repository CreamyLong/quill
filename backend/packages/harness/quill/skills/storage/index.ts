/**
 * SkillStorage singleton + factory.
 *
 * Mirrors `quill.skills.storage.__init__` from the Python backend.
 *
 * NOTE: Python resolves the storage class dynamically via
 * `quill.reflection.resolve_class(skills_config.use, ...)`. Reflection is not
 * ported to TypeScript; `LocalSkillStorage` is the only implementation, so the
 * factory constructs it directly. The threading lock guarding singleton
 * construction is dropped — Node's event loop is single-threaded.
 */

import { getAppConfig, type AppConfig } from "../../config/app_config.js";
import { SkillsConfig } from "../../config/skills_config.js";
import { LocalSkillStorage } from "./local_skill_storage.js";
import { SkillStorage } from "./skill_storage.js";

export { LocalSkillStorage, SkillStorage };

let _defaultSkillStorage: SkillStorage | null = null;
// AppConfig identity the singleton was built from.
let _defaultSkillStorageConfig: AppConfig | null = null;

function skillsConfigFromRecord(raw: Record<string, unknown> | undefined): SkillsConfig {
  const record = raw ?? {};
  return new SkillsConfig({
    use: record.use as string | undefined,
    path: (record.path ?? null) as string | null,
    containerPath: record.container_path as string | undefined,
  });
}

function makeStorage(skillsConfig: SkillsConfig, hostPath: string | null = null): SkillStorage {
  const resolvedHost = hostPath !== null ? hostPath : skillsConfig.getSkillsPath();
  return new LocalSkillStorage(resolvedHost, skillsConfig.containerPath);
}

export interface GetOrNewSkillStorageOptions {
  /** Explicit host-path override for the skills root. */
  skillsPath?: string | null;
  /** Per-request config so the singleton is not polluted. */
  appConfig?: AppConfig | null;
}

/**
 * Return a `SkillStorage` instance — either a new one or the process singleton.
 *
 * A new instance is created (never cached) when `skillsPath` or `appConfig` is
 * provided; otherwise the lazily-built singleton is returned.
 */
export function getOrNewSkillStorage(options: GetOrNewSkillStorageOptions = {}): SkillStorage {
  const { skillsPath, appConfig } = options;

  if (skillsPath !== undefined && skillsPath !== null) {
    if (appConfig !== undefined && appConfig !== null) {
      return makeStorage(skillsConfigFromRecord(appConfig.skills as Record<string, unknown>), String(skillsPath));
    }
    // No app_config: default SkillsConfig so we never need to read config.yaml.
    return makeStorage(new SkillsConfig(), String(skillsPath));
  }

  if (appConfig !== undefined && appConfig !== null) {
    return makeStorage(skillsConfigFromRecord(appConfig.skills as Record<string, unknown>));
  }

  // If the singleton was manually injected without a config identity, skip
  // getAppConfig() entirely to avoid requiring a config.yaml on disk.
  if (_defaultSkillStorage !== null && _defaultSkillStorageConfig === null) {
    return _defaultSkillStorage;
  }

  const appConfigNow = getAppConfig();

  if (_defaultSkillStorage === null || _defaultSkillStorageConfig !== appConfigNow) {
    _defaultSkillStorage = makeStorage(skillsConfigFromRecord(appConfigNow.skills as Record<string, unknown>));
    _defaultSkillStorageConfig = appConfigNow;
  }
  return _defaultSkillStorage;
}

/** Clear the cached singleton (used in tests and hot-reload scenarios). */
export function resetSkillStorage(): void {
  _defaultSkillStorage = null;
  _defaultSkillStorageConfig = null;
}
