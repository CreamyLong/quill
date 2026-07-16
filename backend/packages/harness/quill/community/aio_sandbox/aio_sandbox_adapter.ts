/**
 * Adapter that exposes an {@link AioSandbox} through the {@link SandboxBackend}
 * interface used by the agent's file/shell tools.
 *
 * The AIO sandbox container already understands virtual `/mnt/user-data` paths,
 * so this adapter is mostly a thin delegation + argument-order normalization.
 */

import type { Buffer } from "node:buffer";

import type {
  GlobOptions,
  GlobResult,
  GrepMatch,
  GrepOptions,
  GrepResult,
  ReadFileOptions,
  SandboxBackend,
  SandboxToolProvider,
  StrReplaceOutcome,
} from "../../sandbox/sandbox_backend.js";
import type { AioSandbox } from "./aio_sandbox.js";
import type { AioSandboxProvider } from "./aio_sandbox_provider.js";

export class AioSandboxAdapter implements SandboxBackend {
  private readonly sandbox: AioSandbox;

  get id(): string {
    return this.sandbox.id;
  }

  constructor(sandbox: AioSandbox) {
    this.sandbox = sandbox;
  }

  executeCommand(command: string): string {
    return this.sandbox.executeCommand(command);
  }

  readFile(virtualPath: string, _options?: ReadFileOptions): string {
    return this.sandbox.readFile(virtualPath);
  }

  readFileBinary(virtualPath: string): Buffer {
    return this.sandbox.downloadFile(virtualPath);
  }

  writeFile(virtualPath: string, content: string, append = false): void {
    this.sandbox.writeFile(virtualPath, content, append);
  }

  strReplace(virtualPath: string, oldStr: string, newStr: string, replaceAll = false): StrReplaceOutcome {
    const content = this.readFile(virtualPath);
    if (!content) return "ok";
    if (!content.includes(oldStr)) return "not_found";

    let updated: string;
    if (replaceAll) {
      updated = content.split(oldStr).join(newStr);
    } else {
      const idx = content.indexOf(oldStr);
      updated = content.slice(0, idx) + newStr + content.slice(idx + oldStr.length);
    }
    this.writeFile(virtualPath, updated, false);
    return "ok";
  }

  listDir(virtualPath: string, maxDepth = 2): string[] {
    return this.sandbox.listDir(virtualPath, maxDepth);
  }

  glob(virtualPath: string, pattern: string, options: GlobOptions = {}): GlobResult {
    const [paths, truncated] = this.sandbox.glob(virtualPath, pattern, {
      includeDirs: options.includeDirs ?? false,
      maxResults: options.maxResults ?? 200,
    });
    return { paths, truncated };
  }

  grep(pattern: string, virtualPath: string, options: GrepOptions = {}): GrepResult {
    const [matches, truncated] = this.sandbox.grep(virtualPath, pattern, {
      glob: options.glob ?? null,
      literal: options.literal ?? false,
      caseSensitive: options.caseSensitive ?? false,
      maxResults: options.maxResults ?? 100,
    });
    return {
      matches: matches.map((m: GrepMatch) => ({
        path: m.path,
        line_number: m.line_number,
        line: m.line,
      })),
      truncated,
    };
  }
}

/** Provider wrapper that adapts {@link AioSandboxProvider} for tool use. */
export class AioSandboxToolProvider implements SandboxToolProvider {
  private readonly provider: AioSandboxProvider;

  constructor(provider: AioSandboxProvider) {
    this.provider = provider;
  }

  async acquire(threadId: string): Promise<AioSandboxAdapter> {
    const sandboxId = await this.provider.acquire(threadId);
    const sandbox = this.provider.get(sandboxId);
    if (sandbox === null) {
      throw new Error(`AIO sandbox ${sandboxId} was acquired but is no longer tracked`);
    }
    return new AioSandboxAdapter(sandbox as AioSandbox);
  }
}
