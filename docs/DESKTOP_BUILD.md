# Desktop Build

Since October 8, 2026 (Ticket 186), the source repository is `emixd12/cadence`
(same repository ID) and the preview feed is
`https://github.com/emixd12/cadence/releases/download/desktop-preview/latest.json`.
Installed clients keep their original `habit-tracking-app` endpoints; GitHub
redirects them, and feed, archive and signature checks pass through the old URLs.
Do not create a repository named `habit-tracking-app`: that would end the redirects.
Historical release observations below retain their original names and URLs.
Evidence: `docs/qa/cadence-project-rename.md`.


The owner activated the local-first macOS track on 2026-08-30. Tickets 107–114
are complete. Ticket 115 separately owns deferred Apple-trusted distribution.
Tickets 116–122 plan optional Google account linking and offline-capable
synchronization. This document replaces the earlier unscheduled proposal.
`STATUS.md` records implementation and verification.

## Scope and defaults

Build tracking parity with the current web application using Tauri v2, Vite,
React, and SQLite. Local mode requires no login or network. Optional account
mode keeps SQLite as the offline working copy. Target Apple Silicon first, with
macOS 14 as the declared minimum. Runtime compatibility is verified only on
tested systems; macOS 14 execution remains unverified. Preserve the existing
web deployment and Astro marketing site. Mobile implementation remains deferred.

Use one stable local profile. The default timezone remains America/New_York,
with local timezone selection. Seed the current default categories: Medical,
Grooming, Fitness, Food / Drink, Home, Measurements, Admin, and Other.

Tracking parity and Ticket 113's ad hoc, unnotarized preview/updater acceptance
are complete. Apple Developer Program access, Developer ID signing, notarization,
and Apple Silicon macOS 14 acceptance remain deferred under Ticket 115, not
passed. Tickets 116–122 add optional account synchronization. Exclude Intel
releases, desktop email delivery, duplicated public/legal pages, billing, AI
integrations, and closed-app background synchronization. Keep imported email
configuration as data without sending.

## Current parity baseline

`docs/DESKTOP_PARITY.md` records the current implementation baseline and its
evidence. `interaction-registry.json` remains the canonical interaction
inventory. Preserve current behavior rather than recreating an earlier v1:

| Capability | Existing contract | Desktop requirement |
|---|---|---|
| Timeline | `docs/UI_SPEC.md`, `docs/USER_FLOWS.md` | Today/future grouping, Needs decision retention, manual statuses, Notes, timing, correction, and completion feedback |
| Behaviors | `docs/PRODUCT_SPEC.md`, `docs/RECURRENCE_RULES.md` | Multiple schedules/time entries, exact/custom/preset ranges, recurrence, categories, edit/archive/restore, analytics, selected-day review |
| History and identity | `docs/DATA_MODEL.md` | Definition/configuration history, status events, timing sessions, configuration lineage, range-aware Occurrence identity, stale-write guards, and protected Occurrences |
| Portability | `docs/EXPORT_FORMATS.md` | All five formats, prompt tools, privacy defaults, BehaviorLog import/merge, destructive restore, and provenance |
| Settings | `docs/USER_FLOWS.md`, `docs/NOTIFICATION_SPEC.md` | Local timezone, optional onboarding, native notification permission/readiness, and scheduled-through coverage |

Definition-history and safely mapped time-session replay already exist in the
BehaviorLog import/restore contract. Configuration history remains export
context; imports construct only the current generating schedule graph and keep
historical Occurrences detached. Do not regress these distinctions.

## Workspace and shared core

Add only the scheduled workspaces:

```text
app/, components/, lib/   existing Next.js web app, retained at repository root
apps/marketing/          existing Astro marketing site
apps/desktop/            Tauri v2 + Vite + React
packages/core/           incrementally extracted portable domain code
packages/ui/             canonical tokens and framework-light primitives
```

Ticket 108 must prove native boundaries before Ticket 109 performs broad
extraction. Do not create packages solely to reserve names. Keep npm workspaces
and current web APIs; no app-root move, new task orchestrator, or unrelated
`packages/db`/`packages/config` extraction is required.

Move portable domain types, resolvers, and orchestration incrementally.
Resolvers remain pure and receive `now`; Temporal owns local dates and DST.
Compatibility exports and web adapters preserve existing callers while code
moves. Supabase Auth, RLS, caching, server routes, and provider delivery remain
web adapter responsibilities.

Define operation-specific `DataStore` methods for actual consumers. Behavior
create/update/archive/restore, status changes, import, and restore need atomic
operations with their existing preconditions. Avoid a generic CRUD interface.
Use one shared adapter contract suite against local Supabase and real SQLite.

The shared core cannot import Next.js, Supabase, Tauri, concrete adapters,
Node-only APIs, or browser globals. Ticket 109 adds a deterministic portability
check and keeps existing resolver checks aware of moved implementations.
Structural checks detect boundary drift; common fixtures and adapter tests
establish behavioral evidence.

Replace Node-only hashing with portable hashing that preserves exact existing
fingerprints. Isolate ZIP handling behind an archive adapter. Retain the
existing file-count, size, decompression, ratio, path, and preview-binding
safety limits from `docs/EXPORT_FORMATS.md`.

## Local persistence

Translate the **current** data model and all applicable migrations, not only
`20260607204951_create_database_schema.sql`. Include schedules, schedule slots,
timing, definition/configuration/status history, configuration lineage,
Occurrence freshness state, reminder records, import runs/mappings, imported
Notes/interventions, and export-relevant provenance.

Use text UUIDs and canonical temporal strings. Preserve explicit local dates
and UTC instants. Enable SQLite foreign-key enforcement and preserve owner,
range-aware uniqueness, append-only history, idempotency, stale-edit guards,
and Occurrence preservation rules. First-run seeding must not replace the
profile or recreate removed categories on every launch.

The local database lives in the application data directory. Git-tracked
SQLite migrations must support existing databases, rollback on failure, and
recovery evidence before release. Supabase migrations and generated web types
remain independent; desktop work does not authorize hosted schema changes.

Use a thin native transaction boundary when required. Do not assume separate
SQL-plugin calls share a connection or transaction. Business decisions stay in
TypeScript; native code may execute validated operations atomically, manage
files, schedule notifications, and handle lifecycle events.

The implemented local-only release retains this synchronization scaffold:

- tombstones for syncable deletions;
- a mutation outbox committed in the same transaction as the domain mutation;
- persisted cursors and stable local identity;
- a no-op `SyncEngine` with no network delivery.

The scaffold must preserve current deletion, history, and uniqueness semantics.
Tickets 116–122 activate it through a typed snapshot, saved common baseline,
three-way merge, authenticated hosted apply, and conflict review. The old
blanket last-writer-wins proposal does not override current concurrency
protections.

## Planned account mode

Account-free local mode remains complete. Optional account mode uses the
existing Cadence Google account and synchronizes web plus multiple desktop
working copies while each app runs with connectivity. It adds no closed-app
background helper.

First link detects recognized local data and requires Import local data into
the account or Ignore local data and use account data. Both paths reuse the
portability snapshot, fingerprint, preview, conflict-action, and atomic-plan
architecture. Ignore creates a protected local backup before replacement.

Ticket 119 recognizes local data from the typed portability snapshot. It ignores
only the untouched seeded profile and exact default-category set. Its native
protected-backup command creates, validates, and returns the exact owner-only
backup path without a save dialog. The account choice UI exposes import, ignore,
and cancel separately. Desktop reads complete RLS-scoped hosted rows through the
signed-in Supabase client, imports through `public.apply_behaviorlog_import`,
hydrates through the shared BehaviorLog restore plan and one local atomic apply,
then saves the common baseline. It uses deterministic attempt, preview, apply,
and planned row IDs so an incomplete two-commit attempt can retry safely. It
routes an irreconcilable preview to Ticket 121 without writing either copy.

The live database stays in the app-managed Application Support location.
Settings shows the exact path and offers Reveal in Finder, Back Up, and Restore.
Raw database Restore is local-mode only. Disconnect offers Keep a local copy,
with its exact path, or Remove account data from this Mac.

Ticket 117 implements those local database controls through fixed native
commands. No command accepts a live database path. Backup uses a consistent
online SQLite snapshot and atomic destination replacement. Restore requires the
typed confirmation, validates exact schema compatibility, creates a protected
pre-restore snapshot, replaces the managed database atomically, and reopens it.
Ticket 121 must connect the native local-mode gate to account disconnect state.

Ticket 118 implements the local authentication boundary. Settings starts
Google PKCE in the system browser, and the installed app registers
`cadence://auth/callback`. Native code installs its callback handler before the
Tauri window starts. Tauri's official deep-link plugin delivers cold-launch
and running-app callbacks for only the `cadence` scheme. Native code opens only
HTTPS URLs and exposes fixed Keychain slots. The client validates origin, state, and age,
consumes state before code exchange, and rejects denial, cancellation, replay,
and malformed callbacks. SQLite stores only the stable-local-profile to hosted
user mapping, email, and authentication time. A successful session changes no
product row and remains Ticket 119 input. The hosted redirect allowlist and
installed-app round trip remain acceptance gates. The exact hosted entry is now
verified. The configured ad hoc bundle builds and verifies its signature, but
macOS rejects Data Protection Keychain writes without a valid signed access
group. Apple-signed production builds use the Data Protection Keychain path.
Ad hoc public previews use the existing login-Keychain path and must contain its
compiled release-verification marker. Preview.15 completed the installed Google
round trip through that preview-only path. See
`docs/qa/2026-08-31-desktop-authentication.md`.

The hosted Auth redirect allowlist requires the narrow dynamic-query entry
`cadence://auth/callback?state=*`. The base `cadence://auth/callback` remains
the registered native callback and should stay allow-listed only if native
registration or provider denial proves it necessary. Do not use the broad
`cadence://auth/callback*` pattern. Cadence requires state, authorization code,
and provider errors in the callback query.

Use system-browser PKCE, Keychain session storage, the user's JWT, and hosted
RLS. Never put authentication secrets in SQLite, frontend storage, logs,
exports, or backups. Hosted apply uses ordinary-user, bounded,
`SECURITY INVOKER` contracts where one atomic multi-table commit is required.
Local domain writes, tombstones, and outbox entries remain one SQLite
transaction. A successful network write never weakens either boundary.

The desktop validates each hosted snapshot against its native row models after
fingerprint verification and before planning or writing either copy. This shared
read path covers normal sync, reviewed sync, and first link. Unknown row fields
show Update required to synchronize; malformed known fields remain validation
failures. Native apply retains its own validation. A compatible schema change
still requires installed-desktop acceptance alongside the hosted rollout.

### Synchronized and device-local data

The synchronized account snapshot contains the current typed contracts for:

- profile timezone and account-owned categories;
- Behaviors, schedules, schedule time entries, definition history, and
  configuration history;
- Occurrences, status history, Notes, and time sessions;
- import runs, provenance mappings, passive imported Notes, passive imported
  interventions/observations, and their retained configuration context;
- browser and email reminder preferences; and
- hosted browser/email reminder-delivery history.

The snapshot excludes authentication tokens, PKCE state, Keychain records,
browser push subscriptions and endpoints, native notification requests,
native reminder coverage and delivery evidence, OS permission state, local
file paths and backups, updater state, local preview ledgers, UI preferences,
and device health or capability data. Desktop email delivery remains inactive.
Synchronized reminder preferences may produce native intent only through the
existing desktop reminder planner; hosted delivery history never proves native
delivery or user receipt.

The hosted account owns hosted row ownership through its authenticated user ID.
The stable local profile owns the SQLite working copy. Account-link metadata
maps those identities without rewriting historical IDs or storing a token.
First-link classification, choice, backup, hydration, and baseline creation
belong to Ticket 119. Ticket 117 owns database path and backup controls;
Ticket 118 owns authentication; Ticket 121 owns conflict review and disconnect.

### Snapshot and merge boundary

Each side is read as one internally consistent typed snapshot. A snapshot fails
closed when any collection exceeds 100,000 rows, its canonical UTF-8 JSON
exceeds 64 MiB, or the complete read, validation, fingerprint, and planning
attempt exceeds 30 seconds. No truncated snapshot may synchronize. Ticket 120
must measure these limits with representative and ceiling fixtures before
release. It canonicalizes top-level UTC instant columns to PostgreSQL microsecond precision
with half-even rounding. Snapshot entities and nested object keys use Unicode code-point
order, matching PostgreSQL `COLLATE "C"` UTF-8 byte order. Semantic comparison and fingerprints include
`scheduled_for` plus every `*_at` column except top-level `updated_at`. Local
dates, local times, and nested JSON provenance remain byte-for-byte domain values. Top-level `updated_at` remains in
snapshots and compare-and-set guards, but equality and fingerprints exclude it
because hosted triggers replace it with server time. Exceeding a limit leaves both
copies and the saved baseline unchanged,
reports an actionable error, and records no successful synchronization state.
A hosted change journal requires a later measured ticket; it is not a fallback
inside Tickets 116–122.

The pure synchronization planner compares local, hosted, and saved common
baseline snapshots. It returns a deterministic typed plan, conflicts, and
canonical input fingerprints. It auto-merges independent changes and valid
append-only history. It never silently uses last-writer-wins. One unresolved
conflict rejects the whole accepted plan; Ticket 121 owns the user's resolution
and stale-decision checks. Network, Supabase, SQLite, Keychain, clocks, retry
scheduling, and UI stay outside the planner.

The native SQLite apply orders parent rows before children. It also orders
status-event revisions by `revises_event_id` and import runs by
`accepted_preview_run_id`; UUID order is not a dependency order. Cycles fail
before any write.

Ticket 121 implements that review in Settings and keeps a persistent shell cue
while the whole plan is paused. A reviewed plan must match the saved baseline,
local, and hosted fingerprints captured for the review. Mutable-row conflicts
offer the account or Mac value. Keep both remains unavailable because no current
synchronized conflict can duplicate its complete identity graph safely.
Ordinary and reviewed reminder writes retain an existing `processing_started_at`
when the chosen row has no claim. A conflict choice cannot clear that operational
marker; both database guards forbid it. This preserves the selected status.
For a Pending baseline, a local Cancelled reminder and hosted Sent reminder
reconcile automatically when the delivery identity, schedule, provenance, and
all non-delivery-state fields match across all three copies. The hosted record
must contain a valid send timestamp; any existing local or baseline processing
claim must match the hosted claim. Preserve the complete hosted delivery record
and merge local occurrence decisions independently. This applies to browser push
and email logs, not native notification evidence. It introduces no
latest-write-wins rule. Other reminder conflicts and conflicting user edits
retain the existing whole-plan review gate.
Append-only ID collisions and incompatible new branches fail before user review.
Matching initial manual marks may converge after an Unresolved baseline when
all new events are roots with the same resolved status, provenance, and Behavior.
Both occurrence copies must match outside status timestamps, and each copy's
timestamps must match its own event evidence. Retain every event unchanged;
use existing latest-event ordering only to select display timestamps for the
agreed status. Corrections and divergent descendants cannot use this exception.
After convergence, the shared baseline contains every accepted event, so a later
one-sided correction does not reopen the original duplicate marks. During the
first automatic hydration of an untouched local profile only, the planner may
preserve a hosted same-status branch when every local event in that branch is
already one of the hosted events. Divergent statuses and other cross-copy branches
still fail. A one-sided deletion of protected history is repaired from the
retained copy.

Disconnect clears Keychain secrets before native link-state mutation. Keep a
local copy preserves product rows and returns the exact live path. Remove account
data creates and validates a protected backup, replaces the linked working copy
with a fresh local profile, and returns both exact paths. Native restore derives
account mode from SQLite and rejects linked mode before opening its file picker.

Every synchronization attempt has a stable idempotency key derived from the
account link, baseline fingerprint, and accepted input fingerprints. Repeating
an attempt returns the same committed result or safely replans after a changed
input. Hosted commit and local apply may not share a transaction, so services
retry the incomplete side and advance the baseline, cursor, and outbox
acknowledgements only after both commits succeed. Failures use bounded backoff
with jitter while the app runs; launch, resume, connectivity recovery, relevant
mutation, and **Sync now** may retry. Offline writes remain available.
Idle desktop sessions do not poll full snapshots.
Native resume owns foreground synchronization; successful synchronization refreshes
the displayed local copy directly. Tokens refresh on the next account request.
No retry may duplicate histories, resurrect tombstones, discard newer changes, or apply
an unreviewed conflict decision.

## UI and cross-platform cascade

Keep the current sparse design and four-screen structure: Timeline, Behaviors,
Export & Import, and Settings. Desktop uses callbacks and client services
instead of Server Actions. Product components must not own domain rules or
database/native calls.

Extract canonical tokens into `packages/ui` incrementally. Keep runtime-specific
shells and product components. Bundle fonts, images, and completion audio for
offline use, subject to redistribution-rights verification before release.
Use BehaviorLog import for web-to-desktop transfer; do not add a Full JSON
importer.

Extend `design-system.surfaces.json` with desktop implementations and native
bench evidence. Keep product usage counts separate from bench previews.
Extend the existing interaction registry with platform applicability,
implementation status, and evidence. Reuse interaction IDs when the intent
does not change. Do not create a second interaction or decision registry.

Each new or materially changed product/design ticket must address web, desktop,
marketing, and future mobile. Each entry must link implementation, identify a
follow-up ticket, or explain why it is not applicable. Marketing consumes
approved product claims; it does not duplicate application UI. Mobile stays
deferred even when it benefits from portable contracts.

Existing checks must reject missing references. The desktop release check must
reject incomplete applicable interaction parity. Neither check alone proves
semantic or visual parity; fixture, adapter, and WKWebView evidence remains
required.

Candidate-building prerequisites must be separate from final release readiness.
A planned updater interaction may require candidate artifacts for its acceptance
test. It must not block their creation or be falsely promoted to implemented.
Keep the existing production release checks strict. Preview candidates retain
applicable signature, archive/content, and data-protection checks.

## Native reminders

Preserve hosted browser/email reminder semantics. Desktop schedules local
notifications through a thin macOS adapter. The standard Tauri desktop
notification implementation does not provide scheduled delivery; see its
[implementation](https://raw.githubusercontent.com/tauri-apps/plugins-workspace/v2/plugins/notification/src/desktop.rs).

Target the next 30 days, scheduling the nearest eligible reminders first.
The owner accepted a clearly displayed OS-limited horizon on 2026-08-30;
30 days is a target, not guaranteed coverage. Verify retained pending requests
through OS readback and derive coverage from the contiguous intended sequence.
The first missing request ends verified coverage; a later retained request
cannot extend it. Show the actual scheduled-through date/time and clearly
disclose shorter coverage or unavailable verification. Successful scheduling
callbacks alone do not prove coverage. Do not hardcode a universal request cap.

Reconcile on launch, resume, local day change, and relevant mutations. Persist
native request identifiers and map activation back to the intended Timeline
Occurrence. Cancellation and replacement must remain idempotent after
resolution, edits, archival, repeated reconciliation, and restart.

Native delivery uses BehaviorLog's existing extension mechanism. Do not fork
the upstream schema or change the hosted delivery channels. Do not imply that
OS acceptance proves the user received or read a notification.

The desktop adapter allows up to 850 ms for each pending/delivered readback
phase to settle. One stable incomplete readback may trigger nearest-request
repair. It counts occupied desired identifiers separately from exact content
matches and preserves matching nearest requests. Unstable readback remains
limited; it never establishes a universal OS capacity. Archival, resolution,
and deletion also cancel and verify delivered-only Notification Center entries.
Already delivered entries for unresolved active Occurrences remain available.

Verify permission denial, scheduled delivery, cancellation, replacement,
activation, sleep/resume, fully quit delivery, and OS scheduling limits on
macOS. A shorter OS-limited horizon is acceptable only when coverage is verified
and clearly displayed. Unverified or overstated coverage still fails the gate.
Do not silently truncate coverage or add a background helper.

The initial native probe found that macOS 26.5.2 retained 100 of 128 requests
and evicted 28 without scheduling callback errors. This is observed evidence,
not a universal 100-request limit. The owner's 2026-08-30 horizon decision
replaces the guaranteed 30-day requirement. It does not complete Ticket 108 or
waive native activation proof before broad refactoring. See
[native evidence](qa/2026-08-30-desktop-native-boundary.md).

## Implementation sequence

| Phase | Ticket | Completion requirement |
|---|---|---|
| Activate | 107 | Owning docs, current parity baseline, and cross-platform contract are recorded; unrelated changes survive |
| Native proof | 108 | Persistent SQLite writes, atomic rollback, scheduling/cancellation, activation, and restart evidence pass before broad refactoring |
| Shared foundations | 109 | Portable core/tokens move incrementally with preserved web APIs, fingerprints, and green checks |
| Local persistence | 110 | Current schema, stable seed, atomic operations/outbox, and both adapter contracts pass |
| Tracking parity | 111 | Four screens and all current tracking/portability interactions pass offline and WKWebView QA |
| Native reminders | 112 | Nearest-first reconciliation, verified OS-limited coverage, visible horizon, and lifecycle evidence pass |
| Preview and updater acceptance | 113 | Authorized ad hoc preview, public feed, failure paths, explicit update/restart, and data preservation pass |
| Apple-trusted distribution | 115 | Deferred until Developer Program access, Developer ID, notarization, stapled artifacts, quarantined-DMG Gatekeeper, and Apple Silicon macOS 14 acceptance are available |
| Account-sync contract | 116 | Product, data, security, offline, and merge boundaries agree before runtime work |
| Local database controls | 117 | Exact path, Finder reveal, consistent backup, and protected local-only restore pass native QA |
| Desktop authentication | 118 | System-browser PKCE, deep link, Keychain storage, and one-account session pass |
| First account link | 119 | Recognized local data takes the explicit protected import-or-ignore path |
| Two-way synchronization | 120 | Typed three-way merge, outbox/cursor activation, RLS-safe atomic apply, and offline retry pass |
| Conflict review and disconnect | 121 | Conflict cue/review and both path-disclosed disconnect outcomes pass |
| Migration and release acceptance | 122 | Real-updater schema migration and web-plus-two-desktop matrix pass before claims |

## Completed unnotarized preview milestone

The 2026-08-31 owner decision authorized Ticket 113. The completed milestone
preserved Cadence, `app.cadence.desktop`, and existing local data. It produced
Apple Silicon artifacts with ad hoc signing and no Apple credentials or
notarization. It added no backend, CI infrastructure, background helper, cloud
login, or live sync.

The completed milestone uses the existing `emixd12/habit-tracking-app`
repository, clearly labeled preview files, and a dedicated HTTPS preview feed.
It does not depend on the latest-release pointer. Repository credentials remain
outside the app and feed. The owner approved the concrete published packet.

Ticket 113 checked existing updater keys before generating one persistent pair.
The password-protected private key remains outside the repository with owner-
only access. Exact key paths, password-manager backup steps, secure password
retention, and the public fingerprint are documented without secrets. Updater
integrity signing does not replace Apple signing.

Testing on the current laptop used a protected database backup. Two preview
versions passed real HTTPS update, downloaded DMG launch, explicit install and
restart, invalid-signature/tamper rejection, unavailable-download recovery,
preserved local identity/history, and reminder reconciliation. Both versions
use schema 6, so shipped-migration testing is not applicable to Ticket 113.
Existing native rollback tests remain current evidence. The first future schema-
changing desktop update must upgrade an older installed version through the real
updater with a protected database backup.

Document expected macOS security warnings and use Apple's per-app approval
workflow where needed. Do not disable Gatekeeper globally or remove quarantine
to claim an installation passed. The exact six asset hashes in
[`the asset record`](qa/2026-08-30-desktop-asset-provenance.md) now carry the
owner's Cadence bundling authorization. Preserve third-party notices, MIT asset
exclusions, and reserved trademark rights; no broader relicensing is authorized.

## Verification and release

Run agent, interaction, resolver, design-system, lint, typecheck, test, web-build,
and marketing checks throughout the track. Add native build/test and core
portability checks when their implementations exist. Record unavailable checks
explicitly; do not claim native runtime proof from browser simulation.

Required evidence includes:

- shared adapter contracts against local Supabase and real SQLite;
- midnight/DST, monthly fallback, overlapping schedules, stale edits, timing
  restart, and protected Occurrence preservation;
- import/restore rollback, stale-preview rejection, archive limits,
  sensitive-data defaults, and BehaviorLog round trips;
- offline launch, restart persistence, keyboard access, responsive layouts,
  and actual WKWebView rendering;
- native notification permissions, cancellation, activation, sleep/resume,
  fully quit delivery, contiguous OS-readback coverage, and visible shorter horizons;
- Ticket 113 updater signatures, local-data-preserving upgrades, and bundled-
  asset redistribution rights;
- Ticket 115 Developer ID signing, notarization, stapled app/DMG validation,
  quarantined notarized-DMG Gatekeeper acceptance, and Apple Silicon macOS 14.

Ticket 115 owns the deferred Developer ID signed and notarized `.app` and `.dmg`
artifacts. Tauri requires [signed updater artifacts](https://v2.tauri.app/plugin/updater/).
Local commands, signing requirements, and installed-upgrade evidence live in
[`DESKTOP_RELEASE.md`](DESKTOP_RELEASE.md).

Apple access and credentials remain unavailable, and the current host does not
run macOS 14. Keep Ticket 115 deferred. Public production publication remains an
explicit owner-authorized action; do not publish or change providers as a side
effect.

## Note shortcuts (Tickets 126–128)

The local deterministic fallback uses current owned SQLite Occurrence Notes and
shared pure matching. Accepted shortcuts, suppression keys, settings, and reuse
exclusions persist through restart and protected backup/restore. They synchronize
as `note_shortcut_state` entities with the existing conflict review and atomic apply.
Unknown entity kinds make old clients fail safely and require an update.

Account linking never enables cloud analysis. Provider consent is device-specific
and separate from synchronized feature preferences. Account-free and offline
desktop sends no Notes to a provider. Ticket 128 must validate current linked
identity, connectivity, consent revocation, and hosted source revisions before
any model proposal can persist. Native runtime and upgrade acceptance remain
required evidence; browser mocks cannot substitute for those checks.

## Repair and automatic-update implementation (Tickets 129–131)

Tickets 129 and 130 form the first repair release. Ticket 131 follows separately.
The repair bounds native reminder receipts, coalesces refreshes to one running and
one pending reconciliation, and preserves delivery evidence until SQLite commit.
Migration 0014 performs guarded recovery before local tracking opens. The sync
planner and SQLite/Postgres apply boundaries reject incomplete dependency graphs.

Ticket 131 starts the existing signed updater independently of Settings. Checks
persist their last attempt and run at startup or after 24 hours; resume and online
events run overdue checks. Manual checks bypass the interval. Automatic download
defaults on. One session controller retains a candidate across screen navigation.
Download, installation, and restart remain distinct states and actions. A nonmodal
notice offers inline review or a 24-hour version-specific snooze.

Restart refuses pending writes, account operations, synchronization, or unsaved
drafts. Explicit discard clears tracked drafts only when writes are idle. The
native restart command holds the existing LocalStore mutex through restart.
The response producer is `cadence_private.apply_account_sync_plan(jsonb)`.
Desktop recognizes SQLSTATE `22023` only with either exact message:

- `Update Cadence before synchronizing category changes.`
- `Update Cadence before synchronizing Behavior changes.`

The guards originate in migrations `20260905035835` and `20260906010951`.
These responses produce update-required synchronization state. Other errors retain
their existing classification. Local tracking remains available.

Installed recovery, signed repair upgrade, account convergence, and automatic
update acceptance remain release gates. Automated tests do not establish these.

## Calendar context integration (Tickets 133–137)

The shared `components/timeline/DayProgressTimeline.tsx` renders the production
forward timeline. Existing desktop callbacks retain status, Note, timing, and
notification activation behavior. Pure core resolvers own geometry and estimates.

Optional `VITE_CALENDAR_BROKER_ORIGIN` selects the HTTPS Cadence connector.
The production and development CSP allow the exact deployed broker origin,
`https://cadence-blush-three.vercel.app`. Changing the broker requires a matching
reviewed CSP change; do not widen this allowance to arbitrary HTTPS hosts.
Desktop authenticates using the existing Supabase session in Keychain. A separate
short-lived `pending-calendar-state` Keychain entry correlates consent callbacks.
Google credentials remain on the server. The separate disposable event cache is
described in `docs/DESKTOP_DATA_MODEL.md`. Local account-free tracking remains usable.
Live native consent, source links, offline cache, minimization, and prior-version
upgrade acceptance remain required under `docs/qa/day-progress-release.md`.
