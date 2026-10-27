# Account sync compatibility: stop forced updates on additive changes

Status: Parts A and B (including A.7) approved and implemented in source October 27,
2026, on branch `claude/sync-contract-projection`. The owner dropped Part C on
October 27; development builds keep using production. No hosted change has been made.

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

Review corrections also reject null read contracts, preserve hidden compare-and-set
fields for deletes, and namespace client idempotency keys by contract. The rollback
fixture `tests/sql/account-sync-contract-write-smoke.sql` covers profile preservation,
receipt replay after hidden-only changes, owner isolation and a synthetic later
Category column. It tests old inserts, updates and deletes, and keeps the existing
concurrent-revision rejection before a retry.

Review verification: all 93 migrations and the five sync/place-label/travel-habit
SQL smoke files pass on fresh disposable PostgreSQL 16.15 with synthetic auth
tables and roles. The new fixture fails against the original null-contract and
delete-preservation implementations. Targeted Vitest passes 96 tests; core and
desktop typechecks, changed-file lint, agents, interactions and resolvers checks
pass. This standalone database does not establish Supabase Auth/PostgREST or
installed Mac acceptance; the disposable Supabase rehearsal remains required.

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

**Owner decision, October 27, 2026: Part C is dropped.** Neither a staging
project nor the local stack will serve dev builds. The setup work (a separate
dev identity, a dev-only sign-in and a local web app) outweighs the benefit once
Part A stops additive changes from breaking sync. Dev builds keep using
production. Breaking changes still need the coordinated release in
`docs/DESKTOP_DATA_MODEL.md`. The analysis below is kept for reference.

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

Part A preserves registered additive shapes for supported contracts. It does not
make every historical desktop shape compatible. Part C is dropped.

## Rollout

1. Implement Part A and Part B in one PR: SQL migration, core contract, desktop
   reader, planner, tests. Rehearse it on a local `db reset`.
2. Prepare a 0.1.6 build from contract-2 source before the hosted cutover. Older
   0.1.6 development builds require the expanded profile but send no contract.
   After the migration they receive contract 1 and fail closed until rebuilt.
3. Push the migration after the disposable Supabase rehearsal passes. Verify
   published 0.1.5 on the test Mac, including pending local writes, convergence,
   receipt retry, and preservation of hosted travel habits and place labels.
4. Publish the verified 0.1.6 build through the existing desktop acceptance and
   release procedure. Its contract-2 RPC requires this migration first.

| Client | Result after migration |
|---|---|
| Published 0.1.5 | Receives contract 1; source-level SQL/RPC checks cover preservation. Installed acceptance remains required. |
| Published 0.1.3 or earlier | Not rescued; its Behavior shape predates Where. It still needs a desktop update. |
| Pre-contract 0.1.6 development build | Receives contract 1 but expects the expanded profile; rebuild from contract-2 source. |
| Contract-2 desktop | Receives the complete current shape, including travel habits and place labels. |

Fix forward if the migration needs correction. Once a contract-2 build is in use,
removing the new overload breaks its reads. Reverting only desktop source does not
revert the hosted RPCs. Keep both read signatures, registry, and old-client
projection while correcting any apply defect in a new migration. Preserve account
data and receipt history. This release does not authorize replacing local profiles
or deleting pending writes.

## Recorded decisions

1. Parts A and B are approved, including the contract-1 rescue for published 0.1.5.
2. Installed 0.1.5 acceptance verifies the rescue on a real old client.
3. Part C: dropped (October 27).
4. The next 0.1.6 build uses contract 2 and requires this migration before it can
   synchronize. Registered additive fields can then retain older supported shapes.

## Not verified

- Installed 0.1.5 and contract-2 desktop acceptance against the deployed migration.
- Vercel Preview's Supabase target.
- PostgREST overload dispatch is covered by the authenticated RPC smoke when the
  disposable Supabase rehearsal runs; a standalone SQL run alone does not verify it.
