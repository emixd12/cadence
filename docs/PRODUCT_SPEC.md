# Product Spec

## Purpose

Cadence is a public, open-source personal behavior tracker for recurring life
patterns.

The app lets the user define recurring behaviors, see what is scheduled in a timeline, and manually mark each scheduled occurrence as Completed or Not Completed.

Cadence also serves as a practical demonstration and adoption surface for the
BehaviorLog Bundle standard:
`https://github.com/emixd12/BehaviorLog-Bundle`.

## Primary user

One independent account holder using a single-player personal tracker.

The public web app may support many independent accounts, but it is not a
collaboration product. It does not need shared workspaces, role management,
social features, public profiles, admin dashboards, or productivity-suite
sprawl.

The web app supports independent users with Google auth. Tickets 107–114
implement local-first macOS tracking with one local profile and no login.
Ticket 115 defers Apple-trusted desktop distribution acceptance.
Tickets 116–122 plan optional use of the same Google account with offline-
capable desktop synchronization. Tickets 146–148 implement an in-app read-only daily
briefing in the Timeline horse's text bubble. Billing, native mobile, general AI
chat/coaching, and audio speech remain future scope.

## Product surfaces

Target surfaces:

1. Authenticated web app: current Next.js app.
2. Marketing site: Astro app under `apps/marketing` for Cadence, BehaviorLog,
   docs links, and example bundles.
3. Desktop app: active local-first Tauri v2, Vite, React, and SQLite track in
   `docs/DESKTOP_BUILD.md`, targeting macOS 14+ on Apple Silicon.
4. Mobile app: future local-first app following the desktop direction.

The desktop track adds `apps/desktop`, `packages/core`, and `packages/ui`
incrementally. Next.js stays at the repository root. Broader restructuring
remains deferred. See `docs/PUBLIC_PRODUCT_ARCHITECTURE.md`.

## Core screens

1. Timeline
2. Behaviors
3. Export & Import
4. Settings

## Public website scope

The current Next.js app includes sparse public account-information routes:
`/terms`, `/privacy`, and `/trust`. These are not the marketing site.
They exist so users can review product boundaries, privacy, portability, and
account-deletion behavior before signing in.

The marketing site is a simple Astro site under `apps/marketing`,
SEO-conscious from launch, and visually consistent with
`docs/PRODUCT_SPEC.md` and `DESIGN.md`.

Launch routes:

- `/`: Cadence-led landing page that introduces BehaviorLog as the open
  portability standard
- `/faq`: frequently asked questions about product philosophy, privacy, time
  tracking, and BehaviorLog portability
- `/docs`: technical docs entry point for Cadence, BehaviorLog,
  machine-readable mirrors, and future docs structure
- `/examples`: sanitized sample bundle page
- `/about`: philosophy, governance, scope boundaries, and open-source posture

Primary calls to action:

- Try Cadence
- Read BehaviorLog
- Download Example Bundle
- View on GitHub
- Log in

Marketing posture:

- Cadence is the site brand, homepage lead, and public product name.
- BehaviorLog is the open bundle standard and portability layer behind Cadence
  exports and imports.
- The marketing header uses the Cadence mark and name only.
- `/cadence` and `/standard` redirect to `/`; neither route has a dedicated
  page or machine-readable mirror.
- `/docs` should grow toward familiar developer-docs sections such as Guides,
  Reference, Examples, Agent policy, and Schema history while keeping
  agent-readable outputs first-class.

The marketing site also publishes `llms.txt`, `llms-full.txt`, Markdown
mirrors, a route manifest, sitemap, and robots output. It does not include
marketing cookies or analytics.

## Core object model

### Behavior

A recurring thing the user wants to track.

Examples:
- Brush teeth
- Take medication
- Drink matcha
- Workout
- Do laundry
- Take body measurements

Behaviors own one or more schedules. Each schedule has one recurrence pattern
and one or more time entries. Adding a time adds another time entry under the
same recurrence. Adding a schedule creates another recurrence pattern.

Examples:
- Daily at 11:00 PM
- Every 2 days at 11:00 PM

Those examples are two schedules, even though they share a time.

### Schedule

A recurrence pattern plus one or more exact-time or time-range entries for a
behavior.

### Occurrence

One scheduled instance of a behavior.

Example:
- Brush teeth scheduled for 2026-06-05 at 10:00 PM.
- Stretch scheduled for Morning on 2026-06-05.

### Status

Each occurrence has one status:
- `unresolved`
- `completed`
- `not_completed`

The system does not automatically mark things missed.

Unresolved prior-day items are surfaced through Needs decision.

Needs decision is a derived UI state, not a stored status. It applies when an occurrence is still `unresolved` and its `local_date` is before the current local date.

The UI labels `completed` as Completed and `not_completed` as Not Completed.

Each explicit manual status change updates the occurrence snapshot and appends
one status-history event atomically. Repeating the already-current resolved
choice is a no-op; a correction or clear creates a linked event. Note-only
edits do not change status timestamps or append status events.

Submitted occurrence decisions can be corrected later. The immediate correction
path is the Needs decision modal: prior-day rows resolved today may remain
visible in their original prior-day group through the current local day, with
the same Timeline row cues. This retention is derived from status timing, not a
stored modal-origin flag. Completed and Not Completed retained rows use
resolved-row labels, with correction available from the expanded row. After
that local-day window, later corrections should be deliberate and
behavior-specific, using the Behaviors screen's behavior date review rather
than turning Timeline into a past-history browser. Inside that review only, a
resolved occurrence can use Clear decision to return to Unresolved. Clear
decision does not appear as a global Timeline or Needs decision control.

### Occurrence time tracking

An active behavior can start elapsed-time tracking from its current-day
Timeline occurrence or from an occurrence that remains visible in Needs
decision. Needs decision eligibility includes prior unresolved occurrences and
prior decisions retained through the current local day. Future occurrences,
archived behaviors, and prior resolved occurrences outside that retention
window cannot start a new timing session. Stop and reset remain available for
persisted timing data.

## Day boundary

The day resets at local midnight.

Default timezone:
`America/New_York`

## Behavior creation

### Category management and list organization

Tickets 123–124 implement category management and list organization locally.
Ticket 123 provides Settings controls to create,
rename, describe, reorder, and delete user-owned categories on web and desktop.
Defaults use the same controls. Deletion moves affected Behaviors to No category
through an atomic operation that preserves history. Descriptions remain optional
plain text and accompany category data in supported portable formats.

Ticket 124 owns category filtering and sorting on Behaviors. Its defaults are
All categories and the existing scheduled-time order. Users can select one
category or No category and sort by scheduled time, name, or category.
Filtering changes active/archived lists, not overall adherence calculations.
Category management stays in Settings; Timeline and primary navigation remain
unchanged. Full acceptance criteria and platform impacts live in `docs/TICKETS.md`.

### Creation fields

Required fields:
- Title
- Schedule with at least one recurrence pattern and one exact time or time range

Optional fields:
- Description
- Category
- Browser notifications toggle
- Email reminder toggle
- Reminder offset

Browser notifications default to on for each behavior.

Email reminders default to off.

Public launch includes a minimal first-run setup prompt after first login:

- create first behavior
- request browser notification permission
- import data when import exists
- point to Settings timezone confirmation when useful

The setup prompt is optional, appears as a non-modal pop-up, can be dismissed
locally, and routes into the existing Behaviors, Settings, and Export controls
instead of creating a separate wizard.
A denied or blocked browser notification permission counts as a completed
onboarding decision because recovery happens in browser site settings; Cadence
continues to work without browser reminders until permission is allowed again.

Preset time ranges:
- Morning: 6:00 AM-Noon
- Afternoon: Noon-6:00 PM
- Evening: 6:00 PM-Midnight
- Night: Midnight-6:00 AM

A single behavior can have multiple schedules and multiple time entries in one
day. The system generates one occurrence per matching schedule time entry, then
merges overlapping generated occurrences that share the same behavior, local
date, start time, and end-time/range identity. Partial completion for multi-time
behaviors is derived only from mixed occurrence statuses; it is not a stored
status.

## Notes

Any occurrence can have a free-text note.

BehaviorLog imports can also preserve general note records attached to
behaviors, occurrences, status events, and reviews. These imported records are
passive user-review context: Cadence stores their role, sensitivity, source
metadata, source original id, timestamps, and attachment target, but it must not
turn them into objective analytics facts.

Occurrence-attached imported notes may fill the existing Timeline occurrence
Note field only when an accepted import plan safely identifies the occurrence,
the note is not AI-generated, and the local occurrence note is empty. Behavior,
status-event, review, and conflicting occurrence notes remain imported note
records rather than product notes on Timeline or Behaviors. Import preview and
apply summaries should distinguish inline occurrence-note fills from general
imported note records.

High or restricted sensitivity imported notes require an explicit privacy
acknowledgement before apply. AI-generated notes are previewed with warnings but
not imported into Cadence notes in v1.

Import apply must use the exact persisted merge preview the user accepted. The
server verifies that preview run's bundle, local-data, and combined preview
fingerprints before writing, refuses stale or mismatched input, and retains the
accepted preview relationship on the applied import run for audit. It must not
silently recompute and apply a different plan.

V1 does not need structured measurement fields. For measurements, the user can write values in the behavior title, description, or occurrence note. The one narrow exception is elapsed occurrence time: a user may persist start/stop sessions for one occurrence, with the displayed total derived from stopped intervals. It is not a measurement template, target, or status signal.

Example:
- Behavior title: "Take body measurements"
- Description: "Weight, hips, waist, chest. Add values in the note."

## Behavior review and adherence

The Behaviors screen is the primary behavior object surface. It combines
behavior setup, collapsed behavior metadata, range-based adherence, and
deliberate behavior date review. This is a UI composition change over the
existing analytics resolver/service contract, not a separate data model.

Behavior review should be basic:
- Overall adherence at the top of the Behaviors screen
- Completed and Not Completed counts by active behavior
- Optional compact resolved counts by category
- 7/30/90-day windows, defaulting to 30 days
- `completed` and `not_completed` detail counts, with `unresolved` kept as a neutral heatmap and review state
- A completion-intensity calendar heatmap for overall adherence
- Per-behavior charts or heatmaps where useful
- Per-behavior tracking start date, visible in compact MM-DD-YY text and marked
  in the per-behavior calendar when it falls inside the selected range
- Day-level representation of full completion, partial completion, and not completed when a behavior has multiple occurrences in one day
- A way to review one behavior's occurrences on a selected day from the
  behavior-level calendar, with non-empty cells presented as the review entry
  point and empty cells remaining passive
- Default adherence rate excludes unresolved

When a behavior has stopped timing sessions in the selected 7, 30, or 90-day
range, its compact outcome metadata shows `Average tracked time`. Cadence sums
stopped sessions for each occurrence, then takes the arithmetic mean of those
occurrence totals. Untimed occurrences and occurrences with only a running
session are excluded. The line remains hidden when no recorded occurrence total
exists in the selected range.

Review selected day shows `Tracked time` only when an occurrence has stopped
time or a running session. A stopped total shows its recorded duration, a
running-only session shows `In progress`, and both states show both labels.
The existing Review disclosure exposes `Reset tracked time`, which removes all
of that occurrence's timing sessions without changing Status or Note.

The Overall adherence range selector sits directly above the overall calendar.
The selected date range appears under the adherence percentage in compact
month-day wording, and the calendar legend is vertically listed to the right of
the calendar on desktop.

When nonzero, the top-level adherence summary Unresolved count should match the
Timeline Needs decision count: active unresolved occurrences before the current
local day, regardless of the selected Behaviors range. Hide the top summary
Unresolved row when the count is zero. Current-day unresolved occurrences may
still appear as unresolved in the overall heatmap, behavior heatmaps, and
behavior date review rows, but they are not shown as per-behavior or category
count rows and are not included in the top summary Unresolved count until they
become prior-day unresolved.

The overall calendar should shade each day by completion share: full blue when
all scheduled occurrences that day are Completed, and proportionally lighter
blue as the completed share decreases. Days with no completed occurrences use
the background end of that scale. Fully unresolved days remain neutral and
should not imply failure.

Example:
If Brush teeth has:
- 24 completed
- 4 not completed
- 1 prior-day unresolved

Default adherence:
`24 / (24 + 4) = 85.7%`

## Export

The app must provide:
- JSONL export
- CSV export
- App JSON snapshot
- BehaviorLog bundle export
- Markdown AI summary

Exports should include:
- Behaviors
- Categories
- Occurrences
- Statuses
- Status event history in Full JSON and the BehaviorLog bundle
- Append-only behavior title and description definition history in Full JSON
  and as an optional Cadence file in BehaviorLog
- Append-only behavior schedule, reminder, category, timezone, and active-state
  configuration history in Full JSON and as an optional Cadence file in
  BehaviorLog
- Nullable Occurrence configuration-event lineage in Full JSON and BehaviorLog
- Notes

Behavior definition and configuration history is export and agent context, not
an in-app revision browser. Full JSON and BehaviorLog include full previous and
next snapshots by default for included Behaviors, including events older than
the selected Occurrence range. Archived filtering applies to both histories.
The Markdown summary reports counts and supports schedule-period segmentation
without causal or clinical claims. JSONL and CSV remain unchanged current
snapshot formats.

Historical definitions and configuration can be sensitive. The Export & Import
screen must disclose their default inclusion. Current BehaviorLog import and
restore replay definition history. Configuration history remains export
context. They create the current schedule graph only and preserve historical
Occurrences as detached schedule snapshots, so old and current recurrence
graphs never become simultaneously active.

Time tracking is excluded from exports by default because exact timestamps can
reveal activity patterns. The Export & Import option uses
`include_time_tracking=1` only after explicit selection. Enabled exports scope
sessions to included occurrences and archived-behavior rules. Import and restore
replay safely mapped standard time sessions. A conflicting running session is
skipped with a warning. `docs/EXPORT_FORMATS.md` owns these portability rules.

Account deletion and export should be first-class before broad public launch,
consistent with the BehaviorLog portability posture.

The Settings screen implements account deletion for the signed-in account. The
user must acknowledge the export reminder and type the account email, or
`DELETE` when no email is available. The server verifies a server-only
service-role client, hard-deletes the Supabase auth user, then attempts global
sign-out for current-browser cleanup. Any failure before deletion leaves the
account and session unchanged. Auth deletion removes server session rows and
refresh capability; issued access-token JWTs remain valid only until expiry.

Public launch monitoring is limited to privacy-safe operational events in
server/runtime logs. It may report route names, coarse failure categories,
methods, and numeric counts, but must not include behavior titles,
descriptions, occurrence notes, account emails, push endpoints, subscription
keys, provider secrets, tokens, request bodies, uploaded bundles, or reminder
message bodies.

## Offline and PWA behavior

Web offline support, offline writes, and PWA caching remain deferred.

Desktop tracking works offline against SQLite with or without an account. Local
mode remains complete and requires no login. Tickets 116–122 add optional
Google account linking, automatic eventual synchronization while the app runs,
conflict review, and explicit disconnect choices within the four-screen model.
Account mode synchronizes product records, histories, provenance, hosted
delivery history, and browser/email reminder preferences. It keeps credentials,
push subscriptions, native reminder state, OS capabilities, and local files
device-local. `docs/DESKTOP_BUILD.md#planned-account-mode` owns the complete
field, snapshot, retry, first-link, and conflict contract.
Local Settings exposes the exact Application Support data path, Reveal in
Finder, Back Up, Restore, account, timezone, onboarding, and native reminder
controls. Raw database Restore remains local-mode only.

Desktop native reminders target 30 days and schedule nearest eligible reminders
first. Show the actual contiguous coverage verified through OS readback and
clearly disclose a shorter OS-limited horizon or unavailable verification.
Do not assume a universal request cap. Reconcile on launch, resume, local day
change, and relevant mutations. No background helper is authorized. Desktop
email delivery remains out of scope. Tickets 116–122 activate the current
outbox/cursor scaffold for optional synchronization.

Future offline/PWA work is tracked in `/docs/FUTURE_UPDATES.md`.

## In scope

- Google login
- Many independent single-account users
- Behavior creation/edit/archive
- Categories
- Recurrence rules
- Timeline-first interface
- Notes
- Browser notifications by default
- Optional email reminders
- Basic analytics
- JSONL/CSV/full JSON/BehaviorLog export
- Account deletion with export reminder and typed confirmation
- Public Terms, Privacy, and Trust routes
- Simple onboarding for first behavior, notification permission, import, and timezone
- Privacy-safe monitoring/error reporting
- Repeatable many-user RLS smoke QA
- Public Astro marketing site when explicitly ticketed
- Local-first macOS tracking parity under Tickets 107–114
- Optional desktop Google account linking and synchronization under Tickets 116–122
- Incremental shared domain code and design tokens, with preserved web APIs

## Day-progress timeline and gated Calendar context (Tickets 132–137)

The repository implements the accepted day-progress layout on web and desktop.
`packages/core/src/resolvers/day-progress.resolver.ts` owns layout decisions.
`components/timeline/DayProgressTimeline.tsx` renders the shared Timeline.
`lib/services/timeline.service.ts` and
`apps/desktop/src/local-timeline.service.ts` assemble platform data.
The ordinary Timeline remains usable without Google Calendar and in desktop
local mode.

The Timeline uses one continuous local-day axis. A blue dot marks the current
position without changing a row. Behavior rows keep their time labels, status,
Notes, and manual actions. Calendar markers sit left of the axis. Only events
with the same original start instant group. Display displacement does not change
an event time. Local midnight advances the forward range without deleting a
record or changing an Occurrence status.

The repository also implements optional read-only Google Calendar context.
`docs/EXTERNAL_EVENT_CONTRACT.md` defines the versioned snapshot contract.
`lib/services/google-calendar.service.ts` owns same-account consent and reads.
`components/settings/GoogleCalendarPanel.tsx` owns connection, selection,
visibility, refresh, reconnect, and disconnect controls. Desktop uses
`apps/desktop/src/calendar/google-calendar.ts` and the same server connector.
It does not receive a Google credential.

The connector requests Calendar-list and event read-only scopes after ordinary
Cadence sign-in. It accepts only the Google identity already attached to the
Cadence account. It reads only selected readable calendars and displayed days.
It never creates, edits, or deletes a Google event. All-day dismissal changes
local presentation only. External events never change Behavior schedules,
Occurrence statuses, Notes, or reminders.

Timed and all-day events can open a persistent non-modal preview. **View
details** opens one event in a modal drawer and restores focus when closed.
Validated Google source links open outside Cadence. The UI preserves missing,
restricted, stale, incomplete, and unknown facts. It does not turn a failed or
partial refresh into an empty Calendar claim.

Desktop stores the last complete matching snapshot in the separate disposable
`calendar-cache.sqlite3` file. The cache contains normalized selected event
details, range, account, generation, and freshness. It contains no Google
credential or raw provider response. A failed refresh may retain stale data
with an explicit label. Calendar disconnect and desktop account disconnect clear
the cache while preserving Cadence history. Reconnecting the desktop account
also clears the prior local Calendar state.

The server stores the Calendar connection and display preferences with the
Cadence account. It stores the Google refresh credential as owner-bound
AES-256-GCM ciphertext in a non-exposed database schema. The web and desktop
clients receive normalized event data, not that credential. Cadence exports,
BehaviorLog bundles, account synchronization, and user-created desktop backups
exclude Google credentials and cached events. Hosting infrastructure backups
may retain sealed credential ciphertext under the current hosting backup policy
after live deletion. The current Supabase daily-backup window is seven days.

Disconnect deletes the live credential before Cadence attempts Google grant
revocation. If Google revocation is unavailable, Settings tells the user to
remove Cadence from Google Account permissions. Account deletion captures the
revocation work, deletes the Auth user and cascading owner-scoped Calendar
records, then attempts external revocation. Failed Auth deletion preserves the
Calendar connection. A provider outage after deletion does not restore the account.
Other devices stop refreshing and clear their local content when they next
observe the changed connection. Ordinary web sign-out keeps the account-level
Calendar connection. Desktop account disconnect clears that Mac's Calendar cache.

Timeline planning uses a Behavior's optional positive default duration first.
Without a default, duration estimates use positive stopped-session totals from at
least three Completed Occurrences in the previous 90 complete local days. A
running session is not a finished sample. Missing history remains unknown.
Tracked-time records and measured averages stay independent from the default.
Possible-overlap cues are advisory. They use half-open timed intervals and exclude
all-day events. They never prove availability or change a schedule or status.

The deployed connector and installed preview have live acceptance evidence. The
server still reports `not_configured` unless all required Calendar OAuth and
encryption settings are valid. Desktop additionally requires a valid HTTPS
`VITE_CALENDAR_BROKER_ORIGIN`. The repository contains no live credentials.
Google verified Cadence branding and accepted the Calendar data-access submission
on September 18, 2026, but scope approval and post-approval smoke checks remain
open under Ticket 141. Ticket 137 retains controlled provider-failure and
Workspace-restriction coverage plus dense/overnight installed fixtures and
multi-day resume evidence. Apple-trusted desktop distribution remains separate
under Ticket 115. Native mobile, dynamic rearrangement, and non-Google connectors
remain deferred.

## In-app daily briefing (Tickets 145–148)

The owner's September 20 correction supersedes the external-consumer assumption.
Cadence Daily Brief appears in a text bubble emerging from the existing Timeline
horse on the first app opening of the local day. The user can dismiss or ignore it.
Cadence gathers relevant Behaviors, completion history and connected Calendar facts;
the model writes the briefing; Cadence displays it. No prewritten summary or
individual briefing requires approval. Generation does not block ordinary tracking.

The briefing may recommend priorities, timing and schedule changes. It cannot mark
Occurrences, edit Behaviors, write Notes, send reminders, import records, or edit
Calendar events. Future execution remains separately scoped work. This is a text
bubble, not audio speech, a general chatbot, or a separate advisor application.

Existing sign-in identifies the owner. First-party briefing enablement and disclosed
model-data use replace external-client grants. Keep Calendar connection permission
separate from model disclosure, but require no second login or approval of each
briefing. Account, disclosure, connection, selection and source changes fence pending
results. The model receives no account credential, provider credential or write tool.

Initial generation uses OpenAI `gpt-5.6-luna`. One server adapter maps provider
requests/responses behind a provider-neutral facts/result contract. Shared core and
UI must not depend on provider SDK types. No generic agent framework is required.

The shared authorized context retains manual statuses and bounded completion
counts. The Daily Brief recipe filters resolved work internally and independently
selects model inputs. The current policy does not permit completion or adherence
recaps. Raw status-update times are not actual finish times. Notes,
account identifiers, Calendar rich text, provider IDs and credentials stay excluded.
Partial or stale Calendar coverage cannot prove free time. Missing duration cannot
prove that an activity fits. The private inspector retains source diagnostics.

Daily Brief policy 2.1 gives a forward-looking overview of practical constraints
and supported opportunities. It prioritizes meaningful conflicts and tight
transitions when evidence supports them. Recommendations stay read-only and must
use validated planner options for timing. Prose omits routine ledger recaps,
generic coaching and data-availability reports. Material uncertainty belongs in
prose only through its practical consequence for a specific recommendation.
Uneventful or unsupported cases stay short without claiming the day is free.
New conflict evidence remains in Ticket 159. Ticket 160 records the accepted
travel direction; Tickets 162–165 own implementation and release acceptance.

### Travel context (Tickets 160, 162–165)

Travel routes proactively after setup when two usable location points exist.
Current device position is the default immediate origin when permission and a
fresh sample are available; it overrides where the schedule predicted the user
would be. Recommend current location → first event whenever both points are usable,
with or without a saved base. A saved base supplies a fallback origin and final
return destination. Without a usable base, only final-return advice is suppressed
and return time stays unknown; never assume return to the outbound origin.

Behaviors gain optional designated locations. Calendar events retain their own
locations. Explicit journey corrections override the relevant endpoint; future
legs can start at the preceding planned commitment. Device location never
overwrites a destination. Support walking, cycling, transit and driving through
a chosen mode, with no silent driving fallback. Missing or ambiguous locations
remain unknown. Plan A → B → C directly from event locations, times and mode;
recalculate affected legs when those inputs change. Never insert a return to base
between successive events automatically. See `plans/travel-departure-discovery.md`
for precedence and consent.

Departure, attendance, onward travel and return define derived occupied time.
For example, a 2:30–4:30 event may occupy 1:30–6:30. Timeline collisions and advisor
findings use all known outbound and event-to-event intervals, plus return travel
when known. Unknown return timing never removes known occupancy or collisions,
and cannot establish complete-trip availability. Scheduled times and manual
statuses remain unchanged. Reuse existing magenta Timeline/collision
presentation. Show Calendar locations with Google Maps or a supported preferred
navigation link. Users open navigation themselves.

Onboarding explains automatic routing, recipients, device permission and optional
base. If device location is unavailable, request a base for the immediate origin;
an unknown immediate origin does not block known event-to-event legs. Route expiry
invalidates estimates, not saved configuration. No continuous/background tracking,
Calendar editing or automatic rescheduling follows from this feature.

Web and linked online desktop share the routing and occupancy contract. Desktop
keeps local saved locations and offline/account-free tracking. Tickets 162–164 own
implementation and narrow mobile-web verification; Ticket 165 owns provider-use,
deployed-web and installed-desktop acceptance plus public disclosures. Marketing
gains no capability claim before release evidence. Native mobile remains deferred.
The repository implements deterministic travel behind a disabled deployment gate.
Provider review, credentials, live acceptance and model projection remain unapproved.
See `qa/travel-release.md`. Route expiry clears evidence; the next meaningful
foreground change can refresh within quota. It never polls or regenerates Daily Brief.

`docs/plans/first-external-consumer.md` retains its filename but now defines this
in-app contract, daily presentation default, first-party route, limits and data use.
Ticket 146 is reopened for completion-history projection and first-party fences.
Ticket 147 owns first-party generation, disclosure controls and the OpenAI adapter.
Ticket 148 owns the automatic horse bubble and acceptance on web and linked desktop.
The previously tested read service remains reusable. The old endpoint still denies
all credentials. The consumer module now implements internal generation, and the
horse bubble is wired on both clients. See `docs/qa/in-app-daily-brief.md` for
source verification and the remaining hosted/native/live-data release gates.

Web owns hosted generation. Linked online desktop reuses it and explicitly lacks
unsynced/local-only context. Account-free/offline desktop tracking remains available;
local-only AI is deferred. Marketing gains no new claim. Native mobile remains
deferred. Synthetic access to the selected model passed with the approved existing
key. Hosted deployment, real-data acceptance and installed desktop checks remain
open. Provider retention is disclosed separately from Cadence's no-content-storage policy.

### Advisor improvements (Tickets 168–174)

The owner approved this direction on September 26, 2026. Tickets 168–173 are
implemented in source; Ticket 174 release evidence is in progress. The existing
Daily Brief recipe and horse bubble remain the delivery surface.

Ticket 168 makes loading recoverable. An attempted request is not proof that the
user received advice. Navigation reattaches to the same attempt; interrupted,
failed or undelivered attempts offer an explicit, bounded retry. Dismissal stays
separate, and changed or expired timing is withdrawn with a refresh option.

Tickets 169–172 add nine analysis lanes named after export prompts: weekday/slot
dips, marking-time offsets, schedule load (compared within weekdays), historical
Calendar context (reported unavailable), decision debt, late or batched decision
recording, corrections, reminder associations and Note obstacles. Each lane states
its inputs, lookback, sufficiency rule, limitations and permitted proposal.
Unresolved remains missing decision data. Correlations are described, never causes.
Marks describe logging time, not performance time.

Ticket 173 lets a configuration offer at most one pattern tip per brief, only when a
finding bears on today and passes a cooldown and one-day spacing. Cadence shows a
deterministic evidence line beside the model's wording. Routine ledger recaps and
generic coaching remain excluded. Configurations before 1.3, including the current
production default, select no lanes; the `advisor-analysis` candidate preset awaits
reviewed promotion.

Reminder history and Notes on Not Completed occurrences each need their own
revocable Settings disclosure; the database refuses them otherwise. Travel-to-model
projection stays disabled until its provider-use and disclosure gates pass. Ticket 170
instead shows travel guidance calculated from existing evidence beside the brief,
labeled as calculated, withdrawn at expiry, and never passed to the model.

Ticket 174 verifies useful wording, supported timing and reliable delivery on web
and linked desktop. Native mobile and marketing implementation remain out of scope.

### Internal recipe workbench (Tickets 151–158)

The owner requested tickets for an internal control surface to tune tone, scope,
reference materials, suggestion options and planning logic. Extend the existing
local design bench with saved provider-neutral configurations and comparisons
against one frozen synthetic or explicitly authorized account snapshot.
Daily Brief is the only implemented recipe. Recipe identity never grants access.

Start with curated research/guidance records and validated source references.
A pure planner checks day conflicts and individual feasible opportunities even
when no Behaviors are movable. It combines remaining Behaviors, authorized Calendar
commitments, selected duration estimates, configured windows and buffers. Known
overlaps, tight transitions, supported fits and unknown feasibility remain distinct.
Resolved work is excluded without changing its stored status or history.
Only complete relevant coverage and supported duration can establish a fit.
Range commitments reserve the later of their range end and estimated duration end.
Evidence identifies reserved ranges separately from duration estimates.
Source references, assumptions and freshness accompany the evidence. The model
explains ranked findings; it never calculates intervals. Detailed rejections remain
in the inspector. A fit observation does not grant permission to move an exact
schedule; hypothetical move options still require explicit movability.
No travel-time inference enters the briefing before travel release acceptance.
The model explains valid options; voice controls
cannot override scheduling constraints, data disclosure or read-only boundaries.
No automatic schedule or Calendar change belongs to these tickets.

The internal workbench edits drafts and runs explicit comparisons. A reviewed
repository configuration change activates a preset through the existing hosted
service. Ordinary user Settings remains small. Web and linked desktop share
results; no native workbench, marketing claim or native mobile implementation is
added. Existing live-data and release gates remain separate.

## Out of scope

- Structured measurement templates
- Medication dose tracking
- Native mobile app
- Multi-user collaboration
- Social features
- Gamification
- General AI coaching/chat and autonomous execution beyond the in-app read-only
  daily briefing planned under Tickets 146–148
- Two-way Calendar sync and source-event editing; Tickets 132–137 cover only
  gated read-only Google Calendar context
- PWA offline cache
- Web offline writes
- Payment/subscription infrastructure
- Admin dashboard
- Automatic missed status
- Any third manual completion status beyond Completed and Not Completed
- AI speech features in the launch web app
- Marketing/product emails at launch
- Intel desktop releases, desktop email delivery, and closed-app background synchronization


## Retained archive notes (Ticket 125)

Each active-to-archived transition records a dated archive entry, even when its
optional note is blank. Restore and subsequent archives retain earlier entries.
Archive note text is separate from the Behavior description and Occurrence Notes.
While archived, users can edit or remove any entry's note. Removal clears its
text without deleting the archive entry. Existing archives receive no invented
history. Text is trimmed, limited to 2,000 UTF-16 code units, and stored with the
archive mutation in the existing atomic Behavior write. Failed writes preserve
the draft; stale revisions cannot overwrite newer notes.

The shared web/desktop interface places Archive note (optional) beside Archive
behavior in Details and Settings. Archived details show dated Archive history
with Save note and Remove note actions. No predefined reasons or automatic
archiving rules are added.

## Recurring Note shortcuts contract (Tickets 126–128)

The deterministic feature is optional and defaults off globally and for each
Behavior. Explicit **Find repeated Notes** analyzes only one owner's current,
nonblank Occurrence Notes for one active Behavior, across all three statuses.
Use the latest 100 eligible Occurrences in the 90 local calendar days ending
today (today minus 89 days). Sort local date descending, scheduled instant
descending, then ID ascending. Ignore Notes over 2,000 Unicode code points.
Descriptions, archive notes, passive Notes, and imported inline Occurrences
with import provenance never qualify, including after later edits. Unknown
legacy manual Notes qualify. Count Occurrences once, never edit history.

Normalize repeated text using Unicode NFKC, trim, collapse whitespace, and
locale-independent lowercase for comparison. Preserve the normalized latest
source's letter case for proposed display. Match the entire Note, not fragments
or fuzzy similarity. Require three distinct Occurrences. Propose at most five
texts, each at most 160 Unicode code points, sorted by evidence count descending,
latest supporting date descending, then pattern key ascending. Reject control
characters and instruction-like prompt text. This conservative rule preserves
negation and never infers advice, diagnoses, or status changes.

Proposals expire after 30 elapsed days and disappear immediately when their
exact source Note hashes no longer support three eligible Occurrences. Accepted
shortcuts have no expiry and fresh analysis never edits them. Accept permits
editing before saving; later editing retains the original pattern key.
Dismiss/remove deletes text and evidence, retains only suppression keys for the
original pattern and any edited accepted text for
90 elapsed days, and does not delete saved Notes. Deduplicate by normalized
text and original pattern key. Keep at most 20 accepted shortcuts and 128 total
entries per Behavior; report the limit instead of dropping retained entries.
Each accepted shortcut reserves one of those 128 slots for a second suppression
key after editing. Admission checks preserve that reserve so removal always fits.
Saving a draft that used a shortcut atomically records its Occurrence ID as
excluded future evidence. Edits, removal, off controls, and synchronization never
clear this exclusion. Cancelled/failed saves create no exclusion. Exclusions
retain IDs only, with a 100,000-ID ceiling that fails instead of truncating.

Global off dominates every Behavior setting, hides quick-fill and proposals,
and rejects new analysis. Settings and removals remain available. Off preserves
accepted shortcuts and historical Notes. Both settings persist and synchronize;
neither is provider consent. There is no automatic analysis on opening/saving a
Note, schedule, background worker, or automatic Note submission.

Ticket 128 requires a separate explicit device-specific cloud consent with a
versioned privacy notice, global and per-Behavior checks, current account identity,
and an operator off switch. Linking/synchronization cannot grant this consent.
Account-free/offline desktop uses only local deterministic matching. Provider
selection and synthetic live acceptance remain separately recorded in Ticket
126's evaluation. Until its go decision, cloud analysis is unavailable.

Web and desktop share the resolver, review lifecycle, and Note form. Marketing
updates existing guidance only after verified acceptance. Future mobile remains
deferred and inherits this contract without implementation here.


## Behavior planning fields (Tickets 142–143)

Behaviors optionally store a default duration in whole minutes (1–1,440) and an end date. The default supplies Timeline planning duration; measured time and averages remain independent. The end date is the first archived local day. Automatic archive preserves history and produces a durable in-app notification. Web processes due dates through its existing scheduled and foreground lifecycle. Desktop catches up on launch, resume, and day change without a background helper.

## Historical completion times in Daily Brief

The recipe can independently select historical completion marking patterns to
inform relevant planning advice. These timestamps describe when the user marked
prior Occurrences Completed, not when the Behavior actually finished. Delayed
logging limits precision but does not disable this input. Today's unresolved
Occurrence can benefit from past evidence, independently of average duration.

Use the workbench History days setting and shared circular timing summary defined
in `docs/DATETIME_STRATEGY.md`. Disabled selection omits all timing facts from the
model. Selected summaries and exclusions appear in the inspector. Completion
recaps and routine diagnostic prose remain prohibited. A marking pattern cannot
prove availability or override Calendar evidence, duration or planner constraints.
Consent, explicit comparison runs, read-only authority and duration controls remain.
