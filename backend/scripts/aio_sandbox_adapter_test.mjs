/**
 * Test the AIO sandbox tool adapter.
 *
 * Run: cd backend && npm run build && node --experimental-vm-modules scripts/aio_sandbox_adapter_test.mjs
 */

import assert from "node:assert";

import { AioSandboxAdapter, AioSandboxToolProvider } from "../dist/packages/harness/quill/community/aio_sandbox/aio_sandbox_adapter.js";
import { createSandboxTools } from "../dist/packages/harness/quill/tools/builtins/sandbox_tools.js";

function makeFakeAioSandbox() {
  const files = new Map();
  return {
    id: "aio-1",
    executeCommand: (command) => `ran: ${command}`,
    readFile: (path) => files.get(path) ?? "",
    downloadFile: (path) => Buffer.from(files.get(path) ?? "", "utf-8"),
    writeFile: (path, content, append = false) => {
      files.set(path, append ? (files.get(path) ?? "") + content : content);
    },
    listDir: () => [],
    glob: () => [[], false],
    grep: () => [[], false],
  };
}

async function testAdapterReadWrite() {
  const sandbox = makeFakeAioSandbox();
  const adapter = new AioSandboxAdapter(sandbox);
  adapter.writeFile("/mnt/user-data/workspace/hello.txt", "world");
  assert.strictEqual(adapter.readFile("/mnt/user-data/workspace/hello.txt"), "world");
  console.log("✓ adapter read/write");
}

async function testAdapterStrReplace() {
  const sandbox = makeFakeAioSandbox();
  const adapter = new AioSandboxAdapter(sandbox);
  adapter.writeFile("/mnt/user-data/workspace/code.py", "print('hello')");
  const outcome = adapter.strReplace("/mnt/user-data/workspace/code.py", "hello", "world");
  assert.strictEqual(outcome, "ok");
  assert.strictEqual(adapter.readFile("/mnt/user-data/workspace/code.py"), "print('world')");
  console.log("✓ adapter str_replace");
}

async function testAdapterToolProvider() {
  let acquiredId = null;
  const fakeProvider = {
    async acquire(threadId) {
      acquiredId = threadId;
      return threadId;
    },
    get(sandboxId) {
      return { ...makeFakeAioSandbox(), id: sandboxId };
    },
  };
  const toolProvider = new AioSandboxToolProvider(fakeProvider);
  const adapter = await toolProvider.acquire("thread-42");
  assert.strictEqual(adapter.id, "thread-42");
  assert.strictEqual(acquiredId, "thread-42");
  console.log("✓ AioSandboxToolProvider acquire");
}

async function testToolsWithAdapterProvider() {
  const fakeAio = makeFakeAioSandbox();
  const provider = {
    acquire: async () => new AioSandboxAdapter(fakeAio),
  };
  const tools = createSandboxTools(provider, { hostBashAllowed: true });
  const writeFileTool = tools.find((t) => t.name === "write_file");
  const readFileTool = tools.find((t) => t.name === "read_file");
  assert.ok(writeFileTool && readFileTool);

  const writeResult = await writeFileTool.invoke({
    description: "test",
    path: "/mnt/user-data/workspace/adapter_test.txt",
    content: "adapter works",
  });
  assert.strictEqual(writeResult, "OK");

  const readResult = await readFileTool.invoke({
    description: "test",
    path: "/mnt/user-data/workspace/adapter_test.txt",
  });
  assert.ok(readResult.includes("adapter works"), `got: ${readResult}`);
  console.log("✓ sandbox tools run through AioSandboxAdapter");
}

async function main() {
  await testAdapterReadWrite();
  await testAdapterStrReplace();
  await testAdapterToolProvider();
  await testToolsWithAdapterProvider();
  console.log("\nAll AIO sandbox adapter tests passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
