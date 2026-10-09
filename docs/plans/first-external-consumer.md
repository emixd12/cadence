# Cadence Daily Brief: in-app horse briefing

The September 20, 2026 owner correction supersedes the external-advisor design.
The filename remains stable for existing links. The authoritative decision is
[the in-app correction](../DECISIONS.md#2026-09-20-cadence-daily-brief-belongs-inside-cadence).
Tickets 146–148 now implement an in-app experience, not a separate consumer.

## Planned advisor extension — September 26, 2026

The owner approved filing Tickets 168–174 after reporting unreliable loading and
overly terse advice. Their requested scope includes travel timing and fitting
Behaviors around Calendar events, plus occasional adherence tips from structured
analysis inspired by the export prompt library. Implementation has not started.

The current invocation, input and prose contracts below describe the existing
release. Tickets 168–174 own their next revision: recover failed or undelivered
requests without losing dismissal or quotas; add bounded, source-specific findings;
permit minimal historical evidence to explain useful tips; and suppress repetition.
Routine ledger recaps remain excluded. Extending Daily Brief needs no second recipe,
general chatbot, new provider or autonomous execution.

Reuse existing travel calculations and the shared planner for all timing. Preserve
the current exclusion of travel from model input until provider-use clearance and
revised disclosure pass. Deterministic, attributed travel guidance beside the brief
is the supported fallback. Optional Notes and reminder/history sources require
explicitly defined fields and disclosure; this plan does not turn them on.

`docs/PRODUCT_SPEC.md#planned-advisor-improvements-tickets-168174` owns the planned
product boundary. `docs/TICKETS.md` owns the sequence, dependencies, platform impact
and acceptance. Existing workbench/QA records remain canonical. Ticket 168 can ship
independently; Ticket 174 carries forward open briefing gates without erasing them.

## Accepted experience

1. On the first app opening of the local day, Cadence presents a daily briefing
   in a text bubble emerging from the existing Timeline horse.
2. Cadence gathers relevant Behaviors, completion history, and connected Calendar
   scheduling facts. These are model inputs, not a prewritten briefing to approve.
3. A server-side model generates the briefing from those facts.
4. Cadence displays the briefing in the bubble. The user can dismiss or ignore it
   and continue tracking without responding, accepting advice, or changing screens.

Generation may finish after the app opens. It must not block the Timeline, steal
focus, or require a manual Generate action for the ordinary daily flow. There is
no per-briefing summary approval. Any required model-data disclosure or feature
enablement belongs to setup, not approval of generated prose.

Planning default: one automatic attempt per account/local day per app installation,
with same-day dismissal preserved through navigation and reopening. Failed attempts
allow an explicit retry; they do not create an automatic retry loop. Account/date
changes reset the presentation scope. Ticket 148 verifies this policy alongside
server deduplication and limits; no cross-device dismissal synchronization is implied.

Ticket 168 separates the automatic start, delivery and dismissal. The browser
records whether ready text reached it, never the text itself. A page-session
memory lets a remounted Timeline reattach to the in-flight attempt or fresh
result. An abandoned, failed or server-completed-but-undelivered attempt shows
a recovery notice with an explicit retry. The server admits one automatic start
plus three deliberate retries per installation, day and disclosure revision.
A Timeline change or expiry withdraws delivered text and offers a refresh.

## Authority and provider boundary

Read-only describes execution authority. The briefing may recommend priorities,
timing, sequence, or schedule changes. It cannot mark an Occurrence, edit a Behavior,
write a Note, send a reminder, import data, or edit Calendar events. No apply button
or model write tool exists in this phase. Future execution remains intended work,
with separately scoped operations, permissions, preview, approval, and conflict handling.

Reuse Cadence sign-in and authenticated account ownership. Web requests use the
existing server-verified session; linked desktop uses its existing authenticated
account path and Keychain custody. No external advisor account, delegated OAuth
client, PKCE flow, consumer token, or public MCP/API surface is required.
The September 19 delegated-token isolation finding is historical evidence about
that abandoned architecture, not a blocker for first-party briefing generation.

The model receives only validated facts. It receives no Supabase session, Google
credential, OpenAI key, database client, arbitrary fetch capability, or write tool.
Normal first-party sessions retain their ordinary app authority; the generation
service and model path must expose no tracking or provider mutation capability.
Repositories retain RLS ownership. Never use a service-role fallback.

The initial provider/model is OpenAI **GPT-5.6 Luna**, API ID `gpt-5.6-luna`.
The [official model page](https://developers.openai.com/api/docs/models/gpt-5.6-luna)
was fetched September 20 and documents Responses and structured outputs.
Cadence's server owns the provider call. This selects the product's model, not
this coding task's model. Account access and runtime credentials remain unverified.
Do not silently substitute another model.

Keep architecture provider- and agent-agnostic through one small generation
boundary: validated briefing facts in, validated briefing result out. Put the
OpenAI request/response mapping in one server adapter and configure the model
there. Keep provider SDK types out of core rules, UI, and persisted contracts.
No multi-agent runtime, provider registry, tool framework, or second provider is
needed. A future adapter must satisfy the same input, output, and authority tests.

## Recipe-scoped model inputs (Tickets 156–158)

The table describes the shared authorized source contract. Daily Brief recipe 1.0
selects a subset through configuration 1.2 and applies prose policy 2.1. Resolved
work is excluded before model serialization; the shared ledger status remains intact.
Independent controls omit completion counts, recorded elapsed totals, Calendar facts
and duration sources. Actual finished-at timestamps remain unavailable: status
updates do not establish finish time. Historical averages may derive from internal
history even when raw elapsed totals and completion counts are excluded. Recipe
selection never grants account, Calendar or model-data permissions.

Daily Brief interprets practical constraints and supported opportunities. It does
not narrate completion/adherence or raw availability diagnostics. Missing duration
cannot prove a fit; partial Calendar coverage cannot prove free time. New conflict
analysis remains in Ticket 159. Ticket 160 defines the accepted travel direction;
Tickets 162–165 implement and verify proactive multimode routes, per-leg occupancy
and existing Timeline presentation. A missing base suppresses only final-return
advice; known outbound and event-to-event advice and collisions remain available.
Current device position overrides a predicted immediate origin. Runtime travel
guidance remains unavailable until those follow-ups supply verified evidence.

## Shared source inputs

| Information | Minimum projection and existing owner |
|---|---|
| Current-day Behaviors and Occurrences | Opaque references, title, manual status, local date, scheduled instant and exact/window bounds. Reuse `lib/services/advisor-day-context.service.ts` and core validation. |
| Completion history | Bounded per-Behavior Completed, Not Completed, and Unresolved counts, declared local-date lookback, and completeness. Reuse analytics/status rules; Unresolved remains separate and excluded from final adherence. Ticket 146 adds this context; duration estimates alone do not satisfy it. |
| Duration | Explicit default, measured estimate, or unknown with provenance/sample count. Reuse `resolveBehaviorDurationEstimate`; raw timing sessions remain internal. |
| Connected Calendar | Authorized selected-calendar intervals/all-day spans, busy/free/unknown, tentative/declined state, unknown ends, opaque references, recurrence identity, revisions and coverage. Reuse existing Calendar validation, broker, and subset reads. |
| Reliability | Account-scoped reference, local timezone/day bounds, capture/expiry, per-source observation/revision, selection/connection and disclosure revisions, completeness and stable failures. |

History is factual input for the model, not a manually approved daily summary.
The existing 90-complete-local-day window is the maximum initial lookback;
declare the actual interval. Selected recorded elapsed inputs contain stopped eligible totals and local dates,
never exact session timestamps. Do not expose raw status-history rows, Notes, exact
sessions, reminder logs, old definitions, emails, or account IDs. Calendar titles,
descriptions, attendees, locations, URLs, attachments, and raw provider IDs remain
excluded in this slice. More fields require an explicit need and updated disclosure.
Treat all user/provider text as untrusted data, never instructions or authority.

Calendar display permission alone does not cover transmission to the model.
Ticket 147 implements first-party briefing enablement and disclosed data use,
including optional Calendar context, destination and retention. Reuse connector
selection and same-account rules. Do not recreate external-client grants. Fence
disablement, account switching, connector disconnect/reconnect, and selection or
disclosure changes before model submission and before displaying the result.

## Service, route, limits, and freshness

The model path reads persisted tracking data. It does not call Timeline/export
entry points that generate Occurrences or reconcile archives. Normal app loading
can perform existing maintenance under existing authority. If briefing coverage
is still stale or changed, return an explicit unavailable/incomplete state.
Do not repair tracking data as a side effect of generating advice.

Ticket 147 implements one first-party `POST /api/advisor/brief` operation for bounded
generation. POST initiates model work; it grants no domain-write authority. Use
existing authenticated request handling, web origin/CSRF checks, exact desktop
broker origins, owner isolation, `no-store`, safe errors, and server rate limits.
The server derives owner, timezone and current date. Clients cannot supply an
owner ID, model prompt, arbitrary provider URL, credential, or unbounded query.

The old `GET /api/advisor/day-context` remains disabled in current code. Ticket 147
retains that disabled compatibility boundary and repurposes the consumer module
for internal provider-neutral generation; do not enable delegated access. Share the internal service directly rather than calling the server's own
HTTP API. External-consumer tests are reusable evidence, not revised-flow acceptance.

Retain existing read limits: one current local day, 100 Behaviors, 200 Occurrences,
32 calendars, 500 events, and 512 KiB serialized context. Reject overflow instead
of truncating. Internal history caps remain 10,000 Occurrences and 20,000 sessions;
capped history becomes explicitly unknown/incomplete, never a biased count or
estimate. Ticket 146 queries all manual statuses for completion aggregates. Duration
estimates still use only eligible Completed samples.

Reuse six starts per account per minute and one in-flight read/generation per
account. In-app callers use a fixed server-owned client identity for existing
admission storage. Ticket 147 bounds the entire read-plus-generation attempt
at 60 seconds, with no more than 30 seconds for each phase. Bound model output
size/tokens and reject invalid output. Daily invocation deduplication prevents
navigation, remounts, parallel tabs, or retries from multiplying model requests.
Document any briefing cache, cancellation, admission, consent and deletion writes
as operational state; none may mutate source records.

Context expires at the earliest source age of five minutes, next local midnight,
or invalidated authorization/disclosure. Revalidate revisions before model input
and before delivery. A single bounded reread can replace expired context within
the total deadline; otherwise return a limited/unavailable state. Different sources
have separate observation times, not a cross-provider transaction. A daily briefing
does not prove that today's schedule stays current all day. Label observation time
and withdraw current timing claims after expiry or observed changes.

Partial or unavailable Calendar data never means an empty or conflict-free day.
Cadence-only priority advice may describe missing Calendar context. Tentative,
declined, transparent, all-day and unknown-end events retain their meanings.
Confirmed busy timed intervals reuse existing half-open overlap rules.

## Bubble and platform behavior

Use the existing horse in `app/(app)/timeline/page.tsx` and
`apps/desktop/src/timeline-screen.tsx`. Preserve the app's IBM Plex Sans, square
corners, spacing tokens, colors and Timeline hierarchy. The bubble is a text
surface attached to the horse, not an audio feature, modal, chatbot screen or
new navigation item. No radius or typography redesign is implied.

Provide readable wrapping, a keyboard-accessible dismiss action, visible focus,
adequate contrast, and reduced-motion behavior. Announce completed text politely
without stealing focus. Ignoring or dismissing never blocks status controls.
Test long text, loading, errors, unavailable data, narrow mobile web and desktop.
A dismissed pending request must not reopen the bubble on completion.

| Platform | Implementation reference or follow-up |
|---|---|
| Web | Tickets 146–147 own core/server orchestration; Ticket 148 adds the horse bubble to the existing Timeline. |
| Desktop | Ticket 148 adds the same bubble behavior to `apps/desktop/src/timeline-screen.tsx` for linked online accounts. Hosted context excludes unsynced/local-only data and must disclose that limit. Account-free/offline tracking remains available; a local-only AI adapter is deferred. |
| Marketing | No public capability claim from this implementation. Ticket 148 records factual disclosure/publication follow-up before promotion. |
| Future mobile | Shared contracts remain reusable; native mobile implementation is not applicable to these tickets. Responsive web acceptance remains required. |

Use `interaction-registry.json` and `design-system.surfaces.json` during Ticket 148.
Register automatic invocation, dismissal, retry and enablement only when implemented.
Invoke design-system-bench before reusable UI/catalog changes; use Impeccable
before UI edits. Do not create a second interaction inventory.

## Migration, acceptance, and remaining gates

Ticket 146 reopens the accepted internal contract for bounded completion history
and first-party disclosure fencing. Ticket 147 replaces delegated auth with
first-party generation and the OpenAI adapter. Ticket 148 replaces the synthetic
external consumer with the automatic horse-bubble flow and end-to-end acceptance.
Keep September 19 source/SQL/test results as dated evidence, not proof of these
new criteria. The implementation checkpoint below records the revised source changes.

Required evidence includes two-account isolation; zero model credentials/tools;
zero source writes; completion-history caps; Calendar semantics; injection;
expiry/revision/disclosure races; output validation; duplicate opening suppression;
ignored/dismissed/error/retry flows; linked/unsynced/offline desktop behavior; and
responsive/accessibility checks. Run all required repository checks for runtime work.

Provider selection is settled. Verify actual OpenAI account/model access, server
secret custody, retention/deletion terms, operational metadata retention, Google
onward-use requirements, and exact live-test authority before real-data testing.
The original alignment changed documentation only. The implementation checkpoint
below records the subsequent synthetic model call; no real-data transmission or
hosted deployment occurred. Source, synthetic, deployed,
live provider/model, installed desktop, and public evidence remain separate.
Calendar and Apple release gates remain independent; do not reset or close them.

## September 20 implementation evidence

The source implementation uses `GET/PUT /api/advisor/preferences` and
`POST /api/advisor/brief`. Enablement defaults off and records optional Calendar
selection/connection fences. Private RPCs validate current sessions and deduplicate
installation/day attempts. No prompt or briefing history is persisted. The OpenAI
adapter passed one synthetic request using the owner-approved existing key.
See `docs/qa/in-app-daily-brief.md` for exact checks, operational retention,
rollback and separate hosted/native/live-data gates.
