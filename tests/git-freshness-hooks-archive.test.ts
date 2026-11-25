import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * scripts/git-freshness.mjs: the core.hooksPath rewrite and the STATUS.md
 * archive prompt. Every Git command runs in a throwaway repository; nothing
 * here touches this checkout's shared config.
 */

type FreshnessModule = {
  formatStatusArchive: (statusArchive: { bytes: number; inProgress: boolean } | null) => string;
  hooksPathAction: (current: string, repoRoots: string[]) => "set" | "keep" | "rewrite" | "foreign";
};

const repoRoot = path.resolve(__dirname, "..");
const script = path.join(repoRoot, "scripts", "git-freshness.mjs");

const gitEnv: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.invalid",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.invalid",
  GIT_TERMINAL_PROMPT: "0",
};
delete gitEnv.CADENCE_ALLOW_STALE_BRANCH;
delete gitEnv.CLAUDE_CODE_REMOTE;

function run(cwd: string, command: string, args: string[]) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", env: gitEnv });
  return { status: result.status, stdout: result.stdout.trim(), stderr: result.stderr.trim() };
}

function git(cwd: string, ...args: string[]) {
  const result = run(cwd, "git", args);
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout;
}

let freshness: FreshnessModule;
let tmp: string;

beforeAll(async () => {
  // @ts-expect-error The command is a plain Node ESM script.
  freshness = await import("../scripts/git-freshness.mjs");
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cadence-git-freshness-hooks-")));
});

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

/** origin plus a `work` clone whose main has STATUS.md of `statusBytes` bytes. */
function makeRepos(name: string, statusBytes: number) {
  const dir = path.join(tmp, name);
  fs.mkdirSync(dir);
  git(dir, "init", "--quiet", "--bare", "-b", "main", "origin.git");
  git(dir, "clone", "--quiet", "origin.git", "work");
  const work = path.join(dir, "work");
  fs.writeFileSync(path.join(work, "STATUS.md"), "x".repeat(statusBytes));
  git(work, "add", "STATUS.md");
  git(work, "commit", "--quiet", "-m", "base");
  git(work, "push", "--quiet", "origin", "main");
  git(work, "fetch", "--quiet", "origin");
  return { dir, work };
}

/** A no-op branch guard file, so git-freshness treats `.githooks` as present. */
function addHooksDir(work: string) {
  const hooks = path.join(work, ".githooks");
  fs.mkdirSync(hooks);
  fs.writeFileSync(path.join(hooks, "reference-transaction"), "#!/bin/sh\nexit 0\n");
  fs.chmodSync(path.join(hooks, "reference-transaction"), 0o755);
}

describe("core.hooksPath decision", () => {
  const roots = ["/repo/main", "/repo/main/.claude/worktrees/a"];

  it("sets an unset value and keeps the relative value", () => {
    expect(freshness.hooksPathAction("", roots)).toBe("set");
    expect(freshness.hooksPathAction(".githooks", roots)).toBe("keep");
  });

  it("rewrites an absolute path to this repository's .githooks, in any checkout", () => {
    expect(freshness.hooksPathAction("/repo/main/.githooks", roots)).toBe("rewrite");
    expect(freshness.hooksPathAction("/repo/main/.claude/worktrees/a/.githooks/", roots)).toBe("rewrite");
  });

  it("leaves every other value to the owner", () => {
    expect(freshness.hooksPathAction("/elsewhere/.githooks", roots)).toBe("foreign");
    expect(freshness.hooksPathAction("/repo/main/hooks", roots)).toBe("foreign");
    expect(freshness.hooksPathAction("custom-hooks", roots)).toBe("foreign");
  });
});

describe("git:fresh core.hooksPath rewrite", () => {
  it("rewrites the main checkout's absolute .githooks path to the relative form", () => {
    const { work } = makeRepos("rewrite", 10);
    addHooksDir(work);
    git(work, "config", "core.hooksPath", path.join(work, ".githooks"));
    const result = run(work, "node", [script]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      `Rewrote core.hooksPath from \`${path.join(work, ".githooks")}\` to \`.githooks\``,
    );
    expect(git(work, "config", "--get", "core.hooksPath")).toBe(".githooks");
  });

  it("rewrites from a worktree when the value names another worktree's .githooks", () => {
    const { dir, work } = makeRepos("rewrite-worktree", 10);
    addHooksDir(work);
    git(work, "add", ".githooks");
    git(work, "commit", "--quiet", "-m", "hooks");
    git(work, "push", "--quiet", "origin", "main");
    const tree = path.join(dir, "tree");
    git(work, "worktree", "add", "--quiet", "--detach", tree, "HEAD");
    git(work, "config", "core.hooksPath", path.join(tree, ".githooks"));
    const result = run(work, "node", [script]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Rewrote core.hooksPath");
    expect(git(tree, "config", "--get", "core.hooksPath")).toBe(".githooks");
  });

  it("reports a foreign value and changes nothing", () => {
    const { dir, work } = makeRepos("foreign", 10);
    addHooksDir(work);
    const foreign = path.join(dir, "other-hooks");
    git(work, "config", "core.hooksPath", foreign);
    const result = run(work, "node", [script]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`core.hooksPath is \`${foreign}\`, so the branch guard in .githooks is off. Tell the owner.`);
    expect(git(work, "config", "--get", "core.hooksPath")).toBe(foreign);
  });
});

describe("STATUS.md archive prompt", () => {
  it("formats nothing at or below 34,000 bytes", () => {
    expect(freshness.formatStatusArchive(null)).toBe("");
    expect(freshness.formatStatusArchive({ bytes: 34_000, inProgress: false })).toBe("");
  });

  it("asks for a separate archive PR on the fixed branch", () => {
    const line = freshness.formatStatusArchive({ bytes: 36_512, inProgress: false });
    expect(line).toBe(
      "STATUS.md on origin/main is 36,512 bytes of the 40,000 limit; before feature work, run " +
        "`npm run status:archive` on a branch named `chore/status-archive` from origin/main and " +
        "merge it as its own docs-only PR.",
    );
  });

  it("says the archive is in progress when the branch exists", () => {
    const line = freshness.formatStatusArchive({ bytes: 36_512, inProgress: true });
    expect(line).toContain("`origin/chore/status-archive` exists, so the archive is in progress.");
    expect(line).not.toContain("before feature work");
  });

  it("reads the size from origin/main and the archive branch from origin", () => {
    const { work } = makeRepos("archive", 35_000);
    const prompt = run(work, "node", [script]);
    expect(prompt.status).toBe(0);
    expect(prompt.stdout).toContain("STATUS.md on origin/main is 35,000 bytes of the 40,000 limit; before feature work");

    git(work, "push", "--quiet", "origin", "main:refs/heads/chore/status-archive");
    const inProgress = run(work, "node", [script]);
    expect(inProgress.stdout).toContain("the archive is in progress");
    expect(inProgress.stdout).not.toContain("before feature work");
  });

  it("stays silent when STATUS.md is small", () => {
    const { work } = makeRepos("small", 1_000);
    expect(run(work, "node", [script]).stdout).toBe("");
  });
});
