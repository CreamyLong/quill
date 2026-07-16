import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Integration test for GET /threads/{id}/files/tree. Boots the real gateway
 * server, registers a thread with an override workspace_directory, and hits
 * the endpoint.
 */

import { createGatewayServer } from "../../../server/gateway.ts";

let server: ReturnType<typeof createGatewayServer>["server"];
let port: number;
const baseDir = mkdtempSync(path.join(os.tmpdir(), "tree-test-"));

function req(method: string, pathname: string, body?: unknown): Promise<{ status: number; json: any }> {
  return new Promise((resolve, reject) => {
    const r = http.request(
      { host: "127.0.0.1", port, method, path: pathname, headers: { "Content-Type": "application/json" } },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode ?? 0, json: data ? JSON.parse(data) : null });
          } catch {
            resolve({ status: res.statusCode ?? 0, json: data });
          }
        });
      },
    );
    r.on("error", reject);
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

beforeAll(async () => {
  // Build a small project tree in baseDir.
  writeFileSync(path.join(baseDir, "README.md"), "# Hello\n");
  mkdirSync(path.join(baseDir, "src"));
  writeFileSync(path.join(baseDir, "src", "index.ts"), "export {};\n");
  mkdirSync(path.join(baseDir, "src", "utils"));
  writeFileSync(path.join(baseDir, "src", "utils", "helper.ts"), "");
  mkdirSync(path.join(baseDir, ".git"));
  writeFileSync(path.join(baseDir, ".git", "config"), "ignored");
  mkdirSync(path.join(baseDir, "node_modules"));
  writeFileSync(path.join(baseDir, "node_modules", "pkg.js"), "ignored");

  // Find a free port.
  port = 18000 + Math.floor(Math.random() * 1000);
  // Bring up the server (no logger, no store for test isolation).
  const handle = createGatewayServer({
    graph: { stream: async function* () { /* noop */ }, getState: async () => ({ values: {} }) } as any,
    models: [],
    logger: () => {},
  });
  server = handle.server;
  await new Promise<void>((resolve) => server.listen(port, resolve));
});

afterAll(() => {
  server?.close();
  rmSync(baseDir, { recursive: true, force: true });
});

describe("GET /threads/{id}/files/tree", () => {
  const threadId = "test-tree-thread";

  it("returns 404 for unknown thread", async () => {
    const r = await req("GET", `/threads/no-such-thread/files/tree`);
    expect(r.status).toBe(404);
  });

  it("returns tree for default sandbox (empty)", async () => {
    // First create the thread (without override) so it exists in memory.
    await req("PATCH", `/threads/${threadId}`, { metadata: {} });
    const r = await req("GET", `/threads/${threadId}/files/tree`);
    expect(r.status).toBe(200);
    expect(r.json.type).toBe("directory");
    expect(r.json.children).toBeInstanceOf(Array);
    // Override should NOT be set yet.
    expect(r.json.path).toContain(".scitops");
  });

  it("returns tree with override workspace_directory (ignores .git/node_modules)", async () => {
    // PATCH the thread metadata to set the override.
    await req("PATCH", `/threads/${threadId}`, {
      metadata: { workspace_directory: baseDir },
    });
    const r = await req("GET", `/threads/${threadId}/files/tree`);
    expect(r.status).toBe(200);
    const root = r.json;
    expect(root.type).toBe("directory");
    expect(root.name).toBe(path.basename(baseDir));
    const names = root.children.map((c: any) => c.name).sort();
    // .git and node_modules should be ignored; README.md and src present.
    expect(names).toContain("README.md");
    expect(names).toContain("src");
    expect(names).not.toContain(".git");
    expect(names).not.toContain("node_modules");
    // One level deep: src is a directory with children.
    const src = root.children.find((c: any) => c.name === "src");
    expect(src.type).toBe("directory");
    expect(src.children.map((c: any) => c.name).sort()).toContain("index.ts");
    expect(src.children.find((c: any) => c.name === "utils").type).toBe("directory");
  });
});
