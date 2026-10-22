# Travel routing

Cadence estimates travel to located Calendar events and to Behaviors with a Where,
using Google Maps. The controls live in Settings, Travel; the Behavior form; and
Calendar event details.

## Set up travel

Settings, Travel has three inputs:

- **Travel estimates**: the toggle. The Google Maps disclosure sits beside it.
  Turning it on records your routing consent and asks for device location in the
  same click. Turning it off withdraws consent, clears temporary results and keeps
  the places you entered.
- **Home (optional)**: a full address. Trips home and Behaviors set to Home use it.
  Without Home, outbound and event-to-event estimates still work; the trip back stays
  unknown. Cadence never inserts a detour through Home.
- **Usual travel**: walking, cycling, transit or driving. Choose it before turning
  estimates on.

Select Save travel settings after changing Home or usual travel. Clear Home and save
to remove it. Calendar permission, routing consent, device permission and model
disclosure are separate. Saving a place alone turns none of them on.

Turning estimates on asks the browser or macOS for one foreground position. Cadence
does not save that position or send it from this request. When location is denied,
revoked, unavailable, stale or inaccurate, estimates start from Home or your previous
stop instead. Settings shows whether device location is allowed, not yet allowed or
blocked, and where to change it. Cadence does not track continuously or in the
background, and it does not prompt on every route.

## Set Where for a Behavior

Create or edit a Behavior and choose Where:

- **Not set** (the default): no travel estimate.
- **Anywhere**: no travel estimate; the Behavior fits wherever you are.
- **Home**: Cadence estimates the trip home when you are elsewhere. It needs Home
  in Settings, Travel.
- **A place**: type a full address. Cadence estimates the trip to it.

Travel estimates and scheduling advice work better when Where is set. With
completion places on, Cadence may suggest a Where; a suggestion never changes a
Behavior on its own.
Behaviors that had a location before October 19, 2026 show Where as A place with
the same text. Changing Where makes no Google Maps call; the next refresh looks up
a new place once.

Where synchronizes with the account and belongs in native Cadence database
backups; provider results and device samples do not. Full JSON includes Where,
place text and configuration history. CSV, JSONL and BehaviorLog omit Where and
place text. Configuration history keeps earlier values; changing Where does not
erase them.

## Save where you complete Behaviors

Completion places are off by default and separate from travel estimates. In Settings,
Completion places, select Set up completion places, choose how long to keep labels,
and select Save where I complete Behaviors:

- **90 days** (default): keeps the least about where you have been. Enough for
  suggestions; little history for the advisor to learn from.
- **1 year**: keeps a year of places, so Cadence and the advisor can learn seasonal
  patterns.
- **Until I delete them**: keeps every label until you delete it. The most history and
  the best insights; the most stored about where you have been.

Labels do not reach the Daily Brief yet. Switching to a shorter option asks first and
deletes older labels. Cadence also deletes labels past your choice every day.

When you mark an Occurrence Completed from Unresolved, on its own day and near its
scheduled time, Cadence checks the device position once, only if location is already
allowed. It never asks for permission at that moment. It compares the position with
your place markers on the device and saves one label: Home, a saved place or
elsewhere. It then discards the position. Nothing is saved when the position is more
than two minutes old, less accurate than 100 m, or between 150 m and 400 m from the
nearest marker. Needs decision choices, imports, other devices' marks and later
corrections never create a label. Changing a status away from Completed deletes its
label.

## Record a place marker

A marker is your own device's position for Home or a place you typed as a Behavior's
Where. Cadence never uses Google coordinates for labels. While completion places are
on, select **I'm here** when you are at the place:

- beside Home in Settings, Travel;
- below Where in the Behavior form, for Home or A place;
- in a one-line prompt on a Behavior whose place has no marker yet.

I'm here may show the browser or macOS location prompt, because you asked for it.
Update marker records the place again; Remove deletes that marker. Behaviors with the
same place text share one marker. A Home marker stops applying when you change the Home
address. **Not now** on a prompt turns these prompts off on every device; the other
I'm here controls stay.

## Where suggestions

After at least six labels in the last 60 days, a Behavior may show one line:

- usually completed at Home or at a saved place (80% or more of its labels);
- usually completed away from your saved places, which suggests adding that place;
- completed in different places (two or more places at 25% or more each), which
  suggests Anywhere.

A suggestion appears only when it disagrees with the current Where. Review Where opens
the Behavior's settings with Where filled in; nothing changes until you save. Dismiss
hides the suggestion until six more labels arrive and the rule still applies. The
rules carry versions (`place-label-rules@1`, `where-suggestion-rules@1`); every label
and dismissal records the version that produced it.

## Delete labels and markers

Settings, Completion places has Delete labels and Delete place markers, each with a
confirmation. Turn off deletes every label, place marker and dismissed suggestion.
Labels and markers synchronize with your account and are part of desktop database
backups. They are not part of Full JSON, CSV, JSONL or BehaviorLog exports.

## Inspect travel and correct a journey

The Calendar preview and details keep event markers at their scheduled starts.
Known travel segments extend the temporary magenta spans and Behavior overlap
borders. Expand a located Behavior row to inspect its own travel timing.
Text identifies travel-created overlap. Known free gaps remain free;
unknown legs cannot establish full-trip availability.

When routing is available, event details allow an in-person or remote choice and
a destination correction for that journey and event revision. Use for this journey
changes temporary routing only. It does not edit Calendar or a saved location.
Changes to a source withdraw old evidence. Leave and reopen the Timeline to discard
journey corrections.

## Refresh travel estimates

Estimates refresh when you open the Timeline without a current estimate, when an
event's time, location or attendance changes, when a Behavior's Where or time
changes, when your device has moved more than about 500 m since the last estimate,
or when you choose Refresh travel. Marking a Behavior, editing a Note or returning
to the window does not request again. Cadence keeps the latest estimate for this
browser session only and marks it as possibly stale after five minutes.

Each refresh estimates trips that leave, or must arrive, within the next three
hours. Later trips say "estimated within 3 hours of departure" until then. Driving
uses live traffic only for trips leaving within about an hour.

On opening the Timeline with a current estimate, Cadence reads your device
position once, without asking, to check whether you have moved. Device position is
read only on that open and during a refresh. Cadence never tracks in the background.

The status line shows Travel as of and the time the estimates were observed. After
the estimates expire, the line says they may be stale and keeps them visible until
you refresh. When a refresh fails, the line shows the reason instead.

Travel estimates have a monthly limit per account. When it is used up, the
Timeline keeps the last estimates, marked as possibly stale, and says on which date
estimates resume. Refresh travel is hidden until then.

## Open navigation

Event details show available Calendar location text and a Search in maps link.
Links open Apple Maps on Apple devices (Mac, iPhone and iPad) and Google Maps
elsewhere. A verified route can offer Directions with your usual travel. Apple Maps
links say when cycling must be chosen in the app. A navigation link sends the
location only when you open it; search does not verify route timing.

## Recipients and retention

Reviewed routing sends endpoints, your usual travel and relevant times to Google Maps.
It does not send Calendar titles, notes, account IDs or Calendar credentials.
Cadence keeps device samples used for travel and route results in temporary memory
and excludes them from sync, exports, backups and telemetry. Place markers you record
with I'm here are the exception: they are stored with your account, synchronize, and
enter desktop backups until you remove them or turn completion places off. To avoid paying Google again for
the same place, Cadence stores Google's place identifier for each looked-up
location with your account, keyed by a one-way fingerprint of the typed text.
It never stores the text or coordinates there. Turning travel off deletes them. Google retention follows its own
terms. Cadence cannot erase a request already processed by Google.

Raw locations and route results are not sent to the Daily Brief model. Deterministic
travel facts stay separate from the briefing. Updating travel never silently
regenerates an attempted briefing or resets its dismissal state.

Desktop saves Home, Where and other places you enter offline. Hosted estimates require a linked,
synchronized account and connectivity. Provider, deployed-web and installed-macOS
acceptance remain separate release gates in `docs/qa/travel-release.md`.


A new Daily Brief also prepares travel estimates for the rest of today, within
Cadence's eight-leg limit. These estimates appear in Cadence's calculated travel
line; they are not sent to the model. While the Timeline is visible, Cadence checks
an already-allowed device position once per minute. Only movement beyond 500 m,
allowing for position accuracy, requests new routes. Marking an Occurrence removes
its affected travel from the display without buying new estimates.

When clearing a decision adds a stop absent from the cached trip, Cadence hides the
old guidance and offers Refresh travel. A changed duration estimate does the same.
Neither change calls Google Maps automatically.
