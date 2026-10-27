# Account sync compatibility: stop forced updates on additive changes

Status: Parts A and B (including A.7) approved and implemented in source October 27,
2026, on branch `claude/sync-contract-projection`. Part C is decided (local stack)
and its dev-build change is tracked below. No hosted change has been made.

Implementation differs from the proposal in three places:

- **A.5:** the desktop reader stays strict. The server projects every snapshot to
  the client's contract, so a client never receives fields it does not know.
  Ignoring extras would hide projection faults and would break fingerprint checks.
- **Part B fixtures:** `scripts/account-sync-rpc-smoke.mjs` sends live contract 1
  requests in the 0.1.5 shape instead of replaying frozen files. The requests
  cover the read projection, a refused write to a later field, a profile write
  that keeps learned habits, receipt replay, and an unknown contract.
- **Part B check:** `tests/sql/account-sync-contract-smoke.sql` (run by the
  Supabase rehearsal) freezes synced columns, and
  `tests/account-sync-contract.test.ts` ties `ACCOUNT_SYNC_CONTRACT` to the
  registry. Neither is an `agents:check` rule, because only a migrated database
  shows the real columns.

## Problem

Each feature that adds a synced field breaks every installed desktop build. It
has happened six times: categories (Sep 5), Behavior archive notes (Sep 6),
duration and end date (Sep 18), Where (Oct 19), and place labels and travel
habits (Oct 24). Each time, linked Macs show "Update Cadence" until a new signed
build ships. During active development this means a notarized release per
schema change, or no sync on the owner's own Mac.

## Why it happens (code on `main`, read October 27)

Five independent gates each demand an exact shape.

| # | Where | Rule |
|---|---|---|
| G1 | `cadence_private.apply_account_sync_plan` (patched by anchor in each migration, e.g. `20261024210000_travel_habits.sql:191`) | Profile write must have exactly 13 keys; Behavior writes must carry every new column (`20260918010100…:100`). |
| G2 | Same function, `20260901054332_add_account_sync_contract.sql:510` | Post-apply hosted fingerprint must equal the client's `mergedFingerprint`. Any hosted field the client does not know changes the fingerprint, so this fails even if G1 were removed. |
| G3 | `apps/desktop/src-tauri/src/local_store/sync_apply.rs:84` (`decode_row`) | Any unknown field in a hosted row → "Update Cadence". |
| G4 | `sync_apply.rs:718` (`validate_profile_value`), `:368` (Behavior required fields) | Profile must have exactly the expected keys; Behavior upserts must contain listed fields. |
| G5 | `sync_apply.rs:10` (`AccountSyncEntityKind` enum) and `packages/core/src/resolvers/account-sync.resolver.ts:447` | Unknown entity kinds fail deserialization; place-label rows need an exact key count. |

G1 has a real purpose. The RPC writes every column from the client's row, so an
old client that omitted a new key would null it out. The gates prevent silent
data loss by blocking sync instead. G2–G5 follow from the same "one exact shape"
model.

## Proposal

Three parts. Part A removes the cause. Part B adds a guardrail. Part C removes
development churn from the owner's real account.

### Part A: contract-versioned projection

Each client declares the sync contract it understands. The server reads and
writes in that contract's shape and keeps everything else.

1. **Contract number.** Add `ACCOUNT_SYNC_CONTRACT` (integer) in
   `packages/core`. The current shape is contract 2. The payload field
   `schemaVersion: 1` stays as the envelope version. A new `contract` field
   travels beside it.
2. **Contract registry in SQL.** A private table, or an immutable SQL function,
   maps each contract to its field list per entity kind and its set of kinds.
   Example: contract 2's profile has 13 keys and includes the 4 place-label kinds.
3. **Projected read.** `read_account_sync_snapshot(contract int)` returns only
   that contract's kinds and fields. Its fingerprint is computed over the
   projection. The no-argument version stays and serves contract 1 (see Part A.7).
4. **Merge-preserving apply.** `apply_account_sync_plan` reads `contract`.
   - It rejects a contract below `min_writer_contract` with today's "Update
     Cadence" message.
   - For each upsert, it builds the stored row as `existing || projected_write`,
     so columns outside the contract keep their hosted values. New rows take
     column defaults; every new synced column must have a safe default (Part B).
   - Deletes of a whole row stay deletes; the row's unknown fields go with it.
     That matches user intent.
   - The G2 check compares `mergedFingerprint` with the post-apply snapshot
     **projected to the same contract**.
5. **Desktop reader.** G3/G4/G5 change from exact match to the known subset:
   - Rows decode with known fields required and extras ignored. Remove the
     unknown-field branch in `decode_row`.
   - Desktop validators keep their current rules for each known field's type
     and range, so validation of known data doesn't weaken.
   - In practice, extras only appear if the server's projection is wrong.
     Ignoring them is defensive, not the main mechanism.
6. **When a bump is required.** Bump the contract, and raise
   `min_writer_contract`, only for:
   - a rename or removal;
   - a change in meaning or allowed values for an existing field;
   - a new required invariant across rows that old clients could violate.

   Additive optional fields and kinds bump the contract number without raising
   the minimum. Old clients keep syncing and simply don't see the new data.
7. **Rescuing 0.1.5 (optional, recommended).** Today's 0.1.5 calls the
   no-argument read and sends no `contract`. Treat that as contract 1:
   - 8-key profile;
   - no place-label kinds;
   - Behaviors as at schema 18. Behaviors are unchanged since `where_kind`, so
     no field is dropped there.

   With merge-preserving apply, 0.1.5 would sync again with no desktop release.
   It wouldn't see habits or place labels, and it couldn't erase them.

**What this costs.** One forward migration replaces the anchor-patched apply and
read functions with versioned ones. Future migrations then add fields to the
registry instead of patching function bodies by text anchor. This also removes
the fragile `position(anchor in definition)` patch pattern.

**Main risk.** Merge-preserving writes for *append-only history* kinds:
definition, configuration and status events. These must stay
insert-or-identical, as today. The merge applies only to mutable rows: profile,
Behavior, category, schedule, settings. History kinds keep exact-match rules
within their contract.

### Part B: guardrail so additive changes stay additive

- **Frozen payload fixtures.** Add one recorded snapshot + plan per published
  contract (1 = 0.1.5 shape, 2 = current). Store them under
  `tests/fixtures/account-sync/contract-N/`.
- **SQL smoke.** `scripts/account-sync-rpc-smoke.mjs` replays every fixture
  against the migrated local database and asserts four things:
  - apply succeeds;
  - fields outside the contract are unchanged;
  - fingerprints match;
  - a re-read returns the projected shape.
- **CI rule.** A migration that changes a synced table must also update the
  contract registry. `agents:check` fails if a synced table gains a column
  without a registry entry, or without a default.
- **Doc.** `docs/DESKTOP_DATA_MODEL.md` gets a short "Sync contract" section
  listing the bump rules from A.6.

### Part C: keep development off the owner's account

The desktop already takes `VITE_SUPABASE_URL` at build time
(`apps/desktop/scripts/release-config.mjs:120`), so this needs configuration,
not code.

Owner decision, October 27, 2026: use the local Supabase stack, not a hosted
staging project. No free-tier project slots remain, and a project inside the
Pro organization would add about US$10 a month in compute.

- Development target: the local stack (`npm run supabase -- start`) on the
  owner's Mac. New migrations apply there first, through
  `npm run supabase -- db reset` or `migration up`.
- `dev-build` (PR #142) defaults to the local stack's URL and publishable key.
  Only release builds use production; the release config keeps rejecting
  non-HTTPS URLs, so a dev build cannot be published by mistake.
- The test Mac reaches the stack over Tailscale at the owner's Mac address.
  The dev build's CSP must allow that origin, and only in dev builds.
- Google sign-in against the local stack needs the local auth provider
  configuration in `docs/SUPABASE_WORKFLOW.md`. Not verified: whether the
  current local config supports desktop deep-link callbacks.
- Limit: dev sync works only while the owner's Mac runs the stack.
- Vercel Preview is unchanged. Not verified: which project Preview uses today.
- Production migrations ship in batches, at desktop release time, not per
  feature.
- Cost: US$0. `docs/COSTS.md` needs no new line.

**Not implemented (October 27). Reading `apps/desktop/scripts/release-config.mjs`
turned up three blockers that need owner decisions first:**

1. Dev builds deliberately use the production bundle identifier, entitlements
   and stable update feed, so the next release replaces them. They therefore
   share the installed app's SQLite profile and Keychain session. A dev build
   linked to a local-stack account would sign in to a different hosted user, on
   top of the owner's real local data. To fix this safely, dev builds need their
   own identifier and data directory. That changes the dev-build design from
   PR #142.
2. The local stack has no Google provider credentials, because
   `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID` and `…_SECRET` are unset. Sign-in
   through the local stack needs a Google OAuth client with the local callback,
   or a password sign-in that is enabled only in dev builds.
3. Dev builds reach production services through `VITE_CALENDAR_BROKER_ORIGIN`
   (Calendar, Daily Brief, Travel), and those services verify tokens against
   production. With a local-stack session, those features would fail unless they
   also run locally. Not verified: App Transport Security for plain HTTP to a
   Tailscale `100.x` address.

With Part A alone, the owner's 0.1.x Mac keeps syncing through additive changes.
With Part C, unfinished schema never reaches the real account at all.

## Rollout

1. Implement Part A and Part B in one PR: SQL migration, core contract, desktop
   reader, planner, tests. Rehearse it on a local `db reset`.
2. Push the migration. If A.7 is included, published 0.1.5 resumes syncing
   immediately. Verify on the test Mac.
3. Ship 0.1.6 with the contract-2 reader. From then on, additive features need
   no forced update.
4. Part C can proceed in parallel; it has no code dependency.

## Decisions for the owner

1. Approve Part A as described?
2. Include A.7 (rescue 0.1.5 without a release)? Recommended. It also tests the
   mechanism on a real old client.
3. Part C: decided (local stack, US$0).
4. Should 0.1.6 wait for Part A? Recommended: yes. Then 0.1.6 is the last
   forced update caused by additive changes.

## Not verified

- The exact Behavior and schedule column lists per historical contract. The
  fixtures in Part B will establish them.
- Vercel Preview's Supabase target.
- Whether any planner conflict rule compares fields that a contract-1 client
  cannot see. Check during implementation in `account-sync.resolver.ts`.
