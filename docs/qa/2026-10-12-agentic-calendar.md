# Ticket 187: agent Calendar grant isolation

Source implementation: October 12, 2026. Release acceptance remains open.
The owner requested implementation of the OAuth assessment. Google has not confirmed Cadence's classification.
This change follows the conservative agent-separation branch and requires a separate Google project.

## Implemented boundaries

- Standard Timeline and agent Calendar use separate connection, selection, credential and one-time attempt records.
- Agent ciphertext binds the OAuth client ID. Changed clients require reconnection; existing standard ciphertext remains readable.
- Agent callback state, desktop Keychain state, refresh credentials and pending range reads are purpose-specific.
- Timeline event endpoints reject agent-purpose requests. AI reads never fall back to standard credentials.
- Daily Brief, current account comparisons and retrospective Calendar reads use only the agent grant.
- Saved pre-separation Calendar cases remain reviewable locally but cannot be sent to the model again.
- Daily Brief SQL preference, admission and completion fences reference the agent connection.
- The migration clears prior Calendar disclosure and affected outstanding brief attempts. It preserves behavior-only preferences and standard grants.
- Account deletion attempts both grant revocations after successful Auth deletion. One corrupt credential cannot suppress the other's revocation.
- Web and linked desktop reuse the Settings panel. Agent selection omits Timeline display controls and requires separate model disclosure.

Primary source files: `lib/services/google-calendar-oauth.ts`, `google-calendar.service.ts`,
`lib/db/google-calendar.repo.ts`, `lib/types/google-calendar.ts`, Calendar API routes,
briefing context/history/workbench services, Settings panels, and desktop Calendar adapters.
Migration: `supabase/migrations/20261022180000_separate_agent_calendar_grant.sql`
(renamed October 22, 2026 from `20261012213059_…`; never applied to hosted).
Generated types: `lib/db/database.types.ts`.
Interaction variants: INT-CALENDAR-001–004 and INT-BRIEF-004 in the existing registry.
The existing design-system manifest and usage inventory include the changed controls.

## Verification

Node 24.19.0 supplied the supported project runtime.

- `npm run agents:check`, `interactions:check`, and `resolvers:check`: passed.
- `npm run typecheck` and `desktop:typecheck`: passed.
- `npm run lint -- --ignore-pattern '.claude/**'`: passed. Unscoped lint includes unrelated nested worktrees and generated artifacts and fails there.
- Full Vitest suite: 2,547 passed, 29 skipped across 283 passing files. Uses `--exclude '.claude/**' --maxWorkers=2 --testTimeout=30000`.
- `npm run build`: passed with network access for the existing Google Font dependency. The sandbox-only attempt failed on that fetch.
- `npm run desktop:build`: passed. Existing bundled `use client` directive warnings remain.
- `npm run desktop:native:test`: 110 passed.
- `npm run design-system:check`: passed, 39 components and 167 usage records.
- The full token-baseline scan is unconfigured: no accepted repository baseline exists, and the scan includes vendored/generated trees.
  No baseline was added. Comparing the five changed product TSX files against HEAD found zero additional raw token violations.
- `git diff --check`: passed.

A separate empty Supabase project, `cadence-agent-187`, replayed all migrations through `npm run supabase -- db reset`.
Only this disposable stack used the verification ports; published ports bound to 127.0.0.1.
Existing owner databases remained untouched. Database types were generated from that replay.
The disposable stack is stopped. Its restrictive proxy denied the CLI cleanup prune; direct readback confirmed no ticket containers remain running. Volumes remain preserved.
These SQL contracts passed with `ON_ERROR_STOP=1` and rollback:

- `tests/sql/google-calendar-contract.sql`.
- `tests/sql/google-calendar-agent-contract.sql`: credential/RLS isolation, wrong identity, replay, late callbacks, independent disconnect,
  standard consent rejection by Daily Brief, agent consent acceptance, and post-disconnect fence rejection.
- `tests/sql/ticket-147-daily-brief-smoke.sql`: existing admission/completion checks, updated to use the agent Calendar fixture.

Browser QA used synthetic fixtures at `http://127.0.0.1:4324/design-system?preview=module.google-calendar-panel`.
Connected, unconfigured and reconnect states rendered correctly. Save and Refresh showed expected feedback.
The agent variant omitted Timeline display controls. At 390×844, the panel measured 356px wide with 356px scroll width.
The disclosure and actions wrapped within the panel. Desktop-width inspection also passed.
Shared DOM tests cover independent selection, absent event refresh, and disconnect.
Screenshot from this session: `/tmp/cadence-agent-calendar-preview.jpg` (synthetic data, temporary artifact).

## Open acceptance gates

1. Independent review. The orchestration skill requires: “Accept a substantial implementation only after the fresh reviewer returns `ship`.”
   Its supported review models are unavailable through the current delegation tool. The parent inspected the diff; this is not independent acceptance.
2. An authorized owner must verify the Google project/client inventory, actual project ownership, agentic classification, callback registrations and scopes.
3. Provision and verify the separate agent project/client. Configure the four documented server variables; keep secrets server-only.
4. Authorize and apply the hosted migration and deploy the matching application. Follow the cutover order in `docs/OPERATIONS.md#agent-calendar-grant-ticket-187`.
5. Complete live web and installed desktop consent, revocation, Workspace-policy, account-deletion and sign-in regression checks.
6. Complete provider verification and review public consent/AI disclosures before public availability claims.

No Google configuration, hosted database, deployment, sign-in client, public release, or real model request changed during implementation.
No MCP integration or broader OAuth scopes were added. No commit or push was performed.

Rollback disables agent configuration and Calendar disclosure while preserving standard grants and the additive schema.
Do not revert to source that sends standard-grant Calendar data to AI.

API-EQUIVALENT COST RECEIPT: unavailable. Parent token usage is unobservable; no subagents ran, and no delegation savings are claimed.

## Google sensitive-scope verification: preparation, October 24, 2026

Status: prepared, not submitted. Google has not accepted a submission. The owner must
approve the submission text, choose the recording environment, record and upload the
video, and accept any agreement. No secret, token or authorization code is recorded.

### Provider readback

Read in Chrome as `info@identityscaffolding.com` and with `gcloud` as the same account.

| Item | Readback |
|---|---|
| Project | `cadence-calendar-agent-prod`, number 855808383971, ACTIVE, no organization |
| Branding | App name Cadence; support and developer contact `info@identityscaffolding.com`; home `https://cadence-me.com`; Privacy `https://app.cadence-me.com/privacy`; Terms `https://app.cadence-me.com/terms`; authorized domain `cadence-me.com`; no logo |
| Branding status | "Your branding needs to be verified before it can be shown to users." Verify branding not run |
| Audience | In production, External, requires verification |
| Data Access | Non-sensitive: `openid`, `calendar.calendarlist.readonly`. Sensitive: `calendar.events.readonly` ("Approval required"). Restricted: none. Justification field empty, 1000-character limit |
| Verification Center | Branding not shown to users. Data access not verified; "Prepare for verification" waits for verified, published branding |
| Client | "Cadence Calendar agent broker", Web application, created October 24, 2026, ID `855808383971-r30agviivl9h76f0igu292rg9u8k1op3.apps.googleusercontent.com`. No JavaScript origins. One redirect URI, `https://app.cadence-me.com/auth/google-calendar/callback`. "Use this client for an AI-powered agent" is checked |
| Search Console | `sc-domain:cadence-me.com`: "You are a verified owner", method Domain name provider, account `info@identityscaffolding.com`. Public DNS still returns the `google-site-verification` TXT record and both Vercel A records |
| Public pages | `https://cadence-me.com/` returns 200 and links to `/privacy`, `/terms` and `/trust` on `app.cadence-me.com`; all three return 200 |

`docs/SERVICE_CONNECTIONS.md` still says domain setup is pending DNS verification. That
line is stale: Search Console has shown the verified owner since September 17, 2026
(`docs/VERCEL_WORKFLOW.md`).

### Disclosures

- PR #147 (to `main`) rewrites Privacy, "Optional Google Calendar", for both
  connections. It adds the Limited Use AI/ML statement: Cadence does not use Google API
  data to develop, improve or train generalized AI or ML models, or transfer it for
  that purpose. It also fixes the Trust export sentence (P-005) and the user guide. Its
  "where available" wording is true before and after this PR deploys. It is not live.
- Main's Privacy already disclosed Daily Brief Calendar timing to OpenAI behind a
  separate choice. The older plan statement that it says Calendar data never reaches AI
  providers is out of date.
- This branch adds the in-app line under **Include calendars selected in Google
  Calendar for Daily Brief**. Google requires the disclosure inside the app, next to
  the consent, not only in the policy. Outlook, iCloud and Hevy already have such
  lines; Google Calendar had none.
- Owner check: confirm the OpenAI organization's data-sharing setting is off. The AI
  training statement and the additional information below depend on it.
  `platform.openai.com` required sign-in, so it was not read.

### Recording environment: owner decision

Google's production-readiness policy says production OAuth clients "must not contain
test environments, redirect URIs, or JavaScript origins" that only the developer team
can reach ([policy compliance](https://developers.google.com/identity/protocols/oauth2/production-readiness/policy-compliance)).
The video must show this client's ID in the consent page's address bar. The code
also requires an HTTPS callback at `/auth/google-calendar/callback`, shared by both
Calendar connections. A staging or localhost route therefore cannot complete this
client's consent unless a test callback is added to the production client.

Options:

1. **Recommended:** record on `https://app.cadence-me.com` with the dedicated test
   account `cadence.testing.is@gmail.com`, as Ticket 140 did for the Timeline project.
   This needs this PR's agent flow live: the merge, the hosted migration
   `20261022180000`, the agent server variables including the secret, and the cutover
   order in `docs/OPERATIONS.md`. Until approval, consent shows Google's unverified-app
   warning; the 100-user cap applies.
2. Add a temporary staging callback, record there, then remove it before submitting.
   The video would show a `redirect_uri` the submitted client no longer has. That
   conflicts with the policy above and risks rejection. Not recommended.

The recording also needs one real Daily Brief model call for the test account. That
needs the owner's explicit authorization.

### Scope justification draft (972 of 1000 characters)

For the Data Access field "How will the scopes be used?". It is not submitted.

> Cadence is a personal behavior tracker. This project holds only the AI-agent client for Cadence's optional Daily Brief, a read-only plan for the user's day. The user connects "Google Calendar for Daily Brief" in Settings, chooses calendars, then separately allows Calendar in Daily Brief settings. calendar.events.readonly lets Cadence list today's events on those calendars so the brief can plan around them. Before the OpenAI request, Cadence keeps only each event's times or all-day dates, timezone, status, busy/free availability and the user's own response, under opaque IDs. Titles, descriptions, locations and attendees are dropped. Cadence stores no event data. Narrower scopes fail: calendar.freebusy and calendar.events.freebusy return only merged busy ranges, so the brief could not name the event a Behavior overlaps, keep all-day events apart, or use the user's response. calendar.events.owned.readonly omits subscribed calendars. Cadence never writes events.

Source basis: `projectCalendarConnector` in `packages/core/src/services/advisor-day-context.ts`
keeps opaque refs, interval, timezone, state, availability, response and a recurrence
ref, and drops titles and details. `calendarBlock` in
`packages/core/src/resolvers/briefing-plan.resolver.ts` skips cancelled, free and
declined events, keeps all-day blocks separate, and carries each event's ref.
`readCalendar` in `lib/services/advisor-day-context.service.ts` reads today's local date
only.

### Additional information draft (899 characters)

> Cadence keeps Calendar access for AI apart from Calendar access for display. Timeline uses project cadence-calendar-498717 (data access verified September 2026); its standard client never sends Calendar data to a model. This project, cadence-calendar-agent-prod, has one web client marked as an AI-powered agent, used only for Daily Brief. Sign-in uses a third project. Each Calendar grant has its own consent, encrypted refresh credential and Disconnect; revoking one leaves the other. The macOS app uses the same hosted broker: it opens the system browser, and the server keeps the client secret and exchanges the code. Daily Brief sends OpenAI only event timing fields, with store:false, and OpenAI does not train on this API data. The demo uses a dedicated test account and a test calendar. The support and developer contact info@identityscaffolding.com is monitored by Emiliano Bache Rodriguez.

"Its standard client never sends Calendar data to a model" is true only once this PR is
deployed. Submit after that deployment, or edit the sentence.

### Demo video script

Record in English, one continuous take, with the macOS screen recorder and click
indicators on. Use only the test account and a test calendar holding two harmless
events today, for example "Cadence demo event" (timed) and "Cadence all-day test".
Hide other tabs, notifications, bookmarks and personal accounts. Do not trim the
consent screen, the address bar, the account choice or the return to Cadence.
Before recording, leave Daily Brief off for the test account and record on a day with
no brief attempt yet. Signing in opens Timeline; with Daily Brief off, that visit
generates nothing, so the first brief of the day includes Calendar.

| Time | Action and caption or narration | Evidence for Google |
|---|---|---|
| 0:00–0:15 | Open `https://cadence-me.com`. Show the description and the Privacy link. "Cadence is a personal behavior tracker. Calendar access is optional and read-only." | Public homepage on the verified domain, linked policy |
| 0:15–0:30 | Sign in with Google as the test account and land on Timeline. "This signs in to Cadence. It grants no Calendar access." | Sign-in is separate from Calendar consent |
| 0:30–0:50 | Settings: show **Google Calendar** (Timeline) connected with the test calendar. "This is the Timeline connection, a separate Google project. It is never sent to AI." | First grant shown, distinct from the reviewed client |
| 0:50–1:05 | Settings: **Google Calendar for Daily Brief**, disconnected. Read its description aloud. Select Connect. | Separate, user-initiated agent consent |
| 1:05–1:40 | Google consent: keep the address bar visible and pause until `client_id=855808383971-r30agviivl9h76f0igu292rg9u8k1op3…` is readable. Show the unverified-app warning if shown, the app name Cadence, both Calendar permissions, and English. Choose the test account and allow. | Client ID, app name, exact scopes, affirmative grant |
| 1:40–2:00 | Back in Settings, choose only the test calendar and save. "Cadence reads the calendar list only so I can choose calendars." | `calendar.calendarlist.readonly` use |
| 2:00–2:30 | **Daily Brief**: turn on **Enable Daily Brief**; Calendar is still off. Show the line under **Include calendars selected in Google Calendar for Daily Brief** and read it. Turn it on. "Connecting sent nothing to OpenAI. This choice allows today's event timing, without titles." | In-app AI disclosure and separate consent |
| 2:30–3:05 | Open Timeline and let the Daily Brief appear. Point to advice that plans around the test event's time. "Cadence read today's events on the selected calendar and sent only their timing to OpenAI." | `calendar.events.readonly` use in the agent feature |
| 3:05–3:25 | Settings: Disconnect **Google Calendar for Daily Brief**. Show that the Timeline **Google Calendar** stays connected and Timeline still shows the test events. | Independent revocation of the agent grant |
| 3:25–3:40 | Open `https://app.cadence-me.com/privacy` at "Optional Google Calendar". Show the two-connection text and the AI training statement. | Policy matches the demonstrated flow |

Before upload: play the whole file. Check every frame for tokens, secrets, private
events, personal emails, file paths and unrelated tabs. Upload to the
`brittlebeliefs` channel as **Unlisted**, the channel used for Ticket 140, and check
playback while signed out.

### Submission order after approval

1. PR #147 is approved, merged and deployed. Privacy shows the new text.
2. This PR's agent flow is live on the production host (option 1 above).
3. The video is uploaded and its link and the final texts are approved.
4. Run Verify branding, then publish branding. Google keeps a compliant result for
   7 days.
5. Enter the justification on Data Access. In the Verification Center, enter the video
   link and additional information, answer the questionnaire, and submit.
6. Record the submission time, Verification Center state and video link here and in
   `STATUS.md`.
