# Connector production acceptance: Tickets 236, 240, 241 and 242 (November 11, 2026)

Run `conn-accept-20261111` (ledger `.intent/acceptance/conn-accept-20261111/`). An agent
ran it against production (`https://app.cadence-me.com`, `main` at `1232f7cd`) as test
account A, with A's kept Supabase session as a Bearer token and the Cadence QA Chrome
profile for the UI. Output kept statuses, counts, field names and times only.

Earlier live evidence for these tickets came from a disposable local stack with development
test-login (October 19–22, 2026). This run is the first on the hosted deployment.

## Preflight

`npm run qa:preflight -- --suite connectors --run-dir .intent/acceptance/conn-accept-20261111`
exited 10: ready 9, owner steps 2, waiting 2.

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

**Not run: waiting on the owner's vault item `icloud-test-account-a`.**

- Production status for A: `disconnected`, generation 0 (never connected on production).
  The route is configured (not `not_configured`); unauthenticated requests return 401.
- To run after the item exists: preflight renewal connects A; then calendar list,
  selection, a 31-day read, Timeline at 1280 and 390 px, the all-day toggle, disconnect with
  the app-specific-password revocation instruction, and reconnect. Wrong-principal
  reconnect needs a second Apple Account and stays unexercised unless one exists.

## Ticket 242: Outlook Calendar

**Not run: waiting on the owner's vault item `outlook-test-account-a`.**

- Production status for A: `disconnected`, generation 0.
- `POST /api/outlook-calendar/connection` with `{"target":"web"}` returned 200 and an
  authorize URL on `login.microsoftonline.com/common` with scope
  `openid offline_access Calendars.Read`, PKCE `S256`, `prompt=select_account` and redirect
  `app.cadence-me.com/auth/outlook-calendar/callback`. This confirms the production OAuth
  settings without consent. The unused attempt expires on its own.
- Cross-tenant consent needs a work or school account in a tenant other than the
  "Cadence Calendar" app's home tenant. The run has none. `admin_approval_required` and a
  tenant that blocks unverified apps need such a tenant with the matching policy.

## Ticket 241: release step 6 (production smoke)

Step 6 is a production smoke of each connector, then revoking the test credentials.

| Connector | Smoke on production | Credential after the run |
|---|---|---|
| Hevy | Passed (above) | The owner's key stays connected to account A by design (decision 2026-11-11); the owner decides whether to regenerate it |
| iCloud Calendar | Waiting on `icloud-test-account-a` | — |
| Outlook Calendar | Configuration checked; connect waiting on `outlook-test-account-a` | — |
| Installed desktop | Waiting on the 0.1.10 install on the test Mac (mac-release owns it) | — |

Step 7 (public disclosure copy) belongs to the messaging track. The copy that Ticket 241
wrote is live: `cadence-me.com/faq` serves the Hevy Pro and 500-workout answer, and
`app.cadence-me.com/privacy` serves the iCloud app-specific-password custody text. What
remains is the owner's review of that copy against this evidence; no copy was changed here.
Connector completion copy (D28) is tracked separately in P-038 to P-043.
