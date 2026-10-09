# Locked Product Decisions

These decisions are already resolved. Do not re-ask them unless a later user prompt explicitly changes them.

## Status model

Use explicit manual marking.

Statuses:

- unresolved
- completed
- not_completed

Do not auto-mark an occurrence as missed.

Needs decision is a derived UI state for prior-day unresolved occurrences, not a stored status.

The UI labels `completed` as Completed and `not_completed` as Not Completed.

Occurrence rows keep a current-status snapshot. Internal
`occurrence_status_events` rows store explicit status history for auditability
and BehaviorLog interoperability.

Manual status snapshot and event writes are atomic. Corrections link to the
latest known event, clearing a decision leaves history intact, repeated taps of
the current resolved status are idempotent, and note-only edits do not create
status events.

## Primary route

Use Timeline as the primary screen.

Route:
`/timeline`

Avoid:
`/dashboard`

## Day reset

Use local midnight.

Default timezone:
America/New_York

## Medication tracking

V1 tracks only did/did not.

Do not add:

- Dose amount
- Supply count
- Refill inventory
- Medication calculation logic

## Measurements

No structured measurement templates in v1.

Use:

- Behavior title
- Behavior description
- Occurrence note

### Occurrence elapsed time exception

Ticket 068 permits one duration-only exception. An occurrence can own persisted
start/stop time sessions. Cadence derives recorded duration from each stopped
interval and keeps timing separate from statuses, adherence, notes, and reminder
eligibility. This does not authorize templates, targets, manual duration entry,
or other structured measurements. Start is available on an active behavior's
current-day occurrence and on occurrences still visible in Needs decision.

## Recurrence anchor

Use scheduled date/time.

Recurring behaviors should recur according to their schedule, not from the last completion date.

## Behavior schedules and time entries

Behaviors can have one or more schedules. Each schedule owns one recurrence
pattern and one or more exact times or time ranges. Add time means another time
entry under the same recurrence. Add schedule means another recurrence pattern.

Supported preset ranges:

- Morning: 6:00 AM-Noon
- Afternoon: Noon-6:00 PM
- Evening: 6:00 PM-Midnight
- Night: Midnight-6:00 AM

Range occurrences use the beginning of the range as their scheduled reminder
anchor. Matching generated occurrences with the same behavior, local date,
start time, and end-time/range identity are counted once. Multi-time behavior
completion is derived from individual occurrence statuses only; do not add a
stored partial-completion status or progress label.

## Reminders

Browser notifications:

- Enabled by default on every behavior
- Permission is requested from Settings

Email reminders:

- Optional per behavior
- Configured when creating/editing behavior

## Offline behavior

Internet-required web app is acceptable.

Web offline support and PWA caching remain deferred. The active desktop track
requires offline tracking through SQLite. Tickets 116–122 plan optional account
synchronization while preserving account-free local mode.

Future offline/PWA work is tracked in `/docs/FUTURE_UPDATES.md`.

## Auth

Use Google login through Supabase Auth for the web app and optional desktop
account mode. Desktop always uses one stable local profile and remains usable
without login or network access.

## Supabase operations

Use the Supabase CLI as the standard pathway for database and hosted project operations.

- Use project-local commands through `npm run supabase -- <command>`.
- Use migrations for all schema changes.
- Keep local and hosted schema congruent through git-tracked migrations.
- Do not change the hosted database directly outside migrations.
- Use `docs/SUPABASE_WORKFLOW.md` for command details.

## Owner-scoped time-session query APIs

Keep a bounded, authenticated, `SECURITY INVOKER` RPC for genuinely arbitrary
Occurrence ID sets. The repository batches automatically above 2,000 unique
IDs, merges the results, and restores deterministic global order. Callers and
users do not encounter that implementation limit.

Do not use the ID RPC as the primary historical-data API. Analytics,
behavior-date review, and Export use a joined date-range/keyset-cursor RPC.
PostgreSQL joins Occurrences to Time Sessions directly, filters on stored
Occurrence `local_date`, and returns bounded pages that the repository follows
automatically.

Do not place an unbounded UUID list in a Data API URL. Do not use
`SECURITY DEFINER`, accept a caller-supplied user ID, expose execution to
anonymous roles, or use the service-role client. Existing owner RLS remains
authoritative, and both RPCs explicitly scope rows to `auth.uid()` as defense
in depth. Ticket 094 owns the full contracts and verification requirements.

## Email provider

Use Sequenzy for v1 email reminders.

- Use the Sequenzy CLI as the standard agent pathway for provider operations.
- Use project-local commands through `npm run sequenzy -- <command>`.
- Keep runtime email sending server-only.
- Do not expose `SEQUENZY_API_KEY` to the browser.
- Use `docs/SEQUENZY_WORKFLOW.md` for command details.

## Date and time implementation

Use the strategy in `docs/DATETIME_STRATEGY.md`.

- Default timezone remains `America/New_York`.
- Use local midnight for day boundaries.
- Store `scheduled_for` as `timestamptz` and `local_date` as the local calendar date.
- Use Temporal for timezone-aware implementation when recurrence logic begins.
- Inject `now` into resolvers; do not read the system clock inside resolver logic.

## Agent drift checks

Run `npm run agents:check` and `npm run resolvers:check` before considering any coding task complete.

These checks are part of the repository contract and should be extended when new drift risks appear.

## Product direction

Build a custom, open-source Cadence product.

Do not start by integrating an open-source habit tracker.

Cadence is now a public product posture, not a private-only app. The current
web app should be hardened for many independent single-account users while
remaining single-player and small.

Cadence also demonstrates and promotes the BehaviorLog Bundle standard:
`https://github.com/emixd12/BehaviorLog-Bundle`.

## Public surface architecture

Use separate shells for separate surfaces:

- authenticated web app: current Next.js app,
- marketing site: implemented sibling Astro app,
- desktop app: local-first macOS track implemented under Tickets 107–114, with
  Apple-trusted distribution deferred under Ticket 115,
- mobile app: future local-first app following the desktop direction.

For the active desktop track, keep Next.js at the repository root and add only:

```text
app/              existing Next.js routes, with components/ and lib/ at root
apps/
  marketing/
  desktop/
packages/
  core/
  ui/
```

Create shared packages incrementally after the native boundary proof. Broader
restructuring and mobile remain deferred. Keep npm workspaces.

## Marketing stack

Use Astro for the public marketing site. Keep it SEO-conscious, static-first,
and visually consistent with `docs/PRODUCT_SPEC.md` and `DESIGN.md`.

## Pricing and AI

Billing is not launch scope. The intended future shape is free open-source
desktop/mobile apps plus paid web/shared-account capabilities for cross-surface
saving and future speech-to-speech AI features.

Do not add payment or AI speech features until tickets update the relevant
product, route, data, legal, and operations docs.

## Open-source copyright and security disclosure

Decision date: 2026-08-25. Ticket: 099.

Cadence uses the MIT license with
`Copyright (c) 2026 Identity Scaffolding LLC`.

The MIT scope covers owner-controlled source code, repository documentation,
and synthetic sample content. It excludes tracked binary non-code assets
pending provenance review, including app icons, logos, brand illustrations,
product captures, custom notification icons, design exploration, QA
screenshots, and audio.

Cadence names and logos remain reserved as trademarks. The MIT license grants
no trademark-use permission. Hosted service access, production credentials,
and user-owned behavioral data also remain outside the source license.

Private vulnerability reports use `security@identityscaffolding.com` as the
primary route. GitHub private vulnerability reporting becomes a secondary
route after publication and explicit enablement. The repository owner monitors
the inbox. The owner authorized exactly one harmless synthetic route test. The
sender accepted and retained that one message with sent status on 2026-08-25,
and recipient-side inspection confirmed receipt at the approved mailbox. The
message landed in the junk folder, so the repository owner monitors filtered
folders or maintains appropriate allowlisting. No response deadline, bug
bounty, paid support, contributor license agreement, or copyright assignment
is promised.

## Marketing content, retention, and legal publication

Decision date: 2026-08-27. Ticket: 106.

Cadence's public source remains
`https://github.com/emixd12/habit-tracking-app` under the MIT license. The
application origin remains canonical for `/trust`, `/privacy`, and `/terms`.
Cadence provides prepared prompts, but users export data and choose an external
AI service; Cadence does not send behavior data to an AI provider. Public copy
names exactly JSONL, JSON, CSV, Markdown, and BehaviorLog bundle exports.

The public entity is Identity Scaffolding LLC, a Wyoming limited liability
company assumed authorized in New York, at 30 N Gould St Ste R, Sheridan, WY 82801. The minimum age is 18. New York law governs, subject to nonwaivable
consumer protections. Disputes start with informal resolution and then proceed
in a court of competent jurisdiction in New York State. The initial Terms use
neither mandatory arbitration nor a class-action waiver.

The retention policy remains a proposal, not an approved publication claim.
Its targets are 30 days for routine logs; up to 90 days or the end of an
investigation for security-incident logs; no more than 30 days for backups;
immediately or within seven days for deleted-account live data, with backup
remnants aging out within 30 days; and 12 months after resolution for support
messages. Specific records may be kept longer only for security investigations,
fraud prevention, or legal preservation.

The sanitized 2026-08-27 audit found one-day Vercel Pro runtime logs, seven-day
Supabase Pro API and database logs, and seven-day Supabase Pro daily backups.
No Vercel Observability Plus entitlement, Vercel Log Drain, or Supabase Log
Drain was evidenced. The routine-log and incident-log targets are unsupported.
The backup maximum is supported. Immediate live-data deletion is supported by
the Auth deletion path and database cascades, without a destructive production
test in this audit. Sequenzy transactional retention, browser-push intermediary
retention, and the proposed 12-month support-message period remain unverified.

The Privacy and Terms text dated August 27, 2026 is a draft date, not legal
approval or an effective publication date. Legal-copy publication and public
registration remain blocked until sanitized provider-retention evidence
supports the final claims,
`privacy@identityscaffolding.com` passes one harmless route-confirmation test,
and one legal review approves the final legal text and facts. No gate is
recorded as passed by this decision. The proposed retention policy must change,
or the active provider controls must change under separate authorization,
before the retention gate can pass.

## Ticket 106 publication approval

Decision date: 2026-08-31. Ticket: 106.

The 2026-08-27 decision above remains a historical checkpoint. The owner later
confirmed that active retention settings were verified, the privacy mailbox
passed its harmless route test, legal review approved the final Privacy and
Terms text and facts, and all publication approvals are complete.

The final policy replaces the unsupported 30-day routine-log proposal with the
verified active windows: one day for Vercel runtime logs and seven days for
Supabase API and database logs. Supabase daily backups and deleted-account
backup remnants retain no more than seven days. Browser-push payloads expire
after no more than 24 hours. Support messages retain for 12 months after
resolution. Security-incident records may be preserved for up to 90 days or
the end of the investigation when an investigation requires preservation.

Privacy and Terms are approved for publication. Public registration is
approved. This decision changes no authentication implementation or provider
setting.

## Local-first macOS desktop activation

Decision date: 2026-08-30. Tickets: 107–113.

The owner approved implementation of the desktop plan. Use Tauri v2, Vite,
React, and SQLite for macOS 14+ on Apple Silicon. Tracking requires no login or
network. Keep one stable local profile and current category/timezone defaults.
Preserve current tracking parity, including schedules, timing, history,
lineage, BehaviorLog import/merge/restore, and privacy defaults.

Native SQLite transaction and notification proof must precede broad shared-core
or UI refactoring. Add `apps/desktop`, then extract `packages/core` and
`packages/ui` incrementally. Preserve web APIs and keep Next.js at the root.
Business decisions remain in TypeScript. Thin native code may handle
transactions, files, notification scheduling, and lifecycle.

Retain tombstones, an atomic mutation outbox, cursors, stable local identity,
and a no-op SyncEngine. Do not add live sync, cloud login, or a remote conflict
policy. Reuse BehaviorLog import for transfer; do not add a Full JSON importer.
Native delivery uses BehaviorLog extensions without a schema fork or changes
to hosted delivery semantics.

Target 30 days of native reminders with a clearly displayed, verified
OS-limited horizon. The later 2026-08-30 horizon decision below supersedes the
initial guaranteed-coverage requirement. No background helper is authorized.

Use existing interaction IDs, platform applicability/evidence, and design-system
surface mappings. Every new or materially changed product/design ticket must
address web, desktop, marketing, and future mobile with implementation,
follow-up, or explicit not-applicable reasoning. Structural checks do not prove
semantic parity. Marketing consumes approved claims rather than duplicate UI.

Desktop tracking and the unnotarized preview/updater milestone are complete.
Apple-trusted distribution remains separate and deferred under Ticket 115.
The 2026-08-31 preview decision below records the six assets' distribution
authorization without marking Apple requirements passed.
Public publication remains an explicit release action.
Mobile, Intel releases, email delivery, cloud account controls, and duplicate
public/legal pages remain outside this track.

## Optional desktop account synchronization

Decision date: 2026-08-31. Tickets: 116–122.

The owner approved optional use of the existing Cadence Google account on
desktop. Account-free local mode remains complete. A signed-in desktop keeps
SQLite as its offline working copy and synchronizes with the web account and
other desktop working copies while the app runs with connectivity.

Before the first link, recognized local data requires an explicit choice:
Import local data into the account, or Ignore local data and use account data.
Reuse the existing portability snapshot, fingerprint, preview, conflict action,
and atomic write-plan architecture. Ignore creates a protected local backup
before replacing the working copy.

Use complete typed snapshots, a saved common baseline, and three-way merge for
the first release. Auto-merge nonconflicting changes. Pause the accepted plan
and show a shell cue plus Settings conflict review when intent cannot be
preserved automatically. Do not add a hosted change journal until measurements
show the snapshot ceiling is insufficient.

The owner approved a narrow reminder reconciliation exception on 2026-09-15.
A hosted Sent record takes precedence over a stale local Cancelled record from
a Pending baseline when the delivery identity, schedule, and provenance match.
Preserve hosted send evidence while synchronizing local occurrence decisions;
a local cancellation cannot undo a recorded send. Conflicting user edits and
other reminder conflicts still pause the whole plan. The full matching and
evidence requirements live in `docs/DESKTOP_BUILD.md`.

Reject rather than truncate a snapshot when a collection exceeds 100,000 rows,
canonical JSON exceeds 64 MiB, or a complete attempt exceeds 30 seconds. Advance
the baseline and acknowledge the local outbox only after hosted and local atomic
commits both succeed. Stable idempotency keys make retries safe. The exact
synchronized and device-local fields live in `docs/DESKTOP_BUILD.md`.

Store the live database in the app-managed Application Support location.
Settings shows the exact path and offers Reveal in Finder, Back Up, and Restore.
Raw database Restore is local-mode only. Disconnect offers Keep a local copy,
with its exact path, or Remove account data from this Mac.

Use system-browser PKCE and store session secrets in Keychain. Use only the
user's JWT and hosted RLS. Never package service-role or provider credentials.
Do not add a background helper, billing gate, web PWA writes, desktop email
delivery, mobile implementation, or an account switcher.

The first schema-changing desktop release in this track must upgrade an older
installed version through the real updater after a protected database backup.
Ticket 115 remains a separate deferred Apple-trust gate.

## Preserve compatible initial manual marks during synchronization

Decision date: 2026-09-16. Ticket: 130.

The owner requested a history-preserving repair after independent Mac and web
Completed marks blocked reminder reconciliation. Retain both initial manual
marks when their status and provenance agree and occurrence copies differ only
in status timestamps. Require an Unresolved baseline without status history,
root explicit user marks, and timestamps backed by each copy's own events.
Choose display timestamps with existing latest-event ordering; clocks never
choose between divergent statuses. Retain IDs, timestamps, and provenance on
every original event. Corrections and divergent descendants remain blocked.
Remove the unused review handler that deleted the losing history event.

This narrowly extends the earlier first-hydration compatibility decision.
The existing three-way planner, outbox, compare-and-set apply, and baseline
acknowledgement remain unchanged. No new framework or schema is needed.
Current [PowerSync conflict guidance](https://docs.powersync.com/handling-writes/custom-conflict-resolution)
supports domain-specific reconciliation and explicit unresolved conflicts.
[Automerge conflict semantics](https://automerge.org/docs/reference/documents/conflicts/)
also distinguish deterministic convergence from preserving conflicting values.
Neither requires replacing Cadence's existing transport to handle equal marks.
Desktop owns the shared planner and tests; web retains existing atomic apply
and append-only protection. Marketing has no runtime change; desktop guidance
explains the rule. Future mobile remains deferred.

## Preserve same-status hosted history during first hydration

Decision date: 2026-09-02. Ticket: 119.

The owner chose compatibility handling instead of rewriting pre-existing hosted
status-event rows. The desktop planner preserves a hosted branch when every
event has the same status and Cadence is automatically hydrating an untouched
local profile for the first time. It copies every event unchanged into the
local working copy and first common baseline.

The exception does not apply to recognized local data, local-only branches,
cross-copy branches, divergent statuses, or branches added after a common
baseline exists. Those cases continue to fail before writes. The policy changes
no hosted row and creates no schema migration.

Platform impact:

| Platform | Implementation, follow-up, or not-applicable reason |
|---|---|
| Web | No implementation change; existing hosted history remains unchanged |
| Desktop | `account-sync.resolver.ts` and the first-link service own the narrow hydration exception |
| Marketing | Not applicable; this is data-preservation behavior, not a new product claim |
| Future mobile | No implementation is authorized; reuse the shared planner policy if mobile account linking is later approved |

## Unnotarized desktop preview and asset authorization

Decision date: 2026-08-31. Ticket: 113.

The owner authorized an ad hoc signed Apple Silicon preview using Cadence's
existing identity and local data. Apple enrollment, Developer ID signing,
notarization, and original final-release acceptance are explicitly deferred,
not passed. They must not block preview preparation. macOS 14 remains the
declared minimum; compatibility requires actual testing.

Separate candidate-building prerequisites from final release checks. Preserve
strict production checks, signature/archive validation, data protection, and
honest updater evidence. Prepare previews and a dedicated HTTPS update feed
locally for `emixd12/habit-tracking-app`; public artifacts or feed exposure
required approval of the concrete files and destination. Ticket 113 and
`docs/DESKTOP_RELEASE.md` own the completed preview record; Ticket 115 owns
Apple-trusted distribution.

The owner confirmed ownership and authorized distribution inside Cadence of the
six exact file/hash pairs in `docs/qa/2026-08-30-desktop-asset-provenance.md`.
Do not request the same permission again. Existing MIT asset exclusions,
third-party notices, and reserved trademark rights remain unchanged. This does
not authorize unrelated relicensing or public hosting.

## Apple-trusted desktop distribution split

Decision date: 2026-08-31. Tickets: 113 and 115.

The owner closed Ticket 113 around its completed unnotarized Apple Silicon
preview and updater acceptance. Ticket 115 now owns Apple Developer Program
access, Developer ID Application signing, notarization submission and stapling,
quarantined notarized-DMG Gatekeeper acceptance, and actual Apple Silicon
macOS 14 execution. Ticket 115 is deferred because those resources are
unavailable. Marketing must not claim notarized or generally available
distribution until Ticket 115 passes.

Production checks remain strict. The current preview versions both use SQLite
schema 6, so shipped-migration testing is not applicable to Ticket 113. Native
rollback tests remain current evidence. The first future schema-changing desktop
update must upgrade an older installed version through the real updater after a
protected database backup. Do not create a disposable migration build or a
separate migration ticket now.

## Desktop native reminder horizon

Decision date: 2026-08-30. Tickets: 108 and 112.

The owner accepted replacing guaranteed 30-day native coverage with a clearly
displayed OS-limited horizon. Keep 30 days as the target and schedule nearest
eligible reminders first. Verify retained pending requests through OS readback.
Report contiguous coverage only; the first missing intended request ends it.
Clearly disclose the actual scheduled-through date/time, shorter coverage, and
unavailable verification. Scheduling callbacks alone do not prove retention.

The native probe's 100-of-128 retained requests motivated this change; it does
not establish a universal 100-request cap. Reconcile on launch, resume, local
day change, and relevant mutations without hardcoding that observed ceiling.

This decision permits a shorter verified horizon, not silent truncation or a
background helper. Hosted reminder semantics stay unchanged. Native activation
proof still precedes broad refactoring, and all other implementation, parity,
and release requirements remain. This decision does not complete Ticket 108.

## 2026-09-07: Recurring Note shortcuts contract (Tickets 126–128)

Implement deterministic repeated-text matching independently of provider selection.
Use a separate owned shortcut-state table and existing guarded Note saves. This
preserves historical Note meaning and gives web/desktop the same offline-capable
review workflow. The finalized limits, source exclusions, lifecycle, and insertion
rules are in PRODUCT_SPEC; storage and privacy are in DATA_MODEL and EXPORT_FORMATS.

Imported inline Occurrences and saved shortcut-assisted Notes never count as
fresh evidence. Accepted edits remain user-controlled. Removal retains only a
90-day suppression key, not the deleted text. Native backups and account sync
retain state; portable tracking exports omit assistance metadata. Feature switches
synchronize, but cloud consent never does. Provider evaluation uses synthetic
Notes only and cannot imply permission to send personal Notes or incur new costs.

## 2026-09-15: Day-progress timeline promoted to Tickets 132–137

The owner approved ticket creation for a continuous left-side timeline beside
unchanged ledger rows. Whole current/future days remain connected; item-only
time labels and a moving dot provide temporal orientation. Readability takes
priority over exact proportional spacing when items collide.

The owner answered five scope questions:

- Deliver web and desktop together.
- Require Cadence sign-in and use the same Google account for Calendar.
- Estimate duration from tracked averages when sufficient; otherwise use unknown.
- Show overlap cues only; leave rearranging for a future ticket.
- Cache the displayed external-event range on desktop and label stale data.

The planned product/UI contracts and Tickets 132–137 own the details. Google
access is read-only. Calendar editing, other accounts/connectors, and native
mobile stay deferred. Ticket 132 validates layout and statistical defaults;
Ticket 134 verifies provider capabilities and secure credential custody.
This decision authorizes planning, not implementation or provider deployment.


## 2026-09-16: Day-progress UI accepted; external-event infrastructure next

The owner explicitly closed the seventh-revision UI review and requested connector
infrastructure before minor design polish. Ticket 132 is complete; this does not
claim production or native release acceptance. Tickets 133–137 retain those gates.

Ticket 134 owns a documented, versioned external-event interface, using the
existing shared types. Preserve scheduled starts, ends, derived duration or
unknown, timezone, recurrence identity, availability, provenance, and coverage
for future consumers. `docs/EXTERNAL_EVENT_CONTRACT.md` defines acceptance.
Use MCP's schema/capability ideas without adding an MCP server or generic plugin
framework. Dynamic rearranging, model invocation, and Calendar writes remain
deferred. Ticket 137 verifies interface documentation alongside the combined release.

## 2026-09-18: Cadence Daily Brief selected as the first external consumer

Historical decision: the September 20 correction below supersedes the external
consumer, invocation, delegated-auth and model-selection assumptions.

Decision date: 2026-09-18. Tickets: 145–148.

The owner selected **Cadence Daily Brief**, a private external daily-planning
advisor, as Cadence's first external consumer. This decision accepts planning
for the smallest authenticated read-only interface. It replaces the proposal's
manual-copy recommendation. Historical launch exclusions remain unchanged
except for this explicitly planned external read-only consumer.

Cadence Daily Brief may read relevant Cadence context and separately authorized
connector context. The initial connector is the existing read-only Google
Calendar connection. The contract may support other relevant connectors later,
but this decision adds no connector, generic framework, or MCP requirement.
Connector consent for Cadence does not authorize onward disclosure. The consumer
needs its own revocable, account-bound consent for each data class and connector.

The advisor may suggest priorities, timing, sequence, and schedule changes. It
cannot execute a suggestion. Read authority never grants write authority.
Cadence and provider writes are an intended future phase, not a permanent
exclusion. That phase must separately define named operations, permissions,
preview, explicit human approval, stale-context checks, conflict handling,
idempotency, audit history, revocation, and atomic apply behavior.

The initial interface includes only the current local day's active Behavior and
Occurrence facts needed for planning: opaque consumer-scoped references, title,
local date, scheduled instant and exact/window bounds, status, duration seconds
or unknown, source, sample count, and lookback days. Its envelope includes schema
version, timezone, capture/expiry, Cadence revision, grant generation, and completeness. Initial connector context includes
only opaque event/calendar/recurrence-instance references, timed interval or
all-day date span, duration or unknown end, source timezone/fallback, event state,
availability, current-user response, connector kind, schema/adapter versions,
coverage, fetched time, revisions/generations, freshness, completeness, and failures.
It excludes Calendar title, description, location,
attendees, organizer, conference data, attachments, source URLs, and provider
identifiers by default. Missing, stale, or partial connector data never means free
time.

Ticket 146 plans the minimal shared day-context service. Ticket 147 plans
consumer-bound authentication, consent, and the bounded read API. Ticket 148
plans the private advisor integration and acceptance. The hosted first consumer
requires a linked Cadence account. Account-free desktop stays available and gains
no native helper. Web owns the initial service and API. Marketing changes only
after an implemented capability supports a public claim. Native mobile remains
deferred.

This is planning approval only. It authorizes no live data transmission, model
call, provider action, or write. The consumer and read-only scope are settled;
Tickets 146–148 do not require another consumer-selection confirmation.

## 2026-09-20: Cadence Daily Brief belongs inside Cadence

Decision date: 2026-09-20. Corrects the September 18 decision and Tickets 145–148.

The owner clarified that Cadence itself displays the daily briefing. On first app
opening, a text bubble emerges from the existing horse. The user can dismiss or
ignore it. Cadence gathers Behaviors, completion history and connected Calendar
facts; the AI writes the briefing; Cadence displays the result. “Approved daily
summary” meant the model's input information, not a prewritten output or approval
step. The product must not require approval of each briefing.

Reuse existing sign-in. The model runs behind Cadence's server boundary with no
account credentials or execution tools. Read-only allows recommending priorities,
timing and schedule changes, but never marking behaviors complete or editing
Calendar events. Future writes remain separate intended work.

The owner selected OpenAI Luna 5.6 initially and requested an agent-agnostic
architecture. Use `gpt-5.6-luna` through one replaceable server adapter over neutral
facts/result contracts. A separate consumer host, delegated OAuth client, advisor
login and general agent framework are no longer required.

The former source acceptance remains dated evidence. Reopen Ticket 146 for bounded
completion history and first-party fences. Re-scope Ticket 147 to authenticated
server generation and model-data controls. Re-scope Ticket 148 to automatic
horse-bubble presentation and web/linked-desktop acceptance. Align documentation
before continuing runtime implementation. The stable plan path remains
`docs/plans/first-external-consumer.md`.

Web and linked online desktop receive the planned horse bubble; account-free and
offline desktop tracking remain available. Hosted context excludes unsynced/local
records. Marketing gains no claim until implementation and acceptance; native
mobile stays deferred. Preserve existing style and Timeline controls. The plan's
once-per-local-day/install dismissal policy is an implementation default, not an
additional explicit owner decision. Model-data disclosure, actual access, retention,
provider requirements and live testing still need concrete implementation evidence.


## 2026-09-20: Ticket the internal briefing control surface

The owner asked for tickets following the proposed workbench for tone, scope,
reference materials, suggestion options and rescheduling/planner logic. Tickets
151–155 capture that planning request. They extend the existing design bench,
retain provider-neutral configuration, and compare outputs against fixed facts.

The planned first slice uses curated references and deterministic constraint
checks before model explanation. Planning produces recommendations only; applying
moves remains separately scoped. The internal workbench does not replace the
in-app horse bubble or add a customer admin dashboard. Configuration drafts do
not change the active daily briefing until a reviewed configuration rollout.

This records authorization to create the tickets. It does not mark implementation,
UI acceptance, live-data transmission or deployment complete. Cross-platform impact
and verification requirements are stated in each ticket.

## 2026-09-21: Travel uses current location and complete-trip occupancy

The owner corrected Ticket 160's initial manual-only, driving-only, per-request,
advisor-only proposal. The accepted direction routes proactively from usable
location pairs, with permitted current device position as the default immediate
origin. Behaviors gain optional locations. Calendar locations remain event-owned;
precedence depends on origin, destination and planned-leg roles.

Later correction on the same date supersedes the earlier global saved-base rule.
A missing base suppresses only the final return recommendation; return time stays
unknown. Recommend current location → first event and plan A → B → C whenever
the relevant locations, times and mode are usable. Recalculate affected legs when
those inputs change. For the next immediate departure, current device position
overrides where the schedule predicted the user would be.

Use the saved base for the final return when one exists. Never insert a return to
base between successive events automatically or substitute the outbound origin
for a missing base. Known outbound and event-to-event travel remains in Timeline
occupancy and collision detection. Unknown return time cannot establish complete-trip
availability. Onboarding requests a base when the immediate origin is unavailable,
without blocking otherwise usable event-to-event legs.

Support multiple transport modes. Include departure, attendance, onward travel
and return in derived occupancy and collision detection. Reuse existing magenta
Timeline/collision presentation. Show Calendar locations with Google Maps or a
supported preferred-navigation link. Saved locations persist until edited/removed;
estimate expiry does not reintroduce per-trip origin approval.

The revised brief is `plans/travel-departure-discovery.md`. Tickets 162–165 cover
web and desktop implementation, shared rules, existing UI and release acceptance.
Marketing claims need deployed evidence; native mobile remains deferred. This
decision approves product direction. Discovery does not perform provider setup,
location reads, private routing or deployment. Provider-use and model-disclosure
requirements remain implementation/release work.

## 2026-09-26: Ticket advisor recovery and structured recommendations

The owner reported absent or stuck-loading advisor output and overly terse advice.
They explicitly clarified that routing means both travel/departure timing and
fitting Behaviors around Calendar events. They approved the proposed direction
and requested implementation tickets after the source analysis.

Tickets 168–174 record recovery first, bounded analysis evidence, combined day
planning, adherence timing/load patterns, recurring obstacles/decision recording,
useful prose with occasional tips, and workbench/release evaluation. The export
prompt library seeds the analysis lanes. Each lane must state its source needs,
coverage, sample sufficiency and limitations; future connectors may add evidence.

Daily Brief remains read-only in the existing horse bubble. Permit concise
historical evidence when it explains a practical tip, while retaining the ban on
routine ledger recaps and generic coaching. Unresolved is not failure, correlations
are not causes, and recorded marks do not prove actual performance times.

This authorizes filing the implementation scope, not executing it. No code,
consent, provider configuration or deployed behavior changes. Optional sources
and travel-to-model use retain their explicit disclosure/provider gates. Existing
release evidence remains open where unverified; Ticket 174 coordinates it.

## 2026-09-26: Implement advisor analysis behind a candidate preset

Tickets 168–173 are implemented in source; Ticket 174 evaluation is in progress.
Implementation decisions, recorded for owner review:

- Recovery allows one automatic start plus three deliberate retries per installation,
  local day and disclosure revision, including after server completion. A Timeline
  change or expiry withdraws delivered text and offers a refresh instead of keeping
  possibly outdated advice on screen.
- Analysis lanes are deterministic and threshold-based. The model receives at most one
  selected finding, never internal records. Reminder history and Notes need separate,
  revocable disclosures, enforced in the database. Older clients' saves revoke them.
- The production default selects no lanes. `advisor-analysis` is a candidate preset;
  promotion is a reviewed repository change after owner wording review.
- Travel stays out of model input. The bubble shows travel lines calculated from
  existing evidence, labeled as not written by the model.
- The model payload now carries deterministic local-time labels. Synthetic runs showed
  that the model stated UTC instants as local times, a defect that predates these tickets.
- Historical Calendar associations report unavailable; no historical Calendar read
  was added.
