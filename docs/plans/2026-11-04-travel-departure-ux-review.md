# Travel departure UX review — November 4, 2026

Owner-requested review of the travel feature (Tickets 160–170, 212–219, 243–244).
It records the owner's concerns, the findings from code and documents, a visual
inventory of the current UI and concept mockups of proposed changes. It changes no
runtime behavior, schema, ticket state or user-facing text.

## Summary

Travel routing is live on web. The owner's goal is a clear warning of when to leave.
Cadence does not meet that goal today:

- Leave times exist, but only in places you must open: the event drawer, the event
  dialog and the Daily Brief bubble.
- Two rules hide most leave times most of the day. Estimates expire after 5 minutes
  (Rule 1), and Cadence only estimates trips that leave within 3 hours (Rule 2).
- No spec or ticket includes a warning or notification to leave.
- The model never receives leave times. This follows the owner's October 17 decision.
- The travel text carries too much metadata and internal wording for a launch product.

Evidence: main `0044b8f`, read November 4, 2026. No production data was read. The
screenshots come from the local design-system bench (see "Method and limits").

## Corrections and gaps, November 4, 2026

Added after an independent check of this report, the same day, against main `0044b8f`. The
check read the travel code, specifications, tests, report text and images. It ran a copy
of the shipped resolvers on eight scenarios. It read production state without changing
it: Vercel variable names and aggregate database counts. It read no user IDs, places or
event details. It did not run browser views, real route calls or the installed Mac app, so
its UI findings come from reading the code.

**Verdict:** the main findings hold. Leave times are hard to find, and no warning exists.
The report needs nine corrections, and it missed eleven gaps that change the plan. The
most serious gap: when you are already late on foot, by bike or by transit, Cadence says
"timing unavailable".

The owner then decided the open questions (`docs/DECISIONS.md`, 2026-11-04, "Travel
advisory revamp"). Tickets 263–285 replace the "Candidate follow-up tickets" section below.
The report's text below is otherwise unchanged. Where it disagrees with this section, this
section is right. Line numbers below are as of `0044b8f`.

### Corrections to the report

| # | The report says | The code shows | Evidence | What changes |
|---|---|---|---|---|
| C1 | Not verified: do drawer and dialog lines change after expiry? | They keep the last times, with no mark. Only the status line warns. | `renderTravelTiming` has no clock or stale input (`ExternalEventDetails.tsx:207`). `useTravelContext` keeps the view (`lib/ui/travel.ts:237`). `docs/user-guide/travel.md:173` says the same. | P2 must label the time, not restore it. L-014 describes shipped behavior, not a proposal. |
| C2 | Directions falls back to Search after expiry (also image 2) | The link stays Directions while the view is in memory. | `ExternalEventDetails.tsx:135` checks `state`, not expiry. Scenario H. The QA plan check in `docs/qa/travel-release.md` would have failed. | Directions depends on a resolved place, not on a 5-minute estimate (Ticket 271). |
| C3 | "Leave time appears 3 hours before the trip" (Ticket 261, P-015, mockup P1) | The window counts back from the arrival target. A 2:30 PM event enters at 11:25 AM for any trip length. A trip over about 3 hours is first estimated after you should have left. | `travel-refresh-policy.ts:43` | Fix the rule (Ticket 267) and the copy (Ticket 261, P-015). |
| C4 | Decisions 1 and 2 are open | Tickets 260–262 already record the owner's direction. | Tickets 260 and 261 | Decisions 3–6 remained. |
| C5 | Weather text is treated as a live problem, checked October 27 | Weather is still off. No production user sees weather text. | No `CADENCE_WEATHER_PROVIDER_CLEARANCE` in Vercel, November 4 | Ticket 260's weather part matters only when weather turns on. |
| C6 | No test renders travel UI under the 5-minute cap | Narrower. Some tests use 5-minute fixtures, and hook expiry is tested. None renders the drawer, dialog or bubble after expiry. | `tests/travel-weather-ui.dom.test.tsx:43`, `tests/travel-lifecycle.dom.test.tsx:148` | The test work stays, and it is smaller (Ticket 266). |
| C7 | Not verified: order of the first brief and travel requests | The brief reads its token as soon as its request starts. Measured travel requests take about 3.4 s. So the first brief of the day normally has no trip facts. Timing not measured. | `DailyBriefLauncher.tsx:126`, `docs/COSTS.md` | Wait briefly for the first travel result (Ticket 272). |
| C8 | "No detail available." repeats in the dialog | That is the bench text. Production prints "Not provided.", "Restricted by the source." or "The source omitted this detail." | `ExternalEventDetails.tsx:241` | Ticket 262 hides all four. |
| C9 | Line citation `brief-travel-guidance.ts:85` | The expiry filter is at lines 78–80. | Source | None. |

### Gaps the report missed

| # | Gap | What the user sees | Evidence | Ticket |
|---|---|---|---|---|
| G1 | Late trips go silent | A 30-minute walk to an event 15 minutes away reads "timing unavailable", and the bubble shows nothing. Two events too close together do the same. Only near-term driving reports a late arrival. | Scenarios B and C. `travel.resolver.ts:214`, `travel-provider.ts:184` | 264 |
| G2 | The trip home disappears when the event starts | During the event there is no "Head home" line, which is when it matters most. | Scenario D. `travel.resolver.ts:59`, `travel-route-refresh.service.ts:257` | 264 |
| G3 | No estimate, no reason | With no origin, an address Google cannot pin down, or a location plus a video link, the event shows no travel line at all. Unknown legs never reach the client. | Scenarios E–G. `travel-display.service.ts`, `travel-provider.ts:131`, `travel-route-refresh.service.ts:264` | 264, 273 |
| G4 | One unknown stop hides the next trip | With Home saved, a vague 1 PM event leaves a well-addressed 2:30 PM event with no leave time until 1 PM passes. | Scenarios F and G | 264, 273 |
| G5 | Corrections vanish | In-person or remote and the corrected destination last only while the Timeline stays open. | `ExternalEventDetails.tsx:191`, `docs/user-guide/travel.md:153` | 281 |
| G6 | Google Calendar only | Outlook and iCloud events never route. Their connectors read no location. Nothing explains this. | `DayProgressTimeline.tsx:170`, `outlook-calendar-provider.ts:52`, `icloud-calendar-provider.ts:469` | 283 |
| G7 | Today only | Tomorrow's 8:30 AM trip has no leave time. Mockup P1's Tomorrow line cannot work today. | `DayProgressTimeline.tsx:174`, `lib/ui/travel.ts:291` | 282 |
| G8 | Whole-day estimates need the Daily Brief and then get lost | With the brief off, no whole-day estimate ever runs. With it on, the next refresh replaces later trips with "outside window". | `lib/ui/travel.ts:136`, `travel-route-refresh.service.ts:161` | 267, 268 |
| G9 | The status line is noise on days with no trips | It reads "Travel as of 8:00 AM", then "may be stale", with no trip to talk about. | `lib/ui/travel.ts:188`, `travel-route-refresh.service.ts:444`, `DayProgressTimeline.tsx:726` | 261, 269 |
| G10 | Setup trap | The first-run row reads Saved while Travel estimates stays off, so nothing appears. | `docs/USER_FLOWS.md:205` | 273 |
| G11 | Internal text outside the inventory | "Travel estimates await this deployment's provider review.", "Travel timing incomplete", raw completeness lines, "Applies only to this event revision while the Timeline is open." | `lib/ui/travel.ts:76`, `timeline-context.resolver.ts:293`, `ExternalEventDetails.tsx:191` and `:194` | 261, 262 |

### Mockups against the code and written rules

| Proposal | Verdict | What it really needs |
|---|---|---|
| P1 Next departure on the Timeline | The best single change | An always-visible span and marker override written rules: Ticket 164, `docs/UI_SPEC.md`, `DESIGN.md`. The left rail is 72 px wide below 576 px, so a "Leave 1:15 PM" label will not fit at 390 px. The Tomorrow line needs G7. |
| P2 Drawer emphasis and last estimate | Right, with a changed premise | The time already shows, so it needs a label (C1). The late state needs G1. The mockup's bold type breaks the no-bold rule in `DESIGN.md`. Its weather advice is what Ticket 260 removes. |
| P3 Leave reminder | Right goal, understated | See the list below. It is the largest item in the plan. |
| P4 Daily Brief travel block | Half right | Keep the block from vanishing. The collapsed strip repeats P1. `docs/USER_FLOWS.md` must change. |

What P3 needs that this report does not list:

- `reminder_deliveries` requires an Occurrence. Calendar events have none.
- Nothing on the server can read Calendar or reserve spend without a user session.
  `reserve_travel_provider_spend` uses `auth.uid()`. The MCP's minted user token is a usable
  base (`lib/supabase/integration-token.ts`), and its signing key is set in production.
- A closed app gives no device position. The start point must be Home or the previous stop,
  unless Cadence starts storing a position.
- The Privacy text says Cadence stores no Google event details and processes them "while
  serving a refresh or preparing a briefing". So the title must be read at send time, and a
  messaging entry is needed.
- The push sender fixes a 24-hour lifetime and normal urgency. The service worker has no
  action buttons. Pushes open plain `/timeline`.
- On the Mac, the Rust check accepts only `cadence.local.<occurrence UUID>` identifiers. No
  notification categories exist, so no Directions or Snooze button. Activation opens
  Occurrences only. A quit app cannot re-route. Shipping needs a desktop release.
- A setting in the synced profile forces an account-sync contract change. The last one
  stopped older Mac builds from syncing. A hosted-only preference avoids that.
- The 5-minute cron makes reminders up to 5 minutes late unless the job looks ahead.
- "10 minutes before departure" can land inside the get-ready span.

### Scenarios run on a copy of the shipped resolvers

Each uses a saved Home, walking and a 5-minute arrival buffer, unless stated.

| # | Scenario | Result |
|---|---|---|
| A | Event in 2.5 hours, 30-minute walk | Outbound `current` |
| B | Event in 15 minutes, 30-minute walk | Outbound `unavailable`, "Route departs before its ready time." Bubble items empty. `completeTrip` false. |
| C | Two events 10 minutes apart, 30-minute walk | Onward `unavailable` |
| D | 30 minutes into the event | No legs and no unknown legs |
| E | No Home and no device | No legs. Unknown: `origin_unknown`, `return_base_missing` |
| F | Unresolved 1 PM event, then resolved 2:30 PM event | Only a return leg. Unknown: `destination_unknown`, then `origin_unknown` for the 2:30 PM event |
| G | Location plus video link at 1 PM, then resolved 2:30 PM event | Only a return leg. Unknown: `attendance_unknown`, then `origin_unknown` |
| H | 10 minutes after the estimate | Bubble guidance null. Leg state still `current`. Link label "Directions in Google Maps". |

### Still not verified

- How these states look in a live browser or the installed Mac app.
- Real timing of the first brief and first travel request.
- Whether cron requests carry the Vercel OIDC token that hosted routing needs.
- Web push behavior on iPhone. Based on memory, it needs the site on the Home Screen.
- Which Google price applies to transit. The code reserves the higher rate.

The November 4 production readback is in `docs/COSTS.md`.

## Owner concerns

1. **Too much metadata.** The event dialog and travel lines show too many labels. This
   must be fixed in the launch product. Some text is internal and belongs only in
   development, for example "Synthetic route. No provider call.". The owner also
   regards the weather mode advice ("Consider transit or driving instead of walking.")
   as useless text.
2. **Rigid language.** Labels such as "Outbound" should become plain phrases such as
   "Leave by".
3. **Rules 1 and 2.** The owner is concerned that the 5-minute expiry and the 3-hour
   window keep the feature from working. Both rules are described below.

## Where development stands

| Ticket | Scope | State |
|---|---|---|
| 160 | Discovery and design | Done, September 21 |
| 162–164 | Places, routing, Timeline display | Live since September 22 |
| 166–167 | Quota and refresh rules | Superseded by 213–214 |
| 170 | Calculated travel beside the Daily Brief | Built September 26; model projection moved to 219 |
| 213–214 | US$5 monthly budget, change-driven refresh, 3-hour window | Done, October 18 |
| 215 | Three-input Travel Settings, Behavior Where | Live, October 23 |
| 212, 216, 217 | Setup row, completion places, learned habits | Live on web, October 24 |
| 218 | Weather margin | Code live; weather off in production (no `CADENCE_WEATHER_PROVIDER_CLEARANCE`, checked October 27) |
| 219 | Travel facts in Daily Brief model input | Stages 1–2 live; Google support case 76805292 open |
| 165 | Release acceptance | In progress. Open: denied state, installed Mac checks, directions handoff matrix (never run) |
| 243, 244 | Six-leg speed; place data in Full JSON | Backlog |

No travel source has changed since October 25. Privacy entries P-001 to P-004 and
P-012 remain open on the messaging track.

## The two rules

### Rule 1: estimates expire after 5 minutes

In production, a Google Maps estimate is current for at most 300 seconds.
`boundedExpiry` in `lib/services/travel-provider.ts:440` caps it. After that,
Cadence stops treating the estimate as current:

- The Daily Brief's "Leave by" lines disappear. `projectBriefTravelGuidance` drops
  expired legs (`packages/core/src/services/brief-travel-guidance.ts:85`).
- The Directions link falls back to "Search" (`docs/qa/travel-release.md`, directions
  handoff plan, negative checks).
- The Timeline status line reads "Travel estimates from 8:00 AM may be stale."
  (`components/timeline/DayProgressTimeline.tsx:728`).
- The signed trip conclusions for the Daily Brief model expire at the same time
  (`lib/ui/travel.ts:173`).

Why the rule exists: Cadence chose 5 minutes as a conservative reading of Google's
caching terms (`docs/COSTS.md`). Changing it is a product decision. The terms
question is logged in `docs/LEGAL.md` as L-014 and does not hold this work.

The test page hides this rule. It freezes its clock at 8:00 AM, and its Timeline
status view expires in the year 2999 (`app/design-system/CalendarBench.tsx`). The
leave times in the screenshots never go stale or disappear. The Daily Brief guidance
tests also use a 2.5-hour expiry (`tests/brief-travel-guidance.test.ts`). A search
found no test that renders travel UI under the 5-minute cap. The search was not
exhaustive.

### Rule 2: Cadence only estimates trips within the next 3 hours

A Timeline refresh routes only legs that leave, or must arrive, within 3 hours
(`TRAVEL_ROUTE_WINDOW_SECONDS` in `packages/core/src/services/travel-refresh-policy.ts`).
For any later trip, Cadence does not ask Google at all. The trip shows "estimated
within 3 hours of departure" instead of a time.

Ticket 214 set this rule to control cost under the US$5 monthly ceiling. A generated
Daily Brief routes the whole day once, but Rule 1 expires those estimates 5 minutes
later.

Nothing re-requests an estimate when a trip enters the 3-hour window. Estimates
refresh only when the Timeline opens without a current estimate, a source changes,
the device moves more than 500 m, or the user chooses Refresh travel. A user who
checks the Timeline at 8:00 AM sees no leave time for a 4:00 PM event, and may see
none later unless they reopen the Timeline.

The test page does not apply this rule. It builds evidence directly with the travel
resolver. At its 8:00 AM clock it shows a 1:15 PM leave time, which production
would not show.

## How the feature presents travel today

Ticket 164 ruled out a separate travel lane or warning panel. Travel appears on
existing surfaces:

1. **Timeline status line:** "Travel as of 8:00 AM" with Refresh travel.
2. **Event marker and magenta span:** the span and the overlap border on crowded
   Behaviors appear only while that event's drawer is open.
3. **Event preview drawer:** "Outbound · walking: leave Nov 1, 1:15 PM, arrive Nov 1,
   2:20 PM." This is the Timeline's only leave time.
4. **Calendar details dialog:** the same lines below 13 metadata rows, plus the only
   navigation link.
5. **Expanded Behavior row:** "Possible travel overlap", with no trip or time named.
   A Behavior with its own Where shows its trip timing and no navigation link.
6. **Daily Brief bubble:** "Leave by 2:05 PM for Dentist (cycling)." This is the only
   "Leave by" sentence. The bubble appears once a day and stays hidden after a reload
   (`components/briefing/DailyBriefLauncher.tsx`, `marker.delivered`).
7. **Leave-time question:** asked once a day after a trip. Trips live in page memory,
   so a reload before the event ends skips the question.

### The advisor

The model never receives leave times (`docs/DECISIONS.md`, 2026-10-17). It receives
slow-changing facts and signed yes/no trip conclusions. The conclusions reach the
model only if a travel refresh finished less than 5 minutes before the brief request.
On the first open of the day, the brief and the first travel refresh probably start
together. That ordering is not verified.

## Copy and metadata inventory

Sources: `components/timeline/ExternalEventDetails.tsx`,
`components/timeline/TravelWeather.tsx` and
`components/briefing/DailyBriefBubble.tsx`. "Proposed" is a starting point for the
owner's decision, not an agreed change.

### Travel lines

| Current text | Where | Problem | Proposed |
|---|---|---|---|
| "Outbound · walking: leave Nov 1, 1:15 PM, arrive Nov 1, 2:20 PM." | Drawer, dialog | Rigid role label; the date repeats on a same-day trip; lowercase mode | "Leave by 1:15 PM · walking, arrive 2:20 PM" |
| "Return home · walking: leave …, arrive …" | Drawer, dialog | Same pattern | "Head home 4:40 PM · home by 6:35 PM" |
| "Onward · …" | Drawer, dialog | Internal term | "Then leave by …" |
| "Origin: current device position." / "planned prior stop" / "journey correction" | Dialog | Internal provenance terms | Remove, or show only when the start is unusual ("from Home") |
| "Includes 15 min for thunderstorms. Consider transit or driving instead of walking." | Drawer, dialog, bubble | The owner considers the advice useless. It repeats on every leg. Ticket 218 specifies it. | Keep the margin once: "15 min added for thunderstorms". The owner decides on the mode advice. |
| "Available again Nov 1, 6:45 PM." | Drawer, dialog | Acceptable; the date repeats | "Free again 6:45 PM" |
| "Full-trip availability is unknown. Known travel spans still apply." | Drawer, dialog | Internal wording | "Return time unknown. Add Home in Settings to estimate it." |
| "Google Maps · Checked Nov 1, 8:00 AM. Estimates depend on attendance and current conditions." | Drawer, dialog | The disclaimer adds nothing | "Google Maps · checked 8:00 AM". Keep the attribution. |
| "Weather data by Open-Meteo.com (CC BY 4.0). Cadence derived travel margins from the forecast." | Drawer, dialog, bubble | The second sentence is internal | Keep the credit; drop the second sentence. |
| Route warnings, shown verbatim | Dialog | See below | Show only warnings a user can act on |
| "estimated within 3 hours of departure" | Drawer, dialog | Rule 2 wording | "Leave time appears at 1:00 PM" |
| "timing unavailable" | Drawer, dialog | Gives no reason or next step | Name the reason and offer Refresh travel |
| "Possible travel overlap" | Expanded row | Names no trip or time | "Overlaps your trip home (4:40–6:35 PM)" |
| "Calculated by Cadence from travel estimates as of 9:00 AM, Google Maps. Not written by the model." | Bubble | Long | "Calculated by Cadence · Google Maps · 9:00 AM" |

**Route warnings.** The dialog prints every string in `estimate.warnings`
(`ExternalEventDetails.tsx`, `renderTravelTiming`). In production these are Google's
route warnings, up to 10 per leg, plus Cadence's "Estimated arrival is after the
planned arrival time.". "Synthetic route. No provider call." comes from the bench
fixture (`app/design-system/TravelBench.tsx:107`). It cannot reach production because
the bench route is disabled in production builds. The display path is the same,
though, so production prints Google's warnings verbatim. Mark fixture text as
development-only so nobody mistakes it for product copy. The terms question about
hiding Google's warnings is logged in `docs/LEGAL.md` as L-013 and does not hold the
copy work.

### Event dialog metadata rows

The dialog shows 13 rows before any travel line: Source, Calendar, Time, Duration,
Location, Organizer, Attendees, Conference, Attachments, State, Source timezone,
Recurrence and Updated.

- Empty fields repeat "No detail available." (Organizer, Conference, Attachments).
- State shows raw provider values: "confirmed · busy".
- Source timezone shows an IANA name: "America/New_York".
- Recurrence shows an internal series ID and an ISO instant:
  "series-1 · 2026-11-01T05:00:00Z".
- Updated shows a raw ISO instant: "2026-11-01T12:00:00Z".

Proposed: show Time, Location and the travel lines first. Hide empty rows. Move
State, Source timezone, Recurrence and Updated behind a "More details" disclosure, or
limit them to development builds. Format every time in the account timezone.

## Visual inventory

These images come from the shipped components on the local design-system bench, with
synthetic data. They are not production screenshots. Numbered boxes mark each element,
and the side panel states what it does and what is wrong with it.

![Timeline and event drawer](../design-exploration/travel-departure-review/current-01-timeline-and-event-drawer.png)

![Calendar details dialog](../design-exploration/travel-departure-review/current-02-calendar-details-dialog.png)

![Expanded Behavior row](../design-exploration/travel-departure-review/current-03-expanded-behavior-row.png)

![Daily Brief bubble](../design-exploration/travel-departure-review/current-04-daily-brief-bubble.png)

![Travel Settings](../design-exploration/travel-departure-review/current-05-travel-settings.png)

![Leave-time question](../design-exploration/travel-departure-review/current-06-leave-time-question.png)

## Proposals

The mockups are generated concept images (OpenAI `gpt-image-2`, with the bench
screenshots as style references). They show direction, not final copy or layout.
Some generated times do not agree with each other. Read them as placeholders.
Provider-terms questions from this review are logged in `docs/LEGAL.md` (L-013, L-014).
Under the 2026-11-04 decision they do not hold any proposal.

### P1: Next departure on the Timeline

A persistent line at the top of the Timeline: "Next: leave by 1:15 PM for Afternoon
appointment", with mode, duration, margin, check time and Refresh travel. A "Leave
1:15 PM" label sits on the event marker. The travel span stays visible with the drawer
closed. Later trips show when their leave time will appear.

![P1](../design-exploration/travel-departure-review/proposal-P1-timeline-next-departure.png)

### P2: "Leave now" emphasis and a stale-estimate fallback in the drawer

Within 30 minutes of departure: "Leave in 12 minutes, by 1:15 PM". After expiry:
"Last estimate: leave by 1:15 PM · Checked 12:41 PM, may have changed · Refresh
travel" instead of no time.

![P2](../design-exploration/travel-departure-review/proposal-P2-drawer-leave-now-and-stale.png)

### P3: Optional leave reminder

A new sentence in How you travel: "Remind me to leave [10 minutes before]
departure.", off by default. Delivery uses browser push on web and native
notifications on the Mac. This is new scope. It needs a `docs/NOTIFICATION_SPEC.md`
change and a fresh route request when the reminder is due.

![P3](../design-exploration/travel-departure-review/proposal-P3-leave-reminder-setting-and-notification.png)

### P4: Daily Brief travel block that persists

The travel block survives a reload and updates when travel refreshes. After Close,
the bubble collapses to one line: "Daily Brief · Leave by 2:05 PM for Dentist ·
Open".

![P4](../design-exploration/travel-departure-review/proposal-P4-daily-brief-persistent-travel.png)

### Not visual

- **Refresh at the window boundary.** Request routes once when a trip enters the
  3-hour window while the Timeline is open. This spends budget; measure against the
  US$5 ceiling in `docs/COSTS.md`.
- **Development-only text.** Label fixture strings in bench data and keep them out of
  product copy paths.

## Decisions for the owner

1. Approve the copy direction: plain "Leave by" phrasing, and the metadata reductions
   above, before launch.
2. Keep or remove the weather mode advice ("Consider transit or driving instead of
   …"). Ticket 218 specifies it today.
3. Rule 1: allow a last-known leave time after 5 minutes, marked as a last estimate
   (P2, P4).
4. Rule 2: allow one automatic refresh when a trip enters the 3-hour window.
5. P3: add the optional leave reminder to scope.
6. Run the Ticket 165 directions handoff matrix under a spend cap.

## Candidate follow-up tickets

The copy and metadata pass is filed as Tickets 260–262 (`docs/TICKETS.md`), with
messaging entry P-015. The other candidates are not filed. Each one, when filed, needs
its own platform-impact table and messaging entry. Copy changes alter `docs/user-guide/travel.md` and in-app text, so
each one logs a `docs/MESSAGING_CHANGES.md` entry.

| Candidate | Web | Desktop | Marketing | Future mobile |
|---|---|---|---|---|
| Travel copy and metadata pass (Tickets 260–262) | `ExternalEventDetails`, `TravelWeather`, `DailyBriefBubble` | Same shared components | User guide wording only | Shared components; 390 px check |
| Next-departure line (P1) | `DayProgressTimeline` status line | Shared Timeline | None until released | Mobile web inherits |
| Window-boundary refresh | `lib/ui/travel.ts` | `apps/desktop/src/travel.ts` | None | Not applicable |
| Leave reminder (P3) | Web Push and `docs/NOTIFICATION_SPEC.md` | Native notifications | Messaging entry | Deferred with native mobile |
| Stale fallback (P2, P4) | Drawer and bubble | Shared | Messaging entry | Mobile web inherits |
| Bench and tests reflect Rules 1 and 2 | `app/design-system/CalendarBench.tsx`, resolver tests | Shared core tests | Not applicable | Not applicable |

## Method and limits

- This cloud session had no production sign-in. The QA sessions live in the owner's
  Mac Keychain, and no Mac folder was shared with the session. All screenshots come
  from `/design-system` on a local `next dev`, using bench fixtures.
- The bench shows the best case. Its clock is frozen, its estimates never expire, and
  it ignores the 3-hour window. It also omits the Travel by mode choice and the
  in-person/remote correction that production shows in the dialog.
- Not verified: whether the drawer and dialog lines change after expiry, or keep
  showing the last times; the order of the first brief and travel requests; any
  production state after October 27.
- The mockups are generated images and contain placeholder times.
