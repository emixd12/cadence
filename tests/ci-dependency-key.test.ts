import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { dependencyKey } from "../.github/actions/setup/dependency-key.mjs";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

type Manifest = Record<string, unknown>;
const ROOT: Manifest = {
  name: "cadence", version: "0.1.0", workspaces: ["apps/*", "packages/*"],
  scripts: { test: "vitest run", postinstall: "node scripts/after-install.mjs" },
  dependencies: { next: "16.4.6" },
};
const DESKTOP: Manifest = { name: "@cadence/desktop", version: "0.1.14", scripts: { build: "vite build" }, dependencies: { react: "19.2.0" } };
const CORE: Manifest = { name: "@cadence/core", version: "0.1.0" };

function fixture(files: { root?: Manifest; desktop?: Manifest; core?: Manifest; lock?: string; npmrc?: string } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "cadence-dependency-key-"));
  roots.push(root);
  mkdirSync(path.join(root, "apps/desktop"), { recursive: true });
  mkdirSync(path.join(root, "packages/core"), { recursive: true });
  writeFileSync(path.join(root, "package.json"), JSON.stringify(files.root ?? ROOT, null, 2));
  writeFileSync(path.join(root, "apps/desktop/package.json"), JSON.stringify(files.desktop ?? DESKTOP, null, 2));
  writeFileSync(path.join(root, "packages/core/package.json"), JSON.stringify(files.core ?? CORE, null, 2));
  writeFileSync(path.join(root, "package-lock.json"), files.lock ?? '{"lockfileVersion":3,"packages":{}}');
  if (files.npmrc !== undefined) writeFileSync(path.join(root, ".npmrc"), files.npmrc);
  return root;
}
const base = () => dependencyKey(fixture());

describe("node_modules cache key", () => {
  it("is a SHA-256 digest and repeats for the same files", () => {
    expect(base()).toMatch(/^[0-9a-f]{64}$/);
    expect(base()).toBe(base());
  });

  it("keeps the key when a script that npm ci never runs is added, changed or removed", () => {
    const added = { ...ROOT, scripts: { ...(ROOT.scripts as object), "test:web-client": "vitest run tests/acceptance-web-client/" } };
    const changed = { ...ROOT, scripts: { test: "vitest run --maxWorkers=10", postinstall: "node scripts/after-install.mjs" } };
    const removed = { ...DESKTOP, scripts: {} };
    expect(dependencyKey(fixture({ root: added }))).toBe(base());
    expect(dependencyKey(fixture({ root: changed }))).toBe(base());
    expect(dependencyKey(fixture({ desktop: removed }))).toBe(base());
  });

  it.each([
    ["the lockfile", { lock: '{"lockfileVersion":3,"packages":{"node_modules/next":{"version":"16.4.7"}}}' }],
    ["a root dependency", { root: { ...ROOT, dependencies: { next: "16.4.7" } } }],
    ["a workspace dependency", { desktop: { ...DESKTOP, dependencies: { react: "19.2.1" } } }],
    ["a new dependency group", { core: { ...CORE, devDependencies: { vitest: "5.1.0" } } }],
    ["a workspace version", { desktop: { ...DESKTOP, version: "0.1.15" } }],
    ["the workspace list", { root: { ...ROOT, workspaces: ["apps/*"] } }],
    ["an overrides entry", { root: { ...ROOT, overrides: { esbuild: "0.27.0" } } }],
    ["a script that npm ci runs", { root: { ...ROOT, scripts: { test: "vitest run", postinstall: "node scripts/other.mjs" } } }],
    ["a new prepare script", { core: { ...CORE, scripts: { prepare: "node build.mjs" } } }],
    ["a new dependencies script", { root: { ...ROOT, scripts: { ...(ROOT.scripts as object), dependencies: "node sync.mjs" } } }],
    ["a new .npmrc", { npmrc: "legacy-peer-deps=true\n" }],
  ])("changes the key with %s", (_name, files) => {
    expect(dependencyKey(fixture(files))).not.toBe(base());
  });

  it("changes the key when .npmrc changes", () => {
    expect(dependencyKey(fixture({ npmrc: "legacy-peer-deps=true\n" })))
      .not.toBe(dependencyKey(fixture({ npmrc: "legacy-peer-deps=false\n" })));
  });

  it("reads every workspace manifest that the repository has", () => {
    // The key must not go stale when a workspace is added: a manifest the script
    // skipped would let a changed dependency restore an old node_modules.
    const repository = path.resolve(__dirname, "..");
    const lock = JSON.parse(readFileSync(path.join(repository, "package-lock.json"), "utf8")) as { packages: Record<string, { link?: boolean }> };
    const workspaces = Object.keys(lock.packages).filter((entry) => entry !== "" && !entry.includes("node_modules"));
    expect(workspaces.length).toBeGreaterThan(0);
    for (const workspace of workspaces) expect(workspace).toMatch(/^(apps|packages)\/[^/]+$/);
  });
});
