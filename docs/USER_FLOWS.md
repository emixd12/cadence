# User Flows

## Daily briefing in the horse bubble (Tickets 146–148)

After any required one-time feature/data-use setup, the first app opening of the
local day starts the briefing through existing sign-in. Cadence reads relevant
Behaviors, bounded completion history and authorized connected Calendar facts.
The server model writes the briefing; the existing Timeline horse presents it in
a text bubble. No prewritten summary or generated output requires user approval.

The user may ignore the bubble and keep tracking, or dismiss it. Neither action
marks a status or edits a Calendar event. Recommendations can describe changes,
but cannot execute them. Loading and failures do not interrupt the Timeline.
A dismissed pending result cannot reopen the bubble. An explicit retry follows a
failure without automatic retry loops. The once-per-local-day/install dismissal
policy is defined in `plans/first-external-consumer.md`.

Tips and travel (Tickets 170–173): a brief may carry at most one pattern tip when a
calculated finding bears on today; Cadence shows the evidence line beside it. Tips
repeat at most once per cooldown. Travel lines beside the brief come from existing
travel evidence, disappear when it expires, and never regenerate the brief. Reminder
history and Notes need their own Settings disclosure; turning Daily Brief off revokes both.

Navigation during loading keeps the attempt; returning to Timeline shows its result.
An interrupted, failed or undelivered attempt shows a recovery notice with an
explicit retry, bounded per installation and day. Marking an occurrence after
delivery withdraws the brief and offers a refresh; expiry offers a fresh brief.

Account, date, disclosure and source changes fence pending content. Stale/partial
facts remain explicit. Linked desktop uses hosted account context and discloses
absent unsynced/local-only records; offline/account-free tracking remains usable.
The flow is implemented in source. `qa/in-app-daily-brief.md` records verification
and the remaining hosted, real-data and installed-desktop release gates.

## Travel setup and use (Tickets 162–165)

Settings and deterministic Timeline integration are implemented behind the provider
release gate. Live and installed acceptance remain open in `qa/travel-release.md`.

1. Travel setup explains automatic route queries, location recipients and expanded
   Timeline occupancy. The user chooses a transport mode and may save a base.
2. The user may enable foreground device location for the current origin. If they
   decline, Cadence requests a base for the immediate origin. With usable device
   and event locations, outbound advice needs no base. Without a usable base,
   only the final return recommendation is withheld and return time stays unknown.
   Known event-to-event legs remain available even when the immediate origin is
   unknown.
3. The user may add a designated location in the existing Behavior form. Calendar
   locations stay attached to their events. Missing/ambiguous points need correction;
   Cadence does not infer a home address or in-person attendance for hybrid events.
4. Opening relevant context or changing meaningful inputs computes usable route
   pairs proactively. No per-trip approval is required. The itinerary includes
   direct A → B → C legs using event locations, times and mode. Changes recompute
   the bounded itinerary. Current device position overrides a predicted origin for the next
   immediate departure. Never insert a base detour automatically. Add the final
   return leg only when a usable saved base exists.
5. Existing Timeline inspection shows departure, scheduled event time, return and
   availability when known. Magenta spans and overlap borders include all known
   outbound and event-to-event travel even when final return timing is unknown.
   Calendar location text offers Google Maps or a supported preferred-navigation
   link. Opening navigation remains the user's action.
6. Current travel evidence supports advisor departure/return recommendations after
   provider-use and model-disclosure requirements pass. Missing return evidence
   cannot produce complete-trip availability, but preserves known-leg advice and
   collisions. Expiry clears temporary evidence; foreground changes refresh within budget; it never erases saved locations or
   silently regenerates the daily briefing.

No route changes Calendar events, Occurrence statuses or scheduled times. Disabling
travel stops queries and clears estimates. Removing device permission clears its
sample and uses an available base for the immediate origin. Without one, that
origin remains unknown; known event-to-event legs remain available. Saved locations
remain until edited/removed. Web and linked online desktop share this flow;
offline/account-free desktop tracking stays
available. Native mobile is deferred. See `plans/travel-departure-discovery.md`.

## Day progress and optional Google Calendar context (Tickets 132–137)

The production Timeline places forward Occurrences beside a continuous local-day
axis. The current-time dot advances only within today's section. **Show more
days**, Notes, manual statuses, timing, and **Needs decision** keep their existing
flows. Midnight changes the visible forward range. It never deletes a record or
changes an Occurrence status.

When the deployment configures Calendar, the user opens Settings and chooses
**Connect Google Calendar**. Google consent is separate from ordinary Cadence
sign-in. Cadence requires the same Google identity as the signed-in account and
requests only Calendar-list and event read-only scopes. A different identity,
denied consent, expired attempt, or revoked credential returns a factual state
without changing local Cadence data.

After connection, the user selects readable calendars, controls Timeline and
all-day visibility, and chooses **Save Calendar settings**. The user can choose
**Refresh Calendar**, **Reconnect Google Calendar**, or **Disconnect Google
Calendar**. Disconnect removes the live server credential before attempting
Google grant revocation. A revocation failure tells the user to remove Cadence
from Google Account permissions. Other devices stop refreshing after they next
read the changed connection.

The Timeline reads selected events only for the displayed inclusive date range.
Each timed event has one marker at its start, or at the first visible boundary
when it began earlier. An overnight event continues into the next day without a
second marker. Hover, focus, click, or tap opens a persistent preview. **View
details** opens that event's modal drawer. Close or Escape restores focus.
Validated source links open outside Cadence.

An all-day control appears only when that day has visible all-day events. It
shows the first title and an additional count. **Dismiss** hides an item from
the current presentation. **Restore** brings it back. Neither action changes a
Google event or creates a Cadence status.

The UI distinguishes no selected calendars, no events, not loaded, stale,
incomplete, unavailable, and refresh failure. The web keeps only a short-lived
in-memory result. Desktop can show the last complete matching local snapshot
with a stale label while offline. A partial or failed refresh never replaces a
complete desktop snapshot as complete.

Both clients refresh on initial visible use, visibility return, and a 15-minute
visible interval. Desktop also refreshes on focused resume. Manual refresh skips
the freshness interval. Hidden or minimized desktop windows stop the recurring
timer. Range, selection, account, or connection-generation changes fence older
responses. Desktop stores one complete matching snapshot, so a replacement
evicts details outside the current request.

Duration estimates use positive stopped totals from at least three Completed
Occurrences in the preceding 90 complete local days. Insufficient history stays
unknown. Running timers remain separate activity signals. Possible overlap is
advisory. Unknown, incomplete, or stale Calendar data cannot prove availability.
All-day events do not produce timed-overlap warnings.

The web flow is implemented through `app/(app)/settings/page.tsx`,
`app/(app)/timeline/page.tsx`, and `lib/ui/google-calendar.ts`. Desktop uses
`apps/desktop/src/calendar/use-google-calendar.ts` and
`apps/desktop/src/product.tsx`. The implementation remains unavailable for real
provider use until deployment configuration and live acceptance pass. Desktop
also requires an HTTPS broker origin. Native and live-provider acceptance remain
open under Ticket 137.

This document describes the main v1 screens, modules, and user flows.

Cadence is a public product with multiple planned surfaces, but the current
implemented product flows include the authenticated web app and the sibling
Astro marketing site. Marketing flows stay out of the logged-in app and should
not add promotional copy inside the authenticated tracker.

## Public site flow

Implemented public account-information routes:

- `/terms`: sparse product terms
- `/privacy`: privacy notes for account, behavior, reminder, export, import,
  and deletion data
- `/trust`: manual-status, account-isolation, portability, and reminder
  boundary notes

Implemented public marketing routes in the Astro site under `apps/marketing`:

- `/`: Cadence-led landing page that introduces BehaviorLog as the open
  portability standard
- `/faq`: frequently asked questions about product philosophy, privacy, time
  tracking, and BehaviorLog portability
- `/docs`: technical docs entry point for Cadence, BehaviorLog,
  machine-readable mirrors, and future docs structure
- `/examples`: sanitized sample bundle page
- `/about`: philosophy, governance, scope boundaries, and open-source posture

`/cadence` and `/standard` redirect to `/`; neither is a dedicated page.

Primary actions:

- Try Cadence
- Read BehaviorLog
- Download Example Bundle
- View on GitHub
- Log in

The site should be simple, static-first, and SEO-conscious. It should not tease
desktop/mobile apps before those surfaces are real or intentionally announced.
It also publishes `llms.txt`, `llms-full.txt`, Markdown mirrors, a public route
manifest, sitemap, and robots output for agents and crawlers.

## First-run onboarding flow

Public web launch includes a minimal onboarding path after Google login.

Steps:

1. Create first behavior.
2. Request browser notification permission.
3. Import data when import exists.
4. Point to Settings timezone confirmation when useful.

Onboarding should stay thin. It should reuse existing app controls and should
not become a broad setup wizard. The Timeline may show a dismissible first-run
setup pop-up while required setup items remain incomplete. The pop-up is fixed
over the page instead of appearing before the feed. Its actions route to:

- `/behaviors#create-behavior`
- `/settings#notifications`
- `/settings#timezone`
- `/export#behaviorlog-import`

Import is optional and does not block setup completion.
If browser notifications are denied or already blocked, that permission state
counts as a completed onboarding decision because the app cannot unblock it from
inside Cadence. The user can still use the tracker and may re-enable browser
reminders later from browser site settings plus Settings.

## App shell

The app uses a fixed retractable sidebar on desktop and a drawer on mobile.

Desktop behavior:
- Expanded rail is 16rem wide.
- Collapsed rail is 4rem wide.
- Main content shifts with matching left padding at large breakpoints.
- In the expanded rail, the Cadence mark and name link to Timeline, and a
  separate button collapses the rail.
- In the collapsed rail, the 64px brand cell becomes an expand-only button.
  Hovering it shows the expand icon, and activating it does not navigate.
- The desktop sidebar header does not draw a bottom divider.
- Navigation and account rows keep a fixed 64px icon/avatar column so expanded
  and collapsed icon positions match.
- Labels fade and collapse visually but remain in the DOM.
- The account row continues to open Settings. A quiet Sign out POST control
  sits directly below it; expanded desktop shows its icon and label, while the
  collapsed rail shows an icon-only cell with the accessible name and tooltip
  Sign out.

Mobile behavior:
- The collapsed rail is not used under 1024px.
- A sticky 64px top header opens a 60vw left drawer.
- The mobile drawer header does not draw a bottom divider.
- The drawer closes from backdrop click, Escape, the close button, a navigation
  click, or a left swipe.
- Edge swipe from the first 20px of the viewport opens the drawer.
- Focus stays inside the open drawer and body scrolling is locked.
- Sign out appears below the account row and closes the drawer when submitted.

Primary navigation:
1. Timeline
2. Behaviors
3. Export & Import
4. Settings

The default authenticated route is:
`/timeline`

The root route should eventually redirect authenticated users to `/timeline`.

Do not use `/dashboard` for the primary app screen.

Signing out reads the current browser PushManager endpoint when one exists,
submits it with POST `/auth/sign-out`, deactivates only that active endpoint for
the departing account, then ends the current Supabase session and redirects to
`/login?signedout=1`. This works for browser subscriptions created before the
sign-out endpoint field existed. A browser with no subscription still signs
out. A deactivation or sign-out failure leaves the session intact. Login
announces the focused polite status **Signed out.** Only the exact `signedout=1`
query value enables that notice; GET does not sign out.

Authenticated internal QA can open `/login?preview=1` in any environment to
inspect the login screen without ending the current session. The app shell
exposes **Preview login** only outside production. A normal `/login` request
continues to redirect an authenticated user to the safe `next` route or
`/timeline`.

Categories should not appear in navigation or timeline filtering.

## Timeline flow

The Timeline is the primary screen.

The current day should be visually prominent and should begin the forward timeline.

The Timeline feed starts directly with the current-day section. Do not show a
visible Timeline page title or explanatory helper copy above the feed. The
dismissible first-run setup prompt is a fixed pop-up for accounts that have not
completed required launch setup items, so it does not become feed content.

Timeline order:
1. Floating Needs decision button
2. Current day
3. Next 7 days
4. Additional future days when the user chooses to show more

Needs decision contains prior-day unresolved occurrences. It is not a general
past timeline. As a correction affordance, occurrences decided from Needs
decision, or otherwise resolved today while still belonging to a prior local
day, may remain visible in their original prior-day group through the current
local day. This retention is derived from status timing and does not store a
separate modal-origin flag.

The Needs decision button is fixed to the lower right of the Timeline screen, shows the current number of prior unresolved occurrences, and opens a modal with the grouped prior-day occurrences. On mobile, it spans the lower safe-area width as one bottom action.
The count and label sit on one continuous button surface without an internal divider.
The count includes unresolved prior-day occurrences only. It does not include
same-day retained rows that were already marked Completed or Not Completed from
the modal or another correction surface.
The open modal should not show a visible global Needs decision title or total
count. Its date groups are the visible structure and should start at the top of
the scroll area, with the close control pinned over the top-right corner. Each
group stretches to the same modal gutter on the left and right, shows the date,
then shows a count of unresolved items left to decide for that date. The date
header text may leave room for the overlaid close control.
When the unresolved count is zero but retained rows remain, the launcher should
clarify that the modal reviews decisions from today, and the date group should
state `None left to decide` without describing the past date as today.

Users should not browse previous days as ordinary timeline sections in v1.

Each day section should list active behavior occurrences by scheduled time.

When one behavior has multiple occurrences on the same local day, group those
occurrences together as a stack. The group is ordered by its earliest
occurrence, and each scheduled time or time range remains its own occurrence row
inside the group.

Do not show a "1 of 2 completed" label, progress fill, or stored partial status
for grouped behavior rows. Partial completion is only derived from the mixed
states of the individual occurrence rows. Completed, unresolved, and Not
Completed rows keep the existing single-occurrence visual treatments. Not
Completed rows continue to show both status actions without separate
current-choice styling, and each status action applies only to the occurrence
row where it appears.

If a day has no occurrences, show:

```text
No behaviors on this day
```

## Occurrence card flow

Collapsed unresolved cards show:
- Scheduled time
- Behavior title
- Completed text-link action
- Not Completed text-link action

Preset time ranges show their short label in collapsed rows, such as Morning or
Evening, rather than the full clock range.

Status text-link actions are underlined by default. All status action underlines use the same thin weight.

Collapsed occurrence rows are compact and unboxed. They should not draw a perimeter border around each behavior row. Rows keep a compact horizontal inset on both desktop and mobile.
On mobile, scheduled time, behavior title, and unresolved status actions share one horizontal row when the status actions are visible. Completed and Not Completed keep at least a 44px tap target and same-line labels; the scheduled time and behavior title may compact and truncate before those action targets shrink. Do not add a chevron or separate disclosure icon.

On mobile, pulling downward from the top of Timeline and releasing after a
clear threshold refreshes Timeline data once. A short pull, horizontal drag,
or drag that begins below the top continues normal scrolling and causes no
refresh or occurrence mutation.

Collapsed Completed cards show:
- Scheduled time
- Behavior title
- Resolved status

Collapsed Not Completed cards show:
- Scheduled time
- Behavior title
- Resolved status

Completed cards should have a distinct visual state and should hide the primary status actions.

Not Completed cards use the red accent treatment, show Not Completed as the
collapsed status, and hide primary status actions like Completed cards. The
stored status remains `not_completed` on that occurrence instance, and the UI
must not call it missed or failed.

Clicking a card outside the status actions expands it.

Opening a resolved card keeps its Completed or Not Completed label in the
summary row, horizontally parallel to the behavior title. Expanded details
flow below that row and do not move the resolved status label downward.

Expanded cards keep their detail content inside the native disclosure element
and show:
- Description
- Category
- Schedule details
- Track time
- Note field
- Option to change a Completed or Not Completed status

Expanded details sit on the normal page background without a top divider. The
detail block has a small left inset. Spacing should be measured optically
between rendered text and field edges: the largest gap is between the collapsed
row content and the first detail label and should measure 20px optically. The
next-largest gap is between detail pairs, and the smallest gap is shared by
detail label/value, Note
label/textarea, and textarea/Save note relationships. The note save action is
an underlined text action, matching the Completed and Not Completed controls.
An expanded occurrence holds the same blue background used on row hover, rather
than adding a separate details box.

Every explicit status mark, correction, Unmark, or Clear decision updates the current
occurrence snapshot and appends one status-history event atomically. Repeating
the already-current resolved choice does not create a duplicate event. Saving a
Note without a status change preserves both status timestamps and status
history.

Each status submission carries the rendered status. A stale submission is
rejected and refreshes the owning view so the row shows the server's current
status. Status controls for one occurrence remain disabled while its request is
in flight. Each Note save carries the previously loaded Note value; if another
tab changed it first, Cadence reports a conflict instead of overwriting it.

When browser audio is available, one successful user-initiated transition to
Completed plays one completion chime. The mobile touch sequence and the later
Timeline refresh must not repeat it. Not Completed, note saves, refreshes, and
re-saving an already Completed occurrence remain silent.

### Track occurrence time

For a current-local-day occurrence or a visible Needs decision occurrence of an
active behavior, expand the row and choose **Track Time**. Cadence persists a
session before the counter begins, so a refresh restores a running session.
Choose **Stop** to persist its end. The shown total includes all stopped sessions
for that occurrence. A later **Track Time** creates another session. **Reset
tracked time** removes every session, including a running one, with no
confirmation.

The idle and stopped states show one underlined **Track Time** action without a
duplicate heading. While a session runs, **Track time** becomes a static,
non-underlined label above the counter, Stop, and Reset tracked time controls.

Start is unavailable for future local dates, archived behaviors, and prior
resolved occurrences no longer retained in Needs decision. Stop and reset remain
available after midnight for an earlier valid start. None of these controls
marks a status, changes a note, affects adherence, or changes reminder
eligibility. The counter is display-only; saved duration always uses server-side
persisted instants.

BehaviorLog imports may fill this occurrence Note field only when an accepted
import plan identifies the target occurrence safely, the imported note is not
AI-generated, and the local note is empty. Imported behavior notes,
status-event notes, review notes, and conflicting occurrence notes are stored as
passive imported-note records instead of product notes on Timeline or
Behaviors. Imported notes are user-review context only; they do not change
status, adherence, analytics, or reminder behavior.

Categories are visible only in expanded card details.

If an occurrence is unresolved after the end of its local day, it appears in the Needs decision modal and is visually highlighted. This is a derived UI state based on date and `unresolved`; it must not write a different stored status.

When a prior-day occurrence is marked Completed or Not Completed today, the row
should remain available in the modal until the next local midnight in the user's
timezone. It should stay in its original local-day group rather than moving into
a separate recent-decisions section. Completed rows keep the same blue resolved
treatment as Timeline rows. Not Completed rows use the same resolved-row
structure with the red accent treatment and Not Completed label. Expanding
either resolved row exposes status correction and Note editing. After the next
local midnight, these retained resolved rows no longer appear in Needs decision.

## Behavior flow

The Behaviors screen is the primary behavior object surface. It shows active
behaviors first as compact unboxed records separated by quiet divider lines,
with behavior setup metadata and range-based behavior review in the same row.
Behavior description text appears in the record as a labeled Description block
without local divider lines. Occurrence-specific text remains a Note.

Behavior create/edit is accessible from the Behaviors page. When behaviors
already exist, creation is opened from a simple in-page disclosure so the
existing behavior ledger stays primary. When no behaviors exist, the creation
disclosure may open by default.

Behavior form fields:
- Title
- Description
- Category
- Schedules
  - Recurrence pattern per schedule
  - One or more exact times or time ranges per schedule
- Browser notifications enabled
- Email reminder enabled
- Reminder offset
- Active/archive

At least one schedule and one time entry are required. Add time keeps the user
inside the same recurrence pattern. Add schedule creates a new recurrence
pattern. Behavior-level reminder settings apply to all generated occurrences in
v1.

Cancel discards the complete unsaved behavior draft and restores the values
present when the create or edit form opened. This includes recurrence details,
schedule and time rows, exact times or ranges, reminder choices, and active
state.

An edit save includes the Behavior revision loaded with the form. If another
tab changed the Behavior first, Cadence rejects the stale save, keeps the draft
visible, and offers to reload the current Behavior. The draft remains visible
until the user deliberately chooses Reload behavior.

The recurrence editor should use segmented presets first, with advanced options below.

Archived behaviors appear in a separate low-priority bottom disclosure and do
not appear on the timeline. Archived behaviors can be restored from that
section.

Archive and Restore save the behavior active-state change and a durable
occurrence/reminder stale marker in one transaction. If either write fails,
both roll back. Once the transaction commits, immediate reconciliation is
best-effort and a failure remains available for background retry through the
saved marker.

The per-process Behavior read cache uses a 60-second TTL. Invalidation prevents
an older in-flight read from writing stale data back into that process. Cache
invalidation does not cross Vercel instances, so the TTL remains the
cross-instance staleness bound.

Active behavior rows keep Archive behavior at the end of Details and Settings
so the collapsed row remains focused on review metrics and the behavior
calendar.

Categories are edited in Settings.

The Behaviors screen distinguishes two edit modes:

- Behavior settings edits change the recurring behavior definition, schedule,
  category, description, and reminder settings.
- Behavior date review revisits or corrects a specific dated occurrence record.
  It shows Date of behavior, Time of behavior, Status, and Note as plain rows.
  Date and time are display-only in this review path.

## Reminder flow

Browser notifications are enabled by default for every behavior.

Browser notification permission is requested from Settings through a control that triggers the browser permission prompt.

Email reminders are disabled by default and can be enabled per behavior.

Behavior-specific reminder settings live on the behavior create/edit page.

V1 does not need a test notification button.

## Behavior review flow

Behavior review on the Behaviors screen defaults to the last 30 days.

Show overall adherence at the top.

The overall calendar is part of the Overall adherence area rather than a
separate boxed section. The date range selector sits directly above the
overall calendar, the selected date range appears under the adherence
percentage in compact month-day wording, and the legend is vertically listed
to the right of the calendar on desktop.

The top summary Unresolved count should match the Timeline Needs decision
count, so it includes only active unresolved occurrences before the current
local day, regardless of the selected Behaviors range.

Show a completion-intensity calendar heatmap for overall adherence. A fully
completed day uses the full completed color; partial completion uses a lighter
blue proportional to the completed share; days with resolved occurrences but
no completed occurrences use the red accent treatment.

Show behavior-level Completed and Not Completed counts plus calendars inside
each active behavior row. Unresolved remains visible through neutral heatmap
and behavior date review states, but not as a behavior or category count row.

When the selected 7, 30, or 90-day range contains recorded timing for a
behavior, show one compact Average tracked time row. Sum stopped sessions per
occurrence before averaging timed occurrence totals. Do not count untimed or
running-only occurrences, and do not show a placeholder when no recorded total
exists.

Each behavior count row shows when that behavior started being tracked. When
the tracking start day is within the selected range, the behavior calendar marks
that day.

For behaviors that occur more than once in a day, represent full completion, partial completion, and not completed day states.

The user should be able to select a non-empty cell in a behavior calendar and
review that behavior's occurrences on that day inside the selected behavior
row. The overall calendar remains a passive adherence summary. Behavior date
review is the deliberate later correction path for submitted occurrence
decisions after the Needs decision same-day retention window has passed.
Actionable behavior calendar cells should make that path clear through labels
or titles such as "open day review" while empty cells remain passive.

Behavior date review should:
- Use an explicit heading such as Review selected day.
- Show that behavior's occurrences for the selected local date when rows exist,
  not only Not Completed occurrences.
- Show occurrence details as plain Date of behavior, Time of behavior,
  conditional Tracked time, Status, and Note text. Stopped time shows its total;
  running-only time shows In progress; both states show both labels.
- Keep status corrections behind the per-occurrence Review disclosure. A
  resolved occurrence can use Clear decision there to return to Unresolved;
  an expanded, just-decided Timeline occurrence uses Unmark for the same
  correction. Needs decision does not expose either as a global action.
- Display empty notes as italic No note.
- Hide correction controls behind a per-occurrence Review disclosure until the
  user chooses to review that occurrence.
- Allow individual Completed and Not Completed corrections through the same
  status service used by Timeline.
- Allow occurrence Note edits.
- Allow Reset tracked time inside the existing Review disclosure when timing
  data exists. Reset deletes that occurrence's timing sessions and refreshes
  timing context without changing Status or Note.
- Refresh Behaviors counts, adherence, heatmaps, and behavior date rows after a
  correction.
- Avoid internal divider lines that visually compete with the behavior-row
  separators.
- Avoid an empty review panel when the selected behavior day has no occurrences.
- Avoid bulk edit, all-time search, automatic suggestions, AI coaching, or
  gamified language.

Category-level counts can appear as a compact secondary section.

## Export & Import flow

The `/export` screen is labeled Export & Import. It supports:
- JSONL
- CSV
- Full JSON backup
- BehaviorLog bundle
- Markdown AI summary
- BehaviorLog bundle import

Exports should support download and copy where practical.

The AI summary should be downloadable as `.md`.

Export options:
- Last 7 days
- Last 30 days
- Last 90 days
- All time
- Include archived behaviors
- Include occurrence notes, off by default
- Include time tracking, off by default

Full JSON and BehaviorLog include behavior definition and configuration history
by default for the Behaviors in the export. Configuration history covers
schedule graphs, reminder settings, category, timezone, and active state. This
is not a separate option. Before download, the screen explains that historical
definition and configuration can contain sensitive context. The Markdown
summary reports history counts and gives segmentation guidance without causal
or clinical claims. JSONL and CSV remain unchanged current snapshots.

Behavior definition and configuration events follow Behavior inclusion rather
than the selected Occurrence date range. A 7, 30, or 90 day export therefore
includes both complete trails for each included Behavior, ordered by
`recorded_at`, then `id`. Excluding archived Behaviors also excludes their
history events.

BehaviorLog uses captured configuration lineage to segment schedule periods.
Import and restore do not replay revision events. They create only the retained
current graph and preserve historical Occurrences with non-generating detached
schedule snapshots, including status and note relationships.

Time tracking is omitted unless **Include time tracking** is selected. Its exact
timestamps can reveal activity patterns. With the option selected, each format
includes only sessions for occurrences already in the applied range and
archived-behavior scope. Import and restore validate the optional Cadence timing
file and hash, but do not replay its sessions.

BehaviorLog import flow:
1. Upload a `.behaviorlog.zip` bundle from the Export & Import screen. Cadence
   authenticates the account before archive extraction and rejects bundles
   that exceed its parser-side entry-count, extracted-size, compression-ratio,
   or 2 MB compressed-size limit. The UI checks `file.size` before submission,
   and the server repeats the same check with the factual error **This file is
   larger than the 2 MB limit for BehaviorLog bundles.**
2. Review validation errors, warnings, conflicts, privacy notes, note
   sensitivity warnings, intervention preview counts, passive imported
   intervention storage counts, dropped/redacted intervention field summaries,
   unsupported field counts, imported-note record counts, inline
   occurrence-note fill counts, and merge actions.
3. Apply create-only import only when the dry-run is valid and has no unsafe
   merge decisions.
4. Apply a merge plan only when all actions are supported safe actions and the
   user explicitly confirms the write from the exact accepted persisted
   `merge_preview` run.
5. Confirm high or restricted note sensitivity separately when those notes would
   be imported.
6. On apply, the base64 archive travels once in the form. The server recomputes
   its SHA-256 and compares it with the raw-archive fingerprint retained from
   the accepted preview, then re-parses and verifies the preview-run identity
   plus matching bundle, local-data, and combined preview fingerprints. It
   rejects stale, altered, mismatched, or unaccepted preview data and requires a
   fresh preview instead of recomputing a replacement plan silently.
7. Review recent import runs for status, mode, timestamps, failure message, and
   the accepted preview relationship when present.

The import area states that definition revision events are export-only in this
release. Import and restore validate the optional Cadence file through the
manifest but use only the current title and description snapshots from
`data/behaviors.jsonl`; they do not apply the revision trail. The user should
retain the source export when that history must remain portable.

The import flow must not add full restore, destructive overwrite, generalized
notes browsing, or intervention-to-reminder writes during preview/apply.

BehaviorLog restore preview flow:
1. Parse a trusted `.behaviorlog.zip` backup through the restore preview
   service.
2. Review which records would be created, replaced, archived, deleted, kept, or
   skipped across behaviors, schedule slots, occurrences, status events, inline
   occurrence notes, passive imported notes, and passive imported interventions.
3. Review non-restorable fields: auth identity, profile email, browser
   permissions, push subscriptions, provider accounts, provider secrets, and
   external provider state.
4. Review sensitivity and redaction warnings before any future destructive
   apply flow.

Restore preview is read-only. A later restore apply flow must require the
accepted preview fingerprint, fresh-backup acknowledgement, typed confirmation,
sensitivity acknowledgement when relevant, and stale-preview refusal before any
destructive write.

BehaviorLog restore apply flow:
1. Start from a valid restore preview on the Export & Import screen.
2. Confirm that a fresh backup was created or downloaded.
3. Type `RESTORE`.
4. Acknowledge high or restricted note sensitivity when the preview contains
   those notes.
5. Submit apply. The server re-parses the bundle, re-gathers the current local
   graph, verifies that its raw SHA-256 matches the accepted preview, and
   refuses the apply if the archive, preview, or local-data fingerprint is
   stale.
6. Review the applied or failed restore run in Restore history.

Restore apply can archive, replace, or delete behavior data according to the
accepted preview. It does not restore account identity, profile email, browser
permissions, push subscriptions, provider accounts, provider secrets, or
external provider state, and it does not call reminder providers.

Imported intervention promotion is separate from the Export import apply flow.
When exposed, it must require explicit selection of stored
`imported_interventions` rows and a separate confirmation before any operational
`reminder_deliveries` rows are created or linked. It should not be added to the
Export & Import screen unless a scoped UI ticket calls for it.

## Desktop first account link

After Google authentication, Cadence reads one typed local portability snapshot.
An untouched seeded profile with the exact default categories hydrates from the
account without a choice. Recognized product data, history, profile/category
changes, or import provenance requires Import local data into the account or
Ignore local data and use account data. Cancel removes the incomplete link and
changes neither copy. Ignore first creates and verifies an owner-only protected
backup and shows its exact path. An irreconcilable preview moves to conflict
review; Cadence never silently chooses a copy. The common baseline advances only
after hosted commit and local atomic apply succeed. Retry reuses the same
first-link identities. First automatic hydration preserves pre-existing hosted
same-status status-event branches without rewriting them. Divergent-status,
local-only, cross-copy, and post-baseline branches remain invalid.

## Desktop conflict review and disconnect

When the planner emits a mutable-row conflict, Cadence pauses the entire plan
and keeps a shell cue visible. Settings shows both values. The user selects the
account or Mac version for every item and applies the decisions. Cadence rereads
the baseline, local, and hosted fingerprints. A changed fingerprint rejects the
review without writing either copy. Invalid append-only collisions and new
branches stop before review; the first-hydration compatibility case above is the
only branch exception. One-sided protected-row deletion repairs from the
retained copy.

The user can disconnect after a normal, expired, or revoked session. Keep a
local copy removes Keychain secrets and account-link state, retains product
rows, and shows the live database path. Remove account data requires typed
`REMOVE`, creates a protected backup, clears the linked working copy, seeds a
fresh local profile, and shows both paths. Hosted data remains unchanged. Native
raw restore checks SQLite link state and remains blocked until disconnect.

## Settings flow

Settings includes:
- Profile/email from Google sign-in when available
- Timezone
- Current-device browser notification status
- Current-device browser notification enable control
- Global email notification setting if needed
- Lightweight category editing
- Trust, Privacy, and Terms links
- Account deletion

Timezone detection uses the browser/OS timezone reported by `Intl.DateTimeFormat().resolvedOptions().timeZone`; it does not request location permission.

The user can apply the detected timezone or manually enter an IANA timezone.
Saving commits the profile timezone, every active Behavior timezone,
configuration history, and one stale sync marker in one owner-scoped database
transaction. A failed write leaves those values unchanged. Future unresolved
Occurrence sync runs afterward and remains rerunnable; past and resolved
Occurrence history stays unchanged.
The Settings UI should state this impact before submit so the user understands
that future unresolved rows change while past and resolved history does not.

When the user clicks Enable notifications on this device, Settings requests
browser notification permission if the browser still allows prompting, then
saves the current browser's push subscription after permission is allowed. If
the browser reports notifications are blocked, Settings shows the blocked state
and persistently asks the user to allow the origin in browser or site settings
before returning. A Refresh this device action remains available after reload
so the user can re-check delivery readiness. If the initial subscription check
fails, Settings settles into a factual not-enabled state with a retry action;
first-run setup likewise remains available instead of hanging or disappearing.

Account deletion requires the signed-in user to acknowledge the export reminder
and type the account email, or `DELETE` if no email is available. The server
constructs and verifies the server-only service-role client first. It then
hard-deletes the Supabase auth user, relies on database ownership cascades to
remove hosted Cadence records, and attempts global sign-out for current-browser
cleanup. Validation, service-role verification, and deletion failures leave the
account and session intact so Settings can show a recoverable error. A
post-deletion sign-out error does not turn completed deletion into a recoverable
failure. On success, Login focuses and announces the `Account deleted.`
confirmation reached by the deletion redirect. Auth deletion removes server
session rows and refresh capability. An already-issued access-token JWT can
remain valid until its expiry.
The client should mirror those gates by disabling the destructive submit until
the acknowledgement and exact typed confirmation are present; the server still
enforces the same requirements.

Do not include destructive data actions in v1 except explicit account deletion
and dedicated BehaviorLog restore work. Restore preview is read-only; restore
apply requires its own explicit review, confirmation, and stale-preview gates.


## Category controls (Tickets 123–124)

Settings category management uses the shared CategoryPanel on web and desktop.
Deletion requires reviewed active/archived counts and preserves all Behavior history.
Behaviors filtering and sorting preserve mounted drafts and account-wide analytics.


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

## Note shortcuts (Tickets 126–128)

Enable Note shortcuts in Settings, then opt in inside one Behavior's settings.
Choose Find repeated Notes. Review each proposed text, optionally edit it, then
Accept or Dismiss. Only accepted text becomes a quick-fill button. Edit/Remove
remains available in Behavior settings. Remove erases shortcut text and suppresses
that pattern for 90 days; it leaves saved Notes unchanged.

Open any supported Occurrence Note form. Select a shortcut to fill an empty
draft or append a new line. Review the draft and choose Save note. Cancel leaves
historical Notes unchanged. A stale save retains the existing conflict behavior;
a shortcut inserted during a pending save remains in the draft afterward.
Global off hides quick-fill/proposals and stops analysis. Re-enabling retains
accepted text. Offline desktop follows the same flow with local data. Linking an
account synchronizes shortcut state but never grants cloud analysis consent.

### Desktop repair and update review (Tickets 129–131)

Startup repairs oversized reminder receipts before opening local tracking. Settings
shows verified storage totals and an acknowledged deletion action for the recovery
backup. Dependency-safe account synchronization preserves linked-account metadata.
Automatic update downloads present inline review without replacing an open editor.
Installation and restart require separate actions. Unsaved drafts require saving
or explicit discard; pending writes prevent restart. Web and marketing expose no
native update or recovery controls. Future mobile remains deferred.


## Set duration and scheduled archive (Tickets 142–143)

Create or edit a Behavior, optionally enter Default duration (minutes) and End date, then Save behavior. Blank fields disable either option. Timeline uses the default ahead of its measured estimate. The Behavior stops generating Occurrences at the start of its end date in its timezone. Automatic archive uses existing archive history and reminder cancellation; a durable in-app notification explains the archive. Open Behaviors to review or restore it. Restoring clears an expired end date.

## Compare historical completion timing

Open the briefing workbench, select Historical completion times, and set History
days. Optionally change duration controls independently. Select Run comparison
explicitly. Inspect selected completion-mark summaries and exclusion reasons.
The user alone runs private My account comparisons. Saving a synthetic draft does
not promote it into the daily configuration. Legacy drafts load with timing disabled.
