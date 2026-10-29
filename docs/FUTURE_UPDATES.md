# Future Updates

This document tracks ideas that are intentionally deferred until after the first build is complete.

Items in this document are not v1 requirements unless a future task explicitly moves them into the active product docs and tickets.

Rough feature ideas that are not ready for tickets live in
`docs/FEATURE_IDEAS.md`. That file is an idea inbox, not an implementation
contract.

## Day-progress timeline follow-ups

Tickets 132–137 now plan the continuous left-side timeline and read-only Google
Calendar context on web and desktop. Their planned product/UI contracts own
that scope; the original idea remains in `docs/FEATURE_IDEAS.md`.

The owner accepted Ticket 132's UI baseline on 2026-09-16 and prioritized
Ticket 134 infrastructure. Its `docs/EXTERNAL_EVENT_CONTRACT.md` preserves
scheduling facts for future consumers without implementing those consumers.

Tickets 144–145 cover the reusable integration playbook and original consumer
planning. The September 20 correction replaces the external advisor with an
in-app horse briefing. `plans/first-external-consumer.md` retains its path and
now defines the corrected flow. Tickets 146–148 own bounded facts/history,
first-party generation with OpenAI Luna 5.6, and the automatic dismissible bubble.
Existing sign-in replaces delegated consumer authentication. The implementation
and synthetic verification are recorded in `qa/in-app-daily-brief.md`; hosted,
installed-desktop and real-data release evidence remain separate.

Tickets 142–143 implement optional default Behavior duration and scheduled archive.
Those planning fields are no longer deferred; source and release evidence remain
in `STATUS.md` and `docs/qa/behavior-planning-fields.md`.

Tickets 151–155 now plan an internal briefing workbench: versioned configuration,
curated references, deterministic read-only scheduling options, comparison previews
and reviewed preset rollout. These controls are not implemented. Open-ended research,
a public tuning dashboard and execution of suggested moves remain outside this slice.

Still deferred:

- Minor Timeline visual polish after connector infrastructure.
- Applying advisor suggestions or rearranging a schedule. Cadence Daily Brief
  may suggest priorities, timing, sequence, and schedule changes under Tickets
  146–148, but it cannot execute them.
- A write/execution phase for Cadence Daily Brief. This is intended future work,
  not a permanent exclusion. It needs separately scoped operations, permissions,
  preview, explicit human approval, stale-context checks, conflict handling,
  idempotency, audit history, revocation, and atomic apply behavior. Read and
  execution grants remain separate.
  Owner request (Ticket 184 review, October 16, 2026): when a brief offers a
  supported time, let the user move that day's Behavior to it with one action
  after a confirmation step. Start with Cadence Behaviors for the current day.
  Moving external Calendar events comes later and needs a Calendar write grant.
- An external advisor transport. The in-app briefing needs no delegated
  consumer or generic connector framework. The remote MCP server is no longer
  deferred; see "MCP server follow-ups" below.
- Two-way Calendar sync and source-event editing.
- Connectors beyond Google Calendar and the Outlook, iCloud, and Hevy sources
  locally implemented in Tickets 233–240, with live/release acceptance open under 228. Focus Keeper capabilities remain unverified.
- Generic CalDAV coverage for providers such as Fastmail, Zoho, and Yahoo. Each
  needs its own authentication research and ticket. Not implemented.
- Read-only subscription-feed calendars, such as Proton shared links. Link
  possession and freshness limits need disclosure. Not implemented.
- EventKit access to local-only Mac calendars. It is a native permission, not a
  web-capable connector, and is outside the approved iCloud path.
- Apple Account "supported app" authorization for iCloud, if Apple publishes a
  developer path. It could replace app-specific passwords.
- Hevy early-stop pagination or change-feed reads, after Hevy documents workout
  ordering or creation events.
- Different or multiple accounts per provider for one Cadence account, and
  connector access in account-free desktop mode.
- New timezone controls and daylight-saving presentation refinements. Existing
  timezone and day-boundary correctness remains required for the planned feature.
- Native mobile implementation, web offline caching, and closed-app helpers.

Promote these separately only when their own scope is approved. Ticket 134
capability research is recorded in `docs/qa/google-calendar-capabilities.md`.

## Public product surfaces

Cadence's public-product direction is documented in
`docs/PUBLIC_PRODUCT_ARCHITECTURE.md`.

Deferred surface work includes:

- broader workspace restructuring or moving Next.js out of the repository root,
- mobile app.

Do not implement these without a scoped ticket.

Tickets 107–114 implement the macOS desktop app and incremental extraction
of `packages/core` and `packages/ui`. Their contract lives in
`docs/DESKTOP_BUILD.md`. Ticket 115 defers Apple-trusted distribution. Tickets
116–122 plan optional Google account linking and offline-capable desktop
synchronization. Intel releases and desktop email delivery remain deferred.

Ticket 116's contract is active product architecture, not a future idea.
Tickets 117–122 own its implementation. A hosted change journal remains future
work unless Ticket 120 measurements prove the bounded snapshot design
insufficient.

Implemented surface work:

- Astro marketing site under `apps/marketing`.

## Agent readability roadmap

The Ticket 031 marketing site includes static HTML, Markdown mirrors,
`llms.txt`, `llms-full.txt`, a route manifest, sitemap, and robots output.

Deferred agent-readability work:

- Add a server or edge log measurement pipeline for agent and crawler traffic.
  Client-side analytics cannot measure this traffic because agents and crawlers
  do not execute JavaScript.
- Revisit emerging agent discovery and verification layers when they become
  stable enough to adopt, including Web Bot Auth or `Signature-Agent`, inline
  `text/llms.txt`, MCP server cards, A2A agent cards, and agentic-commerce
  protocols.

Do not add measurement providers, bot-management rules, MCP tools, or emerging
agent-commerce protocols without a scoped ticket and privacy review. Tickets
220–232 are that scope for the Cadence MCP server, and Ticket 231 is its privacy
review. MCP server cards remain deferred.

## MCP server follow-ups

The owner approved the remote MCP server and Claude and ChatGPT plugins on
2026-10-18 (Tickets 220–232; `docs/DECISIONS.md`, `docs/MCP_INTEGRATION.md`).
These related items stay deferred until separately scoped:

- MCP Apps interactive widgets inside Claude or ChatGPT.
- A REST API and webhook adapter over the same operation contract.
- Facets sync. Tickets 220–232 add only foundations: client attribution,
  retry-safe writes, external record links, and "changed since" reads.
- A local stdio MCP server for account-free desktop data, which never reaches
  the hosted server.
- Per-event client provenance in synced status history and BehaviorLog exports.
  In v1, hosted integration activity records which client made a write; synced
  tables do not change.
- MCP prompts and resources. V1 exposes tools only.
- An OpenAI-compatible profile tool. The optional `openai/profile` marker
  requires an identity-only output schema incompatible with `get_account_context`.
  V1 connects without it; account labels and duplicate detection may be less reliable.
- A production sign-in path for directory reviewers. It needs an owner decision.

## Paid shared account and speech features

Future commercial work may add:

- paid product capabilities that do not gate the account synchronization
  planned in Tickets 116–122,
- optional cloud sync for a future mobile client,
- future speech-to-speech AI behavior-review features.

Billing, general AI chat/coaching and audio speech remain deferred. The in-app
read-only horse briefing is the narrow implemented AI feature under Tickets 146–148.
It adds no payment infrastructure, subscription gate, general chatbot or voice.

## Location permission VM images

A spike on October 27–29, 2026 showed that Cadence for Mac's location permission
states can be tested in disposable Tart VMs: one image per state (never asked,
allowed, denied), each set by the owner once. `scripts/location-vm.mjs` installs a
published DMG in a copy, checks Gatekeeper, reads the Device location line, presses
**Check again** and **Open Location Services**, and deletes the copy. VMs cannot get
a position fix, so fix and route checks stay on real hardware. Details, evidence and
setup: `plans/2026-10-27-location-vm-images.md`.

Future work may make these runs part of installed acceptance. The spike also found
that an answer to the first prompt given after Cadence's 12-second request deadline
is lost; that fix needs its own ticket.

Platform impact: desktop only. Web, marketing and future mobile: not applicable.
Messaging impact: none.

## Web PWA and offline support

Future work may add:
- Installable PWA metadata
- App shell caching
- Cached timeline access
- Local pending status changes while offline
- Upload of pending changes when the connection returns
- Sync conflict handling

Do not implement this in v1.

This restriction applies to the web app. Desktop tracking uses local SQLite
and requires offline writes. Tickets 116–122 may activate its mutation outbox
and cursors without authorizing web offline work.

## Local pending action queue

If web offline status logging is added later, use a small local pending action queue rather than cookies.

Candidate storage:
- IndexedDB
- LocalStorage only if the queue remains very small

Pending action shape should include:
- occurrence_id
- user_id if available locally
- desired status
- note change if included
- local action timestamp

Future sync rules must answer:
- What happens if the occurrence was changed on the server before sync?
- Whether latest explicit user action wins
- Whether the user should review conflicts
- How pending actions are surfaced in the UI

## Future cache resolver

If offline/PWA support moves into scope, add:
- `/lib/resolvers/cache.resolver.ts`
- tests for cache shape and pending action planning
- service worker or PWA config files

The cache resolver should stay pure and should not read browser APIs directly.
