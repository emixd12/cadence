# Connector production acceptance: Tickets 236, 240, 241 and 242 (November 11, 2026)

Run `conn-accept-20261111` (ledger `.intent/acceptance/conn-accept-20261111/`). An agent
ran it against production (`https://app.cadence-me.com`, `main` at `1232f7cd`) as test
account A, with A's kept Supabase session as a Bearer token and the Cadence QA Chrome
profile for the UI. Output kept statuses, counts, field names and times only.

Earlier live evidence for these tickets came from a disposable local stack with development
test-login (October 19–22, 2026). This run is the first on the hosted deployment.

Documentation review, November 12: the results below remain the reporting agent's
observations. This review did not rerun live acceptance or inspect account credentials.
The [PR #239 release packet](https://github.com/emixd12/cadence/pull/239) records
0.1.10 installed on the test Mac. Installed connector acceptance remains open; another
installation is not its prerequisite.

## Preflight

Initial result:

`npm run qa:preflight -- --suite connectors --run-dir .intent/acceptance/conn-accept-20261111`
exited 10: ready 9, owner steps 2, waiting 2.

- Ready: `op-service-token`, `vault-google-a`, `vault-hevy-a` (`hevy-owner`),
  `qa-chrome-profile`, `google-browser-a`, `supabase-session-a`, `cadence-web-a`,
  `gcal-connection-a`, `hevy-connection-a`.
- Owner steps at that point: the vault items `outlook-test-account-a` and
  `icloud-test-account-a` were missing.
- Waiting on them at that point: `outlook-connection-a` and `icloud-connection-a`.

Later results: the owner added `outlook-test-account-a`, and the rerun reported
`outlook-connection-a` ready after the agent connected it. The iCloud vault item also
exists, but its fields could not be read (`agent-secret` exit 5). No usable Apple test
identity was available to this run, so `icloud-connection-a` renewal failed (Ticket 240).

## Ticket 236: Hevy (owner's Hevy Pro account, decision 2026-11-11)

**Passed on production web.**

| Check | Result |
|---|---|
| Unauthenticated `GET` of `/api/hevy/{connection,activities}` | 401 |
| `GET /api/hevy/connection` | 200, `connected`, generation 1 |
| `GET /api/hevy/activities`, 31 days (2026-10-12 to 2026-11-11) | 200 in 1.2 s; `complete`; 5 of 5 pages; count before 49, after 49; 0 duplicates; 11 workouts |
| Response fields | Only `id`, `kind`, `startAt`, `endAt`, `duration`, `localStartDate`, `revision`, `fieldAvailability` per workout; no title, exercise, set, weight, routine or note field. Location and source timezone report `unsupported` |
| Reversed range, 42-day range, a future day, a malformed date | 400 `invalid_request` each |
| New workout | An agent added one private workout, "Cadence test (connector acceptance)", 19:10–19:25Z, through `POST /v1/workouts` (201; Hevy count 49 → 50). Additions only; nothing edited or deleted |
| Today's read after the addition | `complete`, count 50/50, one workout 19:10:02Z–19:25:02Z, 900 s |
| Timeline, 1280 and 390 px | "Recorded activity · Hevy", "Workout", "2:10 PM–2:25 PM", "15 min"; no title |
| Settings › Connections › Hevy | Connected; discard disclosure, "Refresh Hevy", "Disconnect Hevy"; the revocation sentence says Hevy keeps the key until the user removes or regenerates it |
| `DELETE /api/hevy/connection` | 200, `disconnected`, generation 2, revocation key `hevy_api_key` |
| Read after disconnect | 409 `not_connected` |
| Reconnect (preflight renewal, `connection.mjs connect`) | `connected`, generation 3; today's read `complete` again |

Not live-testable with this account: non-Pro rejection and histories above 500 workouts
(the account has 50). The owner may delete the test workout; the two Ticket 311 test
workouts were already gone before this run (Hevy count 49).

## Ticket 240: iCloud Calendar

**Not run. Needs an owner decision.**

- The owner reported that attempts to create an Apple Account for testing returned
  "account cannot be created". No usable Apple test identity was available to this run.
- A vault item named `icloud-test-account-a` now exists, but its fields could not be read
  (`agent-secret` exit 5), so the preflight renewal failed.
- Production status for A: `disconnected`, generation 0 (never connected on production).
  The route is configured; unauthenticated requests return 401.
- Options: run with the owner's own Apple Account and an app-specific password under the
  2026-10-19 custody decision (owner-run live tests may use real Apple credentials), or keep
  Ticket 240 live acceptance and the iCloud part of 241 step 6 recorded as waiting.

## Ticket 242: Outlook Calendar

**Passed on production web for a personal Microsoft account (rerun, November 11, 23:30–23:59
ET).** The owner created the identity and the vault item `outlook-test-account-a` and handed
the whole run, including the test events, to the agent. The preflight then reported
`vault-outlook-a` ready.

| Check | Result |
|---|---|
| Configuration (before connect) | `POST /api/outlook-calendar/connection` `{"target":"web"}` returned an authorize URL on `login.microsoftonline.com/common`, scope `openid offline_access Calendars.Read`, PKCE `S256`, `prompt=select_account`, redirect `app.cadence-me.com/auth/outlook-calendar/callback` |
| Connect from Settings in QA Chrome | Microsoft offered a passkey first. The agent gave the page a virtual authenticator with no credential, chose "Use your password", then the authenticator code, all from the vault. The consent screen said "unverified" and listed sign in, maintain access and "Read your calendars". Accept returned to `/settings`: "Connected · No calendars chosen" |
| Calendar list | 200: Calendar (default), Birthdays, United States holidays |
| Selection in Settings | Choosing "Calendar (primary)" auto-saved ("Saved", "Connected · 1 calendar", `selectionRevision` 1) |
| Test events | The agent created "QA Outlook timed" (Nov 11, 4:30–5:00 PM ET) and "QA Outlook all-day" (Nov 11) through Outlook web's compose link |
| `GET /api/outlook-calendar/events`, today to +30 days | 200, schema `1.1.0`, `complete`, 2 events. Timed: 21:30–22:00Z, zone `America/New_York`, busy. All-day: `2026-11-11` to `2026-11-12`, one calendar day, free. Description, organizer, attendees, conference and attachments `unsupported`; location `unsupported`, or `not_provided` with `fields=location` |
| Timeline, 1280 and 390 px | "All day: QA Outlook all-day" beside the date; the timed event as a Calendar marker ("Preview Outlook Calendar event: QA Outlook timed") |
| Disconnect (`DELETE`) | 200, `disconnected`, generation 2, selection cleared, revocation key `microsoft_account_permissions` |
| Reads after disconnect | Events and calendars 409 `not_connected` |
| Reconnect | Microsoft returned without a new consent screen; `connected`, generation 3, no calendars chosen. The agent chose Calendar again; today's read `complete` |

Finding, not a defect: Outlook web stored the all-day event with zone `Etc/UTC`; the date
still came through as November 11 for the New York profile.

Not exercised, by owner decision (November 11, 2026, relayed from the owner's side chat):
cross-tenant consent, `admin_approval_required`, and a tenant that blocks unverified apps.
Also not exercised: wrong-account reconnect (one Microsoft identity only) and installed
Outlook acceptance. The PR #239 release packet already records 0.1.10 installed on the
test Mac; its synthetic callback replay does not establish installed Outlook acceptance.

Account A stays connected to the Outlook test identity with Calendar selected, for later
runs. The two QA events stay in that calendar.

## Ticket 241: release step 6 (production smoke)

Step 6 is a production smoke of each connector, then revoking the test credentials.
The Hevy key remains connected under the recorded owner decision. Outlook provider-grant
revocation remains an open follow-up; a successful disconnect/reconnect check does not
mean the provider grant was revoked after the run.

| Connector | Smoke on production | Credential after the run |
|---|---|---|
| Hevy | Passed (above) | The owner's key stays connected to account A by design (decision 2026-11-11); the owner decides whether to regenerate it |
| iCloud Calendar | Not run: the existing vault item's fields were unreadable, and no usable test identity was available. Awaiting the owner's account choice | — |
| Outlook Calendar | Passed (above) | The test identity stays connected to account A for later runs; it is an agent test identity, not the owner's |
| Installed desktop | Passed on published 0.1.10 on the test Mac for Hevy and Outlook (below), except the Microsoft deep-link completion, account switch and sign-out cleanup, and Hevy key entry on the Mac | — |

Step 7 (public disclosure copy) belongs to the messaging track. The copy that Ticket 241
wrote is live: `cadence-me.com/faq` serves the Hevy Pro and 500-workout answer, and
`app.cadence-me.com/privacy` serves the iCloud app-specific-password custody text. What
remains is the owner's review of that copy against this evidence; no copy was changed here.
Connector completion copy (D28) is tracked separately in P-038 to P-043.

## Installed desktop: Cadence for Mac 0.1.10 on the test Mac (November 12, 2026, 05:40–05:55Z)

mac-release handed the test Mac over after publishing 0.1.10 (linked as account A, schema
24, contract 5). The agent drove it over Tailscale SSH with `scripts/test-device.mjs`:
read-only SQLite on `calendar-cache.sqlite3` (counts, generations and completeness only), and
the window's accessibility tree. The `desktop-test-mac` preflight listed one owner step,
Notifications and Location for Cadence. These checks do not need it, so it was not asked.

| Check | Result |
|---|---|
| Device | macOS 27.2.1 (26B131), arm64, Cadence 0.1.10 running |
| Cache before the window opened | `connector_fence` has one row per source (Outlook, iCloud, Hevy); no snapshots. Fences rise on every refresh of a disconnected source, which clears that source's cache |
| Cache after the window opened | Complete snapshots for Hevy and Outlook, each at the hosted connection generation (3); iCloud fence bumped (disconnected) |
| Settings › Connections (accessibility) | Google "Connected · 1 calendar", Outlook "Connected · 1 calendar", iCloud "Not connected", Hevy "Connected", matching the hosted state |
| Outlook event on the Mac | The agent added "QA Outlook Mac timed" (Nov 12, 3:00–3:30 PM ET) in Outlook web. **Refresh Outlook Calendar** on the Mac showed "Outlook Calendar refreshed."; the cache held 1 event; Timeline showed "Preview Outlook Calendar event: QA Outlook Mac timed" |
| Hevy on the Mac | Timeline "Recorded activity · Hevy", "No recorded workouts today." (none logged on Nov 12); Hevy snapshot complete |
| Disconnect from the Mac | A confirmation ("Disconnect Outlook Calendar?") with **Disconnect** and **Cancel**. After **Disconnect**: hosted `disconnected`, generation 4; the Outlook snapshot was deleted and its fence bumped; the Hevy snapshot stayed; the panel showed the Microsoft revocation instruction and **Connect Outlook Calendar** |
| Connect from the Mac | **Connect Outlook Calendar** opened Chrome on the test Mac at `login.microsoftonline.com/common/oauth2/v2.0/authorize`, scope `openid offline_access Calendars.Read`, redirect the hosted `/auth/outlook-calendar/callback` (which hands a desktop attempt to `cadence://outlook-calendar/callback`). The agent closed that tab |
| Reconnect elsewhere | The agent reconnected A from the web (generation 5) and chose Calendar again. The Mac then showed "Connected · 1 calendar", its cache held generation 5 with 1 event, and the event was back on the Mac Timeline |

Not run on the Mac:

- Finishing the Microsoft sign-in in the test Mac's Chrome and the `cadence://` completion:
  `test-device.mjs click` acts only while Cadence is frontmost, so a browser sign-in cannot
  be driven over SSH.
- The `pending-outlook-calendar-attempt` Keychain item: `security find-generic-password`
  over SSH did not find it, before or after Connect. The app may keep it where `security`
  cannot see it; not verified either way.
- Cache cleanup on sign-out and account switch: it would unlink the test Mac, which
  mac-release still needs for a leave-reminder check.
- Hevy key entry from the Mac: it would pass the owner's key through a remote text field.
  The hosted intake is the same route the web uses (verified above).
- iCloud: not connected (Ticket 240 waits on the owner's Apple Account item).

The test Mac is left as found: Cadence 0.1.10 running and linked as A; Outlook connected
(generation 5, Calendar selected), Hevy connected (generation 3), iCloud not connected.

