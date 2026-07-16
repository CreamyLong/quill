#!/usr/bin/env node
/** Upgrade config.yaml using the TypeScript runtime's YAML dependency. */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requireFromBackend = createRequire(path.join(root, "backend", "package.json"));
const YAML = requireFromBackend("yaml");
const examplePath = path.join(root, "config.example.yaml");
const configuredPath = process.env.QUILL_CONFIG_PATH;
const candidates = [configuredPath, path.join(root, "backend", "config.yaml"), path.join(root, "config.yaml")].filter(Boolean);
const configPath = candidates.find((candidate) => fs.existsSync(candidate));

if (!fs.existsSync(examplePath)) {
  throw new Error(`config.example.yaml not found at ${examplePath}`);
}
if (!configPath) {
  fs.copyFileSync(examplePath, path.join(root, "config.yaml"));
  console.log("OK config.yaml created. Please review and set your API keys.");
  process.exit(0);
}

let raw = fs.readFileSync(configPath, "utf8");
const example = YAML.parse(fs.readFileSync(examplePath, "utf8")) ?? {};
let user = YAML.parse(raw) ?? {};
const userVersion = Number(user.config_version ?? 0);
const exampleVersion = Number(example.config_version ?? 0);
if (userVersion >= exampleVersion) {
  console.log(`OK config.yaml is already up to date (version ${userVersion}).`);
  process.exit(0);
}

const migrations = {
  1: [
    ["src.community.", "quill.community."],
    ["src.sandbox.", "quill.sandbox."],
    ["src.models.", "quill.models."],
    ["src.tools.", "quill.tools."],
  ],
};
const applied = [];
for (let version = userVersion + 1; version <= exampleVersion; version += 1) {
  for (const [oldValue, newValue] of migrations[version] ?? []) {
    if (raw.includes(oldValue)) {
      raw = raw.replaceAll(oldValue, newValue);
      applied.push(`${oldValue} -> ${newValue}`);
    }
  }
}
user = YAML.parse(raw) ?? {};
const added = [];
function mergeMissing(target, source, prefix = "") {
  for (const [key, value] of Object.entries(source)) {
    const keyPath = prefix ? `${prefix}.${key}` : key;
    if (!(key in target)) {
      target[key] = structuredClone(value);
      added.push(keyPath);
    } else if (value && typeof value === "object" && !Array.isArray(value) && target[key] && typeof target[key] === "object" && !Array.isArray(target[key])) {
      mergeMissing(target[key], value, keyPath);
    }
  }
}
mergeMissing(user, example);
user.config_version = exampleVersion;
fs.copyFileSync(configPath, `${configPath}.bak`);
fs.writeFileSync(configPath, YAML.stringify(user), "utf8");
console.log(`Upgraded config.yaml: version ${userVersion} -> ${exampleVersion}`);
if (applied.length) console.log(`Applied migrations: ${applied.join(", ")}`);
if (added.length) console.log(`Added ${added.length} field(s).`);
console.log(`OK config.yaml upgraded to version ${exampleVersion}.`);
