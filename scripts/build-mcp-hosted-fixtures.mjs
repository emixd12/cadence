import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildSync } from "esbuild";

export const FIXTURE_SOURCE = "eb5afa5be5c49b43bbad3ffd5a25d6eddff30079";
export const FIXTURE_RUNTIME_IMPORTS = Object.freeze({
  "@supabase/supabase-js": "@cadence-fixture/supabase-js",
  "@js-temporal/polyfill": "@js-temporal/polyfill",
});
const ROOT = fileURLToPath(new URL("../", import.meta.url));
const ENTRY = join(ROOT, "scripts/mcp-hosted-fixtures.entry.mjs");
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const git = (...args) => execFileSync("git", args, { cwd: ROOT, timeout: 30_000, maxBuffer: 32 * 1024 * 1024 });

// Resolve from each importer so nested frozen packages cannot be confused with
// the newer application packages hoisted at the workspace root.
export function verifyFixtureDependencies(lock, importer) {
  const dependencies = {}, visited = new Set();
  const pending = Object.entries(FIXTURE_RUNTIME_IMPORTS).map(([name, specifier]) => ({ name, specifier, importer }));
  while (pending.length) {
    const { name, specifier, importer: from } = pending.pop();
    let directory = dirname(createRequire(resolve(from)).resolve(specifier));
    let manifest, installed;
    // Some packages do not export package.json; find the package that owns the
    // resolved entry without importing or executing it.
    while (true) {
      manifest = join(directory, "package.json");
      installed = existsSync(manifest) ? JSON.parse(readFileSync(manifest)) : null;
      if (installed?.name === name) break;
      assert.notEqual(dirname(directory), directory, "fixture-dependency-drift");
      directory = dirname(directory);
    }
    const pinned = lock.packages[`node_modules/${name}`];
    assert(pinned && installed.version === pinned.version, "fixture-dependency-drift");
    assert.deepEqual(installed.dependencies ?? {}, pinned.dependencies ?? {}, "fixture-dependency-drift");
    dependencies[name] = installed.version;
    if (visited.has(manifest)) continue;
    visited.add(manifest);
    pending.push(...Object.keys(pinned.dependencies ?? {}).map(dependency => ({
      name: dependency, specifier: dependency, importer: manifest,
    })));
  }
  return dependencies;
}

// Offline build only. This does not read credentials or run the hosted fixture procedure.
export function buildFixtureBundle(output) {
  assert.equal(process.versions.node.split(".")[0], "24");
  const root = mkdtempSync(join(tmpdir(), "cadence-frozen-fixtures-"));
  try {
    execFileSync("tar", ["-xf", "-", "-C", root], {
      input: git("archive", FIXTURE_SOURCE, "lib", "packages/core", "tsconfig.json", "package-lock.json"),
      timeout: 30_000,
    });
    const lock = JSON.parse(readFileSync(join(root, "package-lock.json")));
    const dependencies = verifyFixtureDependencies(lock, resolve(output));
    mkdirSync(dirname(resolve(output)), { recursive: true });
    mkdirSync(join(root, "scripts"));
    writeFileSync(join(root, "scripts/mcp-hosted-fixtures.entry.mjs"), readFileSync(ENTRY));
    const result = buildSync({
      entryPoints: ["scripts/mcp-hosted-fixtures.entry.mjs"],
      absWorkingDir: root, bundle: true, platform: "node", format: "esm", write: false, metafile: true,
      external: Object.values(FIXTURE_RUNTIME_IMPORTS),
      alias: { "@supabase/supabase-js": FIXTURE_RUNTIME_IMPORTS["@supabase/supabase-js"],
        "@cadence/core": join(root, "packages/core/src"), "@": root },
      define: { "import.meta.fixtureSource": JSON.stringify(FIXTURE_SOURCE) },
      tsconfig: join(root, "tsconfig.json"), outfile: resolve(output), logLevel: "silent",
    });
    const inputs = [];
    for (const name of Object.keys(result.metafile.inputs)) {
      const path = resolve(root, name), sourcePath = relative(root, path);
      if (sourcePath === "scripts/mcp-hosted-fixtures.entry.mjs") continue;
      assert(!sourcePath.startsWith("..") && /^(lib|packages\/core)\//.test(sourcePath), "fixture-source-drift");
      const bytes = readFileSync(path);
      assert(bytes.equals(git("show", `${FIXTURE_SOURCE}:${sourcePath}`)), "fixture-source-drift");
      inputs.push({ path: sourcePath, sha256: digest(bytes) });
    }
    const bytes = result.outputFiles[0].contents;
    const receipt = { source: FIXTURE_SOURCE, entrySha256: digest(readFileSync(ENTRY)), bundleSha256: digest(bytes), inputs,
      runtimeImports: FIXTURE_RUNTIME_IMPORTS, dependencies };
    writeFileSync(output, bytes, { mode: 0o600, flag: "wx" });
    writeFileSync(`${output}.json`, JSON.stringify(receipt, null, 2) + "\n", { mode: 0o600, flag: "wx" });
    return receipt;
  } finally { rmSync(root, { recursive: true, force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    assert.equal(process.argv.length, 3);
    console.log(JSON.stringify(buildFixtureBundle(process.argv[2])));
  } catch {
    console.error("Frozen fixture build refused. No hosted operation ran.");
    process.exitCode = 1;
  }
}
