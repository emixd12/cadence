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

## Codex source-folder reassociation

The owner saved the physical `cadence` folder through Edit project and removed
the old source-folder entry. App readback confirms the same project ID
`local-7b732c2eb477d9f46eabb9aa15a2c30b`, label `cadence`, and physical path
`/Users/emi/Coding Projects/cadence`.

This existing chat still supplies the old symlink as a sandbox writable root.
A normal shell operation fails before process creation, even with its working
directory set to the new physical path. Explicitly approved new-root access
passes a disposable-file write/read/delete check and confirms the original
Popmelt store ID. No sandbox policy or app database was edited. A fresh Codex
session must verify normal sandbox access before calling chat migration complete.
GitHub remains unchanged while that local acceptance gate is open.

## October 8 continuation: provider readback

A Claude Code session at the physical `cadence` root passed `pwd -P`, Git
toplevel and disposable write/read/delete checks without sandbox overrides.
The Codex fresh-session check remains open; this result does not close it.

The Vercel CLI login now authenticates. Read-only API readback closes the
production source-metadata gate:

| Project | Production deployment | Source | Commit | Domain |
| --- | --- | --- | --- | --- |
| `cadence` (`prj_9tZKRXZ6IdT56ZLKVSmoJH5AAYhs`) | `dpl_9u3Ki7ZjgCnHwGiL9FTVBGNhFt1n` | CLI, actor `codex` | `meta.sourceCommit` `9eda5c039bbf1c6e306a40a2a720f8d0cb02c43a` | `app.cadence-me.com` |
| `cadence-marketing` (`prj_BLlsxoaz1wSvWuK7xcZLLkHglQcR`) | `dpl_HfvZ63AiK3qinAKFNPzQgKAKy4vR` | Git, repo ID `1261353608`, `main` | `5e7ebdeb67082ebae12b41713507b027bdf726c8` | `cadence-me.com` |

Both projects link GitHub repository ID `1261353608` (`emixd12/habit-tracking-app`)
with production branch `main`. The app has one production-scoped
`CADENCE_TRUST_MARKETING_DEPLOYMENT_ID` variable; its value was not read.
No provider setting, alias or deployment changed.

### Pre-existing Trust publication failure

The scheduled Trust workflow is `active`. Every scheduled run since September 27
failed in `collect` with `ENOENT: no such file or directory, open 'snapshot.json'`.
The last success ran September 26. All six inspected runs used `5e7ebde`.
The latest published snapshot still pairs `dpl_EySiseVj858i81TyfRuYjz8qY6pt`
with `dpl_HfvZ63AiK3qinAKFNPzQgKAKy4vR`. The app has since served `9eda5c0`.
Root cause is not verified; the source/deployment mismatch is the leading
assumption. This failure predates the rename and is not a rename regression.
It also means no evidence writer added files: the public index still holds 37
entries, matching the archive. Task 8 must reconcile `main` with `9eda5c0` and
collect fresh evidence; Task 6 still requires pausing the workflow before cutover.

A Dependabot branch (`86f5eb9`, devalue 5.9.4) produced preview builds on both
Vercel projects October 8. Production aliases did not change.

## October 8 continuation: Task 6 (owner selected Task 6 only)

- Trust workflow `public-trust-evidence.yml` (ID `343427146`): previous state
  `active`; now `disabled_manually`. No run was in progress. Restore it in Task 8.
- Committed `2631e62` locally and pushed `codex/project-rename` to
  `emixd12/habit-tracking-app`. It contains `9eda5c0` and 14 commits beyond
  `origin/main`. No pull request was opened; `main` is unchanged.
- The push triggered Git preview builds on both existing projects. Both are
  READY at `2631e62`: app `dpl_FCm15afuv4nCDuLpkuXFLVpX5GKJ`, marketing
  `dpl_2xxB1HXcu9tW5WA5ohWtcxQxMS1e`. These use Preview configuration. They are
  not the production-configured stages that Task 6 requires.
- GitHub name-dependent surfaces: zero deploy keys, zero repository hooks and
  zero rulesets. OIDC uses the default subject (`repo:emixd12/habit-tracking-app`).
  Only `deploy-pages` requests `id-token: write`; no external cloud trust policy
  uses it. GitHub App installations are not listed: the `gh` token returned HTTP
  403 for that endpoint. Check them in the settings page before Task 7.

### Blocked: production-configured staging

The Claude Code permission classifier denied
`vercel deploy --prod --skip-domain` from a clean clone of `2631e62`. That command
assigns no domain, but the classifier treats it as a production deploy. No retry
or alternative path was attempted. The production-configured marketing and app
stages, and their `CADENCE_TRUST_MARKETING_DEPLOYMENT_ID` pairing, remain open.

Open provenance question for staging: `public-trust-evidence.service.ts` reads
`VERCEL_GIT_COMMIT_SHA`. The current production app came from a CLI upload with
`gitSource` null. Whether CLI deployments populate that variable is unverified.
The leading assumption is that this mismatch causes the scheduled Trust failures.

### Production-configured staging (owner allowed the deploy, October 8)

- Marketing stage: `dpl_F4fjwDVXwqAZYh5hLhaXkUoevp52`, target `production`,
  READY, no domain assigned. Built by CLI from a clean clone of `2631e62`
  (zero working-tree changes; the `.env.local` pulled by `vercel link` was deleted
  before upload). Metadata records `githubCommitSha` and `sourceCommit`
  `2631e62b6408d07544f6b4db1799df355b186432`, repo `emixd12/habit-tracking-app`.
  `cadence-me.com` still resolves to `dpl_HfvZ63AiK3qinAKFNPzQgKAKy4vR`.
- CLI deployments from a Git checkout carry `githubCommitSha` metadata. Whether
  the runtime `VERCEL_GIT_COMMIT_SHA` is populated remains unverified.
- App stage: blocked. The permission classifier denied the app deploy command
  (`--prod --skip-domain` with per-deployment
  `CADENCE_TRUST_MARKETING_DEPLOYMENT_ID=dpl_F4fjwDVXwqAZYh5hLhaXkUoevp52` via
  `-e` and `-b`). No retry occurred. The project-level production setting was
  not changed.

### App stage (owner allowed the deploy, October 8)

- App stage: `dpl_obMzi5XVoyPmeR329MduaxV8f2MS`, target `production`, READY,
  built by CLI from the same clean clone of `2631e62`. Metadata records
  `githubCommitSha` and `sourceCommit` `2631e62b6408d07544f6b4db1799df355b186432`.
  Per-deployment `CADENCE_TRUST_MARKETING_DEPLOYMENT_ID` (runtime and build) is
  `dpl_F4fjwDVXwqAZYh5hLhaXkUoevp52`. The project-level production value was not changed.
- Custom domains are unchanged: `app.cadence-me.com` resolves to
  `dpl_9u3Ki7ZjgCnHwGiL9FTVBGNhFt1n`; `cadence-me.com` resolves to
  `dpl_HfvZ63AiK3qinAKFNPzQgKAKy4vR`. Both projects' production targets are unchanged.
- Side effect: `--skip-domain` still moved the team-scoped `vercel.app` aliases.
  `cadence-emis-projects-4c886aeb.vercel.app` now resolves to the app stage, and
  `cadence-marketing-emis-projects-4c886aeb.vercel.app` to the marketing stage.
  Vercel SSO protection covers both (HTTP 302 to `vercel.com/sso-api`).
  `cadence-marketing-two.vercel.app` and the `git-main` alias did not move.
  `docs/VERCEL_WORKFLOW.md` lists the app alias as a secondary production alias.
  Restore with `vercel alias set` to `dpl_9u3Ki7ZjgCnHwGiL9FTVBGNhFt1n` and
  `dpl_HfvZ63AiK3qinAKFNPzQgKAKy4vR` if required.
- `vercel curl` with an existing automation bypass read `/api/public/trust-evidence`
  on the app stage. It reports `feed_state` `unavailable`: the staged code reads
  `https://emixd12.github.io/cadence/trust/latest.json`, which does not exist before
  Task 7. This is the expected, truthful pre-rename state. The response does not
  expose the runtime source commit, so `VERCEL_GIT_COMMIT_SHA` remains unverified.
  The project's bypass-secret count stayed at three.

### Alias restoration and Task 7 preflight (October 8)

- Owner approved restoring the moved team aliases. `vercel alias set` returned
  success; readback: `cadence-emis-projects-4c886aeb.vercel.app` →
  `dpl_9u3Ki7ZjgCnHwGiL9FTVBGNhFt1n`, `cadence-marketing-emis-projects-4c886aeb.vercel.app`
  → `dpl_HfvZ63AiK3qinAKFNPzQgKAKy4vR`. Custom domains remain unchanged.
- `emixd12/cadence` still returns HTTP 404. Archive repository ID `1409433554`
  remains at `a0419f47ce3cc73eeb97af1d3d910a3bbcb66588`.
- With the Trust workflow paused, all 76 archived `habit-tracking-app/` files match
  the live old-site bytes (SHA-256, zero mismatches, zero fetch failures).
  No archive refresh is needed.
- GitHub App inventory: the Chrome session was not signed in to GitHub, and the
  `gh` token cannot list installations. Apps observed posting checks or statuses on
  three recent commits: Vercel, Supabase, CodeRabbit, Cursor, Claude, GitHub Actions
  and GitHub Advanced Security. The settings-page inventory remains unverified.
- Security settings to recheck after rename: Dependabot security updates,
  secret scanning and push protection enabled; non-provider patterns and validity
  checks disabled.
- Codex gate: on October 8 the owner confirmed that new Codex sessions run at the
  physical `cadence` root. This closes the fresh-session sandbox check by owner attestation.

## Task 7: GitHub repository rename (October 8)

Preconditions closed first: owner confirmed fresh Codex sessions; the owner's
screenshot of installed GitHub Apps lists ChatGPT Codex Connector, Claude,
coderabbitai, Cursor, Google Labs Jules, Linear, Render, Supabase and Vercel.
coderabbitai, Cursor and Vercel show pending permission-update requests; none
was accepted. GitHub Apps bind repositories by ID.

- Renamed at `2026-10-08T20:56:29Z` with `gh repo rename`. Readback:
  `emixd12/cadence`, ID `1261353608`, public, default `main`, unarchived.
- Settings snapshot diff (pre/post): only name and URL fields changed. Refs (142),
  releases and asset IDs/sizes, repository and environment variables, secret
  names, environments, branch protection, Actions permissions, workflow states
  and security settings are identical. Pages `html_url` is now
  `https://emixd12.github.io/cadence/`.
- Legacy evidence: GitHub Pages' CDN ignores query strings and briefly served
  cached project-site copies. After cache expiry, all 76 legacy
  `habit-tracking-app/` URLs returned HTTP 200 with matching SHA-256 bytes, every
  one with the archive's October 7 `last-modified`. The old project root
  returns 404. `/cadence/trust/` serves the moved project site (37 entries).
- Old-name redirects: repository, issues, commit, blob, raw and releases pages
  resolve; `git ls-remote` on the old URL returns `5e7ebde`.
- Main checkout remote is now `git@github.com:emixd12/cadence.git`; both linked
  worktrees share it and have no worktree-specific URL override.
- Updater: both feeds, both update archives and the preview.19 DMG download
  through old and new URLs with baseline SHA-256 values (10/10). Both archive
  signatures verify with the repository Minisign verifier and the public key
  embedded in the installed `/Applications/Cadence.app` (`0.1.1-preview.45`,
  key ID `A305E094044E04A`). That app's feed URL uses the old repository path.
  Native updater redirect acceptance (Tauri HTTP client) remains open; the curl
  chain is not a substitute. The installed app was not changed.
- Vercel: both projects still report slug `habit-tracking-app` with repository
  ID `1261353608` and unchanged production deployments. A Git-triggered build
  probe follows below.
