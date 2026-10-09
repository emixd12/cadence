# UI Spec

## Design direction

Sparse, clean, checklist-like.

The app should feel like a personal cockpit, not a productivity platform.

Cadence is now a public product, but the authenticated app should not become
marketing-heavy. Public explanation, SEO content, standard adoption, and GitHub
links belong on the sibling Astro marketing site. The app remains direct and
work-focused after login.

Avoid:
- Dense dashboards
- Gamified streaks
- Social language
- Motivational copy
- Excessive modals
- Productivity-app sprawl

## Primary navigation

Use a fixed retractable sidebar on desktop and a drawer on mobile.

On desktop, the sidebar remains fixed while page content scrolls. Expanded
width is 16rem. Collapsed width is 4rem. Width changes animate over 200ms, and
the main content uses matching large-breakpoint left padding so content never
sits underneath the fixed rail.

The desktop sidebar uses a stable 64px icon column in both states. Header,
navigation, and footer account rows keep icons or avatar centered in that
column. Navigation and footer labels remain in the DOM and collapse visually
with `opacity-0`, `pointer-events-none`, `w-0`, and `overflow-hidden`; expanded
labels use `opacity-100` and `whitespace-nowrap`.
The desktop sidebar header does not draw a bottom divider. In the expanded
rail, the Cadence mark and name link to `/timeline`, and the collapse control
stays separate from the brand link. In the collapsed rail, the same 64px cell
becomes an **Expand navigation** button with no navigation side effect.
Hovering that button swaps the Cadence mark to the open-sidebar icon. Brand
links use a 70% opacity state on hover and press.

Expanded navigation applies hover and active treatment to the whole row.
Collapsed navigation applies hover and active treatment only to the 64px icon
cell so the rail feels like square targets. The active route uses the Timeline
row hover fill with foreground text. Inactive hover uses the Surface fill.
Primary navigation rows should be flush with no gap between row containers.
The footer account region keeps the account row as a link to Settings. Directly
below it, render a quiet Sign out POST control with the same text and hover
treatment: icon plus label in the expanded desktop rail and mobile drawer, and
an icon-only cell with the accessible name and tooltip Sign out in the
collapsed desktop rail. Submitting from mobile closes the drawer.

The native desktop account row uses the same 60px height, square 32px initials,
64px icon column, and display-name typography. A signed-in session supplies the
name, falling back to email and then Account. The row opens desktop Settings
in expanded, collapsed, and narrow navigation. Local mode keeps Local profile.
Desktop disconnect remains in Settings with Keep a local copy and Remove account
data choices; the web-only Sign out POST control does not apply to desktop.

On mobile, do not use the collapsed rail. Use a sticky 64px top header that
opens a left drawer. At the top of a page, the header does not draw a bottom
divider; as the page scrolls, a 1px Ash Line divider fades in over the first
short scroll distance so sticky-header separation appears only when content is
moving underneath it. The Cadence mark and name in the sticky header and drawer
header link to `/timeline`; the hamburger button remains the drawer opener. The
brand link uses a 70% opacity state on hover and press. The drawer is 60vw wide,
max 60vw, and closes from its backdrop, Escape, the close button, navigation, or
a left swipe. Opening from the first 20px viewport edge is supported. While
open, the drawer traps focus and locks body scrolling. A narrow drawer shadow
is allowed for separation from the backdrop. The mobile drawer header does not
draw a bottom divider.

Use four primary screens:

1. Timeline
2. Behaviors
3. Export & Import
4. Settings

The Timeline screen is the default screen after login.

Route:
`/timeline`

Categories should not appear in navigation or timeline filtering.

Behaviors, Export, and Settings may start with the shared decorative page
banner image as a full app-content-width banner. It may have a tiny top inset,
but should not add bottom margin. Timeline keeps its own decorative image
treatment and hides its visible page title so the current day remains first in
the feed.

## Public marketing site

The marketing site uses Cadence's existing product voice and design tokens, but
it is a separate Astro shell under `apps/marketing` rather than part of the
authenticated app shell.

Launch marketing routes:

- `/`
- `/faq`
- `/docs`
- `/examples`
- `/about`

`/cadence` and `/standard` remain compatibility redirects to `/`, not
dedicated marketing pages.

Primary calls to action:

- Try Cadence
- Read BehaviorLog
- Download Example Bundle
- View on GitHub
- Log in

The marketing site should be SEO-conscious with semantic content structure,
metadata, canonical URLs, social preview metadata, sitemap/robots support, and
fast static pages. It also exposes `llms.txt`, `llms-full.txt`, Markdown
mirrors, and a public route manifest for agents. Do not add heavy client-side
marketing interactions unless a specific page needs them.

Cadence should lead the homepage as the product and site brand. BehaviorLog is
the open bundle standard and portability layer behind Cadence exports and
imports. Keep the existing Cadence mark, use the square ledger visual system,
and show only the Cadence logo and name plus Log in in the marketing header.
About and FAQ belong in the footer. Docs and Examples remain direct or in-page
links rather than top navigation links. Marketing header links use the same
underlined text-action convention as content buttons, without a divider under
the header. The persistent Log in action uses the same primitive with stronger
weight to distinguish it from the route links.

No public design-system page is launch scope. `/design-system` remains
dev-only.

## Timeline screen

This is the main screen.

Tickets 133–136 implement a continuous day-progress line on web and desktop.
`components/timeline/DayProgressTimeline.tsx` renders the shared production
surface. The line sits left of the ledger and spans complete visible local days.
Item-only clock labels and one blue dot show temporal position. Behavior rows
retain their typography, status colors, Notes, and manual controls. Desktop
keeps action text while it fits. Narrow layouts use accessible icon actions and
44px targets.

The layout uses one axis. Calendar markers use centered perpendicular stems
without axis nodes. Behavior rows have no axis-facing ticks or nodes. Exact
original start instants can group in one Calendar lane. Nearby starts stay
separate. Collision spacing can move a control for readability, but its label,
details, and duration retain the actual time. The current future-day range,
**Show more days**, and **Needs decision** rules remain unchanged. Day rollover
removes past sections from the forward view, not stored records.

Each timed event gets one marker at its start, or on the first visible day if it
started earlier. Later days retain duration segments without repeated markers.
Drawers fit their content with 16px padding and reserve only their rendered height.

All-day controls are absent when the day has no all-day events. Otherwise they
show “All day: {first event title}”, with “+N more” for additional visible events.
Dismissed events retain a Restore control. Hover, focus, click, and tap open the
same persistent preview. The preview has no repeated heading or divider. Each
event owns a View details button that opens only that event in the centered details
modal. Closing details returns focus to the original timeline control.
Keep timed Calendar context left of the axis and the ledger exclusively right.
Use 12px restore-action padding on narrow layouts and 16px on desktop. Align day
headers with the ledger while the axis continues through every header and day.
Place **All Day Events** beside the day title. Do not add a right-side all-day
column. The control can wrap on a narrow screen.

The layout uses piecewise interpolation between measured item anchors and
local day boundaries. Readable spacing takes precedence over proportional
scale; the presentation must disclose compressed spacing. A timed-event hover/
focus preview shows duration as a temporary solid 1px magenta axis segment and can
highlight overlapping Behavior rows. An overnight continuation starts at the
next day section and ends at the event's mapped end. It adds no second marker or
stem. No permanent duration bar appears. All-day events retain date-only meaning.

Optional Calendar context uses the same Google identity as the Cadence account.
`components/settings/GoogleCalendarPanel.tsx` provides explicit connection,
calendar selection, visibility, refresh, reconnect, and disconnect controls.
Calendar selection uses one collapsed multi-select field with wrapping selected
name tags. Expanding reveals a searchable, scroll-bounded native checkbox list;
selected entries retain per-calendar Timeline visibility. Escape closes the list
and returns focus to its summary. Changes remain drafts until Save Calendar
settings. Refresh Calendar reloads discovery even without saved selections.
Display names prefer Google's per-user override and retain stable calendar IDs.
The panel shows a factual unavailable state when the deployment lacks Calendar
OAuth configuration. Desktop shows an unavailable build state when it lacks a
valid HTTPS broker origin. Account-free desktop mode has no Calendar controls.

Hover, focus, click, and tap open the same fixed bottom non-modal preview. The
preview persists until dismissal or replacement. It reserves only its rendered
height, has 16px inner padding, and caps at `min(18rem, 40dvh)`. It scrolls
internally when needed. Hover does not move focus. **View details** opens one
event in a centered details modal. Close or Escape returns focus without reopening
the preview. A validated source link can open the event in its source app.

The preview close icon aligns with the first event title and keeps a 44px target.
Expanded details use a centered native dialog, at most 40rem wide with 16px
viewport clearance and internal scrolling. Only the preview reserves bottom space.
Google Calendar markers show the bundled provider icon. The healthy Calendar
current label is hidden; stale, incomplete, and failure information stays visible.

All-day controls appear only when the day has visible all-day events. They show
**All day: {first event title}** and **+N more** when needed. Dismissed items
retain **Restore**. Dismissal and restore change local presentation only. They
never delete a Google event or write a Cadence status. The UI distinguishes no
selection, no events, not loaded, incomplete, stale, and refresh failure.

The current-time dot updates once per visible minute without SVG interpolation.
It stops recurring work on blur/hide and refreshes on return.
The current-time dot uses brand blue and does not tint a row. No persistent overlap fill or edge appears. Hover/focus changes only overlapping
Behavior borders to the owner-selected Poline facet `#DA3278`. Point
Behaviors overlap only when `start <= activation < end`; estimated-duration
Behaviors use half-open interval overlap. Completed and Not Completed fills stay
unchanged. Preserve all other layout, colors, and typography.

Ticket 136 implements conditional duration estimates and possible-overlap cues.
Scheduled/estimated activity must remain distinct from an actually running
timer and from manual Completed/Not Completed status. No automatic schedule
changes occur. Missing history remains unknown. Stale, incomplete, or unavailable
Calendar data cannot establish availability. All-day events never create timed
overlap warnings.

The implementation references appear in `interaction-registry.json` as
`INT-CALENDAR-001` through `INT-CALENDAR-007`. The connector stays unavailable
for real provider use until deployment configuration and live OAuth acceptance
pass. Local component and fixture tests do not establish native or live release
acceptance. See `docs/qa/day-progress-release.md` for the remaining gates.

Travel extension (Tickets 162–165; deployment-gated): reuse the existing
magenta span and overlap borders for derived outbound, event, onward and return
occupancy. Keep the Calendar marker at its scheduled start. A 2:30–4:30 event may
highlight 1:30–6:30 and identify travel-created Behavior conflicts. The shared
occupancy evidence drives Timeline overlap. Advisor projection stays disabled pending
provider-use and model-disclosure clearance.
Retain all known outbound and event-to-event spans and collisions without a base;
only the final return remains unknown. Do not show complete-trip availability from
a partial itinerary.

Use the existing bottom preview and details dialog for departure, mode, event time,
return/availability, assumptions and freshness. Label travel-created conflicts in
text. Preserve hover/focus/tap/click behavior, keyboard access, 44px targets,
left-side Calendar context and the right-side ledger. Add no separate travel lane
or permanent duration fill. Unknown timing never creates a precise occupied span.

Show available Calendar location text with Google Maps or a supported preferred
navigation link. Unresolved addresses can offer Search in maps without claiming a
verified route. Put optional Behavior location in the existing Behavior form.
Travel setup explains automatic routing and the optional base. Current position
is the default immediate origin, ahead of a predicted scheduled position. When
location is unavailable, request a base for that origin. Missing base withholds
only final-return advice; current-location-to-event and event-to-event advice
remain available for usable points. Never insert a base detour automatically.

Implementation references: `components/timeline/DayProgressTimeline.tsx`,
`components/timeline/ExternalEventDetails.tsx`, the existing Behavior form and
`components/settings/TravelSettingsPanel.tsx`. The interaction registry contains
`INT-TRAVEL-001` through `INT-TRAVEL-003`; the existing bench includes complete-trip
and no-base fixtures. Installed acceptance remains in `qa/travel-release.md`.

The current day should be prominent and should begin the forward timeline.

Do not show a visible Timeline page title or explanatory helper text above the
feed. A decorative transparent Cadence horse-line-and-dot image may sit
directly above the feed with no extra top or bottom margin and span the full app
content width; the first Timeline day section should still be the current-day
section.
Implemented exception under revised Tickets 146–148: the horse also anchors a daily
briefing text bubble when the app first opens. The user can dismiss or ignore it.
The bubble must not block tracking, steal focus, or require acceptance of its text.
Preserve IBM Plex Sans, square corners, current spacing and Timeline hierarchy.
Use accessible dismissal, polite completion announcements, responsive wrapping,
nonblocking loading/error states and reduced motion.
`docs/plans/first-external-consumer.md` owns daily invocation and freshness rules.
`docs/qa/in-app-daily-brief.md` separates source/browser checks from live release gates.
The image remains decorative; the briefing text and dismiss control are semantic.
Returning focus revalidates the account, local date, timezone, and disclosure settings.
An unchanged context preserves loading and ready text. Pending generation keeps
Try again available without polling.

Optional first-run setup appears as a dismissible pop-up so it does not push the
feed down while required launch setup items remain incomplete.

On mobile, a downward pull that starts while the Timeline is already at its
top should refresh the current Timeline data after the user crosses and
releases a clear pull threshold. One completed pull should cause one refresh.
Short, horizontal, or below-the-top drags should preserve normal scrolling and
must not refresh or mutate an occurrence. This is an online refresh interaction,
not offline/PWA caching or an offline mutation queue. Desktop upward overscroll
at the top follows the same deliberate threshold and one-request guard. Both
clients reload Cadence and connected Calendar data. Show temporary completion
feedback only after successful reads; report partial failure and preserve data.

### First-run setup

The first-run prompt is a fixed, non-modal pop-up shown on Timeline only while
required setup items remain incomplete and the user has not dismissed it in the
current browser. It should:

- Sit below the sticky mobile header on narrow screens and remain scrollable
  when the setup rows exceed the available height.
- Link to the existing create-behavior, notification, timezone, and import
  controls.
- Treat import as optional.
- Never request notification permission on page load.
- Use compact list rows, quiet dividers, and factual state labels such as Done,
  Not enabled, Blocked, Confirmed, Review, and Optional.
- Provide a Skip setup control.
- Avoid motivational copy, progress gamification, an inline takeover, or a
  wizard.
- Treat a denied or blocked browser notification permission as a completed
  onboarding decision while still showing the factual Blocked label when the
  prompt is otherwise visible.

Users should not browse previous days as normal timeline sections. Prior
unresolved occurrences appear only in the Needs decision modal, with one narrow
exception: prior-day occurrences resolved today may remain visible in that
modal through the current local day so the user can correct an accidental tap.

Timeline access:

### Needs decision

Unresolved occurrences before today.

Needs decision is a derived UI state, not a stored occurrence status.

Needs decision should not interrupt the forward Timeline flow. It is opened from a floating button fixed to the lower right of the Timeline screen.

The floating button should:
- Show the number of prior unresolved occurrences.
- Use the reserved fixed-action treatment when there is at least one occurrence to decide.
- Remain factual and non-punitive. Do not use error styling or missed/failure language.
- Use one continuous surface without an internal divider between the number and text.
- On mobile, span the lower safe-area width as one bottom action so it stays easy to reach without covering the feed.
- Open a modal that reveals all prior unresolved occurrences grouped by local day.

The open modal should be led by the day feed, not by a global title or global
count. Keep the close control pinned over the modal's top-right corner without
reserving a header row; the first date group should start at the top of the
scroll area. The scroll area should keep equal left and right gutters to the
outer modal container; only the date header text row may reserve space for the
overlaid close control. Each date group should show the local date first, then a
line with how many unresolved occurrences are left to decide for that date. Date
groups use the normal white background rather than a grey container.

After the user resolves a prior-day occurrence, that row should remain in its
original local-day group until the next local midnight in the user's timezone
when its `status_marked_at` falls on the current local date. This retention is
derived from existing status timing and applies to any prior-day occurrence
resolved today; do not add a stored modal-origin flag. Do not move retained
rows into a separate "Decided just now" or similar section. Completed rows keep
the same full blue Completed state used on Timeline rows; expanding the row
exposes Change status and Note editing. Not Completed rows keep the same
resolved-row behavior as Completed rows: full red accent treatment, a collapsed
Not Completed label, and status correction from the expanded row. The Needs decision count
continues to count unresolved prior-day occurrences only, not retained decided
rows. When there are no unresolved rows but retained decided rows still exist,
the button may still open the modal with a zero count and should clarify that
the modal is reviewing decisions from today. Date groups with retained rows and
zero unresolved items should say `None left to decide`, without calling the
past group today. Retention
must be derived from existing occurrence status timing and the local day
boundary; do not add a stored status or flag for it.

Example:

```text
Needs decision
Yesterday
- Brush teeth
- Take medication

Monday
- Laundry
```

### Current day

Current-day occurrences, ordered by scheduled time.

When the same behavior has multiple occurrences on the same local day, group
those same-day occurrences together as a stack. Groups are ordered by their
earliest occurrence. Each scheduled time or time range renders as its own
occurrence row inside the group.

For multi-time behavior groups:
- Do not use percentage or progress fill on the grouped row.
- Keep the existing single-occurrence visual language for each row.
- Completed rows use the existing full blue completed treatment.
- Unresolved rows use the existing unresolved treatment and show Completed and
  Not Completed text-link status actions.
- Not Completed rows use the red accent treatment, show the collapsed Not
  Completed label, and hide primary status actions just like Completed rows.
- Do not show a "1 of 2 completed" label.
- Do not add a partial-completion stored status.
- Partial completion is only a derived visual result of mixed row states within
  the grouped behavior.
- Status actions always apply to the specific occurrence row where they appear.

Example:

```text
Saturday, June 6
9:00 AM  Take medication
11:00 AM Drink matcha
10:00 PM Brush teeth
```

If a day has no scheduled behaviors, show:

```text
No behaviors on this day
```

### Future days

Show the next 7 days by default.

Each future day is its own section.

Provide a control to show more future days.
When the user reveals more future days, preserve useful scroll context instead
of sending the user back to the top of the Timeline.

Do not show previous days except for unresolved prior-day items inside the Needs decision modal.

## Disclosure controls

Use native `details` and `summary` for hide/show sections and drawer-like
detail areas when the browser primitive fits the interaction. The `summary`
element is the product disclosure trigger button and should use the shared
disclosure-trigger styling rather than a one-off cursor, marker, or underline
treatment. Sections that need an explicit opener use the shared disclosure
indicator; Timeline occurrence rows omit a separate indicator because the whole
row summary is the trigger.

Disclosure content spacing should be owned by the disclosure pattern or the
surface-specific row pattern, not by ad hoc per-instance padding. Timeline row
details keep the standardized 16px optical gap from the collapsed row text to
the first detail label.

## Occurrence card

Collapsed card should show:
- Scheduled time
- Behavior title
- Current status when Completed or Not Completed
- Completed and Not Completed text-link status actions when unresolved

Preset time-range occurrences should use the short preset label in collapsed
Timeline rows, such as Morning or Evening, without the full clock range.

Status text-link actions should be underlined by default with the same thin underline. On hover-capable devices or keyboard focus, the action text may gain non-reflowing emphasis without changing color or moving adjacent actions. Do not use underline thickness to indicate a saved status.

Occurrence rows should read as compact unboxed list rows. Do not draw a perimeter border around each Timeline behavior row. Row content should keep a compact horizontal inset on both desktop and mobile so filled row states do not press text or status labels against the row edges.

In collapsed rows, the scheduled time, behavior title, and collapsed status/action text should be vertically centered within the row. Opening a resolved row must keep its Completed or Not Completed label in that same summary row, horizontally parallel to the behavior title. The expanded details panel should span the row below and must not push the resolved status label into the details area.
On mobile, scheduled time, behavior title, Completed, and Not Completed should share one horizontal row when unresolved status actions are visible. Completed and Not Completed keep at least a 44px tap target and same-line labels while still looking like underlined text actions; the scheduled time and behavior title may compact and truncate before the status targets shrink. Do not add a chevron or separate disclosure icon.

Expanded card details should stay inside the native disclosure element and show:
- Description if present
- Category
- Behavior schedule
- Track time after the schedule. An active behavior's current-day occurrence or
  visible Needs decision occurrence shows **Track Time**. The idle and stopped
  states use that one underlined action without a duplicate Track time heading.
  A running session changes the first line to a static, non-underlined **Track
  time** label, then shows a tabular `HH:MM:SS` counter, **Stop**, and **Reset
  tracked time** below it. A stopped total remains visible with **Track Time**
  and **Reset tracked time**. Reset removes all sessions for that occurrence
  without a confirmation modal.
- Note field
- Option to change a Completed or Not Completed status.

The timer counter does not use a live region for every second. Start, Stop,
Reset, and errors announce one result. Each timing action keeps a 44px mobile
target. Timing controls do not add a card, route, modal, column, or status cue.

Categories should only be visible in the expanded card details.

Unresolved prior-day cards in the Needs decision modal should be visually highlighted so the user is clearly prompted to decide whether each occurrence was Completed or Not Completed. This highlight is derived from date and status; it must not write a different status.

Completed cards should remain visible with a distinct resolved state, hide the primary status actions, and clearly indicate Completed.

Not Completed cards should remain visible with the red accent treatment and a
collapsed Not Completed label. They should match Completed row structure except
for color and label; status correction remains available after expanding the
row. This is a factual recorded-state cue only; the stored status remains on
that occurrence instance as `not_completed`, and the UI must not call it missed
or failed.

Clicking a Completed or Not Completed card should reveal the option to change
the logged action. Do not require a confirmation step before changing a status.

Notes, category, description, and schedule details are hidden by default and revealed when the user clicks the card outside the status actions.
Expanded details should sit directly on the background surface without a grey
panel, enclosing border, top divider, or boxed card treatment. Use a small left
inset for the detail block. Measure spacing optically between rendered text and
field edges: the largest gap is between the collapsed row content and the first
detail label and should measure 16px optically. This gap is part of the
standard disclosure pattern for row details. The next-largest gap is between
detail pairs, and the smallest gap is shared by detail label/value, Note
label/textarea, and textarea/Save note
relationships. The Note textarea keeps its field border, but Save note uses the
same underlined text-action vocabulary as Completed and Not Completed.
When an occurrence is open, the whole occurrence row should hold the same blue
background used by that row's hover state so the expanded content remains
visually attached to the behavior.

Status action behavior:
- Completed changes status to `completed`
- Not Completed changes status to `not_completed`
- When browser audio is available, one successful user-initiated change into
  Completed should play the short completion chime exactly once. Touch,
  pointer, click, submit, refresh, and React lifecycle handling must not create
  a second playback for the same confirmed status transition.
- Do not play a sound for Not Completed, note saves, page refreshes, or re-saving an already Completed occurrence.
- Note opens an inline edit field or compact modal in the expanded card state

Resolved occurrences can be changed later.

## Behavior form

The create/edit behavior view should be a full page accessible from the sidebar navigation.

Every server validation key must have a visible error surface in the form.
Recurrence errors appear with the Schedule recurrence controls.

On the Behaviors page, the create form should sit in the page flow without an
extra outer card border or outer padding. Inner field groups may still use
quiet dividers where they clarify structure.

Fields:
- Title
- Description
- Category
- Schedule with one or more rows; each row has recurrence, every/details,
  times, and time mode
- Browser notifications enabled, default on
- Email reminder toggle, default off
- Reminder offset
- Active/archive

At least one schedule and one time entry are required. Add time is plain black
text under the schedule row and adds another exact time or range to the same
recurrence. Add schedule is underlined black text and creates another
recurrence row. Keep the section unboxed with thin dividers and inline fields.
Do not show decorative clock, bell, or info icons in the form body. Separate
Reminders from Schedule with a thin divider. The primary submit action is Save
behavior; Cancel is a secondary text action. Cancel restores the complete draft
to the values present when the create or edit form opened, including identity,
recurrence, schedule rows, exact times or ranges, reminder choices, and active
state. It does not persist any of the discarded edits.

Preset time ranges:
- Morning: 6:00 AM-Noon
- Afternoon: Noon-6:00 PM
- Evening: 6:00 PM-Midnight
- Night: Midnight-6:00 AM

Timezone is managed in Settings and should not be shown as a separate panel in
the behavior creation form.

Public launch includes a short first-run onboarding flow. It reuses the same
behavior form, notification permission control, import entry, and timezone
settings rather than creating a separate onboarding product.

## Recurrence editor

Support:
- Daily
- Every N days
- Weekly on selected weekdays
- Every N weeks on selected weekdays
- Monthly on day N

Use segmented presets first, with advanced options below.

The Recurrence editor should be an unframed form section, not a boxed panel.
Use smaller subsection heading text for options such as Every, On, and Day.

Do not expose raw cron syntax.

Do not use natural language parsing in v1.

## Reminder editor

Behavior-specific fields:
- Browser notifications enabled, default on
- Email reminder toggle, default off
- Reminder offset:
  - At scheduled start
  - 15 minutes before
  - 1 hour before
  - 1 day before
  - 3 days before
  - Custom minutes/hours/days if easy

Browser notification permission is managed globally from Settings. The Settings
save control should call the browser permission request from the user's click
when permission is still undecided, save a subscription after permission is
allowed, and show factual unblock copy when the browser reports permission is
blocked.

Behavior-level browser reminders represent intent for that behavior. They rely
on devices enabled in Settings; if the current device is not enabled or browser
notifications are blocked, the behavior remains trackable.

The Reminder editor should use the same unframed form-section treatment as the
Recurrence editor. Use a plain section heading and smaller subsection heading
text for options such as Reminder offset.

## Behaviors screen

Behaviors is the primary behavior object surface. It combines recurring
behavior setup, compact active behavior metadata, range-based adherence, and
behavior date review. This is a UI composition change only: it must not add
schema, stored statuses, duplicate resolver logic, or date/time mutation for
occurrences.

Overall adherence appears near the top of the Behaviors screen with compact
7 / 30 / 90 day underlined text-action range controls directly above the
overall calendar inside that same area. The overall calendar remains passive;
selecting days for correction starts from an individual behavior row.

Show active behaviors first as compact unboxed rows.

The behavior creation form should be available from the Behaviors page without
pushing existing behavior cards far below the first viewport. When behaviors
already exist, keep creation behind a simple in-page disclosure. When no
behaviors exist, the creation disclosure may open by default.

Each behavior card/list item should keep the repeatedly used review information visible:
- Title
- Range-based adherence label plus Completed and Not Completed counts when occurrences exist in the selected range
- A per-behavior calendar/heatmap sized to the row
- Archive behavior at the end of Details and Settings
- Restore for archived behaviors
- Details and Settings

The Details and Settings disclosure should reveal lower-use behavior
configuration fields such as category, scheduled times or ranges, recurrence
summary, reminder indicators, and description when present, then expose the
existing edit form. These characteristics should not take over the collapsed
behavior row.

Behavior records should not draw a perimeter border. Separate adjacent
behaviors with a single quiet divider line, and keep borders only on real
fields, controls, and status labels. Archive behavior belongs at the end of
Details and Settings for active records; on desktop, align it with the
Save/Cancel footer row on the opposite side of the settings area. Restore
remains available from archived records. Archive uses the Rust Signal danger
text-action, while Restore uses the primary underlined text-action rather than
bordered button chrome.
Separate behavior settings edits from behavior date review:

- Details and Settings opens the existing behavior metadata and edit form
  for recurring behavior configuration: title, description, category,
  recurrence, schedule, reminders, and active/archive state.
- Behavior date review opens from a selected non-empty per-behavior calendar
  cell and is for reviewing or correcting dated records only.
- Non-empty per-behavior calendar cells should expose action scent through
  accessible labels or titles such as "open day review"; empty cells remain
  passive.
- Behavior date review displays Date of behavior, Time of behavior, Status, and
  Note as plain rows.
- Date of behavior and Time of behavior are display-only in date review.
- Status and note correction controls stay hidden behind a per-occurrence
  Review disclosure until the user chooses to review that occurrence.

Archived behaviors should not appear in the main active behavior feed or on the
timeline. They should sit at the bottom of the Behaviors screen behind a
low-priority Archived behaviors disclosure with a count, where Restore remains
available.

Archive and Restore change the behavior's durable active state and mark the
occurrence/reminder graph stale in one transaction. If either write fails, both
roll back. After that transaction commits, the behavior-state change remains
successful when immediate repair fails because background processing can retry
from the durable stale marker.

Category editing belongs in Settings.

Ticket 123 implements category create, rename, optional
plain-text description, reorder, and confirmed delete controls to Settings on
web and desktop. Deletion shows the affected Behavior count and moves those
Behaviors to No category while preserving their history. Reuse native fields
and existing text actions; use Move up / Move down for category order.

Ticket 124 implements compact Category and Sort selects to
Behaviors. Category offers All categories, No category, and owned categories.
Sort offers Scheduled time, Name A–Z, and Category. Controls affect active and
archived lists; archived results stay in their disclosure. Show matching/total
counts and Clear filters. Keep overall analytics scope explicit and unchanged.
Preserve drafts and selections through in-screen updates. Stack controls on
narrow screens. Detailed lifecycle and empty-state criteria live in Ticket 124.

## Behavior review details

Default range:
- Last 30 days

Show:
- Overall adherence at the top of Behaviors
- Completion-intensity calendar heatmap for overall adherence
- Date range selector: 7 / 30 / 90 days as underlined text actions. The current
  range uses primary black text, and inactive ranges use readable muted text.
- Completed and Not Completed counts by behavior
- Per-behavior chart or calendar heatmap
- Tracking-since date for each behavior count row in MM-DD-YY format, plus a
  start marker in that behavior's calendar when the start day is inside the
  selected range
- Full completion, partial completion, and not completed day states for behaviors that can occur multiple times in one day
- Behavior date review for correcting individual statuses and notes
- Top summary Unresolved count when the count is greater than zero
- Optional compact resolved counts by category
- Default adherence rate
- Conditional `Average tracked time` inside existing per-behavior outcome
  metadata when the selected range contains one or more stopped-session
  occurrence totals

The Behaviors screen's review area should read as one sparse report surface. Avoid boxed
section panels around Overall adherence, the calendar, Behavior counts, and
Category counts. Use single horizontal dividers where separation is needed.
The overall calendar belongs inside the Overall adherence area. The date range
selector sits directly above that calendar. The overall adherence label uses a
colon, and the percentage sits immediately after it on the same unbroken header
line at desktop widths. The selected date range appears directly underneath in
compact muted month-day wording. The range selector, calendar, and vertically
listed legend form one cluster aligned to the right edge on desktop.

The overall calendar is a passive adherence summary, not the correction entry
point. Later corrections start from a behavior row: selecting a non-empty
behavior calendar cell opens a compact Behavior date area inside that behavior
row. Its heading should be explicit, such as Review selected day, rather than a
generic Review label. The behavior date review should list only that behavior's
occurrences for the selected local date when rows exist, including Completed,
Not Completed, and Unresolved rows. It should use plain text labels for Time of
behavior, conditional Tracked time, Status, and Note rather than chips, and empty notes should read as
italic No note. Correction controls stay hidden behind a per-occurrence Review
disclosure until the user chooses to review that occurrence. Inside the
disclosure, Change status and the Completed / Not Completed actions should sit
on one row when space allows. A resolved occurrence also exposes Clear decision
in this behavior-date context, returning it to Unresolved. An expanded,
just-decided Timeline occurrence exposes the same correction as Unmark; Needs
decision does not expose it as a global action. Both labels use the same status
service and restore only still-future reminders. The inline Note form follows
the status controls. `Reset tracked time` appears in this same disclosure only
when the occurrence has stopped or running timing data. It deletes timing
sessions and refreshes the review without changing Status or Note. Do not use
internal divider lines that visually compete with the behavior-row separators.
Do not add bulk edit, all-time search, automatic suggestions, AI coaching, or
gamified language. Do not render an empty review panel when the selected
behavior day has no occurrences.

Default adherence excludes unresolved occurrences. When shown, the top summary
Unresolved count matches the Timeline Needs decision count: active unresolved
occurrences before the current local day, regardless of the selected Behaviors range.
Hide the top summary Unresolved row when the count is zero.
Current-day unresolved occurrences can still show as unresolved in heatmap
cells and behavior date review rows. Do not render an Unresolved row in
per-behavior or category count grids.

Overall calendar cells use completion intensity for completed share: 100%
Completed uses the full primary blue, and lower completion shares mix that blue
with the background in the same proportion. A 50% completed day should appear
as a half-strength blue cell. A day with resolved occurrences but no completed
occurrences uses the red accent treatment. Fully unresolved days use the
neutral unresolved treatment.

Behavior count rows should be divider-separated rather than boxed. Their
Completed and Not Completed labels align vertically with numeric values in the
same left-start value column used by other behavior-row metadata, and visible
count rows use the same compact vertical spacing as the metadata inside Details
and Settings. Behavior calendar cells with occurrences are selectable; empty
cells remain passive.
Behavior categories appear as plain metadata text inside Details and edit
settings.

Overall and behavior calendar cells show a compact date label on hover or
keyboard focus while preserving the longer accessible label for screen readers
and native titles.

## Export & Import screen

Route:
`/export`

The screen label is Export & Import. Keep `/export` as the stable route.

Top-level sections:
- Export
- Import

Export options should appear before download links and the AI summary so every
output reflects the same selected state. The selected range scope counts belong
inside Options rather than a separate Current export section.

Export options:
- Last 7 days
- Last 30 days
- Last 90 days
- All time
- Include archived behaviors
- Include occurrence notes, off by default
- Include time tracking, off by default, with factual copy that exact session
  timestamps can reveal activity patterns and remain omitted unless selected
- Selected range scope: behavior count, occurrence count, and default adherence

Export outputs:
- Export JSONL
- Export CSV
- Export app JSON snapshot
- Export BehaviorLog bundle
- Copy AI summary
- Download AI summary as `.md`

Downloads should render as compact label/action rows. Put the extension next to
the format name, keep the Download action on the same row when space allows,
and include one concise task-based guidance line per format: JSONL for scripts
and agents, CSV for spreadsheet review, app JSON for app-native snapshots, and
BehaviorLog for complete portability and restore-oriented status history. Omit
icons and row borders. Do not render download actions as explanatory card
grids.

App JSON guidance must name complete behavior definition, schedule, and
reminder history. BehaviorLog guidance must name Cadence definition, schedule,
reminder, and status history. Before Downloads, disclose that Full JSON and
BehaviorLog include complete prior/next titles and descriptions plus schedule
and reminder history by default. State that historical definition and
configuration can contain sensitive context. Do not add a history checkbox.

The Import section must state that definition and configuration revisions are
not replayed. Import and restore use the current snapshot and keep historical
Occurrence snapshots portable without activating prior schedules.

Exports should support both download and copy where practical.

The AI summary is an export artifact, not an in-app coaching feature. It should
state whether notes are included and should show notes only when the user opts
into occurrence notes.

Only an applied time-tracking option may show a Timing sessions count in the
selected-range scope. Enabled download filenames identify the sensitive choice
with `with-time-tracking`.

Analysis prompts appears after the AI summary inside the Export section. It is
a static, single-column library of native disclosure rows. Collapsed rows show
the prompt title and one factual purpose sentence. Expanded rows show the
required export format or options, the full prompt in a preformatted Cold
Surface panel, and an underlined Copy prompt text action. Copy feedback appears
next to the action through an `aria-live="polite"` status with Copied or Copy
unavailable. Keep all copy in sentence case and factual, with no icons, warning
box, or caution chrome. The muted intro includes the plain sensitivity
disclosure that whatever the export contains becomes visible to the assistant
the user pastes it into.

Do not use icons in Export & Import page controls unless a later design-system
ticket reintroduces a specific icon affordance.

BehaviorLog import should live in the Import section as a sparse ledger panel.
The section accepts `.behaviorlog.zip` uploads, shows validation errors and
warnings before any product write, shows dry-run counts, privacy notes, note
sensitivity warnings, intervention preview counts, passive imported
intervention storage counts, dropped/redacted intervention field summaries,
unsupported field counts, imported-note record counts, inline occurrence-note
fill counts, and merge actions, and requires explicit confirmation before
applying create-only or supported user-approved merge plans.
If high or restricted sensitivity notes would be imported, apply controls must
also require a dedicated privacy acknowledgement. Do not add generalized notes
browsing or intervention-to-reminder writes in this screen.

Import and restore show and enforce a 2 MB bundle limit before submission and
on the server, plus bounded archive-entry, extracted-size, and compression-ratio
safety limits. The Next.js Server Action ceiling is 4 MB: a 2 MB ZIP is about
2.7 MB after base64 encoding, leaving margin below Vercel's 4.5 MB Function
request cap. Apply submits the base64 archive once. Action state carries only
the SHA-256 fingerprint of the exact previewed archive bytes.

Import apply controls must remain bound to the persisted accepted merge-preview
run currently being reviewed. The server first verifies the submitted archive's
SHA-256 against the accepted raw-archive fingerprint, then authoritatively
re-parses and verifies matching bundle, local-data, and combined preview
fingerprints before any write. When that verification
refuses an unaccepted, stale, altered, or mismatched preview, show the refusal
as an alert, retain the reviewed preview, and require the user to generate and
accept a fresh preview. Do not silently replace the reviewed plan or provide a
global bypass. Keep each Apply control disabled until the user has reviewed the
exact preview and completed every sensitivity acknowledgement required for that
preview; native required validation remains a secondary safeguard.

BehaviorLog restore preview may also appear in the Import section when a restore
ticket is active. It should stay separate from create-only and merge import,
show create/replace/archive/delete/keep/skip counts, highlight destructive
replace/archive/delete actions, show non-restorable account/provider/browser
fields, show note sensitivity and intervention redaction warnings, and display
the preview fingerprint needed for stale-preview refusal. Preview itself must
not present as a completed restore and must not write product records.

Restore apply controls should appear only after a valid restore preview. They
must require a fresh-backup checkbox, typed `RESTORE` confirmation, and a
separate high/restricted note sensitivity acknowledgement when relevant. The UI
should show stale-preview or unsupported-action refusal as an alert and keep the
preview visible for review. Keep Apply restore disabled until all applicable
gates are satisfied. Apply result or failure details should appear in the
Restore section history.

## Settings screen

Show:
- Profile/email from Google sign-in when available
- Timezone
- Notification permission status
- Control to request browser notification permission
- Global browser notification setting
- Global email notification setting if needed
- Lightweight category editing
- Export/backup links if not on Export page
- Trust, Privacy, and Terms links for public-product account context
- Account deletion with export acknowledgement and typed confirmation

Desktop Settings additionally shows linked-account synchronization state,
conflict count and review, and disconnect choices. A conflict also exposes one
persistent shell cue that opens Settings. Conflict rows show the Mac and account
values with radio controls for Use account version and Use this Mac version.
Keep both appears only when the resolver proves a complete identity-preserving
duplicate; no current conflict class qualifies. Disconnect offers Keep a local
copy and typed-`REMOVE` Remove account data. Results disclose exact local and
protected-backup paths. Revoked sessions direct the user to reconnect or
disconnect without blocking local tracking.

The public `/trust` page keeps durable product commitments separate from current verification evidence. It always shows all nine checks with text and symbols, exact UTC timestamps, scope, limits, and immutable evidence links. Passed requires a valid, fresh snapshot for the current source commit and both deployments. Feed failures show a validated cached copy as Stale, or Unavailable when no validated copy exists.

Timezone detection should use the browser/OS timezone exposed by `Intl.DateTimeFormat().resolvedOptions().timeZone`; do not request geolocation or location permission. Settings should present one native select of IANA timezones whose selected value is the stored timezone; the select is the only "current timezone" display, with no separate stored or browser-detected value rows. When the detected browser timezone differs from the current selection, show a single quiet Detected line with an inline Use detected timezone action; when they match or detection is unavailable, show nothing. If the browser cannot enumerate timezones, fall back to manual IANA timezone entry. Before submit, Settings should state that saving a timezone updates the profile and active behavior schedules, then resyncs future unresolved occurrences while preserving past and resolved history.

Do not include a test notification button in v1.

Do not include destructive data actions in v1 except the explicit public-launch
account deletion path and dedicated BehaviorLog restore work. Restore preview is
read-only; restore apply must require explicit review, backup acknowledgement,
typed confirmation, and stale-preview refusal before destructive writes.
The account deletion action should stay disabled in the client until both the
export acknowledgement and typed confirmation match, while server-side
validation remains authoritative.
Service-role verification and Auth deletion occur before sign-out. A failure
before deletion keeps Settings reachable and shows one specific recoverable
error. A successful hard deletion still redirects to Login if the later
current-browser sign-out cleanup reports that the deleted session is gone.

Notification, behavior archive/restore, and account-deletion action results
must use one concise live result per action. Successful results use status
semantics; failures use alert semantics. Do not announce the same message from
multiple live regions. After successful account deletion redirects to Login,
the `Account deleted.` status receives focus so the result is announced on the
destination page. Unsupported, blocked, dismissed, or otherwise unsuccessful
notification-enable attempts use alert semantics; passive availability details
and successful saves use status semantics.

## Offline UI

Offline support is not part of v1.

Future offline behavior is tracked in `/docs/FUTURE_UPDATES.md`.

Ticket 091: web Export initially shows scoped counts and Generate summary.
Generation reveals the existing Markdown preview, Copy summary, and Download
.md controls. Errors preserve retry. Applying new options clears the summary.
Desktop keeps its local summary behavior.


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

## Note shortcut controls (Tickets 126–128)

Existing Behavior settings contain a Note shortcuts section with its persisted
opt-in, Find repeated Notes action, proposed text with Accept/Edit/Dismiss, and
accepted text with Edit/Remove. Global Settings contains the feature off control.
Explain that matching uses repeated Notes for this Behavior and runs only on request.
Show insufficient evidence and request errors without blocking ordinary Note entry.
If shortcut reads fail, show an unavailable notice and disable those controls.
Keep the tracking screen and ordinary Note entry usable; mutation failures remain errors.

Only accepted shortcuts appear above the existing Note textarea on Timeline,
Needs decision, and Behaviors selected-day review. Buttons fill an empty draft
or append a newline and text to a nonempty draft. They never replace text,
submit, change status, or send reminders. Insertion increments the existing draft
revision, including while Save note is pending. Keep keyboard focus usable,
44px mobile targets, plain text rendering, labelled inputs, and result announcements.
Preserve unsaved shortcut edits on failure. Hide quick-fill/proposals when off;
keep management available so users can remove retained text. No new navigation
or modal is needed. Cloud consent must not appear enabled before provider acceptance.

### Desktop storage and update controls (Tickets 129 and 131)

Local database Settings shows verified before/after bytes including recovery files.
Deleting the exact repair backup requires a checkbox acknowledgement. App updates
shows the automatic-download preference, download progress, plain-text release
notes, and separate download/install/restart actions. A nonmodal notice opens
review inline, preserving the mounted editor. Later snoozes one release for 24
hours. Restart offers Keep editing or explicit draft discard when necessary.
These controls use existing square layouts and text actions. Web and marketing
are not applicable; future mobile implementation remains deferred.


## Behavior planning inputs (Tickets 142–143)

The shared create/edit form places optional Default duration (minutes) and End date inputs under Schedule. Use native number/date controls and the existing line-led styling. Explain that duration is separate from tracked averages and archiving starts at midnight on the chosen date. Timeline details label Default duration separately from measured Estimated duration. Timeline and Behaviors show an accessible persistent notification for automatically archived Behaviors, with history preserved. Restore clears an expired end date and the current notification.


### Daily Brief recipe workbench (Tickets 156–158)

The development workbench identifies Daily Brief and its recipe/policy versions.
Separate native controls select context inputs and duration sources. Unsupported
historical completion marking times are independently selectable; actual finish capture remains unsupported. Input selection never overrides
model-data consent or recipe prose policy. Controls link to existing glossary terms.
The inspector explains exclusions, duration selection and sample coverage; the
horse bubble omits routine connector/history diagnostics. The shared bubble keeps
read-only suggestions, source links, expiry, dismissal and accessible status text.

### Daily Brief recovery, tips and travel (Tickets 168–174)

The shared horse bubble keeps its states: loading, ready and a notice with one
labeled retry. Notices name the outcome plainly: still being prepared, request
limit (retry disabled until the server's wait passes), took too long, offline, sign
in again, changed while prepared, retry limit reached, did not finish loading,
already started but not shown here, timing expired ("Get a fresh brief") and Timeline
changed ("Refresh brief"). Close stays a 44px control in every state.

A ready brief may add two quiet sections below the text, separated by a hairline:
"Pattern tip" (the model's tip plus a muted deterministic evidence line and one
limitation) and "Travel" (up to four calculated lines: travel-created Behavior
overlaps, departures, the return or an unknown-return note, then a muted "Calculated
by Cadence … Not written by the model." line). A hypothetical option that overlaps
travel adds "This time overlaps planned travel." No new buttons; no apply action.

Settings adds two checkboxes below Calendar timing, each with an exact disclosure
paragraph, shown only when the server's recipe uses the source (or in development):
"Include reminder delivery history" and "Include Notes on Not Completed occurrences".

The workbench adds an Analysis scenario select, an Analysis lanes fieldset per
configuration (lane checkboxes with their questions, "Allow one pattern tip", and
"Tip cooldown days"), and an Analysis summary beside each result listing lane states,
reasons and tip-selection decisions. Maximum words accepts up to 180 for 1.3 configs.

## Historical completion times workbench control

The Recipe inputs fieldset includes an independent native checkbox named
Historical completion times. It replaces the disabled finish-time placeholder.
History days scopes its samples. Existing spacing, typography, surfaces and
responsive columns remain. The inspector shows selected summary counts, ranges,
mark-time semantics and exclusions; deselection removes timing facts. Actual
finish capture remains unsupported and no generation occurs when toggling.
