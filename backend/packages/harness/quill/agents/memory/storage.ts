/**
 * Memory storage providers.
 *
 * Mirrors `quill.agents.memory.storage` from the Python backend.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { getMemoryConfig } from "../../config/memory_config.js";
import { getPaths, resolvePath } from "../../config/paths.js";

export function utcNowIsoZ(): string {
  return new Date().toISOString().replace(/\+00:00$/, "Z");
}

export function createEmptyMemory(): Record<string, unknown> {
  return {
    version: "1.0",
    lastUpdated: utcNowIsoZ(),
    user: {
      workContext: { summary: "", updatedAt: "" },
      personalContext: { summary: "", updatedAt: "" },
      topOfMind: { summary: "", updatedAt: "" },
    },
    history: {
      recentMonths: { summary: "", updatedAt: "" },
      earlierContext: { summary: "", updatedAt: "" },
      longTermBackground: { summary: "", updatedAt: "" },
    },
    facts: [],
  };
}

export interface MemoryStorage {
  load(agentName?: string | null, userId?: string | null): Record<string, unknown>;
  reload(agentName?: string | null, userId?: string | null): Record<string, unknown>;
  save(memoryData: Record<string, unknown>, agentName?: string | null, userId?: string | null): boolean;
}

export class FileMemoryStorage implements MemoryStorage {
  private memoryCache = new Map<string, [Record<string, unknown>, number | null]>();

  private validateAgentName(agentName: string): void {
    if (!agentName) {
      throw new Error("Agent name must be a non-empty string.");
    }
    const pattern = /^[A-Za-z0-9-]+$/;
    if (!pattern.test(agentName)) {
      throw new Error(`Invalid agent name ${agentName}: names must match ${pattern.source}`);
    }
  }

  private getMemoryFilePath(agentName?: string | null, userId?: string | null): string {
    const paths = getPaths();
    if (userId !== null && userId !== undefined) {
      if (agentName !== null && agentName !== undefined) {
        this.validateAgentName(agentName);
        return paths.userAgentMemoryFile(userId, agentName);
      }
      const config = getMemoryConfig();
      if (config.storagePath && path.isAbsolute(config.storagePath)) {
        return config.storagePath;
      }
      return paths.userMemoryFile(userId);
    }
    if (agentName !== null && agentName !== undefined) {
      this.validateAgentName(agentName);
      return paths.agentMemoryFile(agentName);
    }
    const config = getMemoryConfig();
    if (config.storagePath) {
      if (path.isAbsolute(config.storagePath)) {
        return config.storagePath;
      }
      return path.join(paths.baseDir, config.storagePath);
    }
    return paths.memoryFile;
  }

  private cacheKey(agentName?: string | null, userId?: string | null): string {
    return JSON.stringify([userId ?? null, agentName ?? null]);
  }

  private loadMemoryFromFile(agentName?: string | null, userId?: string | null): Record<string, unknown> {
    const filePath = this.getMemoryFilePath(agentName, userId);
    if (!fs.existsSync(filePath)) {
      return createEmptyMemory();
    }
    try {
      const text = fs.readFileSync(filePath, "utf-8");
      return JSON.parse(text) as Record<string, unknown>;
    } catch (error) {
      console.warn("Failed to load memory file:", error);
      return createEmptyMemory();
    }
  }

  load(agentName?: string | null, userId?: string | null): Record<string, unknown> {
    const filePath = this.getMemoryFilePath(agentName, userId);
    const key = this.cacheKey(agentName, userId);
    let currentMtime: number | null = null;
    try {
      currentMtime = fs.existsSync(filePath) ? fs.statSync(filePath).mtimeMs : null;
    } catch {
      currentMtime = null;
    }

    const cached = this.memoryCache.get(key);
    if (cached !== undefined && cached[1] === currentMtime) {
      return cached[0];
    }

    const memoryData = this.loadMemoryFromFile(agentName, userId);
    this.memoryCache.set(key, [memoryData, currentMtime]);
    return memoryData;
  }

  reload(agentName?: string | null, userId?: string | null): Record<string, unknown> {
    const filePath = this.getMemoryFilePath(agentName, userId);
    const memoryData = this.loadMemoryFromFile(agentName, userId);
    let mtime: number | null = null;
    try {
      mtime = fs.existsSync(filePath) ? fs.statSync(filePath).mtimeMs : null;
    } catch {
      mtime = null;
    }
    this.memoryCache.set(this.cacheKey(agentName, userId), [memoryData, mtime]);
    return memoryData;
  }

  save(memoryData: Record<string, unknown>, agentName?: string | null, userId?: string | null): boolean {
    const filePath = this.getMemoryFilePath(agentName, userId);
    const key = this.cacheKey(agentName, userId);
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      const toSave = { ...memoryData, lastUpdated: utcNowIsoZ() };
      const tempPath = `${filePath}.${crypto.randomUUID()}.tmp`;
      fs.writeFileSync(tempPath, JSON.stringify(toSave, null, 2), "utf-8");
      fs.renameSync(tempPath, filePath);
      let mtime: number | null = null;
      try {
        mtime = fs.statSync(filePath).mtimeMs;
      } catch {
        mtime = null;
      }
      this.memoryCache.set(key, [toSave, mtime]);
      return true;
    } catch (error) {
      console.error("Failed to save memory file:", error);
      return false;
    }
  }
}

let _storageInstance: MemoryStorage | null = null;

export function getMemoryStorage(): MemoryStorage {
  if (_storageInstance === null) {
    const config = getMemoryConfig();
    // The minimal TS runtime only supports FileMemoryStorage. Reflection-based
    // class loading can be added later when more storage backends are needed.
    if (config.storageClass && config.storageClass !== "quill.agents.memory.storage.FileMemoryStorage") {
      console.warn(`Memory storage '${config.storageClass}' is not supported in TS runtime; falling back to FileMemoryStorage.`);
    }
    _storageInstance = new FileMemoryStorage();
  }
  return _storageInstance;
}

export function resetMemoryStorage(): void {
  _storageInstance = null;
}
