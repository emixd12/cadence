# Open PR review and release plan — October 27, 2026

## Scope and baseline

The owner requested review, corrections, ordered merging and release of every open
PR. The initial main commit was `f10e068c340e6f4f256c757c8b43ec26a655b56d`.
Seven PRs were open: #149, #151, #152, #153, #154, #155 and #156.

Readback confirmed the production application at
`dpl_8Yhhr9bQPKT7iRNX1Dn2sJfJuq3T` and marketing at
`dpl_Gid3Tau9W5fKx2sLfau9avJ36jYQ`, both from that main commit. The hosted
Supabase ledger contained 92 migrations, ending at `20261024210000_travel_habits`.
The published desktop is 0.1.5. Its strict account-sync shape predates that migration.

This plan does not close unrelated product tickets or provider submissions.
Messaging work remains in Tickets 245–246 under the owner's October 27 decision.

## Merge order and corrections

| Order | PR | Correction and reason |
| --- | --- | --- |
| 1 | #152 | Merge the production record first. It supplies the evidence #156 cites and the P-012 entry #154 must preserve. |
| 2 | #154 | Integrate #152 before renaming the log. Preserve P-012, advance the next ID to P-013, correct the Privacy date, and update the new QA reference. |
| 3 | #155 | Keep the scope decision; update its new reference to `MESSAGING_CHANGES.md` after the rename. No feature implementation follows from this directive change. |
| 4 | #156 | Preserve unresolved acceptance. Correct the duplicate Ticket 232 label, the disabled MCP deployment status, and the Ticket 245 verification follow-up. |
| 5 | #151 into #149, then #149 into main | Fix the stack before landing it. Honor the configured process name, identify the app process precisely, and remove unsafe stale-coordinate restart assumptions. Validate Swift helpers on macOS. |
| 6 | #153 | Land sync compatibility last after reviewing the full migration and passing database rehearsal. Reject null/invalid contracts, preserve hidden fields in comparisons, separate versioned receipt keys, and record the owner's decision to drop the separate local development target. |

Later PR branches must merge current main without discarding earlier status entries.
Use expected-head checks on branch updates and PR merges. Do not force-push over
another author's work. Preserve original PR history with merge commits.

## Verification

1. Run agents, interactions, resolvers, lint, typecheck, Vitest and web build checks.
   Run desktop renderer and marketing checks for the integrated tree.
2. Require GitHub CI on each revised PR. Require native Swift validation for the
   test-device tooling: `.github/workflows/desktop-native.yml` now includes the
   **Test-device Swift helpers** job on macOS 15. Resolve review threads only after
   the fix is present.
3. Require #153's disposable Supabase rehearsal on its revised head. Runs
   `40537377626`, `40556180279` and `40558572739` failed before SQL validation.
   Registry authentication did not clear the gate. The later isolated standard
   Docker pull in `40561396997` confirmed GHCR throttling. The current repair
   uses the already-approved official ECR image pins with bounded, classified
   pull retries; it removes the unused GHCR login and package permission. All
   proxy restrictions and rehearsal checks remain. A successful run on the
   final head must still establish migration and RPC validation.
4. Exercise contract 1 reads/writes, hidden-field preservation, receipt replay,
   contract transitions, unsupported/null contracts and cross-account isolation.
5. Distinguish plain PostgreSQL regression evidence from Supabase/PostgREST and
   installed desktop acceptance. Never substitute one for another in release records.

The combined source joins reviewed PR #153 head `f80f758` (tree
`75bd407014dfdf8ca3945aefc0cb0800bc6b4ecb`) and PR #149 head `b97492b` (tree
`7b2764b5a506f0820676650b0665a1d11feebd3f`). Both remote trees matched the reviewed
local trees before integration. This integration changes no migration SQL and
does not establish a hosted deployment.

Final-head CI remains required after further repairs. The latest integrated-head
results are recorded below.

## Hosted release sequence

1. Compare the final reviewed migration list with the hosted ledger. Only the
   account-sync-contract migration may be pending. Keep all 92 applied migrations
   unchanged and deploy the reviewed migration through migration history.
2. Apply the server contract before publishing a desktop that
   sends contract 2. Confirm that no-argument reads still mean contract 1 and that
   unknown contracts fail closed. Verify the published 0.1.5 shape with synthetic
   fixtures before claiming installed 0.1.5 acceptance.
3. Merge the final source only after required CI succeeds. Both Vercel projects
   rebuild on every main merge; verify each final production deployment's commit.
4. Set the application's Production `CADENCE_TRUST_MARKETING_DEPLOYMENT_ID` to the
   final Ready marketing deployment. Redeploy the application and read back its
   production aliases, source commit and provenance pairing.
5. Check public routes, unauthenticated protected endpoints and bounded runtime
   errors. Record what was actually tested, including any unverified signed-in flow.

Compatibility covers the published **0.1.5** shape and the recorded
**0.1.6-dev.2** from `ed93fff` (SQLite schema 18). Dev.2's sync source matches
0.1.5's `41e4549`: it expects eight profile keys and calls the no-argument read
RPC. No later installed development build is recorded; the current Mac build
remains unverified.

Only unversioned development builds from later source that requires the expanded
profile need coordinated replacement from contract-2 source at cutover. They
receive contract 1 and fail their stricter shape check. Classify that cohort by
source, not a 0.1.6 version label. Published 0.1.3 remains unsupported because it
predates Where. After SQL, authenticated RPC and required CI checks pass, the
server rescue may proceed without waiting for a new native release. Native
publication keeps its installed acceptance and signing gates below. The full
client matrix is in `docs/plans/2026-10-27-sync-compatibility.md`.

The server migration is additive and retains the 0.1.5 interface. Application
rollback must retain this compatibility migration; reverting it would break clients
that send contract 2. A database defect needs a reviewed forward repair, not an
unreviewed destructive rollback.

## Desktop release

A new signed desktop must use 0.1.6 or later and the final reviewed source. Follow
`docs/DESKTOP_RELEASE.md` and its release-packet template. Signing, notarization,
quarantined download, database preservation, the 0.1.5-to-candidate updater run and
changed-area checks remain mandatory. Publishing server compatibility does not
publish the newer desktop features.

Installed acceptance must also exercise the revised test-device helpers. Verify
the configured process, expected downloaded version, named restart and resulting
PID on the test Mac. If accessibility fails after bundle replacement, the helper
must report installation without restart and send no stale-coordinate click.
Synthetic SSH tests and the macOS Swift typecheck do not establish that installed
flow or database preservation.

The current execution environment is Linux. No private test-device inventory,
Tailscale connection, Apple signing identity or retained Mac artifact has been
established here. Complete all source and hosted work before requesting any missing
Mac connection. Do not label native publication complete without its evidence.

## Completion record

Review checkpoint, October 27, 2026: six PRs are merged; **only #153 remains open**.

| PR | Merge result |
| --- | --- |
| #152 | Merged to main at `a0dfd2f`. |
| #154 | Merged to main at `28ef9fd`. |
| #155 | Merged to main at `ecba2be`. |
| #156 | Merged to main at `fefeeb0`. |
| #151 | Merged into #149 at `feb9ea4`. |
| #149 | Merged to main at `f8a7740035529a81f8037cdfea3af0aabea73a64`. |

Integrated PR #153 head `aae56162c95864719b2696d934357905c09e7476` passed ordinary
CI (`40558572628`) and both native jobs (`40558572652`), including the Swift
helpers. Supabase rehearsal `40558572739` still failed during startup after GHCR
login succeeded. No SQL test executed in that run; the earlier broad classifier
cannot establish its exact failure cause.

The next published head, `21babac38de7a945e92e7a4a15fd424a88d9cb79`, added
isolated sequential pulls and bounded diagnostics. Rehearsal `40561396997`
(job `122391069851`) failed the standard Docker pre-pull of
`ghcr.io/supabase/postgres:17.6.1.132` with only the fixed
`registry_rate_limit` signal and no retained HTTP code. No migration check ran.
Read-only manifest probes on October 27 at 18:37–18:38 UTC independently found
429/`TOOMANYREQUESTS` for six GHCR pins and ECR's Storage pin; the other six ECR
manifests and GHCR's PostgREST manifest returned 200. No throttled response supplied
`Retry-After`, and no missing-manifest response was observed. Only PostgREST's
cross-registry indexes could be compared and were byte-identical; the other six
identities were not reverified.

The current repair selects `public.ecr.aws`, the pinned CLI's official default
and an existing proxy allowlist entry. It pulls all seven unchanged pins
sequentially, with at most four attempts per image and 10-/20-/40-second backoff
only for explicit throttling or specified network interruptions. Unknown,
authentication, manifest, proxy, disk/certificate and incomplete-diagnostic
failures do not retry. All pulls and delays share the first startup's eight-minute
budget. The second clean startup, migration reset and full SQL/RPC checks remain.
Raw logs and credentials stay suppressed; diagnostics emit only bounded,
allowlisted fields. ECR also throttled during the probes, so this repair does not
establish availability or a successful rehearsal. Final-head validation remains
required.

No hosted migration has been applied during this review. The ledger remains at
92 migrations through `20261024210000`. Successful final-head SQL/RPC rehearsal,
reviewed migration deployment and any provider-generated timestamp reconciliation
remain pending. The migration contents must remain traceable to the reviewed SQL.

Local CLI authentication is absent for Vercel 65.4.0 and GitHub CLI 2.103.3. The
Vercel connector's environment-list request and the actual Production upsert of
`CADENCE_TRUST_MARKETING_DEPLOYMENT_ID` both returned 403. The attempted value was
`dpl_6naaoSjaTVGUUrwtx9VK9djrYHpR`; no environment write was made. This is a
confirmed write-permission blocker, with no authenticated local CLI fallback.

At merged main `f8a7740035529a81f8037cdfea3af0aabea73a64`, application deployment
`dpl_CzL5eMtoVCzCP4YBJfTrAhSGnjk4` and marketing deployment
`dpl_6naaoSjaTVGUUrwtx9VK9djrYHpR` are both Ready. These establish deployment of
the current merged main only. Final PR #153 deployment verification and the
required Trust provenance pairing remain open.

Native 0.1.6 is prepared in source; the published feeds still serve 0.1.5. No Mac
inventory is configured in this environment. Installed acceptance, signing,
notarization and native publication remain open; the passing native CI jobs do not
replace those checks. Preserve historical STATUS evidence and append actual release
results when available. Keep private device inventory and credentials outside this
repository.
