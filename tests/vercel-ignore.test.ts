import { spawnSync } from "node:child_process";
import {
  accessSync,
  constants,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

const SOURCE_ROOT = resolve(__dirname, "..");
const APP_SCRIPT = "scripts/vercel-ignore-app.sh";
const MARKETING_SCRIPT = "scripts/vercel-ignore-marketing.sh";

const SEED_FILES: readonly string[] = [
  "app/page.tsx",
  "components/Button.tsx",
  "lib/services/foo.ts",
  "lib/services/zip.ts",
  "lib/resolvers/export.resolver.ts",
  "packages/core/src/resolvers/export.resolver.ts",
  "packages/ui/tokens.css",
  "public/brand/google-calendar.svg",
  "package-lock.json",
  "docs/IOS_PLAN.md",
  "docs/ontology/briefing-workbench.json",
  "design-system.manifest.json",
  "STATUS.md",
  "apps/desktop/src/main.ts",
  "apps/marketing/src/pages/index.astro",
  "tests/example.test.ts",
  "scripts/tool.mjs",
  ".github/workflows/ci.yml",
];

type ScriptEnv = {
  VERCEL_ENV?: string;
  VERCEL_GIT_COMMIT_REF?: string;
  VERCEL_GIT_COMMIT_SHA?: string;
  VERCEL_GIT_PREVIOUS_SHA?: string;
  VERCEL_GIT_COMMIT_MESSAGE?: string;
};

let repo = "";

function cleanEnv(): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith("VERCEL_") || key.startsWith("GIT_")) continue;
    env[key] = value;
  }
  env.GIT_CONFIG_NOSYSTEM = "1";
  env.GIT_CONFIG_GLOBAL = "/dev/null";
  return env;
}

function git(...args: string[]): string {
  return gitIn(repo, ...args);
}

function gitIn(cwd: string, ...args: string[]): string {
  const result = spawnSync("git", args, { cwd, env: cleanEnv() as NodeJS.ProcessEnv, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  }
  return result.stdout.trim();
}

function writeRepoFile(path: string, content: string): void {
  const full = join(repo, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

function commit(paths: readonly string[], message: string): string {
  for (const path of paths) {
    writeRepoFile(path, `${path} ${Math.random()}\n`);
  }
  git("add", "-A");
  git("commit", "-q", "-m", message);
  return git("rev-parse", "HEAD");
}

function run(script: typeof APP_SCRIPT | typeof MARKETING_SCRIPT, env: ScriptEnv, root = repo): number {
  // Vercel runs each ignoreCommand from its project's root directory.
  const cwd = script === MARKETING_SCRIPT ? join(root, "apps/marketing") : root;
  const command = script === MARKETING_SCRIPT ? `bash ../../${script}` : `bash ${script}`;
  const childEnv = cleanEnv();
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) childEnv[key] = value;
  }
  const result = spawnSync("bash", ["-c", command], {
    cwd,
    env: childEnv as NodeJS.ProcessEnv,
    encoding: "utf8",
  });
  if (result.status === null) throw new Error(`${script} did not exit: ${result.stderr}`);
  return result.status;
}

function runBoth(env: ScriptEnv, root = repo): { app: number; marketing: number } {
  return { app: run(APP_SCRIPT, env, root), marketing: run(MARKETING_SCRIPT, env, root) };
}

// Vercel clones with --depth=10. A file:// URL makes git honor --depth locally.
function shallowClone(extra: readonly string[] = []): string {
  const target = mkdtempSync(join(tmpdir(), "cadence-vercel-ignore-clone-"));
  rmSync(target, { recursive: true, force: true });
  const result = spawnSync("git", ["clone", "-q", "--depth=10", ...extra, `file://${repo}`, target], {
    env: cleanEnv() as NodeJS.ProcessEnv,
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error(`git clone failed: ${result.stderr}`);
  clones.push(target);
  return target;
}

const clones: string[] = [];

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "cadence-vercel-ignore-"));
  git("init", "-q", "-b", "main");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  git("config", "commit.gpgsign", "false");
  for (const script of [APP_SCRIPT, MARKETING_SCRIPT]) {
    mkdirSync(join(repo, "scripts"), { recursive: true });
    copyFileSync(join(SOURCE_ROOT, script), join(repo, script));
  }
  commit(SEED_FILES, "seed");
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
  for (const clone of clones.splice(0)) rmSync(clone, { recursive: true, force: true });
});

function branchCommit(branch: string, paths: readonly string[], message: string) {
  const base = git("rev-parse", "HEAD");
  git("switch", "-q", "-c", branch);
  const head = commit(paths, message);
  return { base, head };
}

function productionCommit(paths: readonly string[], message = "change") {
  const base = git("rev-parse", "HEAD");
  const head = commit(paths, message);
  const env: ScriptEnv = {
    VERCEL_ENV: "production",
    VERCEL_GIT_COMMIT_REF: "main",
    VERCEL_GIT_COMMIT_SHA: head,
    VERCEL_GIT_PREVIOUS_SHA: base,
    VERCEL_GIT_COMMIT_MESSAGE: message,
  };
  return { base, head, env };
}

describe("vercel ignore scripts: previews", () => {
  it("skips both on a default branch push without opt-in, even when both surfaces change", () => {
    const { base, head } = branchCommit(
      "feat/thing",
      ["app/page.tsx", "apps/marketing/src/pages/index.astro"],
      "feat: thing",
    );
    expect(
      runBoth({
        VERCEL_ENV: "preview",
        VERCEL_GIT_COMMIT_REF: "feat/thing",
        VERCEL_GIT_COMMIT_SHA: head,
        VERCEL_GIT_PREVIOUS_SHA: base,
        VERCEL_GIT_COMMIT_MESSAGE: "feat: thing",
      }),
    ).toEqual({ app: 0, marketing: 0 });
  });

  it("builds only the app for a preview/* branch that touches app/", () => {
    const { base, head } = branchCommit("preview/app", ["app/page.tsx"], "app change");
    expect(
      runBoth({
        VERCEL_ENV: "preview",
        VERCEL_GIT_COMMIT_REF: "preview/app",
        VERCEL_GIT_COMMIT_SHA: head,
        VERCEL_GIT_PREVIOUS_SHA: base,
      }),
    ).toEqual({ app: 1, marketing: 0 });
  });

  it("builds only marketing for a preview/* branch that touches apps/marketing/", () => {
    const { base, head } = branchCommit(
      "preview/site",
      ["apps/marketing/src/pages/index.astro"],
      "site change",
    );
    expect(
      runBoth({
        VERCEL_ENV: "preview",
        VERCEL_GIT_COMMIT_REF: "preview/site",
        VERCEL_GIT_COMMIT_SHA: head,
        VERCEL_GIT_PREVIOUS_SHA: base,
      }),
    ).toEqual({ app: 0, marketing: 1 });
  });

  it("reads the commit message from git when Vercel does not supply it", () => {
    const { head } = branchCommit("feat/git-msg", ["app/page.tsx"], "app [vercel preview]");
    expect(
      runBoth({ VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "feat/git-msg", VERCEL_GIT_COMMIT_SHA: head }),
    ).toEqual({ app: 1, marketing: 0 });
  });

  it("matches [Vercel Preview] case-insensitively and diffs a first deploy against the main merge-base", () => {
    const { head } = branchCommit(
      "feat/opt-in",
      ["apps/marketing/src/pages/index.astro"],
      "site [Vercel Preview]",
    );
    expect(
      runBoth({
        VERCEL_ENV: "preview",
        VERCEL_GIT_COMMIT_REF: "feat/opt-in",
        VERCEL_GIT_COMMIT_SHA: head,
        VERCEL_GIT_PREVIOUS_SHA: "",
        VERCEL_GIT_COMMIT_MESSAGE: "site [Vercel Preview]",
      }),
    ).toEqual({ app: 0, marketing: 1 });
  });

  it("[vercel preview app] forces the app on a docs-only commit", () => {
    const { base, head } = branchCommit("feat/docs", ["docs/IOS_PLAN.md"], "docs [vercel preview app]");
    expect(
      runBoth({
        VERCEL_ENV: "preview",
        VERCEL_GIT_COMMIT_REF: "feat/docs",
        VERCEL_GIT_COMMIT_SHA: head,
        VERCEL_GIT_PREVIOUS_SHA: base,
        VERCEL_GIT_COMMIT_MESSAGE: "docs [vercel preview app]",
      }),
    ).toEqual({ app: 1, marketing: 0 });
  });

  it("[vercel preview marketing] forces marketing on a docs-only commit", () => {
    const { base, head } = branchCommit("feat/docs", ["docs/IOS_PLAN.md"], "docs [vercel preview marketing]");
    expect(
      runBoth({
        VERCEL_ENV: "preview",
        VERCEL_GIT_COMMIT_REF: "feat/docs",
        VERCEL_GIT_COMMIT_SHA: head,
        VERCEL_GIT_PREVIOUS_SHA: base,
        VERCEL_GIT_COMMIT_MESSAGE: "docs [vercel preview marketing]",
      }),
    ).toEqual({ app: 0, marketing: 1 });
  });
});

describe("vercel ignore scripts: production", () => {
  it.each([
    ["docs/IOS_PLAN.md"],
    ["STATUS.md"],
    ["apps/desktop/src/main.ts"],
    ["tests/example.test.ts"],
    ["scripts/tool.mjs"],
    [".github/workflows/ci.yml"],
  ])("skips both when only %s changes", (path) => {
    const { env } = productionCommit([path]);
    expect(runBoth(env)).toEqual({ app: 0, marketing: 0 });
  });

  it.each([
    ["app/page.tsx"],
    ["components/Button.tsx"],
    ["lib/services/foo.ts"],
    ["docs/ontology/briefing-workbench.json"],
    ["design-system.manifest.json"],
  ])("builds only the app when %s changes", (path) => {
    const { env } = productionCommit([path]);
    expect(runBoth(env)).toEqual({ app: 1, marketing: 0 });
  });

  it("builds only marketing when apps/marketing/src/pages/index.astro changes", () => {
    const { env } = productionCommit(["apps/marketing/src/pages/index.astro"]);
    expect(runBoth(env)).toEqual({ app: 0, marketing: 1 });
  });

  it.each([
    ["packages/ui/tokens.css"],
    ["public/brand/google-calendar.svg"],
    ["lib/resolvers/export.resolver.ts"],
    ["packages/core/src/resolvers/export.resolver.ts"],
    ["lib/services/zip.ts"],
    ["package-lock.json"],
  ])("builds both when shared dependency %s changes", (path) => {
    const { env } = productionCommit([path]);
    expect(runBoth(env)).toEqual({ app: 1, marketing: 1 });
  });

  it("detects production from the main ref when VERCEL_ENV is absent", () => {
    const { env } = productionCommit(["docs/IOS_PLAN.md"]);
    expect(runBoth({ ...env, VERCEL_ENV: undefined })).toEqual({ app: 0, marketing: 0 });
  });

  it("fails open when VERCEL_GIT_PREVIOUS_SHA is missing or empty", () => {
    const { env } = productionCommit(["docs/IOS_PLAN.md"]);
    expect(runBoth({ ...env, VERCEL_GIT_PREVIOUS_SHA: "" })).toEqual({ app: 1, marketing: 1 });
    expect(runBoth({ ...env, VERCEL_GIT_PREVIOUS_SHA: undefined })).toEqual({ app: 1, marketing: 1 });
  });

  it("fails open when VERCEL_GIT_PREVIOUS_SHA is not in the clone", () => {
    const { env } = productionCommit(["docs/IOS_PLAN.md"]);
    expect(
      runBoth({ ...env, VERCEL_GIT_PREVIOUS_SHA: "0123456789abcdef0123456789abcdef01234567" }),
    ).toEqual({ app: 1, marketing: 1 });
  });

  it("builds a same-commit redeploy", () => {
    const { head, env } = productionCommit(["docs/IOS_PLAN.md"]);
    expect(runBoth({ ...env, VERCEL_GIT_PREVIOUS_SHA: head })).toEqual({ app: 1, marketing: 1 });
  });

  it("[vercel force] builds both on a docs-only main commit", () => {
    const { env } = productionCommit(["docs/IOS_PLAN.md"], "docs [vercel force]");
    expect(runBoth(env)).toEqual({ app: 1, marketing: 1 });
  });
});

describe("vercel ignore wiring", () => {
  it("keeps the five crons and adds the app ignoreCommand", () => {
    const config = JSON.parse(readFileSync(join(SOURCE_ROOT, "vercel.json"), "utf8")) as {
      ignoreCommand?: string;
      crons?: Array<{ path: string; schedule: string }>;
    };
    expect(config.ignoreCommand).toBe("bash scripts/vercel-ignore-app.sh");
    expect(config.crons).toEqual([
      { path: "/api/reminders/process", schedule: "*/5 * * * *" },
      { path: "/api/occurrences/sync", schedule: "5 0 * * *" },
      { path: "/api/travel/leave-reminders/process", schedule: "*/5 * * * *" },
      { path: "/api/connectors/completions/process", schedule: "7,22,37,52 * * * *" },
      { path: "/api/advisor/coach/signals/process", schedule: "41 * * * *" },
    ]);
  });

  it("points the marketing project at its ignore script", () => {
    const config = JSON.parse(readFileSync(join(SOURCE_ROOT, "apps/marketing/vercel.json"), "utf8")) as {
      $schema?: string;
      ignoreCommand?: string;
    };
    expect(config).toEqual({
      $schema: "https://openapi.vercel.sh/vercel.json",
      ignoreCommand: "bash ../../scripts/vercel-ignore-marketing.sh",
    });
  });

  it.each([[APP_SCRIPT], [MARKETING_SCRIPT]])("%s exists and is executable", (script) => {
    expect(() => accessSync(join(SOURCE_ROOT, script), constants.X_OK)).not.toThrow();
  });
});

describe("vercel ignore scripts: clone shape and merges", () => {
  function docsCommits(count: number): void {
    for (let index = 0; index < count; index += 1) commit([`docs/note-${index}.md`], `docs ${index}`);
  }

  it("fetches a base commit older than the shallow clone depth", () => {
    const base = git("rev-parse", "HEAD");
    docsCommits(12);
    const head = git("rev-parse", "HEAD");
    const clone = shallowClone();
    expect(
      spawnSync("git", ["cat-file", "-e", `${base}^{commit}`], {
        cwd: clone,
        env: cleanEnv() as NodeJS.ProcessEnv,
      }).status,
    ).not.toBe(0);
    const env: ScriptEnv = {
      VERCEL_ENV: "production",
      VERCEL_GIT_COMMIT_REF: "main",
      VERCEL_GIT_COMMIT_SHA: head,
      VERCEL_GIT_PREVIOUS_SHA: base,
      VERCEL_GIT_COMMIT_MESSAGE: "docs 11",
    };
    expect(runBoth(env, clone)).toEqual({ app: 0, marketing: 0 });
  });

  it("builds after a targeted fetch when a dependency changed beyond the clone depth", () => {
    const base = git("rev-parse", "HEAD");
    commit(["lib/services/zip.ts"], "zip change");
    docsCommits(12);
    const head = git("rev-parse", "HEAD");
    const clone = shallowClone();
    const env: ScriptEnv = {
      VERCEL_ENV: "production",
      VERCEL_GIT_COMMIT_REF: "main",
      VERCEL_GIT_COMMIT_SHA: head,
      VERCEL_GIT_PREVIOUS_SHA: base,
      VERCEL_GIT_COMMIT_MESSAGE: "docs 11",
    };
    expect(runBoth(env, clone)).toEqual({ app: 1, marketing: 1 });
  });

  it("fails open when the base commit does not exist on the remote", () => {
    docsCommits(12);
    const head = git("rev-parse", "HEAD");
    const clone = shallowClone();
    expect(
      runBoth(
        {
          VERCEL_ENV: "production",
          VERCEL_GIT_COMMIT_REF: "main",
          VERCEL_GIT_COMMIT_SHA: head,
          VERCEL_GIT_PREVIOUS_SHA: "0123456789abcdef0123456789abcdef01234567",
          VERCEL_GIT_COMMIT_MESSAGE: "docs 11",
        },
        clone,
      ),
    ).toEqual({ app: 1, marketing: 1 });
  });

  it.each([
    ["preview/app", ["app/page.tsx"], { app: 1, marketing: 0 }],
    ["preview/site", ["apps/marketing/src/pages/index.astro"], { app: 0, marketing: 1 }],
  ] as const)("fetches origin/main in a single-branch clone of %s", (branch, paths, expected) => {
    git("switch", "-q", "-c", branch);
    commit(paths, "surface change");
    docsCommits(12);
    const head = git("rev-parse", "HEAD");
    git("switch", "-q", "main");
    commit(["docs/main-only.md"], "main moves on");
    const clone = shallowClone(["--single-branch", "--branch", branch]);
    expect(
      spawnSync("git", ["rev-parse", "--verify", "--quiet", "origin/main"], {
        cwd: clone,
        env: cleanEnv() as NodeJS.ProcessEnv,
      }).status,
    ).not.toBe(0);
    expect(
      runBoth(
        {
          VERCEL_ENV: "preview",
          VERCEL_GIT_COMMIT_REF: branch,
          VERCEL_GIT_COMMIT_SHA: head,
          VERCEL_GIT_PREVIOUS_SHA: "",
          VERCEL_GIT_COMMIT_MESSAGE: "docs 11",
        },
        clone,
      ),
    ).toEqual(expected);
  });

  it("detects a dependency change brought in by a --no-ff merge commit on main", () => {
    const base = git("rev-parse", "HEAD");
    git("switch", "-q", "-c", "feat/zip");
    commit(["lib/services/zip.ts"], "zip change");
    git("switch", "-q", "main");
    git("merge", "-q", "--no-ff", "-m", "Merge feat/zip", "feat/zip");
    const head = git("rev-parse", "HEAD");
    expect(
      runBoth({
        VERCEL_ENV: "production",
        VERCEL_GIT_COMMIT_REF: "main",
        VERCEL_GIT_COMMIT_SHA: head,
        VERCEL_GIT_PREVIOUS_SHA: base,
        VERCEL_GIT_COMMIT_MESSAGE: "Merge feat/zip",
      }),
    ).toEqual({ app: 1, marketing: 1 });
  });

  it("ignores preview force markers in a squash-merge body on main", () => {
    const message = "docs: squash (#1)\n\n* docs [vercel preview app]\n* docs [vercel preview marketing]";
    const { env } = productionCommit(["docs/IOS_PLAN.md"], message);
    expect(runBoth(env)).toEqual({ app: 0, marketing: 0 });
  });

  it("builds a same-commit manual redeploy on a preview branch without opt-in", () => {
    const { head } = branchCommit("feat/redeploy", ["docs/IOS_PLAN.md"], "docs");
    expect(
      runBoth({
        VERCEL_ENV: "preview",
        VERCEL_GIT_COMMIT_REF: "feat/redeploy",
        VERCEL_GIT_COMMIT_SHA: head,
        VERCEL_GIT_PREVIOUS_SHA: head,
        VERCEL_GIT_COMMIT_MESSAGE: "docs",
      }),
    ).toEqual({ app: 1, marketing: 1 });
  });
});

// Drift guard: every file a build reads must sit inside its script's PATHS.
const SOURCE_EXTENSIONS = [".ts", ".tsx", ".mts", ".mjs", ".js", ".jsx", ".astro", ".json", ".css"];
const IMPORT_PATTERNS: readonly RegExp[] = [
  /\b(?:import|export)\s+(?:type\s+)?[^'";]*?\bfrom\s*["']([^"']+)["']/g,
  /\bimport\s*["']([^"']+)["']/g,
  /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
  /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  /@import\s+(?:url\()?["']([^"']+)["']/g,
];
const RUNNER_IMPORT = /\brunnerImport\s*\(\s*["']([^"']+)["']/g;

function readPaths(script: string): string[] {
  const text = readFileSync(join(SOURCE_ROOT, script), "utf8");
  const block = /^PATHS=\(\n([\s\S]*?)^\)/m.exec(text);
  if (!block) throw new Error(`${script} has no PATHS=( ... ) block`);
  return block[1]
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

function covered(file: string, paths: readonly string[]): boolean {
  return paths.some((path) => file === path || file.startsWith(`${path}/`));
}

function resolveFile(candidate: string): string | null {
  const attempts = [candidate, ...SOURCE_EXTENSIONS.map((ext) => `${candidate}${ext}`)];
  attempts.push(...SOURCE_EXTENSIONS.map((ext) => join(candidate, `index${ext}`)));
  for (const attempt of attempts) {
    if (existsSync(attempt) && statSync(attempt).isFile()) return attempt;
  }
  return null;
}

type PackageExports = Record<string, string>;
const WORKSPACE_PACKAGES: Record<string, string> = {
  "@cadence/core": "packages/core",
  "@cadence/ui": "packages/ui",
};

function resolveWorkspace(specifier: string): string | null {
  for (const [name, dir] of Object.entries(WORKSPACE_PACKAGES)) {
    if (specifier !== name && !specifier.startsWith(`${name}/`)) continue;
    const subpath = specifier === name ? "." : `./${specifier.slice(name.length + 1)}`;
    const manifest = JSON.parse(readFileSync(join(SOURCE_ROOT, dir, "package.json"), "utf8")) as {
      exports?: PackageExports;
    };
    for (const [key, target] of Object.entries(manifest.exports ?? {})) {
      if (key === subpath) return resolveFile(join(SOURCE_ROOT, dir, target));
      if (key.endsWith("/*") && subpath.startsWith(key.slice(0, -1))) {
        const rest = subpath.slice(key.length - 1);
        return resolveFile(join(SOURCE_ROOT, dir, target.replace("*", rest)));
      }
    }
    return resolveFile(join(SOURCE_ROOT, dir, subpath));
  }
  return null;
}

// "@/..." means apps/marketing/src inside the marketing site and the repository root elsewhere.
function resolveSpecifier(specifier: string, importer: string): string | null {
  const bare = specifier.split("?")[0];
  if (bare.startsWith("./") || bare.startsWith("../")) return resolveFile(resolve(dirname(importer), bare));
  if (bare.startsWith("@/")) {
    const marketingSrc = join(SOURCE_ROOT, "apps/marketing/src");
    const base = importer.startsWith(`${marketingSrc}/`) ? marketingSrc : SOURCE_ROOT;
    return resolveFile(join(base, bare.slice(2)));
  }
  return resolveWorkspace(bare);
}

function importsOf(file: string): string[] {
  if (file.endsWith(".json")) return [];
  const text = readFileSync(file, "utf8");
  const found: string[] = [];
  for (const pattern of IMPORT_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      const target = resolveSpecifier(match[1], file);
      if (target) found.push(target);
    }
  }
  for (const match of text.matchAll(RUNNER_IMPORT)) {
    const target = resolveFile(join(SOURCE_ROOT, match[1]));
    if (target) found.push(target);
  }
  return found;
}

function listFiles(dir: string): string[] {
  const absolute = join(SOURCE_ROOT, dir);
  if (!existsSync(absolute)) return [];
  if (statSync(absolute).isFile()) return [absolute];
  const files: string[] = [];
  for (const entry of readdirSync(absolute, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist" || entry.name.startsWith(".")) continue;
    const child = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(child));
    else if (SOURCE_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) files.push(join(SOURCE_ROOT, child));
  }
  return files;
}

function walk(entries: readonly string[]): Set<string> {
  const seen = new Set<string>();
  const queue = [...entries];
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    queue.push(...importsOf(file));
  }
  return new Set([...seen].map((file) => relative(SOURCE_ROOT, file)));
}

describe("vercel ignore scripts: dependency boundary", () => {
  it("covers every file the marketing build imports from outside apps/marketing", () => {
    const paths = readPaths(MARKETING_SCRIPT);
    const entries = [
      ...listFiles("apps/marketing/src"),
      join(SOURCE_ROOT, "apps/marketing/scripts/build-example-bundle.mjs"),
      join(SOURCE_ROOT, "apps/marketing/astro.config.mjs"),
    ];
    const reached = [...walk(entries)].filter((file) => !file.startsWith("apps/marketing/"));
    expect(reached.length).toBeGreaterThan(0);
    expect(reached.filter((file) => !covered(file, paths)).sort()).toEqual([]);
    const workspaceManifests = ["package.json", "package-lock.json", "packages/core/package.json", "packages/ui/package.json"];
    expect(workspaceManifests.filter((file) => !covered(file, paths))).toEqual([]);
  });

  it("covers every file the app imports from outside its source roots", () => {
    const paths = readPaths(APP_SCRIPT);
    const roots = ["app", "components", "lib", "packages", "proxy.ts", "next.config.ts"];
    const entries = roots.flatMap((root) => listFiles(root));
    const coreRoots = ["app", "components", "lib", "packages", "public", "proxy.ts", "next.config.ts"];
    const outside = [...walk(entries)].filter((rel) => !covered(rel, coreRoots));
    expect(outside.length).toBeGreaterThan(0);
    expect(outside.filter((file) => !covered(file, paths)).sort()).toEqual([]);
  });
});
