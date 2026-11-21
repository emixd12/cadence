// Prints the part of the node_modules cache key that names the installed
// dependencies. Run from the repository root: node dependency-key.mjs [root].
//
// The key covers the lockfile, .npmrc and every package manifest. It leaves out
// one thing: npm scripts that `npm ci` never runs. Adding a script such as
// `test:web-client` changed the old key and reinstalled the same packages
// (11 of the 19 key changes on main in the 30 days to November 21, 2026).
// Every other manifest field still changes the key, so a manifest that no
// longer matches the lockfile misses the cache and fails in `npm ci`.

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** The scripts `npm ci` runs for the root package and each workspace. */
const INSTALL_SCRIPTS = [
  "preinstall",
  "install",
  "postinstall",
  "prepublish",
  "preprepare",
  "prepare",
  "postprepare",
  "predependencies",
  "dependencies",
  "postdependencies",
];

const WORKSPACE_FOLDERS = ["apps", "packages"];

/** @param {string} root @returns {string[]} */
function manifestPaths(root) {
  const paths = ["package.json"];
  for (const folder of WORKSPACE_FOLDERS) {
    if (!existsSync(join(root, folder))) continue;
    for (const name of readdirSync(join(root, folder)).sort()) {
      const path = `${folder}/${name}/package.json`;
      if (existsSync(join(root, path))) paths.push(path);
    }
  }
  return paths;
}

/**
 * The manifest without the scripts `npm ci` never runs.
 * @param {string} text
 * @returns {string}
 */
function installInputs(text) {
  const manifest = JSON.parse(text);
  const scripts = manifest.scripts ?? {};
  manifest.scripts = Object.fromEntries(
    INSTALL_SCRIPTS.filter((name) => scripts[name] !== undefined).map((name) => [name, scripts[name]]),
  );
  return JSON.stringify(manifest);
}

/**
 * @param {string} root The repository root.
 * @returns {string} A SHA-256 digest in hexadecimal.
 */
export function dependencyKey(root) {
  const hash = createHash("sha256");
  const add = (/** @type {string} */ path, /** @type {string} */ content) => hash.update(`${path}\n${content}\n`);
  add("package-lock.json", readFileSync(join(root, "package-lock.json"), "utf8"));
  if (existsSync(join(root, ".npmrc"))) add(".npmrc", readFileSync(join(root, ".npmrc"), "utf8"));
  for (const path of manifestPaths(root)) add(path, installInputs(readFileSync(join(root, path), "utf8")));
  return hash.digest("hex");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.stdout.write(`${dependencyKey(process.argv[2] ?? ".")}\n`);
}
