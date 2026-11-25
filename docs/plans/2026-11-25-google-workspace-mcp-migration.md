# Google Workspace MCP Migration, AI Tools Addendum & Conversational Travel Plan (v3 — Locked)

> **Date:** November 25, 2026
> **Status:** **Locked v3** — audited by two independent reviewers (**Astra 6.2 Extra High** and **Fable 5.2 High**), all Q1–Q8 owner decisions integrated (`docs/DECISIONS.md`, 2026-11-25), implementation initiated on branch `feat/google-calendar-mcp-migration`.
> **Hard external deadlines:**
> - **February 1, 2027** — Google Workspace AI Tools Addendum takes effect & technical enforcement begins requiring AI models/agents to access Workspace data through Google MCP servers (`calendarmcp.googleapis.com`) rather than REST APIs directly.
> - **April 1, 2027** — Standardized usage tiers enforced; Scaled Tier billing begins (Standard Tier remains $0 with 5,000 req/day MCP cap).

**Governance references:**
- Decisions: `docs/DECISIONS.md` (2026-11-25)
- Legal register: `docs/LEGAL.md` **L-027**, **L-026** (reconciled), **L-021**, **L-001**, **L-016**
- Cost ledger: `docs/COSTS.md` ("Google Calendar API and MCP server")
- Messaging log: `docs/MESSAGING_CHANGES.md` **P-090** (relates to P-010, P-012, P-035, P-060, P-065, P-066, P-087–P-089)
- Deferred items: `docs/FUTURE_UPDATES.md` ("AI-friendly routing provider for prose-level travel reasoning", "Confirmation gate for Calendar-informed Advisor Chat writes")

---

## 1. Locked Owner Decisions Summary (Q1–Q8)

| Decision | Locked Choice |
| --- | --- |
| **Q1** | **Option B + smart caching + conversational travel organizing + two-layer longitudinal baseline:** Migrate Brief/Chat to `calendarmcp.googleapis.com`; close all 4 REST-to-AI leak paths; rebuild AI Google-event travel fit from authorized MCP events (fixing `withSuppliedConclusions` revision matching without `etag`); short-TTL MCP snapshot/list cache (5–15 min) + provenance-safe Routes estimate reuse; fold in **hybrid Chat travel UI** (`L-001` compliant: deterministic conclusions to LLM + inline exact travel cards in UI), **today + 7-day lookahead**, **cross-day moves + recurring schedule remodeling** (confirmed), and two-layer longitudinal architecture (≤30d live MCP/travel + indefinite first-party records). Feb 1 fallback disables Google Calendar in AI if verification slips. |
| **Q2** | **Option A + ephemeral >30d Chat MCP + opted-in activity-gated weekly/monthly review:** Google `daily_calendar_load` populated strictly from AI MCP reads, capped at ≤30 days, atomically wiped on disconnect (Outlook/iCloud keep 366d). Chat `list_calendar_load` computes missing >30d Google spans live in memory via MCP and discards immediately. Separate user opt-in (Settings toggle) for activity-gated (active within 7–14d) weekly/monthly longitudinal review; >30d Google inputs discarded immediately; derived summary ≤30d + disconnect purge. |
| **Q3 & Q6** | **Canonical `Connected sources → Google Calendar` home + chained onboarding + lightweight AI picker, no cutover banner:** Single row with status pill (`Not connected` / `Timeline only` / `AI only` / `Timeline & AI`), split internally into **Timeline & Travel** and **AI features (Daily Brief & Chat)** with separate disconnects; chain Step 2 after Timeline connect when AI is on; collapsed pills AI picker (checkboxes only), seeded once from Timeline with one-time note only if hidden calendars were skipped; quiet drift hint (*"AI features use a separate selection (N calendars)."*) + one-click **Sync to AI**; compact inline **Connect Google Calendar for AI** shortcut in `AI features` + read summary & **Manage in Connected sources** link. No 2-week cutover banner. |
| **Q4** | **Option A (delete on disconnect) + Option 2 (keep threads until disconnect, ≤30d summary cap) + disconnect/revocation triggers only + Nov 19 backfill + bench cleanup:** Atomic delete of Google-Calendar-touched Chat threads (with Undo-cleared warning) + `daily_brief_days`, `move_proposals`, `opportunity_proposals`, `agent_run_contents`, Google `daily_calendar_load`, and longitudinal review rows on AI disconnect/revocation only. Keep threads until disconnect while capping `chat_conversations.summary` at ≤30 days. Backfill Nov 19+ Calendar-touched chats. Oct 16 & Oct 23 `.local/briefing-bench/` captures deleted Nov 25, 2026. |
| **Q5** | **Model Armor only + keep T12 immediate Chat writes:** Enable Google Cloud Model Armor (`INSPECT_AND_BLOCK`, Cloud Logging OFF) on `cadence-calendar-agent-prod` alongside existing in-app sanitization/framing. Keep T12 immediate single-record Chat writes with Undo (confirmation gate deferred in `docs/FUTURE_UPDATES.md` & `L-027`). |
| **Q7** | **Bundle into Cadence for Mac `0.1.16`:** Hold `0.1.16` until Phase 4 completes and bundle the versioned `purpose=ai_mcp` broker and shared Settings UI. |
| **Q8** | **Standard Tier ($0) budget posture:** Billing off, monitoring alert at **3,500 req/day**, **40 req/user/day** per-account MCP cap, snapshot + `list_calendars` cache, graceful degradation (one-line notice, never falling back to REST); defer global monthly spend cap until Scaled Tier is needed. |

---

## 2. Target Architecture & Non-Negotiable Invariants

```
NON-AI TRAFFIC (Standard Tier REST — cadence-calendar-498717)
  Timeline display (Web + Mac) ──┐
  Travel display & Leave job   ──┼──► google-calendar.service.ts ("standard")
  (zero AI write-through)        │        └─► calendar-json.googleapis.com

AI TRAFFIC (Standard Tier MCP — cadence-calendar-agent-prod, $0 <= 5K/day)
  Daily Brief (context, moves, ──┐
    opportunities, MCP travel)   │
  Advisor Chat (events, load,    ├──► google-calendar.service.ts ("agent_mcp")
    7d travel-fit, ephemeral>30d)│        ├─► short-TTL MCP cache + 40/user/day budget
  Opted-in longitudinal review   │        ├─► google-calendar-mcp-provider.ts (list_calendars, list_events)
  Google daily_calendar_load     ┘        └─► model-armor.service.ts (INSPECT_AND_BLOCK, logging OFF)
```

1. **Zero REST-to-AI leakage:** No AI route, tool, model context, signed token, client payload (`calendarBusy`), or rollup (`daily_calendar_load`, `day_loads`) may read or relay Google Calendar data sourced from `cadence-calendar-498717`.
2. **Strict authorization & generation fencing:** Every AI Google Calendar check evaluates `aiSettings.approved && aiSourceAllowed(aiSettings, feature, "googleCalendar") && aiCalendarGrantConnected`. Every Google-dependent writer checks `google_calendar_grant_generation` inside its write transaction.
3. **Atomic §2(d) disconnect & revocation cleanup:** `calendar_agent_disconnect` advances generation, invalidates active brief leases, revokes local credentials, and deletes/scrubs all Google-derived AI rows (`chat_*`, `daily_brief_days`, `move_proposals`, `opportunity_proposals`, `agent_run_contents`, Google `daily_calendar_load`, `longitudinal_calendar_reviews`) in **one database transaction**.
4. **Ticket 335 identity-lock parity:** `keep_one_auth_identity()` and `sign-in-methods.service.ts` block unlinking a Google sign-in while either Timeline or AI Google Calendar is connected.
5. **Safe MCP error & quota discipline:** Only token-endpoint `invalid_grant` deletes a stored credential (never MCP HTTP `401`); MCP `403` maps to non-retryable `permission_denied`; never retry HTTP `200` `isError: true`; preserve partial-read honesty; enforce 40 req/user/day cap and degrade gracefully (never falling back to REST).
6. **L-001 hybrid travel boundary:** Never send raw Google Routes durations, distances, leave-by times, or addresses to any LLM; send only deterministic fit/conflict conclusions and free windows while rendering exact leave-by/duration cards directly in UI.

---

## 3. Parallel Execution Plan (Neon Low Orchestration Waves)

Workstreams are decomposed with **disjoint file ownership** per wave so parallel **Neon Low** subagents run cleanly in isolated git worktrees and merge without conflict into `feat/google-calendar-mcp-migration`:

### Wave 1 — Foundation & Independent Parallel Tracks (4 concurrent workstreams)
- **WS-1A — Tolerant Readers, Transport Gate, Workbench §2(f) Block & Latent `day_loads` Fence:**
  - `lib/db/daily-brief.repo.ts`, `packages/core/src/services/daily-brief-sources.ts`, `lib/services/day-load.service.ts`, `lib/services/briefing-workbench.service.ts`, `lib/services/briefing-history.service.ts`, `lib/services/briefing-sequence.service.ts`, `.env.example`, plus new tests (`tests/briefing-workbench-no-live-google-eval.test.ts`, tolerant-reader unit tests).
- **WS-1B — Database Migration, Atomic Purge RPCs, Longitudinal Review Schema & SQL Contract Tests:**
  - `supabase/migrations/20261125120000_reactivate_agent_calendar_mcp.sql` (preserves 5 `calendar_agent_*` RPC signatures + Ticket 335 lock + `keep_one_auth_identity()` parity + `google_calendar_source` on `read_ai_settings` & `read_daily_brief_preferences` + clear `exclude_google_calendar` on AI connect + provenance columns across `chat_conversations`, `chat_messages`, `daily_brief_days`, `move_proposals`, `opportunity_proposals`, `agent_run_contents`, `daily_calendar_load` (`grant_purpose` + ≤30d cap), `longitudinal_calendar_reviews` table & opt-in column + Nov 19 Chat backfill + atomic `purge_google_calendar_ai_data` inside `calendar_agent_disconnect` + `purge_expired_google_calendar_ai_data` + atomic writer generation fences).
  - Delete `app/api/google-calendar/agent-grants/retire/route.ts` and `lib/services/google-calendar-agent-retirement.service.ts` in the same commit; update `lib/services/sign-in-methods.service.ts` & `lib/services/agent-run-maintenance.service.ts`.
  - New `tests/sql/google-calendar-agent-mcp-contract.sql` + update superseded SQL/repo assertions.
- **WS-2A — Google Calendar MCP Provider, Short-TTL Cache, 40/day Per-User Budget & Model Armor Service:**
  - New `lib/services/google-calendar-mcp-provider.ts` (strict allowlist `list_calendars`/`list_events`, local ISO + IANA `timeZone`, `accessRole` check, `AVAILABILITY_FREE`, bounded pagination, safe `401`/`403`/`429`/`isError` handling, optional RRULE expansion helper in `packages/core/src/resolvers/`).
  - New `lib/services/google-calendar-mcp-cache.ts` (5–15 min per-user snapshot & `list_calendars` cache keyed by `(userId, grantGeneration, selectionRevision)` + per-account 40 req/user/day counter + monitoring event at 3,500 req/day).
  - New `lib/services/model-armor.service.ts` (`INSPECT_AND_BLOCK`, Cloud Logging OFF, safe fail-closed/fallback behavior + monitoring spans).
  - Unit tests: `tests/google-calendar-mcp-provider.test.ts`, `tests/google-calendar-mcp-cache.test.ts`, `tests/model-armor.service.test.ts`.
- **WS-3A — Pure Core Resolvers for 7-Day Travel-Fit, First-Party Longitudinal Signals & Hybrid Travel Card Types:**
  - `packages/core/src/types/travel.ts` (or new `packages/core/src/types/chat-travel.ts`) + pure resolvers in `packages/core/src/resolvers/`:
    - 7-day travel-fit & free-window planner (`travel-horizon.resolver.ts`: deterministic fit/conflict conclusions & free windows for LLM vs. structured UI travel card payload — enforcing `L-001` separation),
    - First-party longitudinal behavioral analyzer (`longitudinal-patterns.resolver.ts`: move proposal outcomes Yes/Other/No/Undo, post-travel-shift completion rates, Behavior locations & tracked durations, confirmed schedule patterns),
    - Revision-matching helper for `withSuppliedConclusions` (matching on fields returned by both REST and MCP instead of missing `etag`).
  - Full Vitest unit tests + `npm run resolvers:check`.

### Wave 2 — Core Backend Service Integration & Closing All 4 Leak Paths (after Wave 1 merges)
- **WS-2B — Wire `google-calendar.service.ts`, Authorization Fences, Travel MCP Rebuild, `daily_calendar_load` Isolation & Client `calendarBusy` Closure:**
  - `lib/services/google-calendar.service.ts`, `lib/services/google-calendar-oauth.ts`, `lib/services/account.service.ts`, `lib/services/daily-calendar-load.service.ts`, `lib/services/briefing-account-context.service.ts`, `lib/services/advisor-day-context.service.ts`, `lib/services/daily-brief.service.ts`, `lib/services/brief-moves.service.ts`, `lib/services/brief-opportunities.service.ts`, `lib/services/daily-brief-device.service.ts`, `lib/services/travel-conclusions-token.ts`, `lib/services/travel-times-token.ts`, `lib/services/travel-route-refresh.service.ts` (provenance-safe Routes reuse cache by `(origin, destination, mode, departure time bucket)`), `lib/ui/travel.ts`, `lib/ui/daily-brief-session.ts`.
  - Integration tests: `tests/google-calendar-agent-mcp-isolation.test.ts`.
- **WS-3B — Advisor Chat: Ephemeral >30d `list_calendar_load`, 7-Day Travel-Organizing Tool, Cross-Day & Recurring Remodeling, Model Armor Screening & Chat Disconnect/Summary Hygiene:**
  - `lib/services/chat/chat-tools.ts`, `lib/services/chat/chat-executor.ts`, `lib/services/chat/chat-turn.ts`, `lib/services/chat/chat-writes.ts`, `lib/services/chat/chat-prompt.ts`, `lib/services/chat/chat.service.ts`, `lib/db/chat.repo.ts`.
  - Inline structured travel cards in `components/chat/` (exact leave-by time & duration rendered beside reply, never in LLM input).
  - Opted-in, activity-gated weekly/monthly longitudinal calendar-load review service + cron wire-up (`lib/services/longitudinal-calendar-review.service.ts`).
  - Tests: `tests/chat-google-calendar-retention.test.ts`, `tests/chat-travel-organizing.test.ts`, `tests/longitudinal-calendar-review.test.ts`.

### Wave 3 — Settings UI, Canonical Two-Grant UX, Chained Onboarding & Mac `0.1.16` Bundle (after Wave 2 merges)
- **WS-4A — Web & Shared Settings UI (Q3 & Q6 exact parameters):**
  - `components/settings/GoogleCalendarPanel.tsx` (single row, status pill, Timeline & Travel + AI features split, collapsed pills AI picker, first-connect seeding note, quiet drift hint + Sync to AI, disconnect warning showing Calendar-touched conversation count, longitudinal review opt-in toggle).
  - `components/briefing/DailyBriefSettingsPanel.tsx` (inline **Connect Google Calendar for AI** shortcut when Timeline connected & AI not; Choose sources read summary + **Manage in Connected sources** link).
  - `app/(app)/settings/page.tsx`, `app/api/google-calendar/**` (versioned `purpose=ai_mcp`, AI calendar selection endpoint, Sync-to-AI endpoint, longitudinal review opt-in endpoint, disconnect count preview).
  - `components/briefing/DailyBriefLauncher.tsx` (AI grant generation & selection revision in cache key).
  - Update `interaction-registry.json`, design-system manifests, `docs/PRODUCT_MAP.md`, DOM tests.
- **WS-4B — Cadence for Mac `0.1.16` Versioned `purpose=ai_mcp` Broker & Shared Settings Wiring:**
  - `apps/desktop/src/calendar/google-calendar.ts` (dedicated `ai_mcp` Keychain pending slot & callback marker, preserving `purpose=agent` as `not_configured` and standard `cadence://calendar/callback` for older Macs), `apps/desktop/src/settings-screen.tsx`, `apps/desktop/src/product.tsx`, desktop tests (`npm run desktop:typecheck`, `npm run desktop:build`, `npm run desktop:native:test`).

### Wave 4 — Integration Verification, Phase 0 Live Spike & Pre-Ticket-245 Readiness (Completed / In Progress)
- Waves 1–4 implementation landed on `feat/google-calendar-mcp-migration`; Google Cloud Model Armor template (`projects/habit-tracker-498717/locations/us-east1/templates/cadence-calendar-mcp-screen`, `INSPECT_AND_BLOCK`, Cloud Logging OFF) is live on `habit-tracker-498717` so `cadence-calendar-agent-prod` stays unbilled on Standard Tier.

### Wave 5+ — Wave-Based Sequencing at Inference Pace (No Calendar Date Targets)
Calendar-date targets (prior December/January milestones) are dismissed in favor of wave-based execution at inference pace ahead of Google's February 1, 2027 external enforcement deadline:
- **Wave 5A (Disclosures, Model Armor OIDC & Verification Packet):** Privacy/Terms `P-090` updates, Ticket 245 verification packet refresh, Model Armor Workload Identity OIDC wiring (`habit-tracker-498717`, `x-goog-user-project`).
- **Wave 5B (Review & Rehearsal):** Full verification suite (`agents:check`, `interactions:check`, `map:check`, `resolvers:check`, `lint`, `typecheck`, `test`, `build`, `desktop:typecheck`, `desktop:build`, `desktop:native:test`) and clean local Supabase rehearsal.
- **Wave 6 (Phase 0 Live Wire Spike):** Run live `calendarmcp.googleapis.com` wire check once a fresh Google sign-in token is authorized.
- **Wave 7 (Ticket 245 Submission & Mac `0.1.16` Bundle):** Deploy to production, record and upload the Ticket 245 demo video on `https://app.cadence-me.com`, submit Data Access verification for `cadence-calendar-agent-prod`, and bundle Mac `0.1.16`.
