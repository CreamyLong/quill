import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // Map the src-side module specifiers used by the harness package to their
      // on-disk locations so tests import the .ts sources directly (no build
      // step needed to run the suite).
      "@/runtime/events/base": path.resolve(
        __dirname,
        "packages/harness/quill/runtime/events/store/base.ts",
      ),
    },
  },
  test: {
    globals: false,
    include: ["packages/harness/quill/**/*.test.ts"],
    environment: "node",
    // Tests touch the filesystem (JsonlRunEventStore) and use fake timers in
    // places; give them room. Poller tests use real 5s waits gated behind
    // tiny timeouts so they run fast.
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
