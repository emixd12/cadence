# AGENTS.md

## Project

This repository contains Cadence, a public, open-source personal behavior
tracker product. The implemented surfaces are an authenticated web app for one
account at a time and a separate public Astro marketing site under
`apps/marketing`.

The app lets a user create recurring behaviors, view scheduled occurrences in a timeline, and manually mark each occurrence as Completed or Not Completed. Unmarked occurrences remain Unresolved, and prior-day unresolved occurrences are grouped under Needs decision.

Cadence may support many independent accounts, but each account remains
single-player. This is not a general productivity app, not a social habit
tracker, not a medical dosing app, not a collaboration product, and not an
admin-heavy SaaS product.

Cadence also serves as a practical reference implementation and promotion
surface for the BehaviorLog Bundle standard:
`https://github.com/emixd12/BehaviorLog-Bundle`.

## Primary stack

- Next.js App Router
- TypeScript
- Supabase Postgres
- Supabase Auth with Google login
- Supabase Row Level Security
- Tailwind CSS
- shadcn-style components where useful
- Sequenzy for email reminders
- Web Push for browser notifications
- Vitest for resolver tests

Public-product surfaces are scoped in `docs/PUBLIC_PRODUCT_ARCHITECTURE.md`.
The Astro marketing site is implemented as a sibling app. Tauri desktop and
shared-package work is implemented under Tickets 107–114. Ticket 115 owns
Apple-trusted distribution acceptance and is in progress. macOS 14 runtime
testing is owner-deferred; the compiled minimum does not establish compatibility.
Tickets 116–122 implement optional Google
account linking and offline-capable desktop synchronization. The desktop track
uses Tauri v2, Vite, React, and local SQLite. Next.js stays at the repository
root. Tickets 146–148 implement the authenticated, read-only Cadence Daily Brief
in-app horse briefing. Mobile and broader workspace restructuring remain deferred.

## Agent operating model

Before implementing a task, read in this order:

1. `AGENTS.md`
2. `STATUS.md`
3. `docs/OPERATIONS.md`
4. Provider or governance docs relevant to the task:
   - `docs/SUPABASE_WORKFLOW.md`
   - `docs/SEQUENZY_WORKFLOW.md`
   - `docs/DATETIME_STRATEGY.md`
   - `docs/ROUTE_MAP.md`
   - `docs/AGENT_RESOLVERS.md`
   - `docs/VERCEL_WORKFLOW.md`
   - `docs/CRAWL_POLICY.md`
5. Product source-of-truth docs relevant to the task.
6. Existing tests and implementation.

`STATUS.md` is a current-state ledger. Update it when a ticket starts, completes, becomes blocked, is reopened, or materially changes scope. Do not use it to expand product scope.

If a user prompt conflicts with the docs, report the conflict before editing. If the user intentionally changes product direction, update the relevant docs in the same task.

Every new or materially changed product/design ticket must state its impact on
web, desktop, marketing, and future mobile. Each platform entry needs an
implementation reference, a follow-up ticket, or an explicit not-applicable
reason. Use the existing interaction registry and design-system catalog for
cross-platform evidence; do not create a parallel decision inventory.

## Source-of-truth documents

Product and implementation docs:

1. `/docs/PRODUCT_SPEC.md`
2. `/docs/DATA_MODEL.md`
3. `/docs/RECURRENCE_RULES.md`
4. `/docs/UI_SPEC.md`
5. `/docs/USER_FLOWS.md`
6. `/docs/INTERACTION_REGISTRY.md` plus `/interaction-registry.json`
7. `/docs/NOTIFICATION_SPEC.md`
8. `/docs/EXPORT_FORMATS.md`
9. `/docs/AGENT_RESOLVERS.md`
10. `/docs/ROUTE_MAP.md`
11. `/docs/DATETIME_STRATEGY.md`
12. `/docs/SUPABASE_WORKFLOW.md`
13. `/docs/SEQUENZY_WORKFLOW.md`
14. `/docs/OPERATIONS.md`
15. `/docs/TICKETS.md`
16. `/docs/DECISIONS.md`
17. `/docs/FUTURE_UPDATES.md`
18. `/docs/PUBLIC_PRODUCT_ARCHITECTURE.md`
19. `/docs/VERCEL_WORKFLOW.md`
20. `/docs/CRAWL_POLICY.md`
21. `/docs/DESKTOP_BUILD.md`
22. `/docs/DESKTOP_DATA_MODEL.md`
23. `/docs/DESKTOP_PARITY.md`
24. `/docs/INTEGRATION_PLAYBOOK.md`

## Product constraints

Keep the app small.

In scope:
- Google login
- Many independent single-account users for the web app
- Behavior CRUD
- Category CRUD or simple category selection
- Recurrence rules
- Occurrence generation
- Timeline-first interface
- Manual statuses: unresolved, completed, not_completed
- Notes on occurrences
- Browser reminders enabled by default
- Optional email reminders per behavior
- Basic analytics
- JSONL/CSV/full JSON/BehaviorLog export
- Public Astro marketing site
- Local-first macOS desktop tracking parity under Tickets 107–114
- Optional desktop Google account linking and synchronization under Tickets 116–122
- In-app read-only Cadence Daily Brief in the horse bubble under Tickets 146–148
- Workspace split only when explicitly ticketed

Out of scope for v1:
- Multi-user collaboration
- Social features
- Gamification
- Native mobile apps
- Apple Health / Google Fit integration
- Structured measurement templates
- Medication dose tracking
- Supply/refill inventory
- General AI coaching/chat and autonomous execution; Tickets 146–148 implement only
  the in-app read-only daily briefing in the horse bubble
- Calendar sync and event editing, except the planned read-only Google Calendar
  context in Tickets 132–137
- Payment/subscription infrastructure
- Admin dashboards
- PWA offline cache
- Web offline writes or PWA conflict handling
- Automatic missed status
- Speech features
- Mobile implementation

## Domain language

Use these terms consistently:

- Behavior: a recurring thing the user wants to track.
- Occurrence: one scheduled instance of a behavior.
- Unresolved: an occurrence that has not been manually marked.
- Completed: stored status meaning the behavior was completed.
- Not completed: stored status meaning the user explicitly says it was not completed. Stored as `not_completed` and displayed as Not Completed in the UI.
- Needs decision: UI group and derived state for unresolved occurrences before today. It is not a stored status.

Do not use “missed” as a stored status in v1.

## Architecture rule: resolver-first

Core logic lives in `/lib/resolvers`, with incremental extraction into
`packages/core` under Ticket 109. Preserve the existing web module APIs through
adapters or compatibility exports. Do not duplicate domain rules per platform.

Resolvers should be pure or nearly pure functions. They should not:
- Render UI
- Query Supabase directly
- Send email
- Send push notifications
- Read browser APIs
- Read environment variables
- Mutate global state

Repositories in `/lib/db` own database access.

Services in `/lib/services` orchestrate repositories and resolvers.

UI components call services/server actions. UI components must not implement recurrence, reminder, analytics, or export logic.

Desktop components use callbacks and client services instead of Server Actions.
Operation-specific DataStore methods own atomic mutations; thin native code
may handle SQLite transactions, files, notifications, and lifecycle. Business
decisions remain in TypeScript. Prove native boundaries in Ticket 108 before
broad shared-core or UI refactoring.

Desktop synchronization planning follows the same boundary. A pure planner
compares typed local, hosted, and saved common-baseline snapshots. Services own
network, Keychain, SQLite, Supabase, retries, and atomic apply. See
`docs/DESKTOP_BUILD.md#planned-account-mode`.

API routes and cron/process routes must call services. They must not duplicate resolver logic.

Run `npm run resolvers:check` after resolver, service, API route, cron/process, or UI logic changes.

## Required resolver modules

Implement and preserve these modules:

- `/lib/resolvers/recurrence.resolver.ts`
- `/lib/resolvers/occurrence.resolver.ts`
- `/lib/resolvers/timeline.resolver.ts`
- `/lib/resolvers/status.resolver.ts`
- `/lib/resolvers/reminder.resolver.ts`
- `/lib/resolvers/analytics.resolver.ts`
- `/lib/resolvers/export.resolver.ts`

The registry, allowed callers, forbidden bypasses, and paired tests live in `/docs/AGENT_RESOLVERS.md`.

## Status rules

Stored statuses:

```ts
type OccurrenceStatus = "unresolved" | "completed" | "not_completed";
```

Rules:
- New occurrences start as unresolved.
- The system must not automatically mark unresolved items as missed.
- At midnight, unresolved items from prior days move into the Needs decision UI group.
- The user can change a resolved status later.
- Notes can be added or edited.
- Needs decision is derived from `status === "unresolved"` and `local_date` before the current local date.
- Unresolved is shown separately and excluded from final adherence calculations.

## Date and time rules

Use the user's timezone, defaulting to America/New_York.

The day boundary is local midnight.

Date/time implementation details are locked in `docs/DATETIME_STRATEGY.md`:

- Use Temporal for timezone-aware recurrence and day-boundary logic when implementation begins.
- Store both UTC instants (`timestamptz`) and local calendar dates (`local_date`).
- Inject `now` into resolvers. Do not call `new Date()` inside resolvers.
- Do not parse `YYYY-MM-DD` with JavaScript `Date`.

## Recurrence rules

Supported v1 recurrence types:

- Daily
- Every N days
- Weekly on selected weekdays
- Every N weeks on selected weekdays
- Monthly on day N

Monthly day rule:
- If a behavior is scheduled for day 31 and a month has no day 31, schedule it on the last day of that month.

Do not implement natural-language recurrence in v1.

Do not expose raw cron syntax in the user interface.

## Reminder rules

Browser reminders:
- Enabled by default for every behavior.
- Only work after the user grants browser notification permission and registers a push subscription.
- If push is unavailable or denied, the app still works.

Email reminders:
- Disabled by default.
- Can be enabled per behavior.
- Can use a reminder offset, such as 1 day before or 3 days before.
- Use Sequenzy as the provider.
- Use the Sequenzy CLI workflow in `docs/SEQUENZY_WORKFLOW.md` for provider setup, template inspection, and test sends.

Reminder delivery rules:
- Reminders should be stored in `reminder_deliveries`.
- Pending reminders should be cancelled when an occurrence is resolved before the reminder sends.
- Failed reminders should be logged.
- Reminder processing should be idempotent.
- Reminder processing must avoid duplicate sends.

Desktop uses native reminders under `docs/DESKTOP_BUILD.md`. Preserve hosted
browser/email semantics. Target 30 days, prioritize nearest eligible reminders,
and show contiguous coverage verified through OS readback. Clearly disclose a
shorter OS-limited horizon; do not assume a universal request cap or add a
background helper. Desktop email delivery remains inactive.

## Supabase CLI rules

Supabase is CLI-first in this repo. Use `docs/SUPABASE_WORKFLOW.md` rather than rediscovering provider steps.

Project-local command form:

```bash
npm run supabase -- <command>
```

Rules:
- Use Supabase migrations for schema changes.
- Never change the hosted database directly.
- Keep local and hosted schema congruent through git-tracked migrations.
- Run `npm run supabase -- db reset` to verify migrations from a clean local database.
- Use `npm run supabase -- db push` for hosted deployment only after user authorization.
- Generate database types after schema changes.

Never change the database schema without:
- A migration file
- Updated `/docs/DATA_MODEL.md`
- Updated TypeScript types if needed
- Tests or manual QA notes

All user-owned tables must include `user_id`.

Exception: `profiles` uses `id` as the authenticated user's id (`auth.users.id`) instead of a separate `user_id`; its RLS ownership rule is `id = auth.uid()`.

All user-owned tables must have RLS policies.

These Supabase ownership and RLS requirements apply to the web database.
Desktop uses one stable local profile and a private SQLite database in local
mode. Tickets 116–122 may link that working copy to one authenticated account.
Use the user's JWT and hosted RLS; never put a service-role key in desktop or
authentication tokens in SQLite. Preserve local ownership, constraints,
history, and atomic mutation/outbox writes. Use current data contracts, not
only the initial Supabase migration. See `docs/DESKTOP_BUILD.md`.

Even though each account is single-player, do not bypass RLS in normal web app
code.

## Sequenzy CLI rules

Sequenzy is CLI-first for provider operations in this repo. Use `docs/SEQUENZY_WORKFLOW.md`.

Project-local command form:

```bash
npm run sequenzy -- <command>
```

Rules:
- Use `npm run sequenzy -- whoami` before provider operations that require auth.
- Use `npm run sequenzy -- login` when the user authorizes login.
- Do not send real emails without an explicit user-approved test recipient or production send instruction.
- Keep `SEQUENZY_API_KEY` server-only.
- Do not expose Sequenzy secrets to the browser.
- Keep provider calls in services/adapters, not resolvers.

## Route rules

The Timeline screen is the main screen.

Primary screens:
- Timeline: `/timeline`
- Behaviors: `/behaviors`
- Export: `/export`
- Settings: `/settings`

Behavior analytics and selected-day review live on `/behaviors`.
`/analytics` is a protected compatibility redirect to `/behaviors`, not a
primary screen.

Do not create `/dashboard` in v1.

Route ownership and planned API routes live in `docs/ROUTE_MAP.md`.

## Offline and PWA rules

Web offline behavior and PWA caching are deferred from v1.

Desktop tracking must work offline with or without login. Local mode requires
no account. Tickets 116–122 activate tombstones, the transactional outbox, and
cursors for optional account synchronization. Do not add a closed-app
background helper or web PWA synchronization.

Future offline/PWA work is tracked in `/docs/FUTURE_UPDATES.md`.

## Testing rules

Every resolver must have tests.

Minimum tests:
- Recurrence generation
- Monthly day 31 fallback
- Weekly and every-other-week scheduling
- Midnight day boundary
- Timeline grouping for prior unresolved items
- Status transitions
- Reminder delivery generation
- Export formatting

Before considering a ticket complete, run:

```bash
npm run agents:check
npm run interactions:check
npm run resolvers:check
npm run lint
npm run typecheck
npm run test
npm run build
```

If a command does not exist yet, either add it or state clearly that it is not available.

## UI and design rules

The interface should be sparse.

When changing reusable UI, design tokens, component inventories, templates, navigation, layout shells, or design-system pages, invoke the design-system-bench skill.

Occurrence rows should expose:
- Completed
- Not Completed
- Note

Avoid:
- Dense dashboards
- Gamified streaks
- Social language
- Productivity-app sprawl
- Excessive modals
- Complex settings

For UI/design work, use the project-local impeccable workflow before editing UI:

```bash
node .agents/skills/impeccable/scripts/context.mjs
```

Then read `.agents/skills/impeccable/reference/product.md`. If a specific impeccable command is relevant, read the matching reference file.

`DESIGN.md` is seeded. After real UI exists beyond the scaffold, update it from actual code rather than intentions.

`interaction-registry.json` is the canonical inventory of implemented user
interaction intents. Update it in the same change whenever a user-facing
interaction is added, removed, renamed, moved, gated differently, or given a
materially different side effect. Run `npm run interactions:check`; the command
is also enforced by `npm run agents:check`.

## Completion criteria for any coding task

A task is complete only when:

1. The implementation matches the relevant docs.
2. Resolver logic is tested when resolver logic exists or changes.
3. Agent drift checks pass.
4. TypeScript passes.
5. Lint passes.
6. Tests pass.
7. Build passes.
8. Schema changes include migrations.
9. UI changes are mobile-responsive.
10. No out-of-scope features were added.
11. `STATUS.md` is updated if ticket state changed.
12. The final response explains:
   - What changed
   - Files changed
   - Tests run
   - Any remaining risks or TODOs

## How to handle ambiguity

If ambiguity blocks implementation, ask a narrow question.

If ambiguity does not block implementation, make the simplest assumption consistent with the docs and document it in the final response.

Do not expand scope to solve speculative future requirements.

## Security rules

- Use Supabase Auth and Google login for the web app and optional desktop
  account mode under Tickets 116–122.
- Add desktop account controls only within Tickets 116–122. Never package a
  service-role key or Google provider credential.
- Keep desktop session secrets in Keychain, not SQLite, browser storage, logs,
  exports, or backups.
- Restrict hosted data to the authenticated user and local data to its stable profile.
- Use RLS on all user-owned web tables.
- Never commit `.env` files or secrets.
- Never expose service-role keys to the browser.
- Use server-side code for privileged operations.
- Treat provider CLI login output, API keys, and approval codes as secrets.

## Style rules

- Prefer simple TypeScript.
- Prefer explicit types.
- Prefer small functions.
- Prefer boring UI.
- Do not introduce unnecessary state-management libraries.
- Do not add a component library unless requested.
- Do not add analytics/tracking scripts unrelated to this app's internal behavior tracking.

## Implementation strategy

Implement in small vertical slices.

Do not attempt to build the whole application in one pass.

Recommended sequence:
1. Project scaffold
2. Supabase auth and schema
3. Behavior CRUD
4. Recurrence resolver
5. Occurrence generation
6. Timeline
7. Status marking
8. Notes
9. Reminder scheduling
10. Browser push
11. Email reminders
12. Analytics
13. Exports

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
