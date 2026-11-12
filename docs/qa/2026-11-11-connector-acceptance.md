# Connector production acceptance: Tickets 236, 240, 241 and 242 (November 11, 2026)

Run `conn-accept-20261111` (ledger `.intent/acceptance/conn-accept-20261111/`). An agent
ran it against production (`https://app.cadence-me.com`, `main` at `1232f7cd`) as test
account A, with A's kept Supabase session as a Bearer token and the Cadence QA Chrome
profile for the UI. Output kept statuses, counts, field names and times only.

Earlier live evidence for these tickets came from a disposable local stack with development
test-login (October 19–22, 2026). This run is the first on the hosted deployment.

## Preflight

`npm run qa:preflight -- --suite connectors --run-dir .intent/acceptance/conn-accept-20261111`
exited 10: ready 9, owner steps 2, waiting 2. After the owner added `outlook-test-account-a`, the rerun reported `outlook-connection-a` ready once the agent connected it; `icloud-connection-a` still fails (see Ticket 240).

- Ready: `op-service-token`, `vault-google-a`, `vault-hevy-a` (`hevy-owner`),
  `qa-chrome-profile`, `google-browser-a`, `supabase-session-a`, `cadence-web-a`,
  `gcal-connection-a`, `hevy-connection-a`.
- Owner steps: the vault items `outlook-test-account-a` and `icloud-test-account-a` are
  missing.
- Waiting on them: `outlook-connection-a` and `icloud-connection-a`.

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

- Apple refused to create a new Apple Account for testing ("account cannot be created") on
  each of the owner's attempts. Sandbox Apple Accounts in App Store Connect serve StoreKit
  purchase testing; they are not believed to work for iCloud.com or CalDAV with an
  app-specific password (not verified). No other Apple test-account path is known.
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
desktop (waits on the 0.1.10 install).

Account A stays connected to the Outlook test identity with Calendar selected, for later
runs. The two QA events stay in that calendar.

## Ticket 241: release step 6 (production smoke)

Step 6 is a production smoke of each connector, then revoking the test credentials.

| Connector | Smoke on production | Credential after the run |
|---|---|---|
| Hevy | Passed (above) | The owner's key stays connected to account A by design (decision 2026-11-11); the owner decides whether to regenerate it |
| iCloud Calendar | Waiting on `icloud-test-account-a` | — |
| Outlook Calendar | Passed (above) | The test identity stays connected to account A for later runs; it is an agent test identity, not the owner's |
| Installed desktop | Waiting on the 0.1.10 install on the test Mac (mac-release owns it) | — |

Step 7 (public disclosure copy) belongs to the messaging track. The copy that Ticket 241
wrote is live: `cadence-me.com/faq` serves the Hevy Pro and 500-workout answer, and
`app.cadence-me.com/privacy` serves the iCloud app-specific-password custody text. What
remains is the owner's review of that copy against this evidence; no copy was changed here.
Connector completion copy (D28) is tracked separately in P-038 to P-043.
