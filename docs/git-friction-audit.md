# Git friction audit

Date: 2026-11-25

## Window analysed

- Range: `ea0d15fe^..568df087` on `t3/architecture-git-friction-audit` (same tip as `main` at PR #377).
- Author dates: 2026-11-20 to 2026-11-25. One commit, `fed290eb`, carries an older author date (2026-11-13) and entered `main` on 2026-11-21.
- Commits: 155 in the range. 100 are non-merge commits. 55 are merge commits.
- The unit of analysis is the 100 non-merge commits. `git log -n 100` alone reaches only 60 non-merge commits, so this report uses the `--no-merges` window.
- Of the 55 merges, 19 merge `main` into a branch. 12 merges carry a combined diff, which this report uses as a proxy for a hand-resolved conflict.

### Type breakdown

33 of the 100 subjects use a conventional prefix. I assigned each type from the subject and the file list.

| Type | Commits | Notes |
|---|---|---|
| feat | 38 | Includes bench and content commits |
| fix | 26 | 15 of them follow a feature commit on the same branch within hours |
| docs | 18 | Status entries, release packets, decisions and the avatar plan |
| ci | 7 | Cache keys, parallel web client tests, `merge_group` trigger |
| test | 6 | 3 of them repair tests after a feature commit |
| chore | 5 | 3 Mac version bumps, 2 dependency updates |
| revert | 0 | |

Follow-up commits (a fix, test or docs commit that repairs a feature commit on the same branch within hours): 20 of 100, plus the merge commit `8d48de67`.

### Area breakdown

Number of the 100 commits that touch each top-level path. A commit counts once per path.

| Path | Commits |
|---|---|
| `tests/` | 61 |
| `docs/` | 58 |
| `packages/` | 39 |
| `STATUS.md` | 39 |
| `lib/` | 31 |
| `apps/` | 30 |
| `components/` | 28 |
| `interaction-registry.json` | 26 |
| `app/` | 24 |
| `DESIGN.md` | 19 |
| `scripts/` | 18 |
| `supabase/` | 16 |
| `.github/` | 9 |
| `load-tests/` | 8 |
| `package.json` | 8 |
| `product-map.json` | 7 |

Median files per commit: 4. Three commits touch 50 files or more. The largest touches 214 files.

### Most-changed files

| File | Commits (of 100) | Lines added plus removed |
|---|---|---|
| `STATUS.md` | 39 | 1,057 |
| `interaction-registry.json` | 26 | 4,250 |
| `DESIGN.md` | 19 | not in the top 25 |
| `docs/TICKETS.md` | 15 | 618 |
| `docs/DECISIONS.md` | 13 | not in the top 25 |
| `docs/DATA_MODEL.md` | 13 | not in the top 25 |
| `app/design-system/page.tsx` | 11 | not in the top 25 |
| `docs/MESSAGING_CHANGES.md` | 11 | not in the top 25 |
| `docs/NOTICES.md` | 10 | not in the top 25 |
| `product-map.json` | 7 | 74,584 |

### Co-change pairs

Pairs among the 30 most-changed files. Jaccard is shared commits divided by commits touching either file.

| Pair | Shared commits | Jaccard |
|---|---|---|
| `DESIGN.md` and `interaction-registry.json` | 15 | 0.50 |
| `STATUS.md` and `docs/TICKETS.md` | 14 | 0.35 |
| `STATUS.md` and `interaction-registry.json` | 12 | 0.23 |
| `DESIGN.md` and `app/design-system/page.tsx` | 9 | 0.43 |
| `STATUS.md` and `docs/DECISIONS.md` | 9 | 0.21 |
| `docs/NOTICES.md` and `interaction-registry.json` | 9 | 0.33 |
| `docs/AGENT_RESOLVERS.md` and `scripts/check-resolvers.mjs` | 8 | 0.80 |
| `interaction-registry.json` and `load-tests/scenarios/interaction-map.json` | 8 | 0.31 |
| `docs/DATA_MODEL.md` and `lib/db/database.types.ts` | 7 | 0.50 |
| `docs/PRODUCT_MAP.md` and `product-map.json` | 6 | 0.86 |
| `packages/core/src/resolvers/account-sync.resolver.ts` and `tests/account-sync.resolver.test.ts` | 6 | 0.75 |

## Summary

Ranked by cost in this window.

1. Ledger files conflict on almost every "merge main" and parallel branches claim the same numbers: 12 hand-resolved merges, one ticket renumbering.
2. Hand-copied numbers (sync contract, schema version, list lengths, allowlist counts) lag the code: 7 commits repair them.
3. Database-backed checks run outside the required check: 6 fixes arrived after a rehearsal, a local run or installed acceptance.
4. `product-map.json` is listed in `.gitignore` and is tracked anyway: 74,584 changed lines in 7 commits and one merge conflict.
5. Feature commits leave tests, the interaction registry or `DESIGN.md` stale: 8 follow-ups, 2 minutes to 2 hours later, 3 of them found by review.
6. `STATUS.md` sits 576 bytes under its limit and archive moves ride inside feature commits.
7. Browser storage access is hand-written in each file: one fix in the window, and the same defect shape remains in `lib/ui/daily-brief.ts`.

## Pattern 1: ledger conflicts and number collisions

### What happens

Parallel branches append to the same ledger files. Each "merge main into branch" then needs a hand resolution. Branches also allocate the next ticket, messaging entry, sync contract and SQLite schema number independently.

### Evidence

Files that appear in the combined diff of the 12 hand-resolved merges:

| File | Merges |
|---|---|
| `STATUS.md` | 6 |
| `docs/DECISIONS.md` | 4 |
| `docs/TICKETS.md` | 4 |
| `docs/MESSAGING_CHANGES.md` | 4 |
| `interaction-registry.json` | 4 |
| `load-tests/scenarios/interaction-map.json` | 2 |
| `docs/OPERATIONS.md` | 2 |

- `b1bd8513` "Merge origin/main (PR #357–#359) into feature-create; renumber Ticket 343 to 349". Two branches both filed Ticket 343. The merge renumbered the ticket and its messaging entries to P-082–P-084. Its combined diff covers 22 files, including `product-map.json` and `docs/PRODUCT_MAP.md`.
- `98abd672` and `ca6f2307` "Merge main into claude/avatar-motion-review": `STATUS.md`, `docs/status/archive/2026-11.md`, `interaction-registry.json`.
- `7828861d`: `STATUS.md`, `docs/OPERATIONS.md`, `docs/TICKETS.md`. `bbd4484e` and `962ef701`: `docs/DECISIONS.md` only.
- `8d48de67` "fix(connectors): address Codex review findings and merge main" combines a merge with review fixes: 37 files, 17 in the combined diff.
- `3f59eed6` "fix: Mac migration list, standalone config snapshots and opportunity test order". After the rebase in `e10b51d0`, `apps/desktop/src-tauri/src/local_store/db.rs` held migrations 0027 and 0028 in one tuple. The fix splits them.
- Earlier recurrence: `5a8d0a5a` "Renumber the test-access preflight to Ticket 293" and `3049c671` "Renumber connector Tickets 220–228 to 233–241 and reorder migrations".

### Root cause

`STATUS.md` takes each new entry at the top of "Recent entries". `docs/TICKETS.md`, `docs/DECISIONS.md` and `docs/MESSAGING_CHANGES.md` take new entries at the end. Two branches therefore always edit the same lines. No tool hands out the next number. A branch reads the highest number in its own checkout.

### Existing checks

- `scripts/check-agents.mjs` fails on a leftover conflict marker in `STATUS.md`, `docs/TICKETS.md` and `docs/DECISIONS.md`. It runs after the conflict and does not prevent it.
- `scripts/git-freshness.mjs` reports a stale branch at session start. It does not look at numbers on other branches.
- No `.gitattributes` file exists.

### Proposed automation

- Add `.gitattributes` with `merge=union` for the append-only ledgers. Both sides' new entries are kept without a hand resolution.
- Add `scripts/next-id.mjs` (`npm run ids:next`). It reads `origin/main` and every remote branch and prints the next free ticket, P-, L- and D- number, sync contract and SQLite schema number.
- Extend `scripts/check-agents.mjs` to fail on a duplicate `## Ticket N:` heading. A union merge of two branches that both filed Ticket N then fails the check.

## Pattern 2: hand-copied numbers lag the code

### What happens

A feature raises a version or adds an item. Tests, smoke scripts and fixtures repeat the old number as a literal. A later commit edits each literal.

### Evidence

- `0967fe52` "test: fix final-review counts, scheduled_for allowlist and fixture size": `tests/acceptance-watch.test.mjs` (`toHaveLength(23)` to 25), `tests/developer-docs.test.ts` (36 to 38 pages, 82 to 86 routes), `tests/fixtures/governance/scheduled-for-allowlist.json`.
- `e10b51d0`: the same three literals move again (25 to 26, 38 to 39, 86 to 88), one day later.
- `5f5c1896` "test(sync): move account sync RPC smoke to contract 8": `scripts/account-sync-rpc-smoke.mjs` still wrote at contract 7 after `b7aae027` introduced contract 8.
- `d13b715e` "fix: coach reminders join hint, contract 9 sync smoke and local sub-behavior test": the same script lagged again for contract 9.
- `cf8d0081`: `tests/sql/account-sync-contract-write-smoke.sql` (unknown contract 9 to 10) and `tests/sql/sub-behaviors-smoke.sql` (writer floor 7 to 8).
- `3f59eed6`: `apps/desktop/src-tauri/src/local_store/tests.rs` (`schema_version` 27 to 28).
- `f067bfb6` "Fix scheduled_for allowlist count and desktop Settings retry test": a refactor in `packages/core/src/resolvers/note-suggestion.resolver.ts` brought the file back under its allowed `scheduled_for` line count, 3 minutes after `d1488507`.
- Marker count edits: `0423d3e0`, `d1488507`, `88bc997a` and `cf8d0081` each change one `interaction_marker_count` line in `interaction-registry.json`.
- `097f86de` "Correct the count in the key script's comment".
- Earlier recurrence: `29a21d2f` "Expect account sync contract 6 in the RPC smoke and reject 7", `87ed4ee3` "Allowlist the chat eval fake's scheduled_for output field", `752e224b` "chore(registry): Calendar bench marker count for the Google sign-in select".

The current contract number appears as a literal in at least five places: `packages/core/src/resolvers/account-sync.resolver.ts` (`ACCOUNT_SYNC_CONTRACT = 9`), `scripts/account-sync-rpc-smoke.mjs`, `tests/sql/account-sync-contract-smoke.sql`, `tests/sql/account-sync-contract-write-smoke.sql` and `tests/sql/sub-behaviors-smoke.sql`.

### Root cause

The numbers are copies, and the copies live in files that different checks read. The Vitest literals fail in `npm run test`. The smoke script and SQL literals fail only in the `Local Supabase rehearsal` workflow, which is not part of `verify`.

### Existing checks

- `tests/scheduled-for-drift.test.ts` and the two `toHaveLength` tests catch their own drift. They work as intended; the cost is the repeat edit.
- `scripts/check-interactions.mjs` compares `interaction_marker_count` with the source. Its message names the file and not the registry entries to review.
- Nothing compares the sync contract literals with `ACCOUNT_SYNC_CONTRACT` before the rehearsal runs.

### Proposed automation

- Add `scripts/check-contract-numbers.mjs` to `npm run agents:check`. It reads `ACCOUNT_SYNC_CONTRACT`, the last entry of `MIGRATIONS` in `db.rs` and the MCP contract version, and fails when a listed literal disagrees.
- Make `scripts/account-sync-rpc-smoke.mjs` read the contract from the resolver's source instead of repeating it.
- Extend the `interaction_marker_count` failure message to list the registry entries whose `source` names the file.
- Keep the `toHaveLength` literals. See "Not worth automating".

## Pattern 3: database defects surface after the required check

### What happens

A migration, a SQL smoke file or a PostgREST query is wrong. `verify` passes because it has no database. The defect appears in the `Local Supabase rehearsal` workflow, in a local stack run or in installed Mac acceptance.

### Evidence

- `2346b245` "fix(db): drop session-scoped patch helper in opportunity migrations". `pg_temp.patch_definition` survived from one migration into the next, and `create function` failed with 42723. The message names the rehearsal as the check that stopped. Three migration files changed.
- `d13b715e`: `lib/db/coach-signals.repo.ts` embedded `occurrences` from `reminder_deliveries`, which has two foreign keys to it. The message states "PGRST201 on every call since #315". The defect entered in `0d337198` on 2026-11-20 and the fix landed on 2026-11-21.
- `71b24357` "Ticket 351: wire shared auto-stop plan, update interaction registry, fix SQL smoke column": `tests/sql/ticket-351-auto-stop-time-session-on-completed.sql` named `sub_behavior_order`; the column is `sub_behavior_sort_order`. The fix came 108 minutes after `1cea7cc4`.
- `1a3053a1` "fix(sync): keep sub-behavior order out of account sync configuration check (Ticket 349)". Installed acceptance on a dev-signed build found that hosted `apply_account_sync_plan` refused a Mac step reorder. The fix is a new migration, `20261122040000_account_sync_sub_behavior_order.sql`.
- `8d48de67` adds `20261124195000_recorded_activity_ledger_cursor.sql` 9 minutes after the three migrations in `0a711383`.
- `cf8d0081` edits the three sub-behavior migrations that `e10b51d0` added 13 minutes earlier, to compose with PR #351.
- `5f5c1896` and `d13b715e` also repair the account sync smoke (Pattern 2).

Migrations in the window: 19 files added across 14 non-merge commits, plus one in the merge `8d48de67`. 4 commits changed migrations or added a corrective migration after the first pass: `2346b245`, `cf8d0081`, `1a3053a1` and `8d48de67`.

### Root cause

- `.github/workflows/supabase-rehearsal.yml` runs only for the paths it lists. `lib/db/**` is listed, so `d13b715e`'s repository file would trigger it. The rehearsal still could not catch that defect: it runs SQL smokes and two smoke scripts, and no test that calls the repository query.
- The workflow lists five `lib/services` files by name. A change to any other service that queries the database does not trigger it.
- 27 `tests/*.local-integration.test.ts` files skip unless `CADENCE_LOCAL_SUPABASE_URL` and three keys are set. No workflow, the rehearsal script or the Dagger module names them, so they run only when an agent starts a local stack.
- Auto-merge waits only for `verify` (AGENTS.md, "Git branches and worktrees").

### Existing checks

- `scripts/supabase-rehearsal.sh` runs `db reset`, every `tests/sql/*.sql` file, `smoke:rls:local` and `smoke:account-sync:local`. It caught `2346b245`.
- It does not run the local-integration tests and does not compare `lib/db/database.types.ts` with generated types.

### Proposed automation

- Run the local-integration Vitest files at the end of `scripts/supabase-rehearsal.sh`, against the stack it already started.
- Add `tests/*.local-integration.test.ts` and `lib/services/integration-*.ts` to the workflow's `paths`. `lib/db/**` and `packages/core/**` are already listed.
- Add `scripts/check-postgrest-embeds.mjs` to `npm run resolvers:check`. It reads `Relationships` in `lib/db/database.types.ts` and fails on an embed between two tables with more than one foreign key and no `!fk_name` hint. This check needs no database, so it runs in `verify`.
- In the rehearsal, generate types and diff them against `lib/db/database.types.ts`.

## Pattern 4: `product-map.json` is ignored and tracked

### What happens

`.gitignore` lines 71–72 list `/product-map.json` and `/docs/PRODUCT_MAP.md`. `docs/PRODUCT_MAP_GUIDE.md` says "The map is not committed: build it when you need it." Both files are tracked. Commits that regenerate them carry large diffs, and commits that do not regenerate them leave them stale.

### Evidence

- `fd3ce3eb` (#331) added the builder, the guide and the `.gitignore` lines.
- `168cd2da` "feat(desktop): Behaviors of Opportunity on Cadence for Mac" added `product-map.json` (71,503 lines) and `docs/PRODUCT_MAP.md` (712 lines) on the same day. Its message does not mention them.
- Later changes to `product-map.json`: `cf8d0081` (1,678 lines), `f3771060` (307), `43c5ec57` (334), `d340be14` (318), `8d6e27c4` (410), `91c0dc68` (34).
- `8d6e27c4` "fix(tokens): add token description comments and rebuild product map" exists partly to regenerate the file after `dee2dae8`.
- `b1bd8513` lists `product-map.json` and `docs/PRODUCT_MAP.md` in its combined diff.
- `git ls-files -ci --exclude-standard` prints four tracked-but-ignored files: these two and two under `.intent/artifacts/`.

Total: 74,584 changed lines in `product-map.json` in five days. The file is 2.8 MB.

### Root cause

A forced add or a wide add in `168cd2da` bypassed `.gitignore`. Once tracked, Git keeps reporting the files as modified after each `npm run map:build`, so later commits include them.

### Existing checks

- `npm run map:check` builds the map in memory. It fails on map errors and on a stale `docs/NOTICES.md`. It does not compare `product-map.json` or `docs/PRODUCT_MAP.md` with the build.
- No check compares tracked files with `.gitignore`.

### Proposed automation

- Remove the two files from the index (`git rm --cached`). This follows the guide. It needs the owner's confirmation that nothing reads the committed copy.
- Add an assertion to `scripts/check-agents.mjs`: `git ls-files -ci --exclude-standard` must print nothing, apart from an explicit allowlist.

## Pattern 5: feature commits leave tests, the registry or `DESIGN.md` stale

### What happens

A feature commit changes UI behavior. A second commit, minutes later, updates the test, the interaction registry text or `DESIGN.md`. In three cases an automated review found the gap.

### Evidence

- `f3771060` "Remove Recorded activity · Hevy section from Timeline header" (11:13), then `925b492c` "Update connector-timeline DOM test for removed Timeline header" (11:15), then `1c31f2f4` "Update DESIGN.md to reflect removed RecordedActivityList section" (11:16).
- `d1488507` (10:40), then `f067bfb6` (10:43): `tests/desktop-retry.dom.test.tsx` still expected the removed Day note shortcuts drawer.
- `d1488507`, then `7c396669` "Address Codex review: preserve model proposals, validate inline evidence, update interaction registry" (10:46): 56 changed lines of registry text for three entries.
- `0423d3e0` (10:55) changed one registry line, the marker count, from 25 to 31. `4113e6ee` "Address Codex review: manage focus across Past tips view and update interaction registry" (11:00) rewrote the affected entries.
- `1cea7cc4` (19:19), then `71b24357` (21:07) and `464bffc2` (21:09): the shared service wiring, the registry text and `docs/AGENT_RESOLVERS.md` followed the first commit.
- `dee2dae8` (11:32), then `8d6e27c4` (13:31): new tokens in `packages/ui/tokens.css` had no description comment. `scripts/build-product-map.mjs` treats that as an error for this file (`CANONICAL_TOKEN_FILE`), so `map:check` fails. The fix adds six comment lines and regenerates `product-map.json`.
- `43c5ec57` (13:14), then `a3a3ceda` (13:26): see Pattern 7.
- `f087fbfd` "fix: validate routine reminders against parent settings at send time and detect is_opportunity-only MCP updates" addresses two review comments on PR #354.

### Root cause

- No hook runs any check before a commit or a push. `.githooks/` holds only `reference-transaction`.
- The interaction registry's prose fields (`intent`, `availability`, `success_result`) are free text. `scripts/check-interactions.mjs` verifies paths, symbols and marker counts. A changed count can be satisfied by editing the number alone, as in `0423d3e0`.
- A missing token description is an error only in `packages/ui/tokens.css`. In other token files it is a warning, so `map:check` passes. For `dee2dae8` the check existed and ran after the push, not before it.

I did not verify which check caught `925b492c` and `f067bfb6`. The 2 to 3 minute gaps suggest a local test run after the commit.

### Existing checks

`npm run test` catches the DOM test failures. `interactions:check` catches a wrong marker count. Both ran after the commit and not before it. Review caught the registry prose.

### Proposed automation

- Add `.githooks/pre-push`: run the four fast checks and `vitest related` for the files changed against `origin/main`. `npm run git:fresh` already sets `core.hooksPath`.
- Add a warning ratchet to `scripts/build-product-map.mjs check`: fail when a warning category exceeds its committed baseline.
- When `interaction_marker_count` changes for a file and no other field of the entries that cite the file changes in the same diff, print those entry IDs. Keep it a message, not a failure.

## Pattern 6: `STATUS.md` size and archive moves

### What happens

`STATUS.md` changes in 39 of 100 commits. It is 39,424 bytes; `scripts/check-agents.mjs` fails above 40,000. The archive move happens inside whichever commit crosses the limit.

### Evidence

- `1cea7cc4` (Ticket 351 feature commit): `STATUS.md` 188 changed lines, `docs/status/archive/2026-11.md` 169 added lines, `docs/status/README.md` 4.
- `fefe7fdc` "Record the Cadence for Mac 0.1.14 release": `STATUS.md` 186 changed lines, `docs/status/archive/2026-11.md` 159 added lines.
- `98abd672`: the merge conflicts in `STATUS.md`, `docs/status/README.md` and `docs/status/archive/2026-11.md`.
- Status-only commits: `402b3ee8` "STATUS: name the PR for the dev.2 run" (2 lines), `24f8b735`, `c469c541`, `1b7f1c17`.
- Four commits in the window touch `docs/status/archive/`.

### Root cause

The archive runs when a branch happens to cross the limit. Two open branches near the limit both archive, and both move the same entries. The move also hides the feature's own `STATUS.md` change inside a 180-line diff.

### Existing checks

`npm run status:archive` moves entries until the file is at most 30,000 bytes. `agents:check` enforces the 40,000-byte limit. Both work. Neither controls which commit carries the move.

### Proposed automation

- Run the archive on `main` only, in its own commit: a scheduled workflow or a post-merge step opens a docs-only PR when `STATUS.md` exceeds 34,000 bytes.
- With `merge=union` from Pattern 1, concurrent entry additions stop conflicting. The archive move still needs a single writer.

## Pattern 7: browser storage access is hand-written per file

### What happens

Each component writes its own guard around `window.localStorage`. One new helper put the access outside its `try`.

### Evidence

- `a3a3ceda` "fix(ui): resolve default localStorage inside try block", 12 minutes after `43c5ec57`. In `components/layout/sidebar-state.ts` a default parameter read `window.localStorage` before the `try` block. A browser that throws on that getter would throw from the call.
- The same shape remains in `lib/ui/daily-brief.ts` line 209: `storage: Storage = window.localStorage` as a default parameter of `dailyBriefInstallationId`. Lines 245 and 267 match the same text; I read only line 209.
- 19 source files under `app/`, `components/`, `lib/` and `apps/desktop/src/` reference `localStorage` or `sessionStorage`. `components/advisor/AdvisorProvider.tsx`, `lib/ui/travel.ts`, `lib/ui/travel-habits.ts` and `apps/desktop/src/local-leave-reminder.service.ts` each define their own guarded getter.

Evidence in the window is one commit. `git log -n 300` shows no other storage fix by subject.

### Root cause

No shared helper exists, so each file repeats the guard and each new file can get it wrong. `eslint.config.mjs` holds only the Next.js presets and ignore globs.

### Existing checks

None for this class. A DOM test added in `a3a3ceda` covers the one helper.

### Proposed automation

Add `lib/ui/browser-storage.ts` with guarded getters, and an ESLint `no-restricted-syntax` rule that bans `window.localStorage` and `window.sessionStorage` elsewhere.

## Proposed automations, prioritized

| Rank | Automation | Type | Pattern | Effort | Expected effect |
|---|---|---|---|---|---|
| 1 | Untrack `product-map.json` and `docs/PRODUCT_MAP.md`; fail on tracked-but-ignored files | script (in `agents:check`) | 4 | S | Removes the largest diff source and one conflict source. Estimate: 7 of 100 commits get smaller. |
| 2 | `merge=union` for append-only ledgers; duplicate-ticket check | git attribute plus script | 1 | S | Ledger files appear in 9 of the 12 conflicted merges. 2 of them (`bbd4484e`, `962ef701`) conflict in nothing else. The others get smaller. |
| 3 | `scripts/check-contract-numbers.mjs` | script (in `agents:check`) | 2 | M | Moves contract and schema literal drift into `verify`. Covers 4 of the 7 repair commits. |
| 4 | `.githooks/pre-push` with fast checks and `vitest related` | hook | 5, 2 | S | Catches stale tests and marker counts before the push. Covers `925b492c`, `f067bfb6`, `0967fe52`. |
| 5 | Run local-integration tests in the rehearsal; add two `paths` entries | CI check | 3 | M | Gives the 27 skipped test files a CI run. |
| 6 | `scripts/check-postgrest-embeds.mjs` | script (in `resolvers:check`) | 3 | M | Catches the `d13b715e` class without a database. One instance in the window. |
| 7 | `scripts/next-id.mjs` (`npm run ids:next`) | script | 1 | S | Removes renumbering merges such as `b1bd8513`. |
| 8 | Storage helper and ESLint restriction | lint rule | 7 | M | Removes one defect class; 19 files to migrate. |
| 9 | Warning ratchet in `map:check` | script | 5 | S | Warning categories cannot grow. Tokens in `packages/ui/tokens.css` already fail without a description; this covers the other token files. |
| 10 | Archive `STATUS.md` in its own PR on `main` | CI check | 6 | M | Feature diffs stop carrying 180-line archive moves. |
| 11 | Type drift check in the rehearsal | CI check | 3 | S | Not tied to a defect in the window; low priority. |

### Sketch 1: tracked-but-ignored check

Target: `scripts/check-agents.mjs`. Runs in `npm run agents:check`, the `checks` job of `.github/workflows/ci.yml` and Dagger `cadence/agents`. The Dagger container mounts fixture Git data, so the check must skip when `git ls-files` fails.

```js
import { spawnSync } from "node:child_process";

// Files Git tracks although .gitignore lists them. A generated file that is
// both ignored and tracked goes stale silently and conflicts on every merge.
const TRACKED_IGNORED_ALLOWLIST = new Set([
  ".intent/artifacts/legal232/approved.json",
  ".intent/artifacts/verify232-legal/review-evidence.json",
]);
const listed = spawnSync("git", ["ls-files", "-ci", "--exclude-standard"], { encoding: "utf8" });
if (listed.status === 0) {
  const unexpected = listed.stdout
    .split("\n")
    .filter((file) => file && !TRACKED_IGNORED_ALLOWLIST.has(file));
  assert(
    unexpected.length === 0,
    `Tracked files match .gitignore: ${unexpected.join(", ")}. Run \`git rm --cached <file>\` or remove the ignore line.`,
  );
}
```

One-time step: `git rm --cached product-map.json docs/PRODUCT_MAP.md`.

### Sketch 2: union merge and duplicate-ticket check

Target: new `.gitattributes` at the repository root, and `scripts/check-agents.mjs`.

```gitattributes
# Append-only ledgers: keep both sides' new entries instead of conflicting.
STATUS.md                  merge=union
docs/TICKETS.md            merge=union
docs/DECISIONS.md          merge=union
docs/MESSAGING_CHANGES.md  merge=union
docs/LEGAL.md              merge=union
```

```js
// A union merge keeps both branches' entries, so two branches that filed the
// same ticket number now collide here instead of in a text conflict.
const seenTickets = new Map();
read("docs/TICKETS.md").split("\n").forEach((line, index) => {
  const match = /^## Ticket (\d+):/.exec(line);
  if (!match) return;
  const first = seenTickets.get(match[1]);
  assert(
    first === undefined,
    `docs/TICKETS.md files Ticket ${match[1]} twice (lines ${first} and ${index + 1}). Renumber the newer one; run npm run ids:next.`,
  );
  seenTickets.set(match[1], index + 1);
});
```

Limit: union applies to local merges and rebases. GitHub's server-side merge may not honor it; not verified. Agents already merge `main` locally, which is where the 12 conflicts occurred. Union can also keep both versions of an edited line, so a table row edited on both sides appears twice.

### Sketch 3: `scripts/check-contract-numbers.mjs`

Target: new file. Hook: import and run from `scripts/check-agents.mjs`, or add `&& node scripts/check-contract-numbers.mjs` to the `agents:check` script.

```js
#!/usr/bin/env node
import fs from "node:fs";

const read = (file) => fs.readFileSync(file, "utf8");
const first = (file, pattern) => {
  const match = pattern.exec(read(file));
  if (!match) throw new Error(`${file}: no match for ${pattern}`);
  return Number(match[1]);
};
const errors = [];
const expect = (file, pattern, wanted, label) => {
  const found = first(file, pattern);
  if (found !== wanted) errors.push(`${file}: ${label} is ${found}, expected ${wanted}.`);
};

const contract = first("packages/core/src/resolvers/account-sync.resolver.ts", /ACCOUNT_SYNC_CONTRACT = (\d+)/);
expect("tests/sql/account-sync-contract-smoke.sql", /account_sync_current_contract\(\) <> (\d+)/, contract, "current contract");
expect("tests/sql/account-sync-contract-write-smoke.sql", /array\[null::integer, 0, (\d+)\]/, contract + 1, "unknown contract");
expect("scripts/account-sync-rpc-smoke.mjs", /read_account_sync_snapshot", \{ contract: (\d+) \}\), "unknown read contract"/, contract + 1, "unknown contract");

const dbRs = read("apps/desktop/src-tauri/src/local_store/db.rs");
const files = [...dbRs.matchAll(/migrations\/(\d{4})_/g)].map((match) => Number(match[1]));
files.forEach((number, index) => {
  if (number !== index + 1) errors.push(`db.rs: migration file ${number} is entry ${index + 1}.`);
});

if (errors.length) { console.error(errors.join("\n")); process.exit(1); }
console.log(`contract-numbers passed: sync contract ${contract}, SQLite schema ${files.length}.`);
```

The `db.rs` loop would have failed on the merged tuple that `3f59eed6` repaired only if the file numbers and entry order disagreed; add a count of `(\n\s+\d+,` tuple openers against `files.length` to cover that case.

### Sketch 4: `.githooks/pre-push`

Target: new `.githooks/pre-push`. `scripts/git-freshness.mjs` already points `core.hooksPath` at `.githooks`. The hook must stay fast; the durations below are not measured.

```sh
#!/bin/sh
# Fast checks before a push. Skip with CADENCE_SKIP_PRE_PUSH=1 (say why in the PR).
[ "$CADENCE_SKIP_PRE_PUSH" = "1" ] && exit 0
[ -d node_modules ] || { echo "pre-push: no node_modules; skipping checks." >&2; exit 0; }

set -e
npm run --silent agents:check
npm run --silent interactions:check
npm run --silent map:check
npm run --silent resolvers:check

base=$(git merge-base HEAD origin/main)
changed=$(git diff --name-only --diff-filter=d "$base" HEAD -- '*.ts' '*.tsx' '*.mjs')
if [ -n "$changed" ]; then
  # shellcheck disable=SC2086
  npx vitest related --run $changed --exclude 'tests/acceptance-web-client/**' \
    --exclude '.claude/**' --exclude '.local/**'
fi
```

`vitest related` runs the tests that import a changed file. It would have run `tests/connector-timeline.dom.test.tsx` for `f3771060` and `tests/desktop-retry.dom.test.tsx` for `d1488507`. It does not find tests that read a file through `fs`, such as `tests/scheduled-for-drift.test.ts`; list those governance tests explicitly in the hook.

### Sketch 5: local-integration tests in the rehearsal

Target: `scripts/supabase-rehearsal.sh`, after the `local account-sync smoke` phase, and `.github/workflows/supabase-rehearsal.yml` `paths`.

```sh
begin_phase 'local integration tests'
status_json=$(npm run --silent supabase -- status --output json)
export CADENCE_LOCAL_SUPABASE_URL=$(jq -r '.API_URL' <<<"$status_json")
export CADENCE_LOCAL_SUPABASE_SERVICE_KEY=$(jq -r '.SERVICE_ROLE_KEY' <<<"$status_json")
export CADENCE_LOCAL_SUPABASE_PUBLISHABLE_KEY=$(jq -r '.ANON_KEY' <<<"$status_json")
export CADENCE_LOCAL_INTEGRATION_SIGNING_KEY=$(node -e 'console.log(require("node:crypto").randomBytes(32).toString("base64url"))')
timeout --kill-after=5s 10m npx vitest run tests/*.local-integration.test.ts --reporter=agent
```

```yaml
    paths:
      # added to the existing list
      - lib/services/integration-*.ts
      - tests/*.local-integration.test.ts
```

Not verified: the JSON key names of `supabase status` at CLI 2.105.0, the format the signing key needs, and whether every one of the 27 files passes against a bare `db reset`. `docs/OPERATIONS.md` and `docs/qa/mcp-server.md` describe the local run and should supply the exact values. The script ends by asserting that `auth.users` is empty, so the tests must clean up or run before a final reset.

## Implementation status (2026-11-25)

Each automation is implemented on its own local branch from `origin/main` (`568df087`). A second model reviewed the plan first; its findings changed several designs, noted below. All seven branches merged cleanly into one test branch, where the eight required commands and `npm run desktop:build` passed (7,364 tests passed, 206 skipped).

| Rank | Automation | Branch | Result |
|---|---|---|---|
| 1 | Untrack the product map; tracked-but-ignored check | `chore/ledger-merge-and-ignored-check` | Done |
| 2 | `merge=union`; duplicate-ticket check | same branch | Done for `docs/TICKETS.md` and `docs/DECISIONS.md` only. Union would bring back archived `STATUS.md` entries and duplicate the "is next" counters in `docs/MESSAGING_CHANGES.md` and `docs/LEGAL.md`. Conflict-marker check now covers all five ledgers. |
| 3 | `scripts/check-contract-numbers.mjs` | `chore/contract-number-check-and-next-id` | Done. `tests/sql/sub-behaviors-smoke.sql` is excluded: it tests fixed contracts on purpose. |
| 4 | `.githooks/pre-push` | `chore/pre-push-hook-and-archive-prompt` | Done. Measured 7 s for a docs-only change and 45 s for one component under heavy load. |
| 5 | Local-integration tests in the rehearsal | `ci/rehearsal-local-integration-tests` | Done for 16 of 33 files, with a run-time ES256 signing key. Not run against a database yet; the first GitHub run proves it. |
| 6 | `scripts/check-postgrest-embeds.mjs` | `chore/postgrest-embed-check` | Done, with the TypeScript compiler API instead of a regex. 220 select calls analysed; none ambiguous at HEAD. |
| 7 | `scripts/next-id.mjs` (`npm run ids:next`) | `chore/contract-number-check-and-next-id` | Done |
| 8 | Storage helper and ESLint rule | `chore/browser-storage-helper` | Done. 18 files migrated; all three access forms banned. |
| 9 | Warning ratchet in `map:check` | `chore/map-warning-ratchet` | Done. The `design-system.usage.json differences` category stays a warning: its fix needs a tool outside CI. |
| 10 | Archive `STATUS.md` in its own change | `chore/pre-push-hook-and-archive-prompt` | Changed. `npm run git:fresh` prompts for a `chore/status-archive` PR above 34,000 bytes. A scheduled workflow would need a GitHub App token so that CI runs on its PR. |
| 11 | Type drift check in the rehearsal | none | Not done. The rehearsal excludes the `postgres-meta` image, which `gen types --local` needs. |

Open follow-ups:

- `tests/sql/account-sync-contract-write-smoke.sql` line 145: `contract_probe` is still 9 and probably should be 10. The test passes either way. Not changed.
- The pre-push hook can block a push when the machine is overloaded and a DOM test times out.
- `core.hooksPath` in the owner's clone is an absolute path, so every worktree runs the main checkout's hooks. `npm run git:fresh` rewrites it to `.githooks` once the hook branch is merged.
- Whether GitHub's server-side merge honors `merge=union` is still not verified.

## Not worth automating

- Mac version bumps (`301c5832`, `f6a11e8f`, `df71b580`): one line in `tauri.conf.json` each.
- Release record commits (`caba0e47`, `fefe7fdc`, `14ab3a80`): the packet is evidence a person reads; three in five days.
- The `toHaveLength` literals in `tests/developer-docs.test.ts` and `tests/acceptance-watch.test.mjs`: a deliberate prompt to review a new page or operation. Two edits in the window.
- `scheduled-for-allowlist.json` counts: the ratchet did its job in `f067bfb6` by forcing a refactor.
- Interaction registry prose: free text needs a reader. Only the marker-count message is worth changing.
- The flaky DOM test (`c6db5433`): one instance, fixed at the cause with 48 of 48 parallel runs passing.
- Platform-specific tooling fixes (`7368b351` symlinked temp path, `c829e649` unsigned CLI binary, `5bb81ce6` owner name case): three unrelated causes.
- Advisor avatar review rounds (`cc1570df`, `fa3ab983`, `06d11123`, `c65547d3`): owner review cycles, not friction.
- Dependency updates (`937603f8`, `dfb5ae8f`): Dependabot grouping already exists.
- Account sync planner fixes (`bc568abb`, `c62b7231`, `28b40f5b`, `fed290eb`): four logic defects in one resolver, each with a new test. This is a design question for the planner, not a check.
- Timezone and date defects: none found in the window.

## Method and limits

Commands used, all read-only:

- `git log -n 100 --format='%h %ad %p | %s' --date=iso-strict` and the same with `--no-merges`.
- `git log -n 100 --no-merges --name-only` and `--numstat`, fed to a short Python script for per-file commit counts, top-level areas, line totals and co-change pairs.
- `git show --stat` on each commit cited here, and `git show` diffs for the fix, test and review commits.
- `git show --cc --name-only` on each of the 55 merges to list files in combined diffs.
- `git log -n 300 --no-merges --format='%h %s'` filtered by keyword, to confirm earlier recurrences.
- `git ls-files -ci --exclude-standard`, `git grep` for storage access and contract literals.
- Reads of `package.json`, `scripts/check-agents.mjs`, `scripts/check-interactions.mjs`, `scripts/build-product-map.mjs`, `scripts/archive-status.mjs`, `scripts/supabase-rehearsal.sh`, `.github/workflows/ci.yml`, `.github/workflows/supabase-rehearsal.yml`, `.dagger/modules/cadence/main.dang`, `eslint.config.mjs`, `vitest.config.ts`, `.claude/settings.json`, `.gitignore` and `docs/PRODUCT_MAP_GUIDE.md`.

Not verified:

- No check, test or build ran. The worktree has no `node_modules`. Whether the committed `product-map.json` matches a fresh build at this commit is unknown.
- Which check caught each follow-up. Commit messages name the check for `2346b245`, `1a3053a1`, `c6db5433`, `7c396669`, `4113e6ee` and `f087fbfd`. For the others the timing is the only evidence.
- GitHub pull request data: review comments, CI run history and failed runs. Counts of CI failures per PR are therefore missing.
- A combined diff is a proxy for a hand-resolved conflict. A merge commit that also carries new work, such as `8d48de67`, inflates it.
- Whether `168cd2da` added the product map on purpose. Its message does not say.
- Whether the six migration commits that leave `lib/db/database.types.ts` unchanged needed a type change.
- Runtime of the proposed pre-push hook and of the local-integration tests in CI.
- Whether GitHub's merge honors `merge=union`.
- The code sketches are untested.
- Type and follow-up counts rest on my reading of subjects and file lists; a different reader could move about five commits between feat, fix and docs.
