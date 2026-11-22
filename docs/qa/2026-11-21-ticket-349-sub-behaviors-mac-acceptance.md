# Ticket 349: sub-behaviors, installed Mac acceptance (November 21–22, 2026)

Result: **pass**, after one fix. The installed Mac found a defect: a step reorder could not
sync. Hosted migration `20261122040000_account_sync_sub_behavior_order` fixes it, and the
reorder that had been held then synced.

- Build: dev-signed `0.1.15-dev.1` from `feature-create` `b1bd8513` (clean; SQLite schema
  28; unmerged migration `0028_sub_behaviors.sql`). The owner approved
  `--allow-unmerged-migrations` for this build in chat on November 22, 03:26Z. No
  notarization, upload or publication.
- Device: the owner's Mac, linked to the owner's account. Throwaway Behaviors only, all
  titled `QA349 …` and archived at the end.
- Preflight: `qa:preflight --suite desktop-owner-mac,desktop-test-mac` (run dir
  `.intent/acceptance/ticket-343-mac`). The first run exited 10 with one owner step (test
  Mac Notifications and Location). The owner allowed them. The probe still read "missing",
  because Cadence Settings was closed on the test Mac; after the agent opened it, the
  probe passed, and the rerun exited 0 (13 ready). `hosted-migrations` exited 0.
- Hosted readback: the in-app browser had no owner session, and the owner's sign-in stays
  the owner's step. Each check therefore reads the Mac's own record of the hosted state:
  after every sync, `account_sync_baselines.baseline_json` holds the snapshot that
  `read_account_sync_snapshot(contract => 9)` returned under RLS as the owner. In every
  check, the hosted, local and baseline fingerprints were equal.

## Install and upgrade

| Check | Result |
|---|---|
| Quit before install | Normal quit event, 0 pending writes |
| `install-dev-build.mjs 0.1.15-dev.1 --allow-unmerged-migrations` | Installed over 0.1.14. Protected copy `dev-installs/20261122T033233Z-0.1.15-dev.1/` (before/after SQLite, `Cadence-0.1.14.zip`) |
| Schema | 27 → 28, integrity `ok`, 0 foreign-key errors |
| Rows | 38 tables, every count unchanged; only `schema_migrations` 27 → 28 |
| Binary | `CFBundleShortVersionString` `0.1.15-dev.1`; SHA-256 `ad68944f…` matches `binarySha256`; `codesign --verify --strict` passes |
| New columns | 44 existing Behaviors: `parent_behavior_id` NULL, `inherit_parent_schedule` 0, `sub_behavior_sort_order` 0 |
| Launch sync | Cursor 03:33:06Z, 0 pending |

## Routines on the installed app

The agent drove the window through the accessibility API (role and name lookups, and
keystrokes into focused fields). No click needed the owner.

1. **Create (03:43Z).** On Behaviors › Create behavior: "QA349 Routine", daily at 23:30,
   native reminders off, with 2 draft sub-behaviors. "QA349 Step A" follows the parent
   schedule. "QA349 Step B" has its own schedule: weekly Mon, Wed, Fri, Sat at 23:45. **Up**
   moved Step B above Step A in the draft. Saved: "QA349 Routine created with 2
   sub-behaviors." One `createBehaviorGroup` and 18 `applyOccurrenceGeneration` writes
   synced at 03:43:33Z. SQLite: Step A has `inherit_parent_schedule = 1` and order 1;
   Step B has its own rule and order 0. The parent generates no Occurrences; the steps own
   them (Nov 21: A and B; Nov 22: A; Nov 23: A and B).
2. **Reorder (04:01Z).** In the routine's Details and Settings › Sub-behaviors, **Down** on
   Step B. Locally: A 0, B 1, and the list redrew in the new order. **Defect:** the sync
   failed. Settings showed "Linked · Sync failed" and "A Behavior configuration change
   requires append-only configuration history.", and `reorderSubBehaviors` stayed pending
   for over 15 minutes. See "Defect and fix".
3. **After the fix (04:22Z).** **Sync now**: the held reorder synced at 04:22:28Z; "Account
   data is current."; 0 pending. Hosted: Routine order 0; Step A parent `66e9275a…`, order
   0, inherit true; Step B same parent, order 1, inherit false, weekly at 23:45.
4. **Timeline, Semantic Zoom.** The "Timeline detail" control shows **Routines** pressed.
   With Step B at its own time, Nov 21 shows two routine rows, "11:30 PM QA349 Routine, 0 of
   1 completed" and "11:45 PM QA349 Routine, 0 of 1 completed", each with bulk
   **Completed** and **Not Completed**. This is correct: a routine slot is one parent, one
   local day and one effective start (PRODUCT_SPEC, sub-behaviors, item 4). Future days
   show no bulk marks. **All steps** expands each routine inline with its steps
   (Completed, Not Completed); **Routines** collapses them again.
5. **Edit a step (04:23Z).** Step B's time changed to 23:30, with its own weekdays kept.
   "Behavior saved."; `updateBehaviorGraph` with its configuration event synced. The
   Timeline shows one slot, "11:30 PM QA349 Routine, 0 of 2 completed". Sunday shows "0 of
   1" because Step B does not run on Sundays.
6. **Bulk mark (04:24Z, 23:24 New York).** **Mark QA349 Routine Completed**: one
   `applyParentSlotStatusTransition` synced at 04:24:27Z. Both steps are `completed` with
   one `unresolved → completed` status event each. The row now reads "Completed", with no
   bulk marks. Hosted: both Occurrences completed, both status events present, 4
   configuration events across the three Behaviors.
7. **Cleanup (04:25Z).** **Archive behavior** on the parent: "Behavior archived."; one
   `updateBehaviorGroup` synced at 04:25:09Z. All three are `active = 0` with an
   `archived_at`, and the links are kept. Hosted: all three archived. Local and hosted
   both hold 47 Behaviors (44 + 3 archived throwaways). Pending writes: 0.
8. **Quit.** Normal quit event, 0 pending writes; the agent relaunched Cadence afterwards.

## Defect and fix

`cadence_private.apply_account_sync_plan` required a configuration event for any Behavior
field change other than `title`, `description` and `updated_at`. Ticket 349 defines
`sub_behavior_sort_order` as display order, outside configuration history, so the Mac's
`reorderSubBehaviors` writes no configuration event. Every contract-9 reorder made on a
Mac was therefore refused, and that Mac stopped syncing until the reorder cleared. Web
reorders go through `reorder_sub_behaviors` and were not affected.

- Fix: `supabase/migrations/20261122040000_account_sync_sub_behavior_order.sql` patches
  that one comparison to ignore `sub_behavior_sort_order` (anchored, and fails if the text
  changed). A link or inheritance change still needs a configuration event. Grants
  (`authenticated`, `postgres`) and `security definer` are unchanged.
- Regression: `scripts/account-sync-rpc-smoke.mjs` now applies a contract-9 reorder-only
  write, and checks that a contract-9 schedule change without history is still refused.
  With the old function on the local stack, the smoke fails with the exact error the Mac
  showed. With the fix, it passes.
- Local: applied to the shared local stack with `psql` and recorded in
  `supabase_migrations.schema_migrations`. The `sub-behaviors`, `sub-behavior-portability-connectors`
  and `account-sync-contract` SQL smokes and `smoke:account-sync:local` pass. The shared
  stack (227 users) was not reset, as in Task 12.
- Hosted: `db push` at 04:21:40Z under the standing approval for additive migrations
  (DECISIONS, 2026-11-10): a `create or replace` with the same signature, which only
  accepts writes the old function refused. `migration list`: 151 local, 151 hosted, 0
  differ.

## Tooling findings

1. The pinned Supabase CLI binary (`@supabase/cli-darwin-arm64` 2.105.0, `635c7f83…`) now
   fails `codesign -v` ("invalid signature"), and macOS kills it (exit 137) in this
   worktree and in the primary checkout. An ad-hoc re-signed copy runs. The agent replaced
   the worktree's copy only; `npm ci` restores the original.
2. The shared local stack serves its API on port 55341, but this worktree's
   `supabase status` reports 55321, so `smoke:*:local` cannot reach it. The agent ran the
   smoke through a temporary shim that rewrote the port.
3. A System Events walk of the Behaviors page takes about 11 minutes (about 3,000
   elements). A direct `AXUIElement` walk takes about 1 second. Prefer the native helper
   (`scripts/test-device-ax/axelement.swift` style) on the owner's Mac too.

Not covered: the test Mac (it stays on published 0.1.14); routine reminder text (still
open in STATUS); macOS 14.
