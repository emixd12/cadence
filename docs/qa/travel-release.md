# Travel routing release evidence

Created September 22, 2026; updated October 22, 2026. Ticket 165 remains open.
Its current gates are listed in "Ticket 165 remaining gates" under the October 22
section at the end. The owner authorized USA
billing, the existing Cadence Google Cloud project, an initial US$20 routing
allowance, credential setup and live testing. This record separates that setup
from deployed-web and installed-desktop travel acceptance.

## Authorized setup — September 22, 2026

Google confirmed the existing billing account upgrade and the CLI verified
`billingEnabled: true` for Cadence (`habit-tracker-498717`). The separate
Cadence Calendar project remains unchanged. A US$20 custom-period budget starts
September 22 without automatic renewal. Alerts trigger at 50%, 90% and 100%,
excluding credits. [Cloud budgets](https://docs.cloud.google.com/billing/docs/how-to/budgets)
are notifications, not spending caps.

The dedicated local server key permits only Routes and Geocoding APIs, from
the machine's observed IPv4 and IPv6 egress addresses. The ignored `.env.local`
holds the key. The first unused key was revoked after the CLI unexpectedly
included it in operation output; the replacement value was captured privately.
Provider readback confirms 120 requests/day and 30/minute for Compute Routes
and Geocoding. Other API quotas remain unchanged. Hosted egress clearance is
still required; this local key cannot serve arbitrary Vercel egress.

The database admission function now enforces a nonrenewing initial allowance
of 40 refreshes. It reserves US$0.50 before provider work and retains failed or
partial reservations. A global transaction lock protects the lifetime sum of
the permanent daily counters. A refresh makes at most 19 geocodes and 18 route
calls, including driving refinement and retry. At the verified
[global pricing](https://developers.google.com/maps/billing-and-pricing/pricing),
the conservative upper bound is US$0.365 before tax and without free credits.
US$0.50 is a reservation, not observed billing. Recheck prices before raising
the allowance or changing call bounds. The local ledger has reserved one slot
for public-landmark acceptance; preserve that reservation across any later
hosted rollout. Never reset or prune a live allowance ledger.

The owner confirmed USA billing. The applicable non-EEA
[service terms](https://cloud.google.com/maps-platform/terms/maps-service-terms/)
permit Routes and Geocoding content without a corresponding map and prohibit
combining that content with a non-Google map. Cadence's reviewed boundary is
transient, attributed timing display without a map. Navigation links use
user-authored destination text. Route content and raw endpoints remain excluded
from model input; this review grants no model projection or training use.
Provider retention is governed by Google; Cadence does not promise provider erasure.

The project Supabase executable has an invalid code signature. The installed
official CLI 2.109.1 works through `SUPABASE_CLI_BINARY_OVERRIDE`. A clean local
reset replayed all pending migrations, including travel and the concurrent
historical-completion snapshot. The reset recreated the database with a broad
port binding; the operator stopped it immediately and restored `127.0.0.1`
with the existing volume. The original stopped container remains for rollback.
Generated public/GraphQL types now come from that replayed schema. The real SQL
smoke verifies 40 reservations, six per owner/day, no day-boundary renewal,
and denied unauthorized resets. No hosted migration has run in this phase.

## Documentary support

| Requirement | Official support | Implementation boundary |
|---|---|---|
| Route request | [Compute Routes](https://developers.google.com/maps/documentation/routes/reference/rest/v2/TopLevel/computeRoutes) requires a response field mask and supports origin, destination, selected mode, departure time, arrival time, warnings, and fallback information. | The adapter requests duration, static duration, warnings, transit stop times, and fallback only. It requests only step mode, duration and transit timing for access/egress calculation; never polylines, route tokens or alternatives. |
| Selected transport mode | [Routes travel modes](https://developers.google.com/maps/documentation/routes/reference/rest/v2/RouteTravelMode) defines walking, bicycle, transit, and drive. | Cadence maps only the saved selected mode. It never probes another mode as a fallback. |
| Transit timing | [Compute Routes](https://developers.google.com/maps/documentation/routes/reference/rest/v2/TopLevel/computeRoutes) limits `arrivalTime` to transit and permits either arrival or departure time. | Transit requires provider itinerary times. Missing schedule times fail as unavailable. |
| Geocoding | [Geocoding policies](https://developers.google.com/maps/documentation/geocoding/policies) restrict caching and require attribution when results display without a Google map. | Address resolution is transient and bounded to five candidates. Cadence stores no geocodes. |
| Route display | [Routes policies](https://developers.google.com/maps/documentation/routes/policies) require attribution for Routes content without a Google map. | The narrow route result carries `Google Maps` attribution for later approved presentation. |
| Credential handling | [Google Maps security guidance](https://developers.google.com/maps/api-security-best-practices) recommends API and application restrictions. Server web-service keys use IP restrictions where enforceable. | The adapter reads only a server environment credential and is disabled without the explicit clearance value. It has no browser credential path. |
| Terms and region | [Maps service terms](https://cloud.google.com/maps-platform/terms/maps-service-terms) apply outside the EEA. [Geocoding policies](https://developers.google.com/maps/documentation/geocoding/policies) state that EEA billing has separate terms. | The owner confirmed USA billing on September 22. The non-EEA deterministic-display boundary is recorded above; model projection remains disabled. |

## Open operator gates

Historical list from September 22. Later sections record each outcome. The current
list is "Ticket 165 remaining gates" in the October 22 section at the end.

- Complete private-account Calendar-location and current-device acceptance under
  the separate routing consent. Model projection remains disabled.
- Establish fixed hosted egress or another approved server credential method.
  The verified local IP-restricted key is not a hosted deployment credential.
- Deploy the verified budget admission migration before enabling hosted routing,
  carrying forward the one live-test reservation. Preserve the lifetime ledger.
- Review provider retention and deletion terms. Cadence does not retain route
  requests, geocodes, device samples, or route responses, but this does not
  establish provider erasure.
- Public-landmark acceptance passed below. Private-account, deployed-web and
  installed-desktop travel acceptance remain open.

## Repository evidence

- The server adapter has an explicit `CADENCE_TRAVEL_PROVIDER_CLEARANCE=approved`
  gate. Its default state rejects before it reads a request body, source data, or
  provider data. The server reads its environment configuration without transmitting it.
- The adapter uses `cache: "no-store"`, a five-second call limit, an eight-leg
  batch cap, two concurrent calls, a 45-second batch deadline, and one transient
  retry per batch.
- The service requires an owner/grant/source freshness fence before each call and
  after each response. A late response is rejected.
- Quota records contain counters and dates only. They contain no endpoints,
  device samples, geocodes, or route results.
- Focused provider-free tests cover disabled clearance, selected-mode projection,
  transit schedule rejection, retry bound, late-response rejection, and malformed
  quota decisions.

## Local synthetic acceptance — September 22, 2026

The Codex browser used `http://127.0.0.1:4324/design-system` with synthetic
fixtures. Desktop-width and 390px-wide checks verified the existing preview,
details dialog, keyboard dismissal/focus return, map URL projection and Settings.
No browser or native permission prompt ran. The denied-location Settings fixture
used a stub. No map navigation or provider call occurred.

The complete-trip fixture retains the 2:30–4:30 event marker and attendance,
shows 1:30 departure and 6:30 availability, and highlights the 5PM Behavior
collision. The no-base fixture retains outbound timing and span, reports unknown
full-trip availability, and removes only return occupancy. A DOM regression also
verifies travel inspection for a located Behavior without Calendar events.

Native storage tests passed 108/108, including reopen, CAS, outbox, existing
backup/restore and account-sync paths. This is synthetic storage evidence, not
installed macOS permission acceptance. The native foreground adapter compiled;
real OS denial/revocation, cold start and navigation remain unverified.

At initial repository acceptance, the invalidly signed Supabase binary blocked
clean replay and generated types. The September 22 setup above resolved those
local checks using the installed official CLI. Hosted deployment remains open.

No rollout version exists. Routing remains disabled by default. Rollback first
removes `CADENCE_TRAVEL_PROVIDER_CLEARANCE=approved`, disables travel and clears
transient route state. Preserve user-authored locations, additive schema and
independent tracking, Calendar, sign-in and Daily Brief behavior. Follow
`docs/OPERATIONS.md` before any separately authorized rollout.

Repository checks passed: agent, interaction and resolver contracts; TypeScript;
ESLint with no errors; full Vitest with two workers; web and desktop builds;
shared-core portability; design-system validation; and diff whitespace checks.
The default-concurrency full run hit one unrelated release-CLI test timeout;
the two-worker run passed. Five integration files (29 tests) remain skipped under
the existing suite configuration. Final counts and review disposition are recorded
in `STATUS.md`.

Initial parent Vitest run: 262 files passed, five skipped; 2,111 tests passed,
29 skipped. The initial final run overlapped edits to two unrelated briefing
workbench tests. The subsequent settled run passed. Lint reports ten existing
warnings and zero errors. The travel changes add no lint warnings.
The post-review full run needed loopback access for the existing synthetic
reminder-server tests. Its authorized rerun passed; no external email was sent.

Marketing verification passed: `marketing:check` (28 files, zero diagnostics) and
`marketing:build` (five pages). This verifies the canonical disclosure output;
it does not establish a released travel capability.

Independent review found two defects, both corrected before the next review.
First account link now recognizes saved travel preferences and imports private
travel data through the existing atomic account-sync path. It matches category
identities, retains location history, and uses existing conflict review and retry
guards. Provider-free regressions cover interrupted local commits and conflicting
saved bases. Located exact Behaviors retain inbound routing when their duration
is unknown; return timing and complete availability remain unknown.

Final independent code review returned `ship` with no findings after both corrections.
This accepts the repository implementation behind its disabled provider gate.
It did not close the database, provider, deployed-web or installed-macOS gates.
The authorized setup subsequently completed local database and public-provider
checks. Deployed-web and installed-macOS travel gates remain open.

## Live public-landmark acceptance — September 22, 2026

The production adapter passed walking, cycling, transit and driving for outbound
and return requests between public New York landmarks. Each successful result
had positive duration, ordered timestamps and Google Maps attribution. A short
transit trip without transit steps stayed unavailable; an imprecise landmark
stayed ambiguous. Neither case silently changed the selected mode or guessed a
location. No private account data or device position entered these calls.

Live testing exposed a driving timestamp defect. The first traffic request used
`readyAt`, which had become past by provider receipt. Google returned
`INVALID_ARGUMENT`. The adapter now probes the future requested time and, for
arrival targets, refines once at the candidate departure. Regression tests cover
both departure targets and the 18-call bound with a failed refinement retry.
Denied geocoding responses now report provider failure instead of no location.
Final review also found that an already-late candidate could remain in the past.
Both driving queries now use readiness and a fresh service-clock floor, allowing
ten seconds for receipt. The estimate preserves the evaluated departure and late
arrival. Clock-controlled regressions cover past/equal candidates, elapsed fencing
and immediate departures without adding provider calls. These edge cases have
provider-free evidence; the earlier live future-trip evidence remains separate.

All probes together used eight geocode requests and 18 route requests, within
one reserved slot. The conservative list-price ceiling is US$0.31 without free
credits; actual billed cost is not yet verified. The local lifetime ledger has
one reservation, leaving 39 slots (US$19.50 reserved capacity). Requests and
provider results remained transient; the evidence contains pass/fail counts only.

After the live corrections, agent, interaction and resolver checks, TypeScript,
lint, all tests and the web build passed. Vitest passed 2,135 tests across 262
files; 29 tests across five integration files remain skipped. Lint retains ten
existing warnings and no errors. Independent acceptance review returned `ship`
with no findings. The quota smoke passed against real local Postgres before the
live reservation; do not reset that ledger to repeat the empty-database smoke.

The local app update is independent: preview.42 comes from released main commit
`362eb97e`, without the unreleased travel changes. Existing account Daily Brief
and Calendar timing consent were already enabled. Installed advisor acceptance
resumed after manual Mac unlock and existing-login Keychain approval. The app
opened its linked account, but Calendar and Daily Brief were unavailable because
the build omitted `VITE_CALENDAR_BROKER_ORIGIN`. The corrected preview.42 uses
`VITE_CALENDAR_BROKER_ORIGIN=https://cadence-blush-three.vercel.app` during the
existing `release.mjs preview-build 0.1.1-preview.42` invocation. Keep this public
setting explicit in future builds: the release helper treats it as optional,
and the root `.env.local` did not supply it.

The corrected build passed all 11 release checks, strict deep code signing and
installed/candidate equality. Its binary SHA-256 is
`4ec4d436a356aeaf20884abf19c4f90993faca6569802a6d56cd6f226da915e9`.
The fresh pre-replacement backup passed integrity and foreign-key checks.
Installed Settings confirms Daily Brief and selected Calendar timing enabled.
Calendar events load; linked-account synchronization reports current data.
The first automatic briefing showed an error; Vercel records HTTP 409 from
`POST /api/advisor/brief` at 13:53:08 UTC on September 22. The response's specific
error code was not exposed in runtime logs, so the cause remains unverified.
After navigating to Settings and back, the existing attempted-state guard hid
the bubble. No attempt, dismissal or preference state was reset to force another
generation. Enablement is verified; successful installed generation remains open.
The previous preview.41 and integrity-checked data backups remain available.

## Daily Brief recovery — September 22, 2026

The normal browser retry returned HTTP 200 and `state: ready` after the isolated
production hotfix `dpl_6JTeeGQ7kZFdZ252AfoGMnHydu9L`. The visible horse bubble
displayed the briefing. Released `362eb97e` plus one context predicate correction
and its regression comprise the hotfix. Preserved occurrences may retain old or
null configuration lineage after a valid fenced sync; rejecting their count caused
`context_incomplete`. Final revision checks and stale-state fencing remain intact.
The original regression failed twice; fixed tests passed. Required checks, 1,896
tests (29 skipped), production build and independent review passed. No presentation
or consent state was reset. Installed preview.42 retains its enabled default setup.

## Hosted routing setup — September 22, 2026

The authorized hosted migration push applied travel settings, travel quota, and
`20260922143000_carry_travel_pilot_reservation.sql` only. Readback confirms one
lifetime reservation and 39 remaining slots. The rollback-only local SQL smoke
admits exactly 39 further refreshes, rejects renewal on a new day, and protects
the ledger from authenticated resets. The live ledger remains unchanged.

Vercel uses its existing team-mode OIDC issuer. Google workload identity pool
`vercel-cadence` and provider `cadence-production` require the immutable Cadence
team/project IDs, production environment, exact subject and audience. The
`cadence-travel` service account has only Service Usage Consumer in the project;
only that exact production subject may impersonate it. No service-account key or
paid static-IP add-on was created. Production configuration is saved with the
routing clearance disabled until candidate acceptance.

Hosted calls use short-lived OAuth for Routes and Geocoding v4. The local
IP-restricted key retains Geocoding v3. Provider readback confirms the separate
v4 GeocodeAddress quota is 120/day and 30/minute. The runtime restricts address
resolution to one precise result. v4 lacks v3's partial-match signal; the two
parsers are not semantically identical. Multiple or coarse results remain
ambiguous. No private location or hosted routing request has run in this phase.


## Hosted runtime and private-account acceptance — September 22, 2026

PR #58 merged as `b48654d1` and deployed to production with routing disabled.
The owner then set `CADENCE_TRAVEL_PROVIDER_CLEARANCE=approved` in the
production environment; redeploy `cadence-drxrpk40n` made it effective.
Unauthenticated GET/POST to `/api/travel/routes` and GET `/api/travel/settings`
still return 401. The signed-in owner account reports `configured: true`.

Owner acceptance used the existing production web app in the desktop app's
browser pane. Settings saved travel enabled, the separate routing consent,
transit mode and a public saved base. The Timeline hook issued its own
authenticated refreshes once the pane was visible and focused; a hidden pane
correctly suppresses both Calendar loading and travel refresh. The browser's
geolocation permission was `denied`, so every request carried `device: null`.

Cloud Monitoring for project `habit-tracker-498717` (owner credentials, read-only)
confirms the hosted identity path: 5 STS `ExchangeToken` and 5 IAM
`GenerateAccessToken` responses returned 200, 10 v4 `GeocodeAddress` calls
returned 200 and 1 `ComputeRoutes` call returned 200. No service-account key
exists. Vercel runtime logs show only routine request lines and no errors.

Private-account evidence: today's Calendar had an unlocated 3 PM event and a
7–9 PM event whose Calendar location text (`NudiBranch`) is imprecise. The
Calendar details correction (attendance in person, destination
`220 E Chicago Ave, Chicago, IL 60611`) with saved base
`1999 Campus Dr, Evanston, IL 60208` produced one transit return leg: ready
01:00Z, depart 01:02:54Z, arrive 02:20:36Z, 4,662 s, `Google Maps` attribution,
no fallback, no warnings, five-minute expiry. The outbound leg stayed unknown by
design because the preceding 3 PM commitment has no location; no automatic base
detour was inferred. Collisions were empty. The imprecise location produced no
leg and no guessed endpoint. Route content and endpoints were transient; this
record keeps timing only.

Defect found: the geocode candidate filter accepted only `street_address`,
`premise` and `subpremise` types. Precise `ROOFTOP` venues such as
`Norris University Center, 1999 Campus Dr, Evanston, IL 60208` and
`Museum of Contemporary Art Chicago, 220 E Chicago Ave, Chicago, IL 60611`
(types `establishment`, `point_of_interest`) were treated as ambiguous, so
named venues never became endpoints. The corrected filter rejects coarse types
(localities, postal codes, routes, administrative areas) and keeps the
granularity, single-result and overflow rules. The stale Settings sentence
about pending provider review is removed. Fix status is recorded below.

Ledger: the hosted global counter for 2026-09-22 reads 7 (1 carried
public-landmark reservation plus 6 owner refreshes); the owner counter reads 6,
which is the daily owner limit, so further owner refreshes today return
`quota_exceeded` until the local day changes. That is expected enforcement.
Conservative list-price spend for this phase is under US$0.15; billed cost is
not yet verified.

Installed-macOS travel acceptance remains open: the preview.43 build requires
the owner's signing and updater environment in the shell.

PR #59 merged as `049cbf0f` with the geocode venue-type fix and the removed
Settings sentence. Production deployment `cadence-m9a49eeqx` is Ready; the
signed-in owner Settings page no longer shows the provider-review sentence and
the routes endpoint still reports `configured: true`. A live venue-geocode
re-check on production awaits the next owner local day because the owner
counter is at its daily limit; unit tests and the local v3 probe confirm both
venues resolve. Installed-macOS travel acceptance remains the only open gate.

## Installed macOS acceptance — September 22, 2026

Preview.43 was built from merged main with the owner's signing and updater
environment, passed DMG, updater-archive and signature verification, and replaced
the installed preview.42 after a fresh database backup (integrity and foreign-key
checks pass) and a rollback zip of the previous app. The old preview.42 process was
still running from the morning; it was quit cleanly before the first preview.43
launch. Cold start applied local migration 16 and created the travel settings
table. The account remained signed in and Calendar markers loaded.

Defect: Settings showed `The account snapshot rewrites append-only history.` and
account synchronization stopped. Cause: hosted migration
`20260922010000_add_travel_settings.sql` canonicalized every existing
`behavior_configuration_events` row (`location_text: null` in both configurations;
`location_text` appended to baseline `changed_fields`), while the desktop copy and
its saved sync baseline hold the pre-travel shape. The planner compares history
entities exactly, so every configuration event looked rewritten. Fix: the planner
canonicalizes configuration events before comparison, and local migration 0017
applies the same canonicalization to SQLite. Fingerprints and write shapes are
unchanged. Regression tests cover the false positive and a real rewrite.

The installed Travel panel renders. `Check device location permission` returned
`Location unavailable` without a macOS prompt; System Settings lists Cadence.app
under Location Services switched off. Whether macOS reports denied or not
determined for that state, and why no prompt appeared for the ad hoc signed
preview, remains open. The panel shows `Saving…` on the Save link during the
permission check; that copy is a follow-up. Owner re-acceptance continues after
the toggle and the next preview build.

## Quota admissions deployed — September 22, 2026

PR #64 (`bdd6bd2f`) shipped Ticket 166. The authorized hosted push applied
`20260922200000_travel_route_quota_admissions.sql`; the same push also applied the
pending `20260922034223_advisor_historical_completion_times.sql`, which replaces the
private advisor snapshot function and is additive. Hosted migration list readback shows
both applied with no drift. The quota function now checks the 40-refresh lifetime
budget, a 24 per owner-local-day limit and the 100 per UTC-day limit before
incrementing; rejected attempts leave counters unchanged. The rewritten local budget
smoke is text-checked in this release; run it against local Postgres before the next
hosted quota change. Owner web re-acceptance resumes after the owner local day rolls
over, because today's owner counter (11 attempts under the old function) stays above
the earlier limit until then.

## Installed macOS acceptance, continued — September 23, 2026

Preview.44 (from `91d7c83c`, with the sync canonicalization fix) completed account
synchronization on the installed app at 02:58 UTC after Keychain approval; local
travel settings then matched the hosted account (enabled, saved base, transit,
consent). Preview.45 (branch `codex/desktop-location-diagnostics`, adding a
`reason` code to unavailable and denied location results) replaced it after a fresh
integrity-checked backup and rollback zip. Cold start applied local migrations 16
and 17 and preserved the synced travel settings across the quit and relaunch. The
installed Timeline shows `Travel as of 9:23 AM` with the `Refresh travel` link, so
the installed app completed a hosted route request under the Ticket 166 and 167
policy. The owner's Chrome on production shows travel spans for the same day.

Native device location remains unavailable on the installed preview. With Location
Services on and `Cadence.app` switched on in System Settings, the adapter reports
`Device location: not yet allowed` and the check ends with `Diagnostic: timeout`:
macOS returns `notDetermined`, `requestWhenInUseAuthorization` shows no prompt on
any of the three displays within twelve seconds, and `tccutil reset Location
app.cadence.desktop` fails. The bundle is ad hoc signed (`TeamIdentifier=not set`),
so every preview build is a new identity to macOS and the existing Location
Services entry belongs to an earlier build. The travel code path is exercised
through the saved base and located commitments; the device-origin path on macOS is
blocked by the deferred Apple-trusted signing gate (Ticket 115), not by the adapter.
Web device location on iPhone Safari returned a current position on September 22.
Superseded: the signing attribution was refuted on September 23 and 27; see the
October 22 investigation.

Two follow-ups recorded for Ticket 166/167 owners: the browser pane inside the
desktop host reports `document.hidden` while the user views another pane, so the
hook correctly suspends and aborts in-flight requests, but an aborted request has
already been admitted server-side and consumes one quota slot; and the Settings
permission check shows `Checking…` on the check button as intended.

## Native location gate re-attributed — September 23, 2026

The ad hoc signing explanation recorded above was tested and refuted. The installed
preview.45 re-signed with a stable local identity ("Hermes Local Code Signing") and
run with its window active still reported `Diagnostic: timeout`. A standalone AppKit
probe with its own bundle identifier (`app.cadence.locationprobe`, stably signed, with
usage descriptions) logged `servicesEnabled=1 status=0`, called
`requestWhenInUseAuthorization`, `startUpdatingLocation` and `requestLocation`, and
received `kCLErrorDomain code=1` (denied) two seconds later with the status still
`notDetermined` and no prompt on any of the three displays. Restarting `locationd`
did not change the result; no configuration profile or MDM enrollment is present.
These experiments rule out ad hoc identity churn and the Cadence adapter, but not
signing itself: both the preview and the probe used a local self-signed identity, and
no Apple-trusted Developer ID certificate is available (Ticket 115). Two causes remain
open: a machine-level Core Location condition on the owner's Mac, and a possible
requirement for Apple-trusted signing before Core Location prompts. Next checks: Screen
Time restrictions and a reboot on this Mac, a second Mac, and a Developer ID signed
build once Ticket 115 provides one. The adapter's `reason` codes
made this attribution possible.

## Native location gate attributed to Apple-trusted signing — September 23, 2026 (superseded)

Superseded October 22, 2026: Developer ID builds rc.2 and rc.3 showed the same
missing prompt on September 27 and 29. Signing was not the gate. The October 22
investigation below records the missing Hardened Runtime location entitlement.

After a full reboot, the owner clicked the installed check with the Cadence window
active: `Device location: not yet allowed`, `Diagnostic: timeout`, no prompt. In the
same session Google Chrome (Developer ID signed and notarized) is authorized under
Location Services and Google Maps resolves the owner's position. Core Location on
this Mac therefore serves an already-authorized Apple-trusted client while silently
refusing both the ad hoc preview and the self-signed re-sign as new clients. Chrome's
success does not exercise the new-client prompt path, so it narrows but does not
close the question. Both causes stay open: a machine-level condition affecting new
authorizations, and an Apple-trusted signing requirement. The discriminating tests
remain a second Mac and a Developer ID signed build (Ticket 115). Until then the installed
app plans travel from the saved base and located commitments only, which the
Settings copy already states.

## Base geocode reuse policy check — September 24, 2026

Google's Geocoding API policies state that the place ID is exempt from the
caching restrictions in the Maps Platform Service Terms and may be stored
indefinitely, while other Geocoding content stays subject to those
restrictions. Source, read September 24, 2026:
https://developers.google.com/maps/documentation/geocoding/policies

Cadence's base geocode reuse stores only place-ID endpoints. The reuse branch in
`lib/services/travel-route-refresh.service.ts` caches an endpoint only when its
point kind is `place_id`, keyed by owner and travel settings revision, in server
memory for at most 30 days with a 500-entry cap. It stores no coordinates,
formatted addresses, base text, route content or device samples, and nothing is
persisted. A reuse hit skips the base geocode; every other endpoint still
geocodes, so quota admission continues to happen before the first provider call
of a refresh. The check passes and `BASE_GEOCODE_REUSE_ENABLED` is now `true`.
Owner re-acceptance on web and installed desktop, with Cloud Monitoring geocode
counts before and after, remains open under Ticket 167.

## Admitted requests finish while hidden — September 24, 2026

The September 23 installed acceptance recorded that the desktop host reports
`document.hidden` while the user views another pane, and that the hook then
aborted an in-flight routes request the server had already admitted, so the
quota slot was spent without a view. The shared hook now cancels a request only
before its routes call. Once that call has started, the request finishes even if
the window blurs, hides or unmounts; the view or failure is cached for the page
session and shown on return without a second request, and an immediate remount
joins the routes call still in flight instead of starting another. Settings and
Behavior location saves invalidate cached and in-flight travel at module level,
even when no Timeline is mounted, so requests started earlier neither share nor
cache their results and the next Timeline open requests fresh estimates; before
this, a view cached before a settings save stayed visible until it expired.
Settings changes, revoked location permission and going offline still cancel as
before. DOM tests cover the hidden, pre-commit and unmount cases. Installed
desktop re-acceptance remains open with the other Ticket 166 and 167 gates.

## Travel beside the Daily Brief (Ticket 170) — September 26, 2026

Model projection of travel stays disabled. Instead, the shared Timeline projects its
existing travel evidence with `packages/core/src/services/brief-travel-guidance.ts` and
publishes it to the horse bubble for the same local day. The bubble lists up to four
calculated lines — travel-created overlaps with Unresolved Behaviors, the next
departures, the return or an unknown-return note — plus "Calculated by Cadence from
travel estimates as of … Not written by the model." A hypothetical brief option that
overlaps travel occupancy is labeled. Expired or stale estimates withdraw the section.

No extra route request, quota use, source-change rule or refresh policy changed.
Travel refresh never regenerates the brief or resets its dismissal. Missing base
suppresses only the return line; unknown travel is never treated as free.
`tests/brief-travel-guidance.test.ts` covers full trips, missing base, expiry, stale
legs, every mode and option overlap; `tests/briefing-analysis-pipeline.test.ts`
asserts travel is absent from model input. Native location and navigation gates
remain under Ticket 165; deployed and installed acceptance remain under Ticket 174.

## Signed native acceptance preparation — September 27, 2026

Candidate `0.1.1-rc.1` passes Apple artifact checks. Signed native runtime acceptance remains unverified.
The parent owns installed-app control. This preparation read source and ran synthetic tests only.
It did not query device position, change permission settings, schedule notifications, or modify tracking data.

Bundled Node `24.19.0` passed 88 tests across ten focused files:
`foreground-location.dom`, `travel-navigation`, `travel-settings.dom`,
`native-reminder.resolver`, `desktop-native-spike`, `desktop-native-coverage-probe`,
`desktop-local-day`, `desktop-notification-activation`, `desktop-reminder-repair`,
and `desktop-retry.dom`. These checks use simulated native boundaries.
Earlier actual delivery, activation, OS-limit and sleep/wake evidence remains in
`2026-08-30-desktop-native-boundary.md` and `2026-08-30-desktop-lifecycle-release.md`.
It does not establish signed-identity acceptance on macOS 27.0 (`26A428`).

Installed checks, after protected installation and account acceptance:

1. Activate Cadence and open Settings. Record the device-permission line without coordinates.
   A not-determined native permission returns `prompt` without requesting authorization.
   Click **Check device location permission**. Record prompt appearance, response, state and diagnostic reason.
   The native adapter stops after twelve seconds. Its reasons distinguish `inactive`, `services_off`,
   `status_1`/`status_2`, Core Location errors and `timeout`.
   An available result must also pass the shared sixty-second freshness and hundred-meter accuracy bounds.
   Preserve coordinates in memory only. The Settings check does not save or send the sample.
   Denial/revocation and success require separate observed outcomes; do not infer either from signing.
   If the signed app still times out, keep the second-Mac/new-client test open. Do not reset TCC.
2. Open an authorized located Calendar event in Timeline. Click its visible navigation link.
   Confirm the destination and selected mode in the actual external Maps surface.
   The installed path calls `auth_open_url`, then `NSWorkspace.openURL`.
   It uses source-authored location text, never provider route content.
   Record whether the link says Search or Directions. Directions require a current matching route leg.
   Apple Maps cycling links disclose that the user must choose cycling there.
3. Record notification permission and product coverage in Settings. Request permission only through the visible action.
   Record the retained count, eligible count, target, verified horizon and last readback time.
   Limited coverage must show the first unverified reminder. Successful scheduling alone proves no delivery.
4. For a data-preserving delivery smoke, use one unique `cadence-spike.signed-rc1.<suffix>` request.
   Submit harmless title/body content and a future instant through the existing `native_notifications` bridge.
   Read back that exact ID and fire time before quitting. Quit before it fires.
   Observe delivery, then click the notification without launching Cadence first.
   Verify Cadence opens and preserve activation evidence before event draining.
   `cadence-spike.*` proves native launch, not product Occurrence targeting.
   Product targeting needs its separate existing synthetic-Occurrence evidence.
   Cancel only this exact ID; verify it disappears from both pending and delivered readback.
5. Keep Cadence running across owner-coordinated system sleep and wake.
   Record power-log sleep/wake times and the process start time.
   Before focusing Cadence or selecting Refresh, inspect the persisted coverage readback and reconciliation receipts.
   Confirm automatic renewal after wake, then inspect Settings and its accurate OS-readback horizon.
   A focus/resume event alone does not prove system wake.

Probe constraints: `main.tsx` exposes an operator-only `?bench=native`, without a product menu or test-send control.
The direct bridge requires a supported installed WebView context. A separate probe cannot substitute for installed launch evidence.
Do not drain `native_events` beside Product; its read clears the shared buffer and can consume activation/delivery evidence.
Do not run the capacity probe against the daily-use notification schedule; synthetic requests can evict product requests.

The audit found that `cancelProbes()` included product `cadence.local.*` IDs.
The source fix limits cleanup to `cadence-spike.*`. Capacity probes now reject product
pending IDs or unavailable readback before scheduling either batch. Both regressions
failed before the fix; six focused tests, lint, resolver checks, and diff checks pass.
The readback guard cannot lock concurrent product scheduling; use the exclusive native
bench and keep capacity probes away from the daily-use schedule. Candidate rc.1 predates
this fix; replacement-candidate acceptance remains required.

### September 27 Developer ID location result

The parent installed notarized `0.1.1-rc.2` through the browser-downloaded,
quarantined DMG and normal Gatekeeper Open confirmation. In the fresh local
working directory, Settings showed `Device location: not yet allowed`. The
foreground Check device location permission action finished after the native
twelve-second deadline with `Diagnostic: timeout`; no permission prompt was
observed. The installed Info.plist includes both `NSLocationUsageDescription`
and `NSLocationWhenInUseUsageDescription`. Apple documents foreground use and
the usage keys in [requesting location authorization](https://developer.apple.com/documentation/CoreLocation/requesting-authorization-to-use-location-services).

Developer ID signing alone does not resolve this host's permission-prompt issue.
This result does not establish its cause. No permission database reset, global
location change, coordinate logging, or provider routing occurred. A second
Mac or isolated macOS-user test remains needed to distinguish host state from
an app defect. The existing saved-location fallback remains available.


### September 28 signed Google Maps handoff

Notarized rc.3 rendered the dedicated test Calendar's timed public-landmark event.
Its visible Search in Google Maps action opened Chrome at Central Park, New York.
The installed executable SHA-256 is
`89171f8fe538714d1de72da2855678aaa4f990a644ea8eff0becab44094ec8c2`.
Evidence: `/private/tmp/cadence-calendar-render-20260928.png` and
`/private/tmp/cadence-maps-search-20260928.png`. Search has no transport mode; no
directions or device-location success is claimed. Proactive routing remained off.
Ticket 165's navigation search handoff gate passes. Native location remains open
pending the second Mac or isolated macOS account. See the Apple distribution QA
record for candidate provenance and protected primary-data restoration.


### September 29 — signed rc.3 second-Mac location check

On a clean Cadence installation on an M2 Pro MacBook Pro running macOS 26.7,
the owner reported no initial permission prompt. Settings showed “not yet allowed”;
macOS Location Services listed Cadence with its switch off. Enabling that switch
and retrying produced Allowed and a current position available. The app stated
that the check did not save or send the position. Coordinates were not collected;
proactive travel stayed off. This passes manual grant/retry and foreground location
acquisition. It does not establish automatic first-prompt behavior or resolve the
first Mac's timeout. The exact rc.3 candidate was unchanged.

## Tickets 213–214: monthly budget and efficient refresh — October 18, 2026

Implemented in source; not deployed. Hosted routing has refused every request
since September 25 because the pilot's 40 lifetime refreshes were used.

What changed:

- `20261017150000_travel_monthly_budget.sql` adds `reserve_travel_provider_spend`.
  Each provider call reserves its list price first: US$0.005 for a geocode or a
  Routes Essentials call, US$0.010 for Routes Pro or transit. The owner ceiling is
  US$5.00 per local month; a US$10.00 per UTC day circuit breaker covers all owners.
  Refusals reserve nothing and return the renewal instant.
- `20261017150100_travel_place_cache.sql` stores a text fingerprint and place ID per
  looked-up location. Turning travel off deletes the rows through a trigger.
- The refresh service looks up only places not stored, fences sources once before
  the first paid call and once before returning, routes only legs leaving or
  arriving within three hours, and runs lookups four at a time.
- Driving uses one call per leg. Traffic-aware (Pro) routing applies only to legs
  departing within about an hour; later legs use static Essentials routing.
- The resolver skips legs between consecutive stops at the same place ID.
- The client no longer refreshes on status, Note or duration-history changes. On a
  Timeline open with a current view, one silent foreground read requests again only
  after more than 500 m of movement beyond both accuracy radii.
- When the budget is used up, the Timeline keeps the last plan as stale, says
  "Travel estimates resume on {date}." and hides Refresh travel.

Local evidence: a transaction applying both migrations and
`tests/sql/ticket-213-travel-monthly-budget-smoke.sql` passed against the existing
local schema and rolled back. A clean `db reset` through the reviewed Docker proxy
then applied all migrations and the seed; the smoke passed again. The reset's final
storage health request failed because the stale local API gateway container was
not running; this is unrelated to the schema. The local database held only two
`example.invalid` test accounts before the reset. Type generation was refused by
the proxy's unnamed-container rule, which was not widened; information-schema
readback matched the hand-written types. All published bindings stayed on
`127.0.0.1`, and the Cadence containers were stopped afterward.

Remaining gates, in order:

1. Deploy the owner-approved privacy and terms text (approved October 18, 2026;
   `docs/LEGAL.md` L-012) with or before Tickets 213–214. The draft in
   `components/settings/LegalContent.tsx` adds Google's required Maps notice and links
   to the Terms, names Google Maps Platform as a processor, and discloses place-ID
   storage, foreground location reads and the monthly limit. Set the page and
   retention-table dates to the deployment date if it is not October 18, 2026.
2. Owner-authorized hosted `db push` of both migrations, then deployment.
3. Owner web re-acceptance with `CADENCE_PERF_LOG=1`: record calls per refresh and
   refresh p50/p95 from `travel.refresh`, `travel.place_lookups` and
   `travel.route_legs`, and compare Cloud Monitoring geocode and Routes counts.
4. Google Cloud quotas: Geocoding v4 reads 120/day and 30/minute. Place storage
   reduces lookups, but more users will need higher quotas.
5. Installed desktop re-acceptance inherits the hosted route.
6. Whole-day Daily Brief routing is implemented in the completion pass below.


### October 18 completion pass: local acceptance

Tickets 213–214 remain open for release acceptance. Source implementation is complete.

- The shared launcher requests day scope once per generated Daily Brief. The shared
  travel hook queues it behind an active Timeline request, fences account/date,
  deduplicates remounts, and retains consent, foreground and budget checks. The
  day scope retains the existing eight-leg safety bound. No route value enters
  model input. Web and desktop callers both pass the current linked account.
- Foreground movement checks run every minute with existing permission only.
  Stationary and background checks make no routing request. The threshold remains
  more than 500 m beyond both accuracy radii.
- Calendar title/etag-only changes do not refresh routes. Status/Note writes during
  a request no longer discard its paid work. Core removes affected legs and
  occupancy after a manual decision without inventing a replacement route. Returning
  to Unresolved can reuse the original page-memory estimates.
- Budget refusals apply across source changes, preserve the last same-day plan as
  stale and unlock Refresh travel at the reset instant without a reload.
- The private workbench's existing account-access read reports the local month and
  reserved list-price spend. Failed readback says unavailable instead of zero.
- `20261018051402_fence_travel_place_cache_consent.sql` prevents late lookup writes
  from restoring place IDs after travel is disabled. Deploy this third migration
  together with the two October 17 migrations.
- Generated local TypeScript types match the new tables and RPC. No Google
  coordinates are fetched or stored; routing uses place IDs directly.
- Vitest, ESLint and TypeScript now exclude `.claude/**`, which contains an unrelated
  nested checkout. Before this exclusion, that checkout ran stale tests against
  this checkout's aliases and made lint inspect its generated bundles.

A clean local reset through the reviewed Docker proxy returned zero after starting
the pre-existing stopped Cadence gateway, REST and test-mail containers. It applied
all migrations through `20261018051402` and the seed. Published bindings remained
`127.0.0.1`. The SQL smoke passed after replay. The opt-in contract passed concurrent
reservations at both ceilings and the October-to-November local-midnight boundary.
The contract uses only synthetic accounts and rolls back its injected clock; final
Auth-user count is zero. Reproduce it with:

```sh
CADENCE_TRAVEL_SQL_CONTRACT=1 npm run test -- tests/travel-budget.contract.test.ts
psql postgresql://postgres:postgres@127.0.0.1:55322/postgres -X -v ON_ERROR_STOP=1 -f tests/sql/ticket-213-travel-monthly-budget-smoke.sql
```

Operator readback, using an explicitly selected owner and a read-only session:

```sql
select local_month, reserved_microdollars,
       reserved_microdollars / 1000000.0 as reserved_usd
from public.travel_spend_owner_month
where user_id = :'owner_id'::uuid
order by local_month desc;
```

Browser QA used `127.0.0.1:4321`. A synthetic account response showed US$0.125 for
October in the actual workbench account-access panel at 1280px and 390px. Neither
viewport overflowed horizontally. The response interception and viewport override
were removed. No account comparison or paid provider call ran. Authenticated
Timeline, production provider p50/p95 and installed-desktop acceptance remain open.

Release sequence: apply all three migrations, deploy the matching app and approved
legal text, verify schema/application parity, then run bounded owner acceptance
with performance timing enabled. Keep the feature's existing provider-clearance
gate. The old production budget is exhausted, so a successful before-change latency
baseline is not available from a fresh old-code request; retain any existing timing
logs and label that limit explicitly. Do not substitute synthetic timing for production.


Final checks: `agents:check`, `interactions:check`, `resolvers:check`, lint, web and
desktop typecheck, `design-system:check`, web build, desktop build and `git diff
--check` passed. The full suite passed 2,599 tests with 31 skips; the two opt-in SQL
contract tests passed separately. Lint reported two existing warnings (the workbench
purity suppression and the unused `_omitted` fixture binding). Desktop bundling
reported existing dependency `use client` directive warnings. No hosted migration,
production deployment, Google Cloud change, paid route or model request ran.


## October 18 production release and bounded owner QA

The owner authorized the three migrations, production deployment, and Google Maps QA
with saved and Calendar locations, capped at US$0.50. The release branch
`codex/travel-monthly-budget-release` starts at production `9bf1194`, preserving
the September CPU fix and excluding the advisor branch's unreleased changes.
PR: https://github.com/emixd12/cadence/pull/107. Initial release commit: `b97ecd6`.

All three migrations deployed to the existing linked project. Migration history
reads back through `20261018051402`. Hosted-generated table and RPC definitions
match the release types; only generator helper parentheses and hosted PostgREST
version metadata differ. Both new spend ledgers and the place cache started empty.
No old pilot counter was reset or removed.

Production deployment `dpl_7ePteYsUBqwQHUfufXVrUJduEDL2` reached READY at
05:28:14 UTC. Both `app.cadence-me.com` and the legacy Vercel alias serve it.
The clean CLI upload contains the reviewed release worktree at `b97ecd6`;
the CLI deployment omits Git metadata. Approved October 18 Privacy and Terms
content is live, including Google Maps Platform, the Maps end-user terms link,
place-ID storage, foreground reads, and retention disclosures. L-012 is closed.
Login, Privacy and Terms return 200. Protected screens redirect unauthenticated
requests; both travel APIs return 401.

The sampling deployment overrides only `CADENCE_PERF_LOG=1`. Project environment
values remain unchanged. Deployment `dpl_6FfpW18n8tTRaJUVckLKJLvqkN3j` reached READY at
05:44:15 UTC without that override, restoring existing project configuration.
Its metadata records `7db9e3c696b3315bbf641320fcd838001060394c`.
The new `.vercelignore` excludes local desktop artifacts, signing state, private
exports and linked-provider metadata from CLI uploads. A dry-run manifest verified
those exclusions. The intermediate artifact-bearing upload was canceled before
promotion; its app source was unchanged and contained no signing secret.

### Provider and cost evidence

QA used the signed-in owner's existing consent, saved base, selected Transit mode,
and Calendar locations. Direct acceptance requests used `device: null`.
The original Calendar strings contain clinic/room descriptions. Five initial
lookups produced one resolved, two ambiguous and two unresolved results; Cadence
correctly withheld routes. Temporary request-only corrections used the street-address
portions of two existing Calendar locations. No Calendar or saved-place record changed.

The first corrected refresh looked up two new strings and returned two current
transit estimates, each attributed to Google Maps. Three repetitions used the
place cache and made no geocoding calls. The observed durations were 2,338 and
734 seconds; route data remained transient and outside model input.

| Sample | New geocodes | Routes | Server refresh ms | Browser elapsed ms |
|---|---:|---:|---:|---:|
| Original Calendar text | 5 | 0 | 3806.4 | 4347 |
| Street-address corrections | 2 | 2 | 3598.4 | 3802 |
| Cached repeat 1 | 0 | 2 | 3480.4 | 3607 |
| Cached repeat 2 | 0 | 2 | 3232.0 | 3415 |
| Cached repeat 3 | 0 | 2 | 2972.9 | 3169 |

Four successful two-leg samples: median server duration 3356.2 ms; nearest-rank
p95 3598.4 ms. This passes the five-second target for this owner scenario.
This small sample does not establish six-leg or multi-user load performance.
The exhausted old pilot prevents a fresh successful before-change baseline;
no retained successful baseline was available. Two operator probe errors
(a future start date and an object instead of a revision string) failed before
any reservation; they are excluded from latency statistics.

Cloud Monitoring independently reports seven GeocodeAddress and eight ComputeRoutes
calls, all HTTP 200, in the bounded window starting 05:27 UTC. The owner ledger
reserves US$0.115: 7 × US$0.005 plus 8 × US$0.010. Transit stays conservatively
reserved at Pro list price. This is reserved list-price usage, not an invoice.
Provider quota readback remains 120/day and 30/minute for Geocoding v4 and Routes;
no quota or billing configuration changed.

Web Timeline at 390px has equal viewport and document widths. It shows
`Travel as of` and Refresh travel. Manual refresh completes. Opening the current
Timeline and manual refresh add no Google spend because all relevant locations
are cached and no leg is due in the three-hour window. Existing browser location
permission caused normal UI requests to include a device sample; no Google route
call used it in this window. Direct route acceptance did not request location.

### Release verification and desktop

The production-based candidate passes 2,365 tests, with 31 skips. Agent,
interaction, resolver, design-system, lint, web/desktop type checks, and both
frontend builds pass. The two SQL contracts passed separately before rollout.
GitHub verify and CodeQL pass.

A matching local desktop candidate, `0.1.1-preview.47`, passed strict app signing,
read-only DMG comparison, updater-signature verification and archive comparison.
It is an ad hoc preview, not Apple-notarized distribution. Source: `b97ecd6`;
artifact hashes are in its ignored `artifact-verification.json`.
macOS 27's Rust proc-macro stripping issue initially prevented compilation;
build-only `CARGO_PROFILE_RELEASE_STRIP=none`,
`CARGO_PROFILE_RELEASE_BUILD_OVERRIDE_STRIP=none` and
`CARGO_PROFILE_RELEASE_BUILD_OVERRIDE_DEBUG=2` resolved it. No source change
or security exception was required. Upstream:
https://github.com/rust-lang/rust/issues/157750.

The verified candidate replaced installed preview.45 after an online SQLite
backup and retained app rollback under the private Cadence Release directory.
The current host is Apple Silicon, macOS 27.0.1 (26A434). The process launches,
but `SecItemCopyMatching` waits for macOS Keychain approval while reading the
existing account session. Installed UI acceptance remains pending that owner
action. Do not treat the frontend build or app process as runtime acceptance.
No credential, private location, raw route response or database backup is
included in this public evidence.

Read-only installed-data verification compares all 30 SQLite tables with the
pre-install backup: zero changed, new or removed tables; quick_check passes and
foreign-key violations are zero. The preview.45 rollback ZIP was extracted,
compared file-by-file including permissions and symlinks, and signature-verified
before its redundant unpacked copies were removed. The native Keychain prompt
requires owner input; Computer Use refuses SecurityAgent interaction.

### Release review corrections — October 18

The response now includes the decision and duration basis for future Behaviors,
including resolved occurrences omitted from the route. Shared core withdraws the
cached trip if a newly Unresolved stop was omitted or its learned duration changed.
Both clients offer manual Refresh travel. These changes make no provider call.
Resolved stops still filter locally; an unchanged estimate or range schedule keeps
its cached guidance. Regressions cover the resolver, service and rendered controls.

Duration history now participates in both database fences. Calendar intentionally
keeps Ticket 214's two reads: the initial snapshot and final revision check.
A Calendar change during this bounded window can still consume reservations before
the final check rejects the trip. Eliminating that window would require another
Calendar read and still could not make an external provider transaction atomic.
No stale trip is delivered. The review's proposed third read was not adopted.

### Final production readback

Deployment `dpl_68Po4U87qX4YXxG9epjkPwU3sdHz` is READY and owns both production
aliases. It contains review commit `f239e72c0f32a4e46721dfa4e4e5776ace6da404`.
A final saved/Calendar-location request returned 200, two current attributed legs,
29 Behavior source records and no provider place IDs. Browser duration: 4.159 s;
server timing was not sampled. Total reserved QA spend: US$0.135 of US$0.50.
Cloud Monitoring confirms seven geocodes and ten routes, all 200. Final Timeline
status says Travel as of; the 390px viewport has no horizontal overflow. The
bounded deployment log scan returned no error records.

All required local checks and both frontend builds pass at the review commit:
2,370 tests passed, 31 skipped. Preview.48 matches that source and passed all
artifact checks. It remains staged under the ignored release directory; installed
preview.47 still waits for the owner's Keychain password and Allow action.
Tickets and PR #107 remain open for installed runtime acceptance. The final
candidate still needs installation and runtime verification after that prompt.

### Installed acceptance follow-up

Owner Keychain approval allowed preview.47 to open. Runtime inspection found the
local build helper had omitted `VITE_CALENDAR_BROKER_ORIGIN`; preview.48 therefore
was not installed. Preview.49 includes the existing production connector origin,
passes artifact verification, and loads the linked account and selected Calendar
in the installed app.

Synchronization then exposed an existing account-sync defect: 229 freshly
generated, untouched local Occurrences duplicated hosted schedule identities.
All 229 have no Notes, decisions, time sessions, reminders or imported
interventions. No private database repair was applied. A shared planner correction
retains hosted identities for only new, unreferenced, unresolved duplicates.
Native atomic apply frees their unique schedule slots before inserting hosted
rows. Protected duplicates fail closed. The correction includes resolver and real
SQLite regressions; 2,378 TypeScript tests and 110 native tests pass.

Platform impact: desktop uses the shared planner and native transaction ordering;
web tracking is unchanged and hosted data keeps its identities. Marketing is not
applicable. Future mobile inherits the planner rule. Installed verification of
the corrected candidate remains in progress.


Preview.50 is installed from source commit `ce7d671`. Artifact checks verify the
app, archive, updater signature, DMG and minimum-target metadata. The private
pre-install SQLite backup is retained. The changed native binary triggered
another macOS Keychain prompt while reading the existing session. A process
sample confirms `SecItemCopyMatching` in `auth_secret_get`; Computer Use cannot
operate this security prompt. Runtime convergence and protected-data preservation
checks remain pending owner action. No manual database repair was applied.

The final source passes agent, interaction and resolver checks, lint, web and
desktop type checks, 2,378 TypeScript tests (31 skipped), 110 native tests, and
both frontend builds. Native formatting check reports existing formatting drift
in unrelated files; no repository-wide formatting was applied.

A read-only selected-Calendar check found 13 events across October 19–23, with
10 location fields. This does not establish six route legs on one day. No extra
Maps call was made for that check. The two-leg timing sample remains the only
live performance evidence; six-leg and before/after comparisons remain unverified.


### Final installed acceptance — October 18, 2026

The owner cleared the second Keychain prompt. Installed preview.50 completed
normal synchronization and displayed “Account data is current.” The account-sync
cursor advanced to `2026-10-18T06:34:26.509Z`; no outbox mutations remain pending.
Read-only comparison with the pre-install backup confirmed:

- All 1,456 existing status events and 13 time sessions are byte-for-byte intact.
- All 34 existing Notes remain intact. No prior resolved Occurrence was removed
  or changed to another status.
- All import mappings, imported Notes, imported interventions, Behavior definition
  events and Behavior configuration events remain intact. Hosted history was added.
- The planner removed 229 untouched independently generated duplicates. Normal
  hosted reconciliation also removed three older untouched Occurrences. None
  contained a Note, decision, status history or completed timestamp.
- SQLite quick-check is `ok`, foreign-key errors are zero, and no duplicate
  schedule identities remain. No private database repair was applied.

The native app loaded selected Calendar context. Raising its window activated
foreground travel and displayed “Travel as of 2:35 AM” with Refresh travel.
Refresh travel disabled while pending, then completed and re-enabled. The
current three-hour window contained no route legs, so these native checks made
no Google Maps call. The cumulative reserved QA cost remains US$0.135. The
production owner-account two-leg runs above cover actual saved/Calendar routing.
No tracking decision, Note, saved address or Calendar event was edited for QA.

Tickets 213–214 functional acceptance is complete. The measured performance
claim is limited to four two-leg samples. Six-leg and pre-change comparisons
remain unmeasured; the exhausted old pilot could not supply a successful
baseline. Current-device native location and Apple-trusted distribution remain
separate Tickets 115/165 gates. The main promotion follows PR #107 and the
existing matching-marketing-deployment procedure.

## Ticket 165 permission path, prompt investigation and directions plan — October 22, 2026

Owner decisions on October 22: accept the manual macOS permission path and make it
clear in the app; investigate why signed Cadence for Mac shows no first prompt; test
the directions handoff after Ticket 215 deploys. Privacy-policy conflicts are
logged, not blocking. This work changed source only. It ran no hosted migration,
deployment, signing, publication or Google Maps call, and it read no device position.

### Signing no longer gates device location

Signed Cadence for Mac 0.1.3 was published October 22, 2026 (Tickets 115, 178 and
181). Developer ID signing and notarization are available. Device location does not
wait for them. The Developer ID candidates rc.2 (September 27) and rc.3 (September
29) already showed the missing prompt, so earlier notes that blame signing are
superseded.

### Manual permission path in Travel Settings

While travel is on and device location is not allowed, not yet allowed or timed
out, the Travel Settings panel shows guidance below the device-location line:

- Mac app: "To use your current position, turn on Cadence in System Settings ›
  Privacy & Security › Location Services, then choose Check again." **Open
  Location Services** calls the new native command `open_location_settings`. The
  command opens one fixed URL,
  `x-apple.systempreferences:com.apple.preference.security?Privacy_LocationServices`,
  and accepts no input.
- Browsers: the existing site-setting guidance, or Safari Websites on iPhone and
  iPad, followed by Check again.
- Both: "Saved places and Calendar trips keep working without device location."
  **Check again** asks for one foreground position and is disabled while a request
  runs. It does not save or send the position.

The guidance stays hidden during the toggle's own first request, so it never
competes with an OS prompt. The interactions are `INT-TRAVEL-006` and
`INT-TRAVEL-007`. DOM tests cover desktop not yet allowed, blocked and timeout,
retry, opener failure, travel off and four browser cases. The bench shows the desktop
state; a 375px check found no horizontal overflow.

Not verified: the installed app opening the pane. On this Mac (macOS 27.0.1,
26A434) the Privacy & Security settings extension declares the legacy identifier
`com.apple.preference.security` and a `Privacy_LocationServices` anchor. The pane
was not opened because the owner's System Settings window was in use.

### Missing first prompt: investigation

Finding: signed Cadence builds enable Hardened Runtime but did not sign the
Hardened Runtime location entitlement. This is a well-evidenced defect. It is not
yet demonstrated to be the only cause.

Evidence, read-only on the first Mac:

- Installed Developer ID Cadence 0.1.2 reports `flags=0x10000(runtime)` and Team
  `HK26VT477G`. Its signed entitlements are only the App ID, team and Keychain
  group. 0.1.3 was built from the same `Entitlements.plist`; its installed
  signature was not read here.
- Apple's Hardened Runtime documentation lists
  `com.apple.security.personal-information.location` under Resource Access. Its
  entitlement page says to enable Hardened Runtime or App Sandbox and then select
  Location.
- Google Chrome on this Mac is Developer ID signed with Hardened Runtime, is
  authorized for Location Services, and signs this entitlement.
- Preview builds are ad hoc signed with Hardened Runtime and no entitlements, so the
  September 22–23 preview results fit the same cause. The September 23 probe's
  signing flags were not recorded; it neither supports nor refutes the finding.
- On the second Mac (September 29) Cadence was listed with its switch off and no
  prompt appeared. Turning it on by hand and retrying returned a position. That fits
  an entitlement that blocks only the prompt; this reading is not verified.
- Retained `locationd` logs on this Mac (about five days) contain no Cadence
  authorization request, so they cannot discriminate.

The native adapter (`apps/desktop/src-tauri/native/location.m`) shows no defect.
It creates the `CLLocationManager` on the main queue and keeps it alive until
completion or the 12-second deadline. It calls `requestWhenInUseAuthorization`
only while Cadence is active and only when the status is not determined. macOS
reports a grant as `kCLAuthorizationStatusAuthorizedAlways`; the SDK marks
`kCLAuthorizationStatusAuthorizedWhenInUse` unavailable on macOS, so the handler is
correct. `Info.plist` carries both `NSLocationUsageDescription` and
`NSLocationWhenInUseUsageDescription`.

Fix:

- `apps/desktop/src-tauri/Entitlements.plist` adds
  `com.apple.security.personal-information.location = true` for production builds.
- `apps/desktop/scripts/verify-entitlements.py` accepts that key without profile
  authorization and requires it to be `true`. Every other entitlement still needs
  the profile. The shipped "Cadence Desktop Developer ID" profile grants only the
  App ID, team and Keychain group, so without this change the next production
  build would fail verification.
- Tests: verifier cases for the profile-free location key, a false value and an
  unlisted runtime exception, plus a check of the repository plists.

Limits: Firefox's macOS geolocation code notes that macOS often does not prompt
even when it reports that it will. The manual path stays in the app either way.
Previews keep no entitlements; location on ad hoc previews stays unsupported.

### Owner prompt test (signed build required)

The entitlement fix ships separately from main in PR #134. Run the prompt test
on a signed build made from main, not from this branch: a Ticket 215 build carries
SQLite migration 0018 and the Where synchronization contract, which can break
Behavior sync for a linked account before the hosted Where migration. Recommended
build: the 0.1.4 candidate after PR #134 merges; fallback: an unpublished
`0.1.4-rc.1` from an isolated checkout. The steps, build commands and version
reasoning are in `docs/qa/2026-10-22-desktop-location-entitlement.md` on main.

- Main check: a new macOS user, or a Mac that never ran Cadence. Do not reset TCC
  or change global location settings.
- Optional: the first Mac's main user, with the main-based candidate only. Main has
  no desktop migration after 0.1.3, so reinstalling 0.1.3 rolls back.

After the hosted Where migration and a signed build from this branch exist, check
this branch's own controls on that build: Open Location Services opens System
Settings at Location Services, and Check again returns the new state.

### Directions handoff test plan — run after Ticket 215 deploys

Do not run this yet. It needs Ticket 215's hosted migration, web deployment and a
desktop build with SQLite migration 0018, all owner-gated. Directions need a
current route leg, so each case makes Google Maps calls. Run it under an
owner-approved spend cap.

Current source rules (`packages/core/src/services/travel-navigation.ts`,
`lib/ui/navigation-platform.ts`):

- Desktop always uses Apple Maps. Web uses Apple Maps when the platform or user
  agent names Mac, iPhone, iPad or iPod, and Google Maps elsewhere.
- Directions replace Search only when the event has a current route leg ending at
  it and a usual travel mode is set. Otherwise the link says Search.
- Apple Maps uses `daddr` with `dirflg` `w`, `r` or `d`. Cycling has no flag; the
  details show "Choose cycling in Apple Maps; this link cannot preselect it."
  Google Maps uses `/maps/dir/?api=1&destination=…&travelmode=…`, with `bicycling`
  for cycling.
- The link carries the user's source text only, never provider route content.
- Only Calendar event details have a navigation link. A Behavior with Where = A
  place gets travel timing in its expanded row and no navigation action.

Fixtures, in the dedicated test Calendar and the owner test account:

- E1: a timed event starting one to three hours ahead, inside the three-hour
  routing window, at a public landmark reachable with the usual travel.
- B1: a Behavior with Where = A place at a different public landmark, scheduled
  inside the same window and before E1.
- Travel on, Home set, usual travel Walking first. Device location allowed on each
  device, or Home as the origin where it is not.

Matrix. For each row, open Timeline, choose Refresh travel, open E1's details,
record the link label, then open the link and record the destination and mode
shown by the Maps app:

| Surface | Expected app | Expected label |
|---|---|---|
| Installed Cadence for Mac | Apple Maps app | Directions in Apple Maps |
| Safari on Mac | Apple Maps | Directions in Apple Maps |
| Chrome on Mac | Apple Maps | Directions in Apple Maps |
| Safari on iPhone or iPad | Apple Maps app | Directions in Apple Maps |
| Chrome on Windows, Linux or Android | Google Maps | Directions in Google Maps |

Mode checks: repeat one Apple row and the Google row with Transit and Driving
(Pro routing within about an hour). Then run Cycling: Apple rows must show the
cycling notice and open Apple Maps with no preselected mode; the Google row must
open with bicycling. Negative checks:

- Before any refresh, or after estimates expire, E1 says Search, not Directions.
- With travel off, E1 says Search.
- B1's expanded row shows its travel timing and no Search or Directions link.
  Record this as current behavior; a Behavior navigation link would be new scope.

Record each row's label, app, destination text and mode. Record no coordinates,
route durations or provider responses.

### Ticket 165 remaining gates

- Owner prompt test above, on a main-based signed build with the location
  entitlement (PR #134).
- Installed check of Open Location Services and Check again on a signed build from
  this branch, after the hosted Where migration.
- Directions handoff matrix above, after Ticket 215 deploys.
- Search handoff passed on September 28; manual grant, retry and foreground
  acquisition passed on September 29. They need no rerun unless the native path
  changes again.
