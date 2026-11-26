# Google Calendar MCP Live Wire Spike — November 25, 2026

Phase 0 live verification of Cadence's Google Workspace Calendar MCP integration
(`calendarmcp.googleapis.com`) and Google Cloud Model Armor prompt-injection
screening on production (`https://app.cadence-me.com`, deployment `cadence-lo22vs16w`,
PR #398 merged at `74f02cb8`, migration `20261125120000_reactivate_agent_calendar_mcp.sql`).

## Environment and credentials verified

| Component | Live value / state |
|---|---|
| Agent GCP project | `cadence-calendar-agent-prod` (`#855808383971`), billing OFF (Standard Tier, 5,000 req/day cap) |
| OAuth client | `855808383971-r30agviivl9h76f0igu292rg9u8k1op3.apps.googleusercontent.com` ("Use this client for an AI-powered agent" enabled) |
| Timeline GCP project | `cadence-calendar-498717` (separate OAuth client, `calendar-json.googleapis.com`) |
| Production transport flag | `CADENCE_GOOGLE_CALENDAR_AI_TRANSPORT=agent_mcp` |
| Model Armor template | `projects/habit-tracker-498717/locations/us-east1/templates/cadence-calendar-mcp-screen` (`INSPECT_AND_BLOCK`, Cloud Logging OFF) |
| Quota alert policy | `projects/cadence-calendar-agent-prod/alertPolicies/9812872071682798828` (70% daily cap = 3,500 req/day) |
| Test account | Dedicated test account A (`cadence.testing.is@gmail.com`) in `Cadence QA Chrome` |

## Live wire results

### 1. OAuth consent & dual-grant separation (`purpose=ai_mcp`)

- Initiating **Connect Google Calendar for AI** from Settings → Connected sources → Google Calendar redirected to `accounts.google.com` with `client_id=855808383971-r30agviivl9h76f0igu292rg9u8k1op3.apps.googleusercontent.com`.
- Google's granular consent screen displayed app name **Cadence** and the two exact read-only scopes:
  - `https://www.googleapis.com/auth/calendar.calendarlist.readonly` ("See the list of Google calendars you're subscribed to.")
  - `https://www.googleapis.com/auth/calendar.events.readonly` ("View events on all your calendars.")
- Callback landed at `/settings?aiCalendar=connected`.
- `GET /api/google-calendar/connection?purpose=ai_mcp` returned `status: "connected"`, `generation: 1`, `selectionRevision: 1`, with initial `selectedCalendarIds` seeded from the Timeline grant's selection.
- `GET /api/google-calendar/connection` (Timeline & Travel) remained independently `status: "connected"` (`generation: 26`).

### 2. `list_calendars` over `calendarmcp.googleapis.com`

- `GET /api/google-calendar/calendars?purpose=ai_mcp` returned HTTP `200` in **490 ms** on cold call.
- Returned all 3 subscribed calendars (`Cadence demonstration`, `cadence.testing.is@gmail.com`, `Holidays in United States`) with IDs, display names, and `America/New_York` timezones.
- Wire observation: `calendarmcp.googleapis.com` `list_calendars` omits/normalizes `primary` and `accessRole` relative to Calendar REST v3, so Cadence's adapter safely defaults `primary: false` and `accessRole: "reader"` while first-connect seeding uses the existing Timeline calendar selection. No adapter change required.

### 3. `list_events` over `calendarmcp.googleapis.com` (timed, daily recurring, and all-day)

Three harmless fixtures were placed on Test Account A's calendar for Wednesday, November 25, 2026 (`America/New_York`):
1. **Timed event with location:** `Evening Study Session`, `19:30–20:30`, location `Public Library`.
2. **Daily recurring series started 2 days earlier (Nov 23):** `Morning Check-in`, `09:30–10:00` daily.
3. **All-day event:** `Project Milestone Day`, `2026-11-25`.

Advisor Chat (`/chat`) was asked to list all Google Calendar events today (timed, recurring, and all-day) with times and locations:
- Completed end-to-end in **13.5 s** (including MCP `list_events`, Google Cloud Model Armor `INSPECT_AND_BLOCK` screening, and OpenAI response generation).
- **Recurring-event expansion confirmed:** `Morning Check-in` (`9:30–10:00 am`) was expanded and returned for `2026-11-25` via `list_events` with `singleEvents: true`.
- **All-day event confirmed:** `Project Milestone Day` returned accurately as an all-day event.
- **Timed event + location confirmed:** `Evening Study Session` returned accurately as `7:30–8:30 pm at Public Library`.
- **Model Armor screening confirmed:** Live benign calendar payloads passed `cadence-calendar-mcp-screen` (`INSPECT_AND_BLOCK`) with zero false positives.
- **Provenance tracking confirmed:** `GET /api/google-calendar/connection?purpose=ai_mcp` immediately reflected `affectedChatCount: 1`.

### 4. Independent AI disconnect & atomic purge

- Clicking **Disconnect Google Calendar for AI** displayed the inline warning: *"Disconnecting removes 1 conversation that used Google Calendar and clears Undo for changes made in them; your completed schedule changes stay."*
- Confirming **Disconnect**:
  - Updated AI connection to `status: "disconnected"`, `generation: 2`, `selectionRevision: 3`, `affectedChatCount: 0`.
  - Atomically deleted the Google-Calendar-touched Chat thread (`/chat` no longer contained the conversation or any event titles).
  - Left the **Timeline & Travel** connection untouched (`status: "connected"`, `generation: 26`), with Timeline still displaying today's events.

## Ticket 245 verification demo video

Recorded in one continuous unedited English take (`1920×1200` H.264 MP4, `2m 28s`) on `https://cadence-me.com` and `https://app.cadence-me.com` covering all 8 shots in `docs/qa/2026-10-12-agentic-calendar.md`, visually audited across 8 extracted keyframes confirming:
- Browser address bar visible throughout, with `client_id=855808383971-r30agviivl9h76f0igu292rg9u8k1op3` clearly legible on the Google OAuth consent screen alongside app name **Cadence** and both read-only scopes.
- Live Advisor Chat reading today's events via `calendarmcp.googleapis.com`.
- Independent AI disconnect warning, atomic Chat purge, and preserved Timeline connection.
- Live `/privacy` disclosure dated November 25, 2026 (`calendarmcp.googleapis.com`, Model Armor, ≤30-day derived caps, AI/ML non-training).
