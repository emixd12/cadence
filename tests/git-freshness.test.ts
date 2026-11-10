import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

type FreshnessModule = {
  formatReport: (state: Record<string, unknown>) => string;
};

const repoRoot = path.resolve(__dirname, "..");
const hooksDir = path.join(repoRoot, ".githooks");
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

function run(cwd: string, command: string, args: string[], env: Record<string, string> = {}) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", env: { ...gitEnv, ...env } });
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
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cadence-git-freshness-"));
});

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

/** origin with two commits on main; `work` clone is one commit behind. */
function makeRepos(name: string) {
  const dir = path.join(tmp, name);
  fs.mkdirSync(dir);
  git(dir, "init", "--quiet", "--bare", "-b", "main", "origin.git");
  git(dir, "clone", "--quiet", "origin.git", "work");
  const work = path.join(dir, "work");
  git(work, "commit", "--quiet", "--allow-empty", "-m", "base");
  git(work, "push", "--quiet", "origin", "main");
  git(dir, "clone", "--quiet", "origin.git", "other");
  const other = path.join(dir, "other");
  git(other, "commit", "--quiet", "--allow-empty", "-m", "ahead");
  git(other, "push", "--quiet", "origin", "main");
  git(work, "fetch", "--quiet", "origin");
  return { dir, work, other };
}

describe("git freshness report", () => {
  const empty = {
    hooks: null,
    fetchError: null,
    mainUpdate: null,
    current: null,
    deleted: [],
    mergedWorktrees: [],
    dirtyStale: [],
    staleBranches: [],
    orphanFolders: [],
  };

  it("prints nothing when everything is current", () => {
    expect(freshness.formatReport(empty)).toBe("");
    expect(freshness.formatReport({ ...empty, current: { branch: "feature", behind: 0 } })).toBe("");
  });

  it("names a stale branch, deleted branches and leftovers", () => {
    const report = freshness.formatReport({
      ...empty,
      current: { branch: "feature", behind: 5 },
      deleted: ["old-a", "old-b"],
      mergedWorktrees: [".claude/worktrees/done"],
      orphanFolders: ["release-0.1.7"],
    });
    expect(report).toContain("`feature` is 5 commit(s) behind origin/main");
    expect(report).toContain("old-a, old-b");
    expect(report).toContain(".claude/worktrees/done");
    expect(report).toContain("release-0.1.7");
  });
});

describe("branch guard Git hook", () => {
  it("refuses a new branch behind origin/main and allows a fresh one", () => {
    const { work } = makeRepos("guard");
    git(work, "config", "core.hooksPath", hooksDir);

    const stale = run(work, "git", ["switch", "-c", "stale"]);
    expect(stale.status).not.toBe(0);
    expect(stale.stderr).toContain("1 commit(s) behind origin/main");
    expect(run(work, "git", ["rev-parse", "--verify", "--quiet", "refs/heads/stale"]).status).not.toBe(0);

    const worktree = run(work, "git", ["worktree", "add", "-b", "wt-stale", "../wt-stale", "main"]);
    expect(worktree.status).not.toBe(0);

    expect(run(work, "git", ["switch", "-c", "fresh", "origin/main"]).status).toBe(0);
    expect(run(work, "git", ["worktree", "add", "-b", "wt-fresh", "../wt-fresh", "origin/main"]).status).toBe(0);
  });

  it("leaves existing branches, commits and deletions alone", () => {
    const { work } = makeRepos("existing");
    git(work, "config", "core.hooksPath", hooksDir);
    expect(run(work, "git", ["commit", "--allow-empty", "-m", "local"]).status).toBe(0);
    expect(run(work, "git", ["switch", "-c", "x", "origin/main"]).status).toBe(0);
    expect(run(work, "git", ["switch", "main"]).status).toBe(0);
    expect(run(work, "git", ["branch", "-D", "x"]).status).toBe(0);
  });

  it("honors the escape hatches", () => {
    const { work } = makeRepos("escape");
    git(work, "config", "core.hooksPath", hooksDir);
    expect(run(work, "git", ["branch", "a"], { CADENCE_ALLOW_STALE_BRANCH: "1" }).status).toBe(0);

    git(work, "config", "cadence.branchGuard", "warn");
    const warned = run(work, "git", ["branch", "b"]);
    expect(warned.status).toBe(0);
    expect(warned.stderr).toContain("cadence branch guard");

    git(work, "config", "cadence.branchGuard", "off");
    const off = run(work, "git", ["branch", "c"]);
    expect(off.status).toBe(0);
    expect(off.stderr).toBe("");
  });
});

describe("git:fresh command", () => {
  it("fast-forwards main, deletes merged gone branches and keeps unmerged work", () => {
    const { work, other } = makeRepos("fresh");
    // A merged branch whose remote branch was deleted after the merge.
    git(other, "switch", "--quiet", "-c", "done");
    git(other, "commit", "--quiet", "--allow-empty", "-m", "done");
    git(other, "push", "--quiet", "origin", "done");
    git(work, "fetch", "--quiet", "origin");
    git(work, "branch", "--quiet", "--track", "done", "origin/done");
    git(other, "switch", "--quiet", "main");
    git(other, "merge", "--quiet", "--no-ff", "done", "-m", "merge done");
    git(other, "push", "--quiet", "origin", "main", ":done");
    // Unmerged work whose remote branch is also gone must survive.
    git(work, "switch", "--quiet", "-c", "wip");
    git(work, "commit", "--quiet", "--allow-empty", "-m", "wip");
    git(work, "push", "--quiet", "-u", "origin", "wip");
    git(work, "push", "--quiet", "origin", ":wip");
    git(work, "switch", "--quiet", "main");

    const result = run(work, "node", [script]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Fast-forwarded local main by 3 commit(s) in the main checkout");
    expect(result.stdout).toContain("Deleted merged local branches whose remote branch is gone: done.");
    expect(git(work, "branch", "--format=%(refname:short)").split("\n").sort()).toEqual(["main", "wip"]);
    expect(git(work, "rev-parse", "main")).toBe(git(work, "rev-parse", "origin/main"));

    expect(run(work, "node", [script]).stdout).toBe("");
  });

  it("reports a branch that is behind without changing it", () => {
    const { work } = makeRepos("behind");
    git(work, "switch", "--quiet", "-c", "feature", "main");
    const tip = git(work, "rev-parse", "HEAD");
    const result = run(work, "node", [script]);
    expect(result.stdout).toContain("`feature` is 1 commit(s) behind origin/main");
    expect(git(work, "rev-parse", "HEAD")).toBe(tip);
  });
});
