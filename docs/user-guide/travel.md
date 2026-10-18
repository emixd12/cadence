# Travel routing

Live routing remains disabled pending provider review and rollout. The implemented
controls use the existing Behavior form, Settings and Calendar event details.

## Set up travel

In Settings, Travel, enter an optional saved base, choose walking, cycling, public
transit or driving, and choose Google Maps or Apple Maps for navigation links.
Read the routing disclosure and select its checkbox before enabling proactive
estimates. Select Save travel settings. Clear the base field and save to remove it.
Turning travel off clears temporary results and preserves user-entered locations.
Calendar permission, routing consent, device permission and model disclosure are
separate. Saving a location alone enables none of them.

A missing base suppresses only final-return advice. Known outbound and event-to-event
routes remain available. Cadence never inserts an automatic detour through base.
Final return and full-trip availability stay unknown when the base or return is unknown.

## Check device permission

Check device location permission requests one foreground position through the
browser or macOS permission flow. This explicit check does not save or send the
position. Denied, revoked, unavailable, stale or inaccurate samples cannot establish
a current origin. Add a base for an immediate-origin fallback, or continue with
known event-to-event legs. Cadence does not track continuously or in the background.

After routing is enabled on a reviewed deployment, an already permitted current
position supplies the immediate origin. Cadence does not prompt on every route.

## Add a Behavior location

Create or edit a Behavior and enter a full address in Location (optional). Clear
the field to remove it. Existing status, schedule and reminder controls keep their
meaning. Saved locations synchronize with the account and belong in native Cadence database backups;
provider results and device samples do not. Full JSON includes Behavior locations
and configuration history. Other export formats omit location text.
Configuration history retains previous
Behavior locations; clearing a current location does not erase earlier history.

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
event's time, location or attendance changes, when a Behavior's location or time
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
A verified route can offer Directions with the selected supported mode. Apple Maps
links disclose when cycling must be selected in the destination app. A navigation
link sends the source location only when clicked; search does not verify route timing.

## Recipients and retention

Reviewed routing sends endpoints, chosen mode and relevant times to Google Maps.
It does not send Calendar titles, notes, account IDs or Calendar credentials.
Cadence keeps device samples and route results in temporary memory and excludes
them from sync, exports, backups and telemetry. To avoid paying Google again for
the same place, Cadence stores Google's place identifier for each looked-up
location with your account, keyed by a one-way fingerprint of the typed text.
It never stores the text or coordinates there. Turning travel off deletes them. Google retention follows its own
terms. Cadence cannot erase a request already processed by Google.

Raw locations and route results are not sent to the Daily Brief model. Deterministic
travel facts stay separate from the briefing. Updating travel never silently
regenerates an attempted briefing or resets its dismissal state.

Desktop saves user-entered locations offline. Hosted estimates require a linked,
synchronized account and connectivity. Provider, deployed-web and installed-macOS
acceptance remain separate release gates in `docs/qa/travel-release.md`.


A new Daily Brief also prepares travel estimates for the rest of today, within
Cadence's eight-leg limit. These estimates appear in Cadence's calculated travel
line; they are not sent to the model. While the Timeline is visible, Cadence checks
an already-allowed device position once per minute. Only movement beyond 500 m,
allowing for position accuracy, requests new routes. Marking an Occurrence removes
its affected travel from the display without buying new estimates.
