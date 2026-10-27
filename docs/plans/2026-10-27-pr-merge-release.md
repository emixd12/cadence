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
| 6 | #153 | Land sync compatibility last after reviewing the full migration and passing database rehearsal. Reject null/invalid contracts, preserve hidden fields in comparisons, separate versioned receipt keys, and document the deferred local development target. |

Later PR branches must merge current main without discarding earlier status entries.
Use expected-head checks on branch updates and PR merges. Do not force-push over
another author's work. Preserve original PR history with merge commits.

## Verification

1. Run agents, interactions, resolvers, lint, typecheck, Vitest and web build checks.
   Run desktop renderer and marketing checks for the integrated tree.
2. Require GitHub CI on each revised PR. Require native Swift validation for the
   test-device tooling. Resolve review threads only after the fix is present.
3. Require #153's disposable Supabase rehearsal on its revised head. The initial
   run `40537377626` failed during image pull rate limiting, before any migration
   test ran; it is not SQL validation evidence.
4. Exercise contract 1 reads/writes, hidden-field preservation, receipt replay,
   contract transitions, unsupported/null contracts and cross-account isolation.
5. Distinguish plain PostgreSQL regression evidence from Supabase/PostgREST and
   installed desktop acceptance. Never substitute one for another in release records.

## Hosted release sequence

1. Compare the final reviewed migration list with the hosted ledger. Only the
   account-sync-contract migration may be pending. Keep all 92 applied migrations
   unchanged and deploy the reviewed migration through migration history.
2. Apply the backward-compatible server contract before publishing a desktop that
   sends contract 2. Confirm that no-argument reads still mean contract 1 and that
   unknown contracts fail closed. Verify restored legacy behavior with synthetic
   fixtures before claiming installed 0.1.5 acceptance.
3. Merge the final source only after required CI succeeds. Both Vercel projects
   rebuild on every main merge; verify each final production deployment's commit.
4. Set the application's Production `CADENCE_TRUST_MARKETING_DEPLOYMENT_ID` to the
   final Ready marketing deployment. Redeploy the application and read back its
   production aliases, source commit and provenance pairing.
5. Check public routes, unauthenticated protected endpoints and bounded runtime
   errors. Record what was actually tested, including any unverified signed-in flow.

The server migration is additive and retains the legacy interface. Application
rollback must retain this compatibility migration; reverting it would break clients
that send contract 2. A database defect needs a reviewed forward repair, not an
unreviewed destructive rollback.

## Desktop release

A new signed desktop must use 0.1.6 or later and the final reviewed source. Follow
`docs/DESKTOP_RELEASE.md` and its release-packet template. Signing, notarization,
quarantined download, database preservation, the 0.1.5-to-candidate updater run and
changed-area checks remain mandatory. Publishing server compatibility does not
publish the newer desktop features.

The current execution environment is Linux. No private test-device inventory,
Tailscale connection, Apple signing identity or retained Mac artifact has been
established here. Complete all source and hosted work before requesting any missing
Mac connection. Do not label native publication complete without its evidence.

## Completion record

Update this plan and `STATUS.md` with correction commits, CI runs, migration readback,
deployment IDs, open-PR count and desktop publication evidence or the exact remaining
access blocker. Keep private device inventory and credentials outside this repository.
