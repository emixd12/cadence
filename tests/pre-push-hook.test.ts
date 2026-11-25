import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Runs the real .githooks/pre-push through `git push` in throwaway
 * repositories. Stub npm, npx and node on PATH record what the hook runs, so
 * no real check or test runs here.
 */

const repoRoot = path.resolve(__dirname, "..");
const hooksDir = path.join(repoRoot, ".githooks");
const BLOCKED =
  "push blocked by .githooks/pre-push; fix the check or set CADENCE_SKIP_PRE_PUSH=1 and say why in the PR";

let tmp: string;
let stubBin: string;

const baseEnv: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.invalid",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.invalid",
  GIT_TERMINAL_PROMPT: "0",
};
delete baseEnv.CADENCE_ALLOW_STALE_BRANCH;
delete baseEnv.CADENCE_SKIP_PRE_PUSH;
delete baseEnv.CLAUDE_CODE_REMOTE;

function writeStub(name: string, body: string) {
  const file = path.join(stubBin, name);
  fs.writeFileSync(file, `#!/bin/sh\n${body}\n`);
  fs.chmodSync(file, 0o755);
}

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cadence-pre-push-"));
  stubBin = path.join(tmp, "bin");
  fs.mkdirSync(stubBin);
  // `npm run --silent <check>` fails when STUB_FAIL names that check.
  writeStub(
    "npm",
    [
      'echo "npm $*" >>"$STUB_LOG"',
      'if [ -n "$STUB_FAIL" ] && [ "$3" = "$STUB_FAIL" ]; then echo "stub $3 failed: count is stale"; exit 1; fi',
      "exit 0",
    ].join("\n"),
  );
  writeStub(
    "npx",
    [
      'echo "npx $*" >>"$STUB_LOG"',
      'if [ -n "$STUB_FAIL" ] && [ "$2" = "$STUB_FAIL" ]; then echo "stub vitest $2 failed"; exit 1; fi',
      "exit 0",
    ].join("\n"),
  );
  // Report Node 24 so the hook never puts the machine's real Node 24 ahead of the stubs.
  writeStub("node", "echo 24");
});

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function run(cwd: string, args: string[], env: Record<string, string> = {}) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...baseEnv, PATH: `${stubBin}:${process.env.PATH}`, ...env },
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function git(cwd: string, ...args: string[]) {
  // Setup commands bypass both hooks; the orphan branch case needs the branch guard off.
  const result = run(cwd, args, { CADENCE_SKIP_PRE_PUSH: "1", CADENCE_ALLOW_STALE_BRANCH: "1" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout.trim();
}

/** A clone with origin/main, a feature branch with one .ts change, and node_modules. */
function makeRepo(name: string) {
  const dir = path.join(tmp, name);
  fs.mkdirSync(dir);
  git(dir, "init", "--quiet", "--bare", "-b", "main", "origin.git");
  git(dir, "clone", "--quiet", "origin.git", "work");
  const work = path.join(dir, "work");
  fs.mkdirSync(path.join(work, "tests"));
  fs.writeFileSync(path.join(work, "tests", "scheduled-for-drift.test.ts"), "// governance\n");
  fs.writeFileSync(path.join(work, "README.md"), "base\n");
  git(work, "add", ".");
  git(work, "commit", "--quiet", "-m", "base");
  git(work, "push", "--quiet", "origin", "main");
  git(work, "config", "core.hooksPath", hooksDir);
  git(work, "switch", "--quiet", "-c", "feature", "origin/main");
  fs.mkdirSync(path.join(work, "src"));
  fs.writeFileSync(path.join(work, "src", "a.ts"), "export const a = 1;\n");
  fs.writeFileSync(path.join(work, "README.md"), "changed\n");
  git(work, "add", ".");
  git(work, "commit", "--quiet", "-m", "feature");
  fs.mkdirSync(path.join(work, "node_modules"));
  const log = path.join(dir, "calls.log");
  fs.writeFileSync(log, "");
  return { work, log, calls: () => fs.readFileSync(log, "utf8") };
}

describe("pre-push hook", () => {
  it("runs the fast checks, the governance tests and vitest related, one line per step", () => {
    const repo = makeRepo("pass");
    const result = run(repo.work, ["push", "--quiet", "origin", "feature"], { STUB_LOG: repo.log });
    expect(result.status).toBe(0);
    const calls = repo.calls();
    for (const check of ["agents:check", "interactions:check", "map:check", "resolvers:check"]) {
      expect(calls).toContain(`npm run --silent ${check}`);
      expect(result.stderr).toMatch(new RegExp(`pre-push: ok   ${check} \\(\\d+ s\\)`));
    }
    expect(calls).toContain(
      "npx vitest run tests/scheduled-for-drift.test.ts --exclude=.local/** --exclude=.claude/** " +
        "--exclude=tests/acceptance-web-client/**",
    );
    // Only the .ts file is passed; README.md is not.
    expect(calls).toContain(
      "npx vitest related --run --passWithNoTests src/a.ts --exclude=.local/** --exclude=.claude/** " +
        "--exclude=tests/acceptance-web-client/**",
    );
    expect(result.stderr).toContain("pre-push: ok   vitest related for 1 changed file(s)");
    expect(result.stderr).not.toContain(BLOCKED);
    expect(git(repo.work, "ls-remote", "origin", "refs/heads/feature")).not.toBe("");
  });

  it("blocks the push when a check fails and prints that check's output", () => {
    const repo = makeRepo("fail");
    const result = run(repo.work, ["push", "--quiet", "origin", "feature"], {
      STUB_LOG: repo.log,
      STUB_FAIL: "map:check",
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("pre-push: FAIL map:check");
    expect(result.stderr).toContain("stub map:check failed: count is stale");
    expect(result.stderr).toContain(BLOCKED);
    // The other checks still ran, so one push shows every failure.
    expect(repo.calls()).toContain("npm run --silent resolvers:check");
    expect(git(repo.work, "ls-remote", "origin", "refs/heads/feature")).toBe("");
  });

  it("blocks the push when the related tests fail", () => {
    const repo = makeRepo("fail-related");
    const result = run(repo.work, ["push", "--quiet", "origin", "feature"], {
      STUB_LOG: repo.log,
      STUB_FAIL: "related",
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("pre-push: FAIL vitest related for 1 changed file(s)");
    expect(result.stderr).toContain(BLOCKED);
  });

  it("lets a push that only deletes refs through without running checks", () => {
    const repo = makeRepo("delete");
    git(repo.work, "push", "--quiet", "origin", "feature");
    const result = run(repo.work, ["push", "--quiet", "origin", ":feature"], {
      STUB_LOG: repo.log,
      STUB_FAIL: "agents:check",
    });
    expect(result.status).toBe(0);
    expect(repo.calls()).toBe("");
    expect(git(repo.work, "ls-remote", "origin", "refs/heads/feature")).toBe("");
  });

  it("skips with a note when origin/main does not exist", () => {
    const repo = makeRepo("no-base");
    git(repo.work, "update-ref", "-d", "refs/remotes/origin/main");
    const result = run(repo.work, ["push", "--quiet", "origin", "feature"], {
      STUB_LOG: repo.log,
      STUB_FAIL: "agents:check",
    });
    expect(result.status).toBe(0);
    expect(result.stderr).toContain("pre-push: origin/main does not exist here; checks skipped.");
    expect(repo.calls()).toBe("");
  });

  it("skips with a note when merge-base finds no common commit", () => {
    const repo = makeRepo("no-merge-base");
    git(repo.work, "switch", "--quiet", "--orphan", "unrelated");
    git(repo.work, "commit", "--quiet", "--allow-empty", "-m", "unrelated");
    const result = run(repo.work, ["push", "--quiet", "origin", "unrelated"], {
      STUB_LOG: repo.log,
      STUB_FAIL: "agents:check",
    });
    expect(result.status).toBe(0);
    expect(result.stderr).toContain("pre-push: git merge-base HEAD origin/main failed; checks skipped.");
    expect(repo.calls()).toBe("");
  });

  it("honors CADENCE_SKIP_PRE_PUSH=1", () => {
    const repo = makeRepo("skip");
    const result = run(repo.work, ["push", "--quiet", "origin", "feature"], {
      STUB_LOG: repo.log,
      STUB_FAIL: "agents:check",
      CADENCE_SKIP_PRE_PUSH: "1",
    });
    expect(result.status).toBe(0);
    expect(result.stderr).toContain("pre-push: skipped (CADENCE_SKIP_PRE_PUSH=1).");
    expect(repo.calls()).toBe("");
  });

  it("skips in Claude Code cloud sessions and without node_modules", () => {
    const repo = makeRepo("cloud");
    const cloud = run(repo.work, ["push", "--quiet", "origin", "feature"], {
      STUB_LOG: repo.log,
      STUB_FAIL: "agents:check",
      CLAUDE_CODE_REMOTE: "true",
    });
    expect(cloud.status).toBe(0);
    expect(repo.calls()).toBe("");

    git(repo.work, "push", "--quiet", "origin", ":feature");
    fs.rmSync(path.join(repo.work, "node_modules"), { recursive: true });
    const bare = run(repo.work, ["push", "--quiet", "origin", "feature"], {
      STUB_LOG: repo.log,
      STUB_FAIL: "agents:check",
    });
    expect(bare.status).toBe(0);
    expect(bare.stderr).toContain("pre-push: node_modules is missing; checks skipped. Run npm ci.");
    expect(repo.calls()).toBe("");
  });

  it("skips vitest related when no .ts, .tsx or .mjs file changed", () => {
    const repo = makeRepo("docs-only");
    git(repo.work, "switch", "--quiet", "-c", "docs", "origin/main");
    fs.writeFileSync(path.join(repo.work, "README.md"), "docs only\n");
    git(repo.work, "commit", "--quiet", "-am", "docs");
    const result = run(repo.work, ["push", "--quiet", "origin", "docs"], { STUB_LOG: repo.log });
    expect(result.status).toBe(0);
    expect(repo.calls()).not.toContain("vitest related");
    expect(result.stderr).toContain("pre-push: skip vitest related");
  });
});
