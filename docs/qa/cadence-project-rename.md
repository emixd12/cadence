# Cadence rename execution evidence

Date: October 7, 2026. Ticket 186 remains in progress. The physical project folder is now `cadence`, with an old-path compatibility
symlink. The GitHub repository remains `emixd12/habit-tracking-app`.

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
Initial base: `5e7ebdeb67082ebae12b41713507b027bdf726c8` from refreshed `origin/main`.
Current base: deployed app commit `9eda5c039bbf1c6e306a40a2a720f8d0cb02c43a`; see the correction below.

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

## Initial local relocation blocker (superseded by the compatibility-link decision)

Computer Use returned: "Computer Use is not allowed to use the app
'com.openai.codex' for safety reasons." Exposed Codex tools provide no project
relocation operation. No alternative UI-control mechanism was attempted.

Official documentation describes Project menu > Edit project > Add folder and
Make primary: https://learn.chatgpt.com/docs/projects . It explicitly describes
new-chat defaults; it does not prove migration of this project's existing chat
working directories or permissions. The owner's October 7 screenshot confirms
that Edit project exposes a name field, the current source folder with a remove
control, Add folder, and Save. It shows no explicit relocation control. Changing
the name field does not rename the filesystem directory or GitHub repository.
The screenshot does not establish that existing chats follow a changed source folder.

Next required step: establish supported project reassociation and existing-chat access before moving
files. Do not edit live Codex databases/global state to bypass the gate. Preserve
Popmelt's existing store identity and validate it after a controlled relocation.

## Remaining execution

The plan's remaining Codex source-folder reassociation, deployment preflight,
repository rename, new Pages seed, native updater compatibility, production
promotion, full verification, and scheduled-publication observation remain open.
Vercel source-commit metadata and the complete environment baseline still need capture.
Both Codex automations remain paused and unchanged. No workflow was disabled.
All 17 pre-existing changed paths in the main checkout remain intact; Ticket 186
text was appended to the already modified ticket file without replacing its content.

## October 7 continuation: validated preparation

The owner changed the Codex display name to `cadence` through Edit project.
Readback retained project ID `local-7b732c2eb477d9f46eabb9aa15a2c30b` and the
original source folder. The owner confirmed existing chats remain listed.
The owner then explicitly selected an old-path compatibility link. The physical
folder may move to `cadence` while `habit-tracking-app` remains a symlink. This
supersedes the requirement to migrate every old chat path before the local move.
Keep the link until all dependent chats, tools and permissions are verified.
Do not use it to bypass sandbox permissions; use authorized new-root operations.

A disposable macOS `renameatx_np(RENAME_SWAP)` rehearsal passed the forward move,
inode/content preservation and reverse move, including preserving post-move writes.
The initial rehearsal assertion compared `/var` with `/private/var`; normalizing
both paths fixed the check. No repository folder was touched by the rehearsal.
An atomic swap avoids any interval where the old path is missing. Ordinary code
writers/builds must be idle; the Popmelt bridge can retain its existing path and
open handles through the link. No live Codex state/database rewrite is needed.

### Production baseline correction

Production app deployment `dpl_9u3Ki7ZjgCnHwGiL9FTVBGNhFt1n` came from the CLI.
The existing September 26 ledger records a clean archive of commit
`9eda5c039bbf1c6e306a40a2a720f8d0cb02c43a`. It contains ten already-deployed
commits beyond `origin/main` (`5e7ebdeb67082ebae12b41713507b027bdf726c8`).
The Vercel connector omits that deployment's source metadata, so provider-side
source-commit readback remains required before promotion. Deploying a patch
based only on `main` would regress the app.

The two rename commits were replayed onto that deployed app commit. The original
main-based preparation remains on `codex/project-rename-main-baseline` at
`196a00d`. The active migration branch remains `codex/project-rename`; its diff
against the deployed commit contains only migration work. The ticket append
conflict retained both deployed tickets and Ticket 186. Neither branch was pushed.
Marketing files are identical between the two baseline commits. Reconcile main
with the already-deployed history before any scheduled workflow/main promotion;
do not merge the newer working feature branch.

Active source, release/feed, marketing and legal repository references now use
`cadence` in the isolated patch. The reference catalog is `2026-10-07.1`, with
`cadence-manual-truth` revision 2; review dates and source meaning are unchanged.
Legacy Trust fixtures, historical records and local Supabase identity remain intact.

All 15 non-source-audit checks from Task 9 pass on the corrected baseline with
Node 24.19.0. Tests: 2,332 passed, 29 skipped across five existing gated suites.
Web, marketing and desktop builds pass; lint, TypeScript, governance, resolver,
Trust, portability and design-system checks pass. Logs:
`/private/tmp/cadence-rename-20261007/checks-production/`.

The shared worktree's all-ref source scan found one pre-existing synthetic test
URL in unrelated local commit `950855010583281b3db3cb9bbeb1b5487bb58b64`.
It is a literal test placeholder with an interpolated host, not a live credential.
No scanner rule or historical commit was changed. A complete, non-shallow,
single-branch clone of the intended publication history passed the unchanged
source scanner: 1,140 files, zero working-tree/history/client findings.

### Provider and updater preflight

Both Vercel dashboard Git pages show `emixd12/habit-tracking-app`; neither project
has deploy hooks. Both use Node 24, automatic ignored-build behavior, and inherited
Git-source policies without restrictions. App root is the repository root;
marketing root is `apps/marketing`. Framework build/install overrides are off.
The app production environment tracks `main`, with primary domain
`app.cadence-me.com`. Provider APIs confirm both existing project IDs and verified
domains `app.cadence-me.com` and `cadence-me.com`.
The existing CLI token returned HTTP 403; it was not retried or replaced.
The 2password Automation vault returned no Vercel credential reference.
Dashboard and connector inspection continued through their existing logins.
No provider configuration or production routing changed.

Downloaded both existing feeds, their advertised archives and the marketing-linked
preview.19 DMG. All five files have byte sizes and SHA-256 hashes in
`/private/tmp/cadence-rename-20261007/updater-baseline/manifest.json`.
Preview advertises `0.1.1-preview.24`; QA advertises `0.1.1-rc.3`.
Both archive signatures pass real Minisign verification with the existing public
key. No asset was installed. Code inspection confirms desktop checks may download
automatically, while installation requires a separate action. Native post-rename
redirect/download/signature acceptance still requires an isolated harness.

## Physical folder cutover

The authorized atomic swap succeeded. The physical directory is now
`/Users/emi/Coding Projects/cadence`; the old path is an absolute symlink to it.
The private `cutover/` backup contains the complete checkout and both existing
linked worktrees. Verification passed: 2,532 selected files, unchanged root inode,
HEAD/index/unrelated Git status, three worktree common directories, and Popmelt
store `store-7b732c2eb477`. Five pre-existing prunable registrations remain intact.
The atomic swap preserved old-path availability for open tool handles.

Codex's sandbox rejects a symlink as its configured writable root. This was an
execution-environment error, not an auto-review denial. An explicitly approved
operation from the new physical root succeeded. The owner must update Source
folders through Edit project; do not change sandbox settings or live app databases.
The old link remains for path compatibility after this supported project edit.

Both existing automation prompts now use the physical `cadence` path through
`automation_update`. Both retain their IDs, schedules, target chats and PAUSED
state. Design-system manifest and usage root fields now use the physical path.
The generated environment definition and Popmelt bridge retain their working
compatibility path until their supported settings/session refresh is verified.

Local post-move verification: `design-system:check` passed from the physical
root. Next.js started on the first available allowed port, 127.0.0.1:4324;
the browser rendered the sign-in page and its existing navigation. No account
sign-in or data mutation occurred. Codex Source folders still reports the old
path while the owner completes the requested supported settings edit.
