# Cadence rename execution evidence

Date: October 7, 2026. Ticket 186 remains in progress. Neither the project
folder nor `emixd12/habit-tracking-app` has been renamed.

## Authority and execution boundary

The owner authorized the complete rename plan and selected a separate archive
site preserving exact historical evidence URLs. Independent preparation has
proceeded before the gated local move. No production application deployment,
updater change, database operation, or source-repository rename has occurred.

## Completed preparation

- Created a private mode-0700 backup at
  `/Users/emi/Coding Projects/.cadence-rename-backup-20261007`.
- Copied the complete 27 GB checkout with APFS cloning, including `.git`, ignored
  files, environment files, `.local`, `.popmelt`, and native build output.
- Copied the existing apple-distribution worktree separately.
- Captured HEADs, refs, index/working-tree diffs, worktree inventory, and untracked paths.
- Compared 2,529 tracked/private operational files: zero content mismatches.
  Sample restoration passed. The original Git status matched the captured status.
- Preserved Codex configuration and the two paused automation configurations.
- Captured GitHub repository, Pages, variables, environments, rulesets, main-branch
  protection, workflows, Actions permissions, releases, secret names only, hooks,
  and deploy-key metadata inside the private backup.
- Downloaded all 37 public snapshots, 37 details files, index, and latest pointer.
  All 76 files passed schema/detail validation; exact bytes have SHA-256 records.
  Copies and the manifest remain in the backup's `public-evidence` directory.

This is an initial recovery copy, not the final quiescent cutover snapshot.
Refresh volatile state and Git administration after stopping writers. Preparation
created another linked worktree after the backup, so the final worktree inventory
and backup must include it.

## Archive publication

- Repository: https://github.com/emixd12/emixd12.github.io
- GitHub repository ID: `1409433554`.
- Published commit: `a0419f47ce3cc73eeb97af1d3d910a3bbcb66588`.
- Pages deployment: https://github.com/emixd12/emixd12.github.io/actions/runs/37694983020
- Pages reports built, HTTPS enabled, no custom domain, source `main` at `/`.
- GitHub automatically enabled user-site Pages. An explicit create call returned
  HTTP 409; readback confirmed the correct existing configuration. No retry occurred.
- https://emixd12.github.io/cadence-rename-preflight.txt returned HTTP 200 and exact staged content.
- The immutable-commit raw index matches the captured public index byte-for-byte.
- The repository contains only validated public evidence and archive documentation.

The existing project site still owns `/habit-tracking-app/`. This checkpoint does
not prove user-site fallback at that path. Verify all 76 legacy URLs immediately
after the eventual source-repository rename, before any production promotion.
Refresh the archive if the old evidence publisher adds files before cutover.

## Isolated compatibility patch

Worktree: `/private/tmp/cadence-rename-release`.
Branch: `codex/project-rename`.
Base: `5e7ebdeb67082ebae12b41713507b027bdf726c8` from refreshed `origin/main`.

Changed `scripts/download-public-trust-history.mjs` to accept the exact legacy
history prefix only for the new Cadence Pages root. The downloader preserves
snapshot/details bytes, checks HTTP success and canonical paths, rejects path
collisions and file redirects, and retains every distinct referenced details file.
Other caller roots receive no archive exception.

Expanded `tests/public-trust-publication.test.ts` with two-publication retention,
exact-byte checks, canonical legacy URL retention, immutable overwrite rejection,
foreign/sibling/traversal path rejection, duplicate target detection, and missing,
redirected, or mismatched history rejection.

Verification completed with Node 24.19.0:

- Three focused Trust test files: 39 tests passed.
- Focused ESLint on the two changed code/test files: passed.
- `agents:check`: passed.
- `interactions:check`: passed; no interaction changes. The command's existing
  human-review inventory is not a new full interaction acceptance claim.
- `resolvers:check`: passed.
- `git diff --check`: passed.

Focused tests temporarily reused installed external dependencies through a
symlink after verifying identical lockfiles. That symlink was removed. A clean
worktree dependency install and full release verification remain required before
publishing the migration branch. No migration branch has been pushed or merged.

## Local relocation blocker

Computer Use returned: "Computer Use is not allowed to use the app
'com.openai.codex' for safety reasons." Exposed Codex tools provide no project
relocation operation. No alternative UI-control mechanism was attempted.

Official documentation describes Project menu > Edit project > Add folder and
Make primary: https://learn.chatgpt.com/docs/projects . It explicitly describes
new-chat defaults; it does not prove migration of this project's existing chat
working directories or permissions. The owner was unsure whether the installed
project menu exposes relocation controls.

Next required step: inspect the actual project folder controls with the owner.
Establish supported project reassociation and existing-chat access before moving
files. Do not edit live Codex databases/global state to bypass the gate. Preserve
Popmelt's existing store identity and validate it after a controlled relocation.

## Remaining execution

The plan's local move, full code/reference migration, deployment preflight,
repository rename, new Pages seed, native updater compatibility, production
promotion, full verification, and scheduled-publication observation remain open.
Vercel's complete Git/alias/environment baseline still needs capture.
Both Codex automations remain paused and unchanged. No workflow was disabled.
All 17 pre-existing changed paths in the main checkout remain intact; Ticket 186
text was appended to the already modified ticket file without replacing its content.
