# Behavior Where rollout plan

## Release boundary

PR #112 changes the hosted and desktop Behavior sync contract. The new hosted
writer requires `where_kind` for desktop upserts. A desktop without SQLite
migration 0018 and the updated sync payload fails closed for Behavior writes
after the hosted migration; local data remains local. The earlier signed 0.1.3
artifact is not a compatible Where release.

The independent session hotfix may ship as 0.1.4 before Where. The Where
candidate must use a version newer than every already-published desktop
release. Use 0.1.4 only while it remains unpublished and newer than the current
published version. If 0.1.4 has shipped, advance the version, for example to
0.1.5, or higher if another release already exists. Never replace published
0.1.4 artifacts or reuse that updater version for different application code.

The previous web graph writers are deliberately supported during a
migration-first deployment. This compatibility does not extend the desktop
sync contract. A title-only edit preserves Home or Anywhere, while a legacy
configuration edit that would contradict the stored Where value is refused.

## Implementation and deployment sequence

1. Integrate the reviewed connector work before this PR when both features
   are selected. Preserve the connector Calendar event union, freshness and
   Hevy data, the desktop Apple Maps choice, and both interaction-map additions.
2. Select an immutable combined release commit. Prepare the signed desktop
   candidate with SQLite 0018, the updated sync contract and the session fix
   from PR #115. Verify an upgrade from the currently installed desktop,
   retained local data, Where backfill, and sync against a migrated test
   database. Native signing and installed acceptance cannot be inferred from
   the frontend build.
3. Rehearse the complete hosted migration set on a disposable database. If
   PR #111 ships, its migrations `20261019040000_connector_lifecycle.sql` and
   `20261019041000_daily_brief_connector_disclosure.sql` precede
   `20261019180000_add_behavior_where.sql`. Verify the linked production
   migration history before applying anything. If the connector rollout is
   deferred, explicitly reconcile the unapplied migration order before a
   later connector release; do not silently introduce out-of-order history.
4. After the operator authorizes the concrete release, apply the reviewed
   migrations, deploy the matching web source promptly, and distribute the
   verified desktop candidate. Main merges trigger web and marketing
   deployments; a main merge alone does not apply SQL or update installed
   desktops. Schedule these steps as one controlled rollout.
5. Check all four Where states, Home removal, existing place backfill,
   routing consent, foreground location, Apple/Google navigation links,
   offline edits and reconnection on web and installed desktop. Confirm the
   connector reads and Settings RPCs work if PR #111 is included.
6. Refresh deployment-specific public Trust evidence after the final app and
   marketing deployments are ready. Keep any owner-gated provider enablement
   disabled until its own acceptance is complete.

## Travel release train (October 23, 2026)

The owner combined Tickets 165, 212 and 216–219 with this PR into one release. The
train adds two hosted migrations after `20261022180000_separate_agent_calendar_grant.sql`:
`20261024200000_completion_place_labels.sql` (216), then
`20261024210000_travel_habits.sql` (217). It adds SQLite 0019 (217 habits) and
0020 (216 labels) after 0018, so the desktop schema version is 20. The desktop
candidate must be 0.1.6 or later: 0.1.4 is the unpublished session hotfix, and 0.1.5
is the signed build from main (schema 18) that restores Behavior sync after the
October 23 production Where migration. Builds before the train fail closed on
account synchronization.
The train adds no step to the sequence above; it widens steps 2, 3 and 5 to the
travel tickets' migrations and acceptance. See the release-train section in
`STATUS.md`.

## Failure handling

Preserve schema and local user data. Roll back the web deployment to the
previous compatible graph writer if needed, and stop desktop synchronization
until a compatible build is available. Do not reverse the backfill or remove
Where values to make an older client write. Record the selected app, marketing
and desktop artifacts together so a rollback does not claim acceptance from a
different build.

## Review evidence

The refreshed PR passes 2,897 tests with 167 skipped, web and desktop builds,
web/desktop typechecks, registry checks, lint and Design System Bench checks.
The PR's earlier disposable Postgres and Rust evidence remains historical;
this review environment has no Docker/Postgres or Rust toolchain. No hosted
migration, provider operation, signing or deployment occurred in this review.

The subsequent stack integration includes reviewed PR #111 at `e9c2dc6`.
Conflicts preserve the desktop Apple Maps choice alongside all three Calendar
sources, per-source freshness and Hevy activity, and keep both Where and iCloud
interaction-map entries. Travel estimates still use Google events only. The
combined source passes 366 focused Where, travel, sync, connector and desktop
Product regressions, with one local-database test skipped. Agents, interaction,
resolver, design-system and load-manifest checks, lint, web/desktop TypeScript,
core portability and desktop parity also pass. Final aggregate verification
with the dependency updates and PR #115 is recorded separately.
