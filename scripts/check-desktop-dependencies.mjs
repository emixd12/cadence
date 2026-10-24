import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));

// Tauri's JavaScript core and native runtime must share a minor version.
// Its JavaScript/native plugins require an exact version match.
// https://v2.tauri.app/develop/updating-dependencies/
export function checkDesktopDependencies(root = repositoryRoot) {
  const npmLock = JSON.parse(readFileSync(path.join(root, "package-lock.json"), "utf8"));
  const desktop = JSON.parse(readFileSync(path.join(root, "apps/desktop/package.json"), "utf8"));
  const cargoLock = readFileSync(path.join(root, "apps/desktop/src-tauri/Cargo.lock"), "utf8");
  const nativePackages = cargoLock.split(/^\[\[package\]\]\s*$/m).slice(1).map((block) => ({
    name: /^name = "([^"]+)"$/m.exec(block)?.[1],
    version: /^version = "([^"]+)"$/m.exec(block)?.[1],
  }));

  function nativeVersion(name) {
    const matches = nativePackages.filter((entry) => entry.name === name);
    if (matches.length !== 1 || !matches[0].version) {
      throw new Error(`Expected one locked native ${name} version in Cargo.lock.`);
    }
    return matches[0].version;
  }

  function javascriptVersion(name) {
    // Prefer a workspace-local installation when npm has not hoisted this dependency.
    const entry = npmLock.packages[`apps/desktop/node_modules/${name}`]
      ?? npmLock.packages[`node_modules/${name}`];
    if (!entry?.version) throw new Error(`Missing locked ${name} version in package-lock.json.`);
    return entry.version;
  }

  const api = javascriptVersion("@tauri-apps/api");
  const native = nativeVersion("tauri");
  const minor = (version) => /^(\d+\.\d+)\.\d+$/.exec(version)?.[1];
  if (!minor(api) || minor(api) !== minor(native)) {
    throw new Error(`Tauri core version mismatch: @tauri-apps/api ${api}, native tauri ${native}. Update both to the same minor version.`);
  }

  for (const name of Object.keys(desktop.dependencies ?? {}).filter((name) => name.startsWith("@tauri-apps/plugin-"))) {
    const javascript = javascriptVersion(name);
    const nativeName = name.replace("@tauri-apps/", "tauri-");
    const plugin = nativeVersion(nativeName);
    if (javascript !== plugin) {
      throw new Error(`Tauri plugin version mismatch: ${name} ${javascript}, ${nativeName} ${plugin}. Update both to the same exact version.`);
    }
  }
  return { api, native };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { api, native } = checkDesktopDependencies();
    console.log(`desktop:dependencies:check passed (API ${api}, native ${native}, plugins paired).`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
