# PR merge readiness and deployment plan — October 24, 2026

## Recommendation and scope

Use one deliberate sequence: reconcile deployment and release records, finish the
pinned 0.1.5 release, merge the dependency stack, ship the combined travel branch
#138, then integrate #135. The travel children overlap substantially; merging them
as separate releases adds migration and conflict risk without adding functionality.

This review covers the 15 open PRs below. It includes source analysis, branch
ancestry, integration work, targeted regression tests and available CI evidence.
Corrections were prepared on the affected PR branches. This document does not
declare a merge, hosted migration, provider change, notarization, publication or
candidate promotion complete. A successful check on an earlier commit does not
approve a later integration tree.

## PR inventory

| PR | Scope | Assessment and intended disposition |
| --- | --- | --- |
| [#122](https://github.com/emixd12/cadence/pull/122) | Lucide 1.59.0 | No application defect found. Refreshed against current main; merge first in the dependency stack. |
| [#123](https://github.com/emixd12/cadence/pull/123) | React and React DOM | Corrected manifest floors to `^19.3.1` in web and desktop. The lockfile already paired the runtimes correctly. Integrates #122. |
| [#124](https://github.com/emixd12/cadence/pull/124) | Tauri API | Corrected JavaScript/native version mismatch and added a compatibility guard. Integrates #122/#123; requires a newly accepted desktop build. |
| [#130](https://github.com/emixd12/cadence/pull/130) | Optional first-run Travel setup | No additional defect found. Feature commits are subsumed by #138; retire after the combined merge. |
| [#131](https://github.com/emixd12/cadence/pull/131) | macOS location permission guidance | Corrected permission inspection that requested a position. Carry the fix into #138; installed native acceptance remains distinct. |
| [#132](https://github.com/emixd12/cadence/pull/132) | Daily Brief travel facts, stage 1 | Subsumed by #138, whose signed-conclusion path received the freshness fixes below. |
| [#133](https://github.com/emixd12/cadence/pull/133) | Weather margins | Corrected missing forecast data being classified as clear. Preserve the correction in #138; no separate travel deployment. |
| [#135](https://github.com/emixd12/cadence/pull/135) | Briefing recipes and separate agent Calendar grant | Corrected Setup tips, duplicate moves and travel-incompatible fallback suggestions; retained unrelated lockfile metadata. Integrate after #138. Candidate promotion and Calendar cutover remain separate. |
| [#136](https://github.com/emixd12/cadence/pull/136) | Learned Travel habits | Feature work is subsumed by #138. Its standalone SQLite numbering must not be shipped beside #137 independently. |
| [#137](https://github.com/emixd12/cadence/pull/137) | Completion place labels | Corrected truncated retained history and a real concurrent opt-out race. Carry both fixes into #138. |
| [#138](https://github.com/emixd12/cadence/pull/138) | Combined travel release | Preferred release vehicle. Includes shared feature fixes and new source/token freshness checks; validate the final integrated head. |
| [#139](https://github.com/emixd12/cadence/pull/139) | October 23 hosted migration record | No defect found. Merge the record; do not reapply the migrations it records as completed. |
| [#140](https://github.com/emixd12/cadence/pull/140) | 0.1.5 candidate and acceptance packet | Reconciled with current stable-updater publication policy and preserved new Mac evidence. Documentation readiness does not mean publication readiness. |
| [#141](https://github.com/emixd12/cadence/pull/141) | Connector production configuration record | Resolved its stale-base integration while retaining connector and release history. No new secret rotation or redeploy is implied. |
| [#144](https://github.com/emixd12/cadence/pull/144) | Agent-run desktop acceptance | Reviewed latest head `417872b`, including location checks and Launch Services findings. No additional issue found. |

#130 and #131's original heads are ancestors of the original combined branch.
#136 and #137 have later standalone merge commits, but their feature commits are
already incorporated. Preserve the review corrections without replaying obsolete
standalone settings flows.

## Defects corrected and why they matter

### Runtime and native permission boundaries

#124 originally combined Tauri JavaScript API 2.12.4 with native Tauri 2.11.5.
Tauri requires compatible major/minor versions across that boundary. The correction
pins API, CLI and native Tauri to 2.12.4, updates `tauri-build` to 2.7.3, and
regenerates both lockfiles. Deep-link and updater plugin versions remain unchanged.
A cross-language dependency guard now runs in repository checks and desktop builds,
with six regression tests. See
[the guard](https://github.com/emixd12/cadence/blob/831469d6a742845bfdb8486c67198190207dac10/scripts/check-desktop-dependencies.mjs) and
[Tauri's updating guidance](https://v2.tauri.app/develop/updating-dependencies/).

#123 is a consistency correction, not evidence of a previously mismatched installed
React pair. React/DOM were already locked together at 19.3.1; matching manifest
floors prevent a later install from weakening that baseline.

#131's permission label performed a foreground position request, conflating
authorization with position availability and sharing the position operation's
mutex. The new native `location_permission` command reads authorization and service
state only. Settings uses a separate permission adapter; Timeline retains its
coordinate-read behavior. An authorized position timeout now offers another
position request instead of telling the user to enable permission already granted.

### Travel evidence and retained data

#133 treated incomplete weather input as clear. Missing rain or showers measurements
now remain unknown. Clear weather requires complete hourly coverage and all rule
measurements; observed adverse conditions can still contribute their margin.
The adapter also checks timestamp units, range, alignment and increasing order.
Three regression tests fail against the original behavior and pass with the fix.

#137 read only one PostgREST page, ordered oldest first. After 1,000 retained labels,
recent completions disappeared from Where suggestions and combined Brief history
counts. All four unbounded collection readers now use the existing paginator,
owner filters and stable ordering. Later-page errors reject incomplete results.
Six regressions cover collection boundaries, recent suggestions and read failures.

More seriously, the hosted opt-in trigger did not lock the setting. An insert
could observe the previously enabled value while opt-out deleted existing records,
then survive both commits. The correction holds a share lock through the dependent
write. An isolated PostgreSQL regression reproduced surviving markers, labels and
dismissals before the fix and verified rejection or subsequent deletion afterward.
Its scope and the workspace-recovery distinction are recorded in
[the place-label review](2026-10-24-place-label-review.md).

### Signed conclusions and generation correctness

#138's signed conclusions were not bound to every planning input. The correction
uses one shared duration-history range and revision, including session occurrence
and Behavior associations. It binds timezone, actual Home and habits values,
occurrence status and the full Calendar event set, including unnamed events.
Caller-maintained timestamps alone are insufficient because sync can preserve a
revision while changing its value.

Delivery checks now reject changes behind accepted conclusions. Route issuance
also checks current timezone and actual settings values. A status change must
invalidate the plan because route and occupancy selection include unresolved
occurrences; a Note-only change still preserves paid work.

Two ordering races were reproduced: stored inputs could change while a slower
weather request or the final Calendar reread remained pending after the supposed
last check. Both provider waits now finish before the final stored-input fence.
Each deferred-provider regression failed before its reorder and passed afterward.
All 40 route-refresh tests pass. These checks provide bounded freshness, not an
atomic transaction across external providers and PostgreSQL.

Full Calendar binding can exceed the token's size limit on busy calendars.
The issuer now refuses such tokens; routing still returns its evidence, and the
Brief uses stored facts without supplied route/weather conclusions. Invalid,
foreign, expired or stale tokens also fail closed without failing the whole Brief.
See [the token service](../../lib/services/travel-conclusions-token.ts) and
[route regressions](../../tests/travel-route-refresh.service.test.ts).

#135's recipe 1.2 Setup tips used facts from before projection, so accepted estimates,
excluded Behaviors or deliberately disabled duration inputs could still produce a
false missing-length tip. Tips now use the same projected context and duration
sources as the Brief. Repeated planner option IDs are rejected, preserving the
one-move-per-Behavior contract. Optional estimation cost assumptions are documented;
the production recipe default remains unchanged.

Combining #135 with #138 exposed another defect: recipe 1.2 could reintroduce an
omitted planner move after travel analysis rejected it. The integrated correction
uses final projected travel facts in a pure core policy. Known conflicting moves
are withheld and rejected if selected by model output; unknown or deliberately
withheld travel facts cannot automatically restore an omitted move. Planner inputs
remain free of travel data. Five integration regressions cover these boundaries.
The combined Brief UI also preserves Travel guidance and overlap warnings when
recipe 1.2 supplies little or no prose, with a single Open-Meteo attribution; two
DOM regressions cover that presentation.

## Merge and implementation sequence

1. **Merge #139, #141, latest #144, then #140.** Preserve both operational histories
   in the resolved additive STATUS merge. #140 now includes these reviewed record
   predecessors, so its later merge retains them. #139 records an earlier web-before-schema deployment
   mistake; it is evidence for avoiding that sequence now. Documentation merges can
   still trigger deployment automation, so reconcile deployment IDs and Trust evidence.

2. **Finish the pinned 0.1.5 release before changing the desktop runtime baseline.**
   Use its documented source and artifact hashes. The packet now correctly places
   the real updater test during authorized stable-feed publication, before moving
   the version-free download and preview feed. Do not rebuild the candidate from
   a later dependency or feature branch while retaining its existing acceptance.
   This serialization keeps the release baseline clear. Moving main does not itself
   invalidate an immutable artifact: if work must overlap, keep 0.1.5 pinned to its
   recorded source and stop describing it as equivalent to current main.

3. **Merge #122 → #123 → #124.** The stack has been resolved in that order.
   #124 also includes the resolved release records. Keep web/desktop manifests and both locks coherent. Node 24 is the tested project
   baseline. The new Tauri runtime needs its own candidate acceptance; 0.1.5's binary
   evidence cannot establish that runtime's behavior.

4. **Integrate and merge corrected #138.** Preserve the #131, #133 and #137 fixes
   and the conclusion/freshness regressions. Reconcile the dependency stack and main
   before checking the final tree. The corrected branch includes the resolved
   documentation and dependency predecessors. Close superseded travel PRs after verifying their
   intended changes are represented; do not deploy each child separately.

5. **Integrate #135 after #138.** Resolve shared Briefing context, Calendar, generated
   types, Settings and documentation against the combined implementation. Keep the
   new agent Calendar grant separate from the Timeline grant and preserve existing
   connector disclosure fences. Source merge, hosted cutover and recipe promotion
   are separate decisions; existing production recipe behavior remains the default.
   The final #135 branch is prepared against #138 so reviewers can verify the
   semantic integration, including travel-aware fallback suppression.

Resolved integration trees may receive further commits before publication.
Re-run required checks on those exact heads rather than inferring readiness from
clean merges or earlier branch checks.

## Deployment, migration and rollback plan

Verify the actual hosted migration ledger first. #139 records the October 23
connector and Where migrations as applied; do not infer current production state
from a local branch alone. Rehearse the final combined migration history, generated
types, owner RLS and account-sync contract before the coordinated rollout.

| Order | Hosted migration | Release |
| --- | --- | --- |
| 1 | `20261022180000_separate_agent_calendar_grant.sql` | Ticket 187, applied October 24, 2026 |
| 2 | `20261024200000_completion_place_labels.sql` | #138 |
| 3 | `20261024210000_travel_habits.sql` | #138 |

Ticket 187 shipped first, without the travel train. The travel migrations were
renamed from `20261022160000` and `20261022170000` so they sort after that applied
migration; a plain `db push` then applies them without `--include-all`. The two
travel migrations patch account-sync RPC definitions by anchor and touch no object
the Ticket 187 migration defines. Rehearse their composition on top of the applied
preference wrappers and connector fences.
Do not deploy application code that expects absent tables or RPC shapes. With the
normal Git integration, merging to `main` deploys both application and marketing;
there is no automatic hosted SQL migration or desktop publication. Apply the required
SQL before the source merge that triggers its matching web deployment. Treat that
merge as part of the scheduled production window. If acceptance needs a merged
source first, explicitly hold production promotion for that window; do not let the
application reach production against the old schema.

An already-applied migration is immutable. If ledger inspection shows either travel
migration was applied elsewhere, put its review correction in a new migration
instead of editing the shared database's recorded history.

Prepare the signed desktop artifact before the window; apply the hosted migrations,
deploy matching web code, then distribute the accepted desktop release. For #138,
SQLite must advance from 18 through **19: Travel habits** and **20: completion
labels**. The standalone #136/#137 branches both originally claimed migration 19;
the combined numbering resolves that collision.
Choose a version newer than every published release; the train records 0.1.6 as
its minimum. Keep artifact hashes and upgrade evidence tied to that exact build.

The 13-key profile makes older desktop clients reject synchronization even when
the user has not enabled the new optional features. Plan the update window around
that explicit compatibility break. Validate upgrade data preservation, new-account
defaults, linked-account sync, opt-in/opt-out, completion status changes and retained
history. Verify the existing occurrence-sync cron calls the retention purge.

Verify provider configuration and fallback behavior in the intended environment.
Without `TRAVEL_CONCLUSIONS_SIGNING_SECRET`, route/weather conclusions remain
unsupplied to the Brief. Weather stays off until configured; the repository's existing commercial-use
requirement calls for the paid Open-Meteo plan before operator clearance. Live Maps, weather
and connector checks must use their documented accounts, budgets and disclosure
boundaries; unit fixtures do not establish provider availability or consent.

Application rollback alone cannot restore old-client sync after the schema change.
Keep a recoverable pre-migration backup, preserve user data and prefer forward
corrections or disabling optional functionality. Dropping new tables or downgrading
SQLite is not a routine rollback. #135 requires a separate Calendar-grant cutover: verify its distinct Google agent
project/client and environment variables, deny the old advisor/workbench consumers,
drain admitted requests, apply migration `20261022180000`, deploy the matching
server and require fresh consent for the agent grant. Do not restore an old server
that consumes the ordinary Timeline Calendar grant for AI after that separation.
Merging source does not establish live consent, callback or credential-cleanup
acceptance.

After the final application and marketing deployments are Ready, refresh
`CADENCE_TRUST_MARKETING_DEPLOYMENT_ID`, redeploy the application as documented, and
verify Trust evidence names those final deployments. Restore saved update feeds to
stop further installs if release acceptance fails; an installed SQLite upgrade
requires a consistent app/database backup pair for a deliberate downgrade.

## Evidence and remaining gates

During review, published corrections to #122, #123, #124, #131, #133, #135,
#137, #140 and #141 obtained green applicable CI, including actual macOS native
compilation and unit tests for #124 and #131. The final #138/#135 integration is
validated separately; final publication and checks may supersede those earlier heads. These are review observations,
not a durable claim about whatever head GitHub shows later. Confirm required
checks, mergeability and review state immediately before each merge.

The resolved #138 tree at `8ecbe338` passed **3,729 tests** across 339 test files,
with 179 tests in 17 files explicitly skipped by the suite configuration. Its
`agents:check`, `interactions:check`, `resolvers:check`, lint, web and desktop
TypeScript checks, web build, desktop renderer build, marketing build/check and
public-source audit all passed. The source audit reported zero findings. The later
report/status commit changes documentation only.

The final #135 integration adds five travel/candidate regressions and two combined
bubble regressions. Four travel/candidate cases failed against the textual merge
and passed after correction. The first full integrated run passed **3,802 tests**
(345 files), with 179 tests in 17 files skipped. A rerun after final candidate-prompt
wording passed 3,800 and exceeded two existing time limits while the production
build ran: the saved-review DOM test's 5 seconds and the core-portability test's
20 seconds. After the build, both files passed all **42 tests with unchanged timeouts**.
All 3,802 unique tests therefore have passing final-source evidence; the timed-out
run is not described as an uninterrupted pass. The final web build, desktop frontend
and marketing builds, both TypeScript checks, lint, agents/interactions/resolvers,
marketing readability, public-source/artifact and Trust checks passed. No runtime
source changed when this report was brought into the final branch.

Local validation also includes targeted regressions and full suites on the
individual corrected branches. Some tests are
environment-gated; native compilation, SQL rehearsal and installed acceptance are
different evidence. An isolated PostgreSQL trigger test is not a full Supabase
rehearsal. Dependency installs using `--ignore-scripts` do not establish every
package lifecycle script. Fresh npm audits on the resolved travel/dependency stack
reported zero advisories in both production-only and all-dependency scopes.
`design-system:check` could not run here because its configured external verifier at
`/Users/emi/.codex/skills/design-system-bench/scripts/verify_traceability.py` is absent.
The bench manifest, interaction checks, UI regressions and frontend builds remain
independently checked; the missing verifier is not reported as passing.

#140 preserves the owner's dev.2 first-prompt and foreground-position passes.
Denied-state, never-authorized-user, first-account-link, required callback/session
replays, real updater/data comparison and public-download checks remain explicit
where the packet marks them open. Connector panel visibility is not completed
installed connector acceptance. #144's latest instructions incorporate the live
location-log and Launch Services findings.

Use [the release policy](../DESKTOP_RELEASE.md),
[the 0.1.5 packet](https://github.com/emixd12/cadence/blob/5472568c87fe76b27ddda3e5f897631548d73b9b/docs/qa/2026-10-23-desktop-0.1.5-release-packet.md),
[the Supabase workflow](../SUPABASE_WORKFLOW.md) and
[the rollout record](2026-10-21-behavior-where-rollout.md) for those gates.
Record privacy/disclosure conflicts under the current project policy; they do not
block development. Notarization, publication, provider cutover and hosted changes
remain concrete release actions, not consequences of a green source review.
