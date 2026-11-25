#!/usr/bin/env node
// Git freshness for any agent or person working in this repository
// (AGENTS.md, "Git branches and worktrees"; docs/OPERATIONS.md, "Branches and
// worktrees").
//
//   npm run git:fresh
//     Turns on the versioned Git hooks in .githooks for this clone, fetches
//     origin, fast-forwards local main, deletes local branches whose remote
//     branch is gone after a merge, and prints what still needs a decision.
//     It rewrites an absolute core.hooksPath that points at this repository's
//     .githooks to the relative form, so each worktree runs its own hooks, and
//     prompts for a separate STATUS.md archive PR when origin/main's STATUS.md
//     nears the agents:check limit. Prints nothing when everything is current.
//
// Agent session-start hooks (.claude/settings.json, .codex/hooks.json) call
// this same command. It exits 0 on every error so a Git problem never blocks a
// session.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE = "origin/main";
const HOOKS_PATH = ".githooks";
const FETCH_TIMEOUT_MS = 15_000;
const STALE_DAYS = 14;
const STATUS_LIMIT_BYTES = 40_000; // scripts/check-agents.mjs fails above this.
const STATUS_ARCHIVE_PROMPT_BYTES = 34_000;
const STATUS_ARCHIVE_BRANCH = "chore/status-archive";

// ---------------------------------------------------------------------------
// Report (pure)

export function formatReport(state) {
  const lines = [];
  if (state.hooks) lines.push(`- ${state.hooks}`);
  if (state.fetchError) {
    lines.push(`- \`git fetch origin\` failed (${state.fetchError}). ${BASE} may be stale.`);
  }
  if (state.mainUpdate) lines.push(`- ${state.mainUpdate}`);
  const archive = formatStatusArchive(state.statusArchive);
  if (archive) lines.push(`- ${archive}`);
  if (state.current && state.current.branch !== "main" && state.current.behind > 0) {
    lines.push(
      `- This checkout's branch \`${state.current.branch ?? "(detached)"}\` is ${state.current.behind} ` +
        `commit(s) behind ${BASE}. Rebase onto ${BASE} before new work, a push or a PR.`,
    );
  }
  if (state.deleted.length > 0) {
    lines.push(`- Deleted merged local branches whose remote branch is gone: ${state.deleted.join(", ")}.`);
  }
  if (state.mergedWorktrees.length > 0) {
    lines.push(
      `- Clean worktrees whose branch is already in ${BASE} (remove with \`git worktree remove <path>\` ` +
        `if no session uses them): ${state.mergedWorktrees.join(", ")}.`,
    );
  }
  if (state.dirtyStale.length > 0) {
    lines.push(
      `- Worktrees with uncommitted changes and no commit for ${STALE_DAYS}+ days: ` +
        `${state.dirtyStale.join(", ")}. Commit them to a draft PR or tell the owner.`,
    );
  }
  if (state.staleBranches.length > 0) {
    lines.push(
      `- Unmerged local branches with no commit for ${STALE_DAYS}+ days: ${state.staleBranches.join(", ")}.`,
    );
  }
  if (state.orphanFolders.length > 0) {
    lines.push(
      `- Folders in .claude/worktrees that are not Git worktrees (not deleted; ask the owner): ` +
        `${state.orphanFolders.join(", ")}.`,
    );
  }
  if (lines.length === 0) return "";
  return [`Git freshness (start new branches from ${BASE}):`, ...lines].join("\n");
}

/**
 * One line when STATUS.md on origin/main nears the agents:check limit. The
 * archive move runs once, on a fixed branch, in its own docs-only PR, so it
 * never hides inside a feature commit. A second session that also acts on the
 * prompt collides on the branch name instead of archiving twice.
 */
export function formatStatusArchive(statusArchive) {
  if (!statusArchive || statusArchive.bytes <= STATUS_ARCHIVE_PROMPT_BYTES) return "";
  const size =
    `STATUS.md on ${BASE} is ${statusArchive.bytes.toLocaleString("en-US")} bytes ` +
    `of the ${STATUS_LIMIT_BYTES.toLocaleString("en-US")} limit`;
  if (statusArchive.inProgress) {
    return (
      `${size}; \`origin/${STATUS_ARCHIVE_BRANCH}\` exists, so the archive is in progress. ` +
      `Do not run \`npm run status:archive\` in a feature branch.`
    );
  }
  return (
    `${size}; before feature work, run \`npm run status:archive\` on a branch named ` +
    `\`${STATUS_ARCHIVE_BRANCH}\` from ${BASE} and merge it as its own docs-only PR.`
  );
}

/**
 * What to do with core.hooksPath. `repoRoots` are the main checkout and every
 * worktree of this repository. An absolute path to the .githooks directory of
 * any of them is rewritten to the relative `.githooks`, so each worktree runs
 * its own copy of the hooks. Any other value belongs to the owner.
 */
export function hooksPathAction(current, repoRoots, resolve = path.resolve) {
  if (!current) return "set";
  if (current === HOOKS_PATH) return "keep";
  if (!path.isAbsolute(current)) return "foreign";
  const target = resolve(current);
  const ours = repoRoots.some((root) => resolve(path.join(root, HOOKS_PATH)) === target);
  return ours ? "rewrite" : "foreign";
}

// ---------------------------------------------------------------------------
// Git state (impure)

function git(args, options = {}) {
  const result = spawnSync("git", args, {
    encoding: "utf8",
    timeout: options.timeout ?? 10_000,
    cwd: options.cwd,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  return {
    ok: result.status === 0,
    out: (result.stdout ?? "").trim(),
    err: (result.stderr ?? "").trim() || (result.error ? String(result.error.message) : ""),
  };
}

const isAncestor = (a, b) => git(["merge-base", "--is-ancestor", a, b]).ok;

function parseWorktrees(porcelain) {
  return porcelain
    .split("\n\n")
    .map((block) => {
      const entry = {};
      for (const line of block.split("\n")) {
        const [key, ...rest] = line.split(" ");
        entry[key] = rest.join(" ") || true;
      }
      return {
        path: entry.worktree,
        branch: typeof entry.branch === "string" ? entry.branch.replace("refs/heads/", "") : null,
        bare: Boolean(entry.bare),
      };
    })
    .filter((entry) => entry.path);
}

function relative(root, target) {
  const rel = path.relative(root, target);
  if (rel === "") return "the main checkout";
  return !rel.startsWith("..") && !path.isAbsolute(rel) ? rel : target;
}

function realPath(target) {
  try {
    return fs.realpathSync(target);
  } catch {
    return path.resolve(target);
  }
}

function installHooks(topLevel, repoRoots) {
  if (!fs.existsSync(path.join(topLevel, HOOKS_PATH, "reference-transaction"))) return null;
  const current = git(["config", "--get", "core.hooksPath"]).out;
  const action = hooksPathAction(current, repoRoots, realPath);
  if (action === "keep") return null;
  if (action === "foreign") {
    return `core.hooksPath is \`${current}\`, so the branch guard in ${HOOKS_PATH} is off. Tell the owner.`;
  }
  const set = git(["config", "core.hooksPath", HOOKS_PATH]).ok;
  if (action === "rewrite") {
    return set
      ? `Rewrote core.hooksPath from \`${current}\` to \`${HOOKS_PATH}\`, so each worktree runs its own hooks.`
      : `core.hooksPath is \`${current}\`; rewriting it to \`${HOOKS_PATH}\` failed.`;
  }
  return set
    ? `Turned on the Git hooks in ${HOOKS_PATH} for this clone (branch guard, pre-push checks).`
    : `Could not set core.hooksPath to ${HOOKS_PATH}.`;
}

function statusArchiveState() {
  const size = git(["cat-file", "-s", `${BASE}:STATUS.md`]);
  if (!size.ok) return null;
  return {
    bytes: Number(size.out) || 0,
    inProgress: git(["rev-parse", "--verify", "--quiet", `refs/remotes/origin/${STATUS_ARCHIVE_BRANCH}`]).ok,
  };
}

export function collectState() {
  const state = {
    hooks: null,
    fetchError: null,
    mainUpdate: null,
    statusArchive: null,
    current: null,
    deleted: [],
    mergedWorktrees: [],
    dirtyStale: [],
    staleBranches: [],
    orphanFolders: [],
  };

  const topLevel = git(["rev-parse", "--show-toplevel"]);
  if (!topLevel.ok) return null;
  const commonDir = path.resolve(topLevel.out, git(["rev-parse", "--git-common-dir"]).out);
  const mainRoot = path.dirname(commonDir);
  const here = path.resolve(topLevel.out);

  git(["worktree", "prune"]);
  const worktrees = parseWorktrees(git(["worktree", "list", "--porcelain"]).out);
  state.hooks = installHooks(here, [mainRoot, here, ...worktrees.map((entry) => entry.path)]);

  const fetch = git(["fetch", "origin", "--prune", "--quiet"], { timeout: FETCH_TIMEOUT_MS });
  if (!fetch.ok) state.fetchError = fetch.err.split("\n")[0] || "timed out";
  if (!git(["rev-parse", "--verify", "--quiet", BASE]).ok) return state;
  state.statusArchive = statusArchiveState();
  const checkedOut = new Set(worktrees.map((entry) => entry.branch).filter(Boolean));
  const currentBranch = git(["symbolic-ref", "--quiet", "--short", "HEAD"]).out || null;

  // Local main: fast-forward it where it is checked out, or move the ref.
  if (git(["rev-parse", "--verify", "--quiet", "refs/heads/main"]).ok) {
    const behind = Number(git(["rev-list", "--count", `main..${BASE}`]).out) || 0;
    if (behind > 0) {
      const mainTree = worktrees.find((entry) => entry.branch === "main");
      if (!isAncestor("main", BASE)) {
        state.mainUpdate = `Local main has commits that are not on ${BASE}; it was not updated. Tell the owner.`;
      } else if (!mainTree) {
        const moved = git(["update-ref", "refs/heads/main", BASE, git(["rev-parse", "main"]).out]);
        state.mainUpdate = moved.ok
          ? `Fast-forwarded local main by ${behind} commit(s) to ${BASE}.`
          : `Local main is ${behind} commit(s) behind ${BASE}; updating it failed.`;
      } else {
        const merged = git(["merge", "--ff-only", "--quiet", BASE], { cwd: mainTree.path });
        state.mainUpdate = merged.ok
          ? `Fast-forwarded local main by ${behind} commit(s) in ${relative(mainRoot, mainTree.path)}.`
          : `Local main is ${behind} commit(s) behind ${BASE} and could not fast-forward ` +
            `(uncommitted changes overlap). Run \`git merge --ff-only ${BASE}\` there once they are committed.`;
      }
    }
  }

  if (currentBranch !== "main") {
    state.current = {
      branch: currentBranch,
      behind: Number(git(["rev-list", "--count", `HEAD..${BASE}`]).out) || 0,
    };
  }

  // Local branches.
  const now = Date.now();
  const refs = git([
    "for-each-ref",
    "--format=%(refname:short)%09%(upstream:track)%09%(committerdate:unix)",
    "refs/heads",
  ]).out;
  for (const line of refs.split("\n").filter(Boolean)) {
    const [branch, track, committed] = line.split("\t");
    if (branch === "main" || checkedOut.has(branch)) continue;
    const merged = isAncestor(branch, BASE);
    if (merged && track === "[gone]") {
      if (git(["branch", "-D", branch]).ok) state.deleted.push(branch);
      continue;
    }
    const ageDays = (now - Number(committed) * 1000) / 86_400_000;
    if (!merged && ageDays >= STALE_DAYS) state.staleBranches.push(branch);
  }

  // Other worktrees: report only, never remove.
  const baseTip = git(["rev-parse", BASE]).out;
  for (const entry of worktrees) {
    const full = path.resolve(entry.path);
    if (entry.bare || full === here || full === mainRoot || !fs.existsSync(full)) continue;
    const dirty = git(["status", "--porcelain"], { cwd: full }).out !== "";
    const tip = git(["rev-parse", "HEAD"], { cwd: full }).out;
    const name = relative(mainRoot, full);
    if (!dirty && tip && tip !== baseTip && isAncestor(tip, BASE)) {
      state.mergedWorktrees.push(name);
    } else if (dirty) {
      const lastCommit = Number(git(["log", "-1", "--format=%ct"], { cwd: full }).out) * 1000;
      if (now - lastCommit >= STALE_DAYS * 86_400_000) state.dirtyStale.push(name);
    }
  }

  // Leftover folders in the Claude worktree directory: report only.
  const registered = new Set(worktrees.map((entry) => path.resolve(entry.path)));
  const worktreeDir = path.join(mainRoot, ".claude", "worktrees");
  if (fs.existsSync(worktreeDir)) {
    for (const dirent of fs.readdirSync(worktreeDir, { withFileTypes: true })) {
      if (dirent.isDirectory() && !registered.has(path.join(worktreeDir, dirent.name))) {
        state.orphanFolders.push(dirent.name);
      }
    }
  }

  return state;
}

// ---------------------------------------------------------------------------
// Entry point

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    // Claude Code cloud sessions start from a fresh clone (scripts/claude-cloud-session.sh).
    if (process.env.CLAUDE_CODE_REMOTE !== "true") {
      const state = collectState();
      const report = state ? formatReport(state) : "";
      if (report) process.stdout.write(`${report}\n`);
    }
  } catch (error) {
    process.stderr.write(`git-freshness: ${error instanceof Error ? error.message : String(error)}\n`);
  }
  process.exit(0);
}
