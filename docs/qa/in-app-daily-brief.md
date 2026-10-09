# In-app Daily Brief — September 20, 2026

Tickets 146–148 implement the corrected first-party flow in source. Fresh
independent review returned `ship` with no findings. Hosted deployment and installed-desktop acceptance
are separate gates; this record does not claim production activation.

## Runtime and ownership

- Timeline loads its persisted coverage, then invokes the briefing through the
  existing account. Settings explicitly enables OpenAI disclosure and optional
  selected Calendar timing. No approval of model-written text is required.
- `daily-brief.service.ts` reads the internal context directly. The former external
  consumer is now provider-neutral generation/validation. `daily-brief-openai.ts`
  is the sole model adapter. The old GET stays disabled as a compatibility boundary.
- The model receives minimized current-day facts, 90-day all-status counts,
  aggregate durations and authorized Calendar intervals. It receives no Notes,
  raw history, credentials, database capability or mutation tools.
- Session existence/expiry, disclosure revision, active Behavior selection,
  Cadence revision, timezone/day and Calendar connection/selection fence both
  submission and delivery. External sources retain separate observation times.
- A 60-second attempt contains read/model phases capped at 30 seconds each.
  Admission permits one active generation per account and six starts/minute.
  Installation/day state suppresses completed duplicates; failures need explicit retry.
  Ticket 168: an explicit retry can also replace a completed-but-undelivered
  attempt, capped at one automatic start plus three retries per installation/day.
- Only private operational metadata is written. No prompt or generated text is
  persisted. Up to eight latest installation attempts remain until replacement,
  disablement or account deletion. Provider retention remains separate.

## Verification evidence

- Node 24 targeted provider/service/route checks: 25 passed.
- Completion-history contract/service/migration checks: 20 passed.
- Storage repository/migration checks: seven passed.
- Clean `supabase db reset` passed through migration `20260921003952`.
- Snapshot, admission and Daily Brief SQL smoke scripts passed with rollback.
  Tests cover two owners, revoked sessions, disclosure revisions, Calendar fences,
  deduplication, late completion tokens, retry, bounded rows and rate limits.
- Generated public/GraphQL database types match the local schema.
- Cadence Docker ports remained bound to `127.0.0.1`.
- Required repository checks passed: agents, interactions, resolvers, lint,
  typecheck, test and production build. Core portability, design-system,
  desktop typecheck and desktop production build also passed.
- Full Vitest run: 234 files passed, five skipped; 1,885 tests passed, 29 skipped.
  The first final rerun hit a sandbox localhost-listener denial in the fake
  Sequenzy fixture. The rerun with local socket access passed. No email was sent.
- Lint has zero errors and ten pre-existing warnings outside Daily Brief.
- Responsive synthetic browser fixtures passed at 390×844 and 1280×900.
  The horse pointer remains visible, long unbroken text wraps/scrolls, Close
  measures 44×44 pixels, and tracking controls remain unobscured.
- DOM checks cover automatic invocation, pending dismissal, explicit retry,
  account switch/logout, expiration, cross-tab disclosure and unavailable settings.
- Parent inspected the scoped change set before dispatching fresh independent review.
  Fresh read-only review returned `ship` with no findings. Requested reviewer:
  `gpt-5.6-sol` / `high`; runtime model, effort and token usage were unobservable.
- Temporary browser viewport and fixture tab were cleaned up. The local test
  database and Docker proxy stopped after rollback checks. Existing dev servers
  were left running.

## Synthetic OpenAI access

The owner explicitly approved reuse of the existing key. The production adapter
successfully called `gpt-5.6-luna` with invented walk facts and returned valid JSON.
No Cadence account or Calendar data was sent. The adapter used Responses,
`store:false`, `background:false`, `tools:[]`, strict JSON schema and no redirects.
No credential, response body, response ID or prompt was added to the repository.

OpenAI's [model documentation](https://developers.openai.com/api/docs/models/gpt-5.6-luna)
confirms the selected model interface. Its [data controls](https://developers.openai.com/api/docs/guides/your-data)
distinguish application storage from abuse-monitoring and prompt-cache retention.
Cadence does not promise zero provider retention.

## Ticket 168 recovery — September 26, 2026

Source inspection found four loss paths. Regression tests reproduce each one
against the previous launcher; 18 of the new cases fail there and pass now.

- The launcher was keyed by Timeline facts. Marking an occurrence while loading
  remounted it, aborted the request, and the daily `attempted` marker blocked any
  new request. The launcher now receives the facts as `sourceKey` and stays mounted.
- Navigation away from Timeline discarded the attempt. A page-session memory per
  client now keeps the in-flight attempt and fresh result for same-account remounts.
- The server marked a finished generation `completed`, so a retry after an
  undelivered result returned `already_attempted`. Migration
  `20260926150000_daily_brief_bounded_recovery.sql` admits up to three deliberate
  retries per installation, day and disclosure revision, including after completion.
- The web client had no deadline, and the desktop deadline disappeared when a
  caller signal was supplied. Preference reads, installation lock, session lookup,
  request and body decoding now have composed client deadlines (15 s, 5 s, 75 s).

Browser markers now record `attempted`, `delivered`, `dismissed` and a bounded
`pendingUntil` claim for parallel tabs. They hold no generated text. Markers
written before this change count as delivered, so no stale recovery notice appears.

Outcomes are distinct: pending, rate limit (retry disabled until the server wait
passes), timeout, offline, sign-in, changed context, retry limit, interrupted,
undelivered, expired and outdated. Server phase spans (`daily_brief.preferences`,
`admission`, `context`, `model`, `finish`, `request`) record duration and error
code only, when `CADENCE_PERF_LOG=1`.

Verification: focused Daily Brief suites pass (77 tests). A port-less local
Postgres 17 container (`supabase/postgres:17.6.1.159`) applied the original and
new migrations over auth/profile/Calendar stubs. A rollback-free smoke script
confirmed: automatic admission; `pending` while leased; `already_attempted` for a
repeated automatic start; three retries admitted after completion; `retry_exhausted`
on the fifth admission; four rate-limit entries; an independent second owner; and
denied direct table reads. The container was removed. A full `supabase db reset`
did not run (see the loopback-binding note in `docs/SUPABASE_WORKFLOW.md`).
Hosted migration, deployed-web and installed-desktop recovery checks remain open
under Ticket 174.

## Remaining release evidence

- Apply the committed migrations to the hosted project only under deployment authority.
- Configure the server-only key and verify production first-party sessions and desktop CORS.
- Record authorized real-data and Google onward-use acceptance before Calendar model use.
- Verify the installed desktop app with linked/unsynced/offline accounts.
- Keep marketing claims unchanged until live acceptance supports publication.

Disable the feature in Settings or remove the server key to roll back generation.
Additive database functions can remain unused. Account deletion cascades private
operational records; provider retention cannot be retroactively recalled by Cadence.
