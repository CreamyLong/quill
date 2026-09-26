#!/usr/bin/env node
/**
 * prepare-bundle.mjs — assemble everything the packaged desktop app needs.
 *
 * Runs as the Tauri `beforeBuildCommand` so `tauri build` (local and CI)
 * always produces a self-contained bundle:
 *
 *   desktop/backend-bundle/   → gateway launcher + compiled backend + prod
 *                               node_modules (pruned via npm ci --omit=dev)
 *   desktop/frontend-bundle/  → Next.js standalone server (server.js +
 *                               static assets), built with the desktop
 *                               gateway URL baked into its rewrites
 *
 * The Rust shell (gateway.rs) spawns both as child processes at launch:
 * the gateway on :8200 and the frontend server on :3100, then navigates
 * the window to http://127.0.0.1:3100. Node.js must be on PATH.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(here, "..");
const repoRoot = path.resolve(desktopDir, "..");
const backendDir = path.join(repoRoot, "backend");
const frontendDir = path.join(repoRoot, "frontend");
const bundlesDir = path.join(desktopDir, "src-tauri", "bundles");
const backendBundle = path.join(bundlesDir, "backend-bundle");
const frontendBundle = path.join(bundlesDir, "frontend-bundle");

const GATEWAY_PORT = "8200";
const FRONTEND_PORT = "3100";

function log(msg) {
  console.log(`[prepare-bundle] ${msg}`);
}

// Windows resolves npm/pnpm/npx through .cmd shims that execFileSync cannot
// spawn directly — use the .cmd names there.
const IS_WIN = process.platform === "win32";
function cmdFor(cmd) {
  return IS_WIN && ["npm", "pnpm", "npx"].includes(cmd) ? `${cmd}.cmd` : cmd;
}

function run(cmd, args, opts = {}) {
  execFileSync(cmdFor(cmd), args, { stdio: "inherit", ...opts });
}

function copyDir(src, dest, filter) {
  fs.mkdirSync(dest, { recursive: true });
  if (!filter) {
    // Fast path: recursive copy that DEREFERENCES symlinks (pnpm's
    // node_modules is a forest of symlinks into .pnpm; real files survive
    // any bundler, including Tauri's resource copier).
    fs.cpSync(src, dest, { recursive: true });
    return;
  }
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (!filter(entry)) continue;
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d, filter);
    else fs.copyFileSync(s, d);
  }
}

function rmrf(p) {
  // macOS rmSync(recursive) can fail transiently (EACCES/ENOTEMPTY) — retry.
  for (let i = 0; i < 5; i += 1) {
    try {
      fs.rmSync(p, { recursive: true, force: true });
      return;
    } catch (err) {
      if (i === 4) throw err;
    }
  }
}

// ---------------------------------------------------------------------------
// 1. Backend: compile TS → dist (skipped when dist is newer than sources)
// ---------------------------------------------------------------------------

function buildBackend() {
  const distMarker = path.join(backendDir, "dist", "packages", "harness", "quill", "server", "gateway.js");
  if (fs.existsSync(distMarker)) {
    log("backend dist already built — skipping tsc");
    return;
  }
  if (!fs.existsSync(path.join(backendDir, "node_modules"))) {
    log("installing backend dependencies…");
    run("npm", ["ci"], { cwd: backendDir });
  }
  log("compiling backend (tsc)…");
  run("npm", ["run", "build"], { cwd: backendDir });
}

// ---------------------------------------------------------------------------
// 2. Backend bundle: scripts + dist + package.json + pruned node_modules
// ---------------------------------------------------------------------------

function bundleBackend() {
  rmrf(backendBundle);
  fs.mkdirSync(backendBundle, { recursive: true });

  log("copying backend scripts + dist + manifests…");
  copyDir(path.join(backendDir, "scripts"), path.join(backendBundle, "scripts"));
  copyDir(path.join(backendDir, "dist"), path.join(backendBundle, "dist"));
  fs.copyFileSync(path.join(backendDir, "package.json"), path.join(backendBundle, "package.json"));
  fs.copyFileSync(
    path.join(backendDir, "package-lock.json"),
    path.join(backendBundle, "package-lock.json"),
  );

  log("installing production-only node_modules (npm ci --omit=dev)…");
  run("npm", ["ci", "--omit=dev", "--no-audit", "--no-fund"], { cwd: backendBundle });

  // .bin holds symlinks that confuse some bundlers; the gateway never uses them.
  rmrf(path.join(backendBundle, "node_modules", ".bin"));
  log("backend bundle ready");
}

// ---------------------------------------------------------------------------
// 3. Frontend: Next.js standalone build with desktop gateway URL baked in
// ---------------------------------------------------------------------------

function buildFrontend() {
  if (!fs.existsSync(path.join(frontendDir, "node_modules"))) {
    log("installing frontend dependencies…");
    run("pnpm", ["install", "--frozen-lockfile"], { cwd: frontendDir });
  }
  log("building frontend (Next.js standalone, gateway → 127.0.0.1:" + GATEWAY_PORT + ")…");
  run("npx", ["next", "build"], {
    cwd: frontendDir,
    env: {
      ...process.env,
      NEXT_CONFIG_BUILD_OUTPUT: "standalone",
      QUILL_INTERNAL_GATEWAY_BASE_URL: `http://127.0.0.1:${GATEWAY_PORT}`,
      PORT: FRONTEND_PORT,
    },
  });
}

function bundleFrontend() {
  const standalone = path.join(frontendDir, ".quill-dist", "standalone");
  if (!fs.existsSync(path.join(standalone, "server.js"))) {
    throw new Error(`standalone build missing: ${standalone}/server.js — build the frontend first`);
  }
  rmrf(frontendBundle);
  fs.mkdirSync(frontendBundle, { recursive: true });

  log("copying Next standalone server…");
  copyDir(standalone, frontendBundle);
  // Next requires the static assets and public dir beside the standalone server.
  copyDir(path.join(frontendDir, ".quill-dist", "static"), path.join(frontendBundle, ".quill-dist", "static"));
  if (fs.existsSync(path.join(frontendDir, "public"))) {
    copyDir(path.join(frontendDir, "public"), path.join(frontendBundle, "public"));
  }
  log("frontend bundle ready");

  // Ship the config template alongside the bundles (seeds the user's
  // config.yaml on first run).
  fs.copyFileSync(
    path.join(repoRoot, "config.example.yaml"),
    path.join(bundlesDir, "config.example.yaml"),
  );
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

try {
  if (process.env.QUILL_PREPARE_SKIP === "1" && fs.existsSync(path.join(backendBundle, "scripts", "gateway_server.mjs")) && fs.existsSync(path.join(frontendBundle, "server.js"))) {
    log("QUILL_PREPARE_SKIP=1 and bundles exist — skipping (CI always builds fresh)");
  } else {
    buildBackend();
    bundleBackend();
    buildFrontend();
    bundleFrontend();
  }
  log("done — desktop bundles are ready for tauri build");
} catch (err) {
  console.error(`[prepare-bundle] FAILED: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
}
