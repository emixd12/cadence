# Architecture map

Last verified against source: 2026-11-25, commit `568df087`.

This file tells an agent where code lives, how a request moves through it and which
edits must happen together. It is a navigation aid, not a source-of-truth document.
Product rules stay in `AGENTS.md` and the documents it lists. When this file and the
code disagree, the code is right: fix this file in the same change.

`AGENTS.md`, "Codebase map", holds the short version. Read this file when a task
touches an area you have not worked in.

## 1. Repository layout

| Path | What it holds |
|---|---|
| `app/` | Next.js 16 App Router web app. Route groups `(app)`, `(auth)`, `(legal)`; `api/`; `auth/`; `oauth/`; `mcp/`; `.well-known/`; `design-system/` |
| `proxy.ts` | The Next.js request proxy. This repo has no `middleware.ts` |
| `components/<area>/` | React components. Many are compiled into the Mac app as well |
| `lib/services/` | I/O services (162 files). Orchestrate repositories and resolvers |
| `lib/db/` | Repositories. `database.types.ts` is the generated Supabase type file |
| `lib/resolvers/` | One-line re-exports of core resolvers, plus the web-only Public Trust resolver |
| `lib/integrations/`, `lib/mcp/` | MCP transport, operation dispatch, session-less per-user callers |
| `lib/auth/`, `lib/supabase/`, `lib/security/`, `lib/cache/`, `lib/ui/` | Sign-in, Supabase clients, rate limits and kill switches, read cache, client helpers |
| `packages/core/` | `@cadence/core`: pure resolvers, portable services, types, MCP contract, notices. No I/O |
| `packages/ui/` | `@cadence/ui`: `runtime.tsx`, `tokens.css`, `fonts.css`. No components |
| `apps/desktop/` | Cadence for Mac: Tauri v2, Vite, React, SQLite, Rust and Objective-C |
| `apps/marketing/` | Astro 7 static marketing and developer site |
| `supabase/` | `config.toml` and 157 migrations. `seed.sql` is empty by design |
| `integrations/` | Claude and ChatGPT plugins and their shared skills |
| `tests/` | Vitest tests (flat), `sql/` psql smokes, `fixtures/`, `helpers/`, `acceptance-web-client/` |
| `scripts/` | Check scripts, provider CLIs, acceptance runners, load-test drivers |
| `load-tests/` | Python Locust suite driven by the `load:*` npm scripts |
| `.agentic/`, `.claude/skills/`, `.agents/skills/` | Test-access preflight, project skills, the impeccable design workflow |
| `.dagger/`, `.github/`, `.githooks/` | Dagger module, CI workflows, the branch guard hook |

Large committed data files: `interaction-registry.json` (832 KB), `product-map.json`
(2.8 MB), `design-system.*.json`, `DESIGN.md` (112 KB). Search them; do not read them
in full.

## 2. Web app

### Request pipeline

`proxy.ts` → `lib/supabase/proxy.ts` (`updateSession`) → `app/layout.tsx` →
`app/(app)/layout.tsx` → page.

- The proxy matcher covers `/`, `/login`, `/timeline`, `/chat`, `/behaviors`,
  `/analytics`, `/export`, `/api/export`, `/settings` and `/oauth` (`proxy.ts:17-29`).
  Nothing else passes through it: not the other `/api/**` routes, `/mcp`, `/auth/**` or
  `/design-system`. Those routes authenticate themselves.
- `/oauth/*` skips session handling, except `/oauth/consent` (`proxy.ts:7`).
- Protected routes come from `APP_NAV_ITEMS` and `PROTECTED_APP_ROUTES` in
  `lib/navigation.ts`. `app/(app)/layout.tsx` is a second gate.
- An auth provider outage returns 503 with `Retry-After` and keeps the session
  (`lib/supabase/proxy.ts`). Do not turn it into a login redirect.
- `/design-system` calls `notFound()` in production. `/api/dev/*` returns 404 outside
  development. `/analytics` redirects to `/behaviors`. `/` only redirects.

### Routes outside the page tree

- API families under `app/api/`: `advisor`, `auth`, `connectors`, `export`,
  `google-calendar`, `outlook-calendar`, `icloud-calendar`, `hevy`, `travel`, `push`,
  `public`, `reminders`, `occurrences`, `dev`.
- `app/mcp/route.ts` is the MCP endpoint. The path is `/mcp`, not `/api/mcp`.
- `app/oauth/{authorize,token,register,revoke}` and `app/.well-known/*` are short
  files that call `lib/services/oauth/server.ts`.
- Scheduled routes (`vercel.json`):

| Route | Schedule | Work |
|---|---|---|
| `/api/reminders/process` | every 5 minutes | Email and browser reminders |
| `/api/occurrences/sync` | 00:05 daily | Occurrence horizon, plus OAuth, agent-run and place-label maintenance |
| `/api/travel/leave-reminders/process` | every 5 minutes | Leave reminders |
| `/api/connectors/completions/process` | four times an hour | Connector completion |
| `/api/advisor/coach/signals/process` | hourly | Coach signals |

  Scheduled routes authenticate with a `CRON_SECRET` bearer token.

### Auth and Supabase clients

- `lib/supabase/server.ts` `createClient()`: cookie client for server code. Cookie
  writes fail silently in Server Components; the proxy writes refreshed cookies.
- `lib/supabase/admin.ts` `createServiceRoleClient()`: service role. Used by scheduled
  routes and a few services.
- The web app has no browser Supabase client. All web data access is server-side.
- `lib/auth/current-user.ts`: `getCurrentUserClaims` (local JWT claims),
  `getCurrentUser` (network call) and `requireCurrentUserId`.
- Sign-in starts in `lib/auth/sign-in-start.ts` and returns to
  `app/auth/callback/route.ts`. Email sign-in: `lib/auth/email-sign-in-server.ts`.
  `lib/auth/redirects.ts` `normalizeRedirectPath` rejects off-site `next` values.
- The Mac calls `/api/*` with a bearer JWT and a native-origin CORS allowlist per route
  family, for example `lib/services/google-calendar-request.ts`.

### Flags

Flags are environment variables read where they are used. The literal that turns each
one on differs:

| Variable | On when |
|---|---|
| `CADENCE_SIGN_IN_APPLE`, `CADENCE_SIGN_IN_EMAIL` | `"on"` |
| `CADENCE_MCP_ENABLED` | `"true"` |
| `CADENCE_LEAVE_REMINDER_JOB` | `"enabled"` |
| `CADENCE_DISABLE_*` kill switches (`lib/security/launch-circuit-breakers.ts`) | `"1"` |

### Mutations and state

- Server Actions sit beside their pages: `app/(app)/timeline/{actions,move-actions,mark-detail-actions,opportunity-actions}.ts`,
  `app/(app)/{behaviors,settings,export,note-shortcuts}/actions.ts`,
  `app/oauth/consent/actions.ts`. They use the `(prevState, formData)` shape, and pages
  pass them to components as props.
- Mark an Occurrence: `components/timeline/StatusButtons.tsx` →
  `markOccurrenceStatusAction` (`app/(app)/timeline/actions.ts`) →
  `lib/services/occurrence.service.ts` (`applyOccurrenceStatusTransition`) → core
  planner → RPC `apply_occurrence_status_transition`. This action deliberately skips
  `revalidatePath`; the client refreshes after the chime.
- Create a Behavior: `components/behaviors/BehaviorForm.tsx` → `createBehaviorAction`
  → `lib/services/behavior.service.ts` → core `createBehavior` → occurrence sync →
  `revalidatePath("/timeline")`.
- Caching: every `(app)` page is `force-dynamic`. The only Next cache API in use is
  `revalidatePath`. `lib/cache` is a per-process read cache (60 s, 250 entries); its
  invalidators are in `lib/cache/stable-user-data.cache.ts`.
- Client state: `useState`, `useActionState` and React contexts. No store library.
  Optimistic Occurrence status is a pure resolver held in
  `components/timeline/Timeline.tsx`.
- Rate limiters and the read cache live in process memory. Vercel instances do not
  share them.

### Next.js specifics

- `next` 16.4.6, `react` 19.3.1. `params` and `searchParams` are Promises.
- `npm run build` is `next build --webpack`.
- `npm run typecheck` is `next typegen && tsc --noEmit`. `tsc` alone fails on a fresh
  checkout because `next-env.d.ts` imports generated route types.
- The `tsc` binary is TypeScript 7 (`@typescript/native`). `import "typescript"` is
  TypeScript 6.
- Root `tsconfig.json` excludes `apps/**`. Only `npm run desktop:build` and
  `npm run marketing:build` typecheck those apps.

## 3. Domain core and server logic

### `packages/core` (`@cadence/core`)

- `src/resolvers/`: 45 pure resolvers. `src/services/`: 58 planners with no I/O.
  `src/integration/`: the MCP contract. `src/notices/`: the notices catalog.
  `src/types/`, `src/data/`, `src/advisor-avatar/`.
- `src/data-store.ts` and `src/behavior-store.ts` define the store interfaces that web
  (`lib/db/behavior-store.ts`) and desktop (`apps/desktop/src/local-*.service.ts`)
  implement.
- The package has no root export. Import by subpath: `@cadence/core/resolvers/<name>`,
  `/services/<name>`, `/types/<name>`, `/integration`, `/notices`.
- `npm run core:check` enforces portability:
  - Imports: only `@js-temporal/polyfill`, `ohash/crypto` and relative paths in `src`.
  - No clock reads: `Date.now`, `Temporal.Now`, zero-argument `new Date()`.
  - Forbidden identifiers: `window document navigator localStorage sessionStorage Notification fetch process Buffer global globalThis require eval Function`.
    The check matches names, not usage. A local variable named `process` or `window`
    fails.
- Nine service names exist in both `lib/services` (I/O) and `packages/core/src/services`
  (pure): `behavior`, `timeline`, `occurrence`, `settings`, `category`, `day-note`,
  `time-tracking`, `note-shortcut`, `period`. Check the import path.

### `lib/services` clusters

| Domain | Anchor files |
|---|---|
| Tracking | `occurrence.service.ts`, `behavior.service.ts`, `timeline.service.ts` |
| Reminders | `reminder.service.ts`, `sequenzy.service.ts`, `web-push.service.ts` |
| Export and BehaviorLog | `export.service.ts`, `behaviorlog-import.service.ts`, `behaviorlog-restore.service.ts` |
| Analytics | `analytics.service.ts`, `day-load.service.ts` |
| Calendar connectors | `google-calendar.service.ts`, `outlook-calendar.service.ts`, `icloud-calendar.service.ts`, `connector-credentials.ts` |
| Hevy and connector completion | `connector-completion.service.ts`, `connector-completion-job.service.ts`, `hevy.service.ts` |
| Travel and leave reminders | `travel-routing.service.ts`, `travel-provider.ts`, `leave-reminder-job.service.ts` |
| Daily Brief and advisor | `daily-brief.service.ts`, `briefing-pipeline.ts`, `daily-brief-model.ts` |
| Chat | `chat/chat.service.ts`, `chat/chat-turn.ts`, `chat/chat-tools.ts` |
| Model transport | `agent-model.ts` (AI SDK; gateway or direct keys) |
| MCP and OAuth | `oauth/server.ts`, `oauth/protocol.ts`, `integration-read.service.ts`, `integration-write.service.ts` |
| Sign-in and account | `account.service.ts`, `sign-in-methods.service.ts`, `desktop-sign-in.service.ts` |

Session-less jobs act as one user through a short-lived per-user JWT:
`lib/integrations/{agent,leave-reminder,connector-completion}-caller.ts`.

### Repositories

- Every repository function takes the Supabase client as its first argument
  (`AppSupabaseClient`, defined in `lib/db/behaviors.repo.ts`).
- Errors are thrown. A missing row returns `null`.
- Atomic multi-row writes go through database functions (`.rpc(`). Large reads page
  through `lib/db/paginated-read.ts`.
- The boundary is not strict today: about 18 services query tables directly.

### Flows

**Occurrence generation.** Horizon is 30 days (`DEFAULT_OCCURRENCE_HORIZON_DAYS`,
`packages/core/src/resolvers/occurrence.resolver.ts`). Occurrences are stored rows.
Triggers: Behavior save, timezone change, lazily on read through
`ensureUserOccurrencesFresh` (Timeline, analytics, export, MCP reads), and the nightly
`/api/occurrences/sync` job. Path: `syncUserOccurrences` → `planOccurrenceGeneration`
(core) → RPC `apply_occurrence_generation_plan` → reminder deliveries.

**Reminders.** `/api/reminders/process` → `processDueReminders`
(`lib/services/reminder.service.ts`, service role). Deliveries are planned by the
reminder resolver and inserted with an upsert on
`occurrence_id,channel,scheduled_send_at`. A sender claims a delivery with a
conditional update on `processing_started_at`; a claim older than 15 minutes can be
reclaimed. Resolving an Occurrence cancels its pending deliveries.

**Connector completion.** `/api/connectors/completions/process` →
`processConnectorCompletions` → due accounts from a service-role read → per-user JWT →
`reconcileConnectorCompletions` (`lib/services/connector-completion.service.ts`): read
evidence, re-check the connection generation, `resolveActivityMatches` (core), apply
through `apply_connector_completion`, `attach_source_activity` and
`remove_source_match`.

**MCP tool call.** `app/mcp/route.ts` → `lib/mcp/server.ts` (origin allowlist, bearer
check) → `verifyMcpAccessToken` (hash lookup through the service role) →
`lib/integrations/request-context.ts` mints a JWT of 300 s or less → 
`lib/integrations/operations/execute.ts` (scope, rate limit) → `read/index.ts` or
`write/index.ts` → `integration-read.service.ts` or `integration-write.service.ts`
under RLS. Writes claim an idempotency key first.

### Time

- `@js-temporal/polyfill` only. Helpers: `packages/core/src/resolvers/time.resolver.ts`
  (`CadenceClock`, `fixedClock`, `localDateAt`, `todayIn`, `localDayBounds`).
- Services default `options.now ?? Temporal.Now.instant()` and pass `now` down.
- `core:check` is the only enforcement. ESLint has no date rule.

### Connector credentials

Sealing happens in Node, not in Postgres: AES-256-GCM in
`lib/services/connector-credentials.ts`, with associated data that binds provider,
purpose, user, account digest and generation. Keys:
`CONNECTOR_CREDENTIAL_ENCRYPTION_KEY`, `CONNECTOR_CREDENTIAL_KEY_ID`,
`CONNECTOR_CREDENTIAL_DECRYPTION_KEYS`. Google Calendar has its own key set in
`lib/services/google-calendar-oauth.ts`. A failed open maps to `reconnect_required`.

## 4. Database

- Schemas: `public`, `cadence_private` (helper functions, account sync contract
  registry), `cadence_oauth_private` (MCP OAuth), `cadence_calendar_private` and
  `cadence_calendar_agent_private` (sealed credentials), `cadence_advisor_private`
  (Daily Brief, agent runs, coach). The Data API exposes only `public` and
  `graphql_public`.
- `profiles.id` is the owner key. Every other user-owned table uses `user_id`.
- Function conventions: `search_path = ''` with schema-qualified names; an explicit
  `revoke all` then one `grant execute`. User writes grant to `authenticated`.
  Server-only functions grant to `service_role`.
- `public` wrappers are usually `security invoker` and call `cadence_private`. The
  connector completion functions are `security definer`.
- Status changes go through `public.apply_occurrence_status_transition`, which does a
  compare-and-set on the expected status and latest event.
- Local ports (`supabase/config.toml`): API 55321, Postgres 55322, Studio 55323,
  Mailpit 55324. Postgres 17.
- `scripts/supabase-cli.mjs` only swaps in a correctly signed CLI binary on Apple
  Silicon. It has no guard against a hosted push.
- Regenerate types after a schema change:
  `npm run --silent supabase -- gen types typescript --local > lib/db/database.types.ts`.
  No check detects a stale type file.

Gotchas:

- 35 migrations patch an existing function with `pg_get_functiondef` plus `replace()`.
  No single file holds the current body of `cadence_private.apply_account_sync_plan`
  or `apply_behaviorlog_import`. Read the live definition from a local database.
- A text patch raises when its anchor string is missing. Never reformat or edit an
  earlier migration. Tests also read named migration files as text.
- A helper created in `pg_temp` survives into the next migration in the same session.
  Drop it at the end of the file (commit `2346b245`).
- A migration with a backfill, an `update`, an `insert … select` or `set not null`
  must start with `BEGIN;` and end with `COMMIT;` (`scripts/check-agents.mjs`). The
  rule also matches those statements inside function bodies.
- A changed function signature needs a new revoke and grant.
- A new `public` table or `authenticated` function must be added to
  `PUBLIC_DATA_API_RELATIONS` or `PUBLIC_AUTHENTICATED_FUNCTIONS` in
  `scripts/supabase-rls-smoke.mjs`.
- A PostgREST embed between two tables with more than one foreign key needs a
  `!fk_name` hint, or every call fails with PGRST201 (commit `d13b715e`).
  `npm run resolvers:check` enforces this.
- `tests/sql/*.sql` run only in the `Local Supabase rehearsal` workflow or by hand with
  `psql` against port 55322. `npm run test` does not run them.
- `tests/*.local-integration.test.*` skip unless `CADENCE_LOCAL_SUPABASE_*` variables
  are set. The `Local Supabase rehearsal` workflow runs the files listed under `run` in
  `scripts/supabase-rehearsal-integration-tests.json` (13 as of 2026-11-25); the
  rest are listed there as excluded, each with its reason.

## 5. Cadence for Mac (`apps/desktop`)

- Frontend entry: `src/main.tsx` → `src/product.tsx` (wires clients, sync, reminders)
  → `src/desktop-app.tsx`. No router; one file per screen (`*-screen.tsx`).
- Rust entry: `src-tauri/src/main.rs` → `lib.rs` `run()`. Objective-C lives in
  `src-tauri/native/*.m`.
- All product reads and writes use one Tauri command, `local_store`. The TypeScript
  side is `src/local-store.ts` (`LocalCommandMap`, `localCommand()`); the Rust side is
  `src-tauri/src/local_store/mod.rs` (`Request` enum, `execute()`).
- Each mutation runs in one `IMMEDIATE` transaction that also writes the
  `mutation_outbox` row. A repeated `mutationId` replays the stored result.
- SQLite schema: `src-tauri/migrations/NNNN_*.sql`, listed in the `MIGRATIONS` array
  in `src-tauri/src/local_store/db.rs`.
- Sync: the pure planner is `packages/core/src/resolvers/account-sync.resolver.ts`
  (`ACCOUNT_SYNC_CONTRACT`). `src/sync-engine.ts` loops;
  `src/account/account-sync.ts` calls hosted RPCs `read_account_sync_snapshot` and
  `apply_account_sync_plan`; `src-tauri/src/local_store/sync_apply.rs` applies locally.
- Auth: Supabase PKCE with Keychain storage (`src/account/auth.ts`). Callbacks arrive
  on the `cadence://` scheme. Keychain item names are allowlisted in
  `src-tauri/src/auth.rs`.
- Code sharing: `@/*` maps to the repository root. The Mac compiles
  `components/**`, `lib/ui`, `lib/types`, `lib/auth` and a few pure `lib/services`
  files directly. Shared components receive actions as props; desktop builds them in
  `src/local-actions.ts`. They use `RuntimeLink` and `useRefresh` from
  `@cadence/ui/runtime`, not `next/link` or the Next router.
- `npm run desktop:dev:web` runs Vite only. Native calls are skipped, so the browser
  preview has no data.

Gotchas:

- A shared component that imports `next/*`, a Server Action or server-only code breaks
  the Mac build. Only `npm run desktop:build` catches it.
- A new image or sound used by a shared component must be added to `productAssets` in
  `apps/desktop/vite.config.ts`.
- A new hosted origin must be added to `csp` and `devCsp` in
  `src-tauri/tauri.conf.json`. Tests read both.
- The app version lives only in `src-tauri/tauri.conf.json`. `package.json` and
  `Cargo.toml` stay at `0.1.0`.
- The Rust row structs use `deny_unknown_fields`. A new field on a synced row fails
  local apply until the Rust struct changes.
- `tests/desktop-*-contract.test.ts` skip without `CADENCE_SQLITE_CONTRACT`. A passing
  `npm run test` does not show that the SQLite adapters work. Run
  `npm run desktop:contract:test` (needs Rust). No CI workflow runs it.
- The `Desktop native` workflow triggers on `apps/desktop/src-tauri/**`, not on
  `apps/desktop/src/**`.
- Tauri npm packages and crates must move together
  (`npm run desktop:dependencies:check`).
- Dev server ports are 4321–4330. `devCsp`, the OAuth issuer check and
  `lib/auth/redirects.ts` all assume that range.

## 6. MCP, OAuth and plugins

- Tool registry: `packages/core/src/integration/operations.ts`. Contract version:
  `packages/core/src/integration/version.ts`.
- Tokens are 32 random bytes stored as SHA-256 hex. The resource is always
  `${CADENCE_OAUTH_ISSUER}/mcp`; any other `resource` is rejected.
- `CADENCE_MCP_ENABLED` must equal `"true"`, or `/mcp`, OAuth and discovery return 503.
- Clients are public and PKCE S256 only. OAuth endpoints reject an `Authorization`
  header and a `client_secret`.
- Browser origins allowed on `/mcp`: the issuer, `https://claude.ai`,
  `https://chatgpt.com`.
- `integrations/skills/` is the single source for plugin skills. The copies under
  `integrations/claude-plugin` and `integrations/chatgpt-plugin` must be
  byte-identical (`scripts/check-plugins.mjs`, run by `tests/plugins.test.ts`).
- Acceptance runners live in `scripts/acceptance/`. The run ledger is
  `.intent/acceptance/<run-id>/`. The test-access preflight is
  `.agentic/scripts/test-access-preflight.mjs` (exit 0 ready, 10 owner steps, 11 check
  errors).

## 7. Marketing site (`apps/marketing`)

- Astro 7, static output. Content is TypeScript data in `src/data/`. No content
  collections.
- `src/data/developer-reference.json` is generated from the MCP registry.
- `robots.txt`, `llms.txt` and the sitemap are generated routes fed by
  `src/data/agent-output.ts`.
- `npm run marketing:check` reads `apps/marketing/dist`. Run `npm run marketing:build`
  first.

## 8. Commands, CI and checks

Use Node 24 (`engines.node`). A new worktree needs `npm ci` before any check runs.

| Command | Runs |
|---|---|
| `npm run dev` | `next dev --port 3000` |
| `npm run test -- tests/x.test.ts` | One test file |
| `npm run test -- tests/x.test.ts -t "name"` | One test by name |
| `npm run test:web-client` | Headless Chrome runner tests, excluded from `npm run test` |
| `npm run core:check` | Core portability (also inside `agents:check`) |
| `npm run desktop:build` | Dependency check, `tsc`, `vite build` for the Mac frontend |
| `npm run desktop:native:test` | `cargo test` |
| `npm run desktop:contract:test` | Real SQLite contract tests |
| `npm run marketing:build`, then `npm run marketing:check` | Astro check, build, developer reference and agent-readability checks |
| `npm run public-source:check` | Secret scan of tracked files and all-ref history. Fails on a shallow clone |
| `npm run design-system:check` | Needs `python3` and the design-system-bench skill directory. Not in CI |

Vitest runs in the `node` environment with globals and no setup file. A DOM test needs
`// @vitest-environment jsdom` at the top. Test name suffixes: `.resolver.test.ts`,
`.service.test.ts`, `.repo.test.ts`, `.dom.test.tsx`, `.local-integration.test.ts`,
`.live.test.ts` (paid model calls, env-gated). `tests/fixtures/governance/*` are
negative fixtures that the checks require to stay failing.

CI workflows (`.github/workflows`):

| Workflow | Runs on | Required for merge |
|---|---|---|
| `ci.yml` | Every PR and push to `main` | Yes, through the `verify` job |
| `desktop-native.yml` | Rust and Tauri paths, root `package.json`, lockfile | No |
| `supabase-rehearsal.yml` | `supabase/**`, `lib/db/**`, `lib/types/**`, `packages/core/**`, `tests/sql/**` and more | No |
| `web-client-runner.yml` | `scripts/acceptance/**`, `tests/acceptance-web-client/**` | No |
| `public-trust-evidence.yml` | Daily schedule and manual | No |

Dagger checks (`.dagger/modules/cadence/main.dang`): `agents`, `interactions`,
`productMap`, `resolvers`, `lint`, `test`, `publicTrust`, `typecheck`, `build`,
`desktopBuild`, `marketing`. `public-source:check` runs in CI only.

## 9. Edits that must happen together

| When you add or change | Also change |
|---|---|
| A `<button>`, `<a>`, `<Link>`, `<form>`, `<input>`, `<select>`, `<textarea>`, `<summary>` or an `onClick`-style handler in `app`, `components`, `apps/desktop/src`, `apps/marketing/src` or `public` | `source_inventory[].interaction_marker_count` for that file in `interaction-registry.json`, and the text of the interactions that cite it |
| A user-facing interaction | An `INT-<DOMAIN>-NNN` entry with feature, journey, implementation references, a `docs/user-guide` anchor, test coverage and platform records |
| A file in `packages/core/src/resolvers` | The `resolverRegistry` array in `scripts/check-resolvers.mjs`, a paired test, and `docs/AGENT_RESOLVERS.md` |
| A registered `lib/resolvers/*.ts` file | Nothing. It must stay exactly `export * from "@cadence/core/resolvers/<name>";` |
| An environment variable read in `app`, `components`, `lib`, `apps` or `scripts` | `NAME=` in `.env.example`, with an empty value for secrets |
| A notice | `packages/core/src/notices/catalog/*.json`, then `npm run map:build` and commit `docs/NOTICES.md` |
| A token in `packages/ui/tokens.css` | A description comment on the token, or `map:check` fails |
| A reusable component | `design-system.manifest.json` with `notes`, and the bench in `app/design-system/` |
| A Supabase migration | `docs/DATA_MODEL.md`, `lib/db/database.types.ts`, the RLS smoke lists for a new table or function, and a `tests/sql` smoke where useful |
| The account sync contract | `ACCOUNT_SYNC_CONTRACT`, the hosted contract registry migration, the Rust `AccountSyncEntityKind` enum and row structs, `scripts/account-sync-rpc-smoke.mjs`, and the contract literals in `tests/sql/account-sync-contract-*.sql` |
| A desktop SQLite migration | The file, the `MIGRATIONS` entry in `db.rs`, and `schema_version` in `local_store/tests.rs` |
| An MCP tool | `operations.ts`, a handler in `read/index.ts` or `write/index.ts`, `tests/fixtures/integration/operations/<name>.json`, the name list in `tests/integration-contract.test.ts`, `REGISTRY_TOOLS` in `scripts/acceptance/protocol.mjs`, `OPERATION_ACCESS` in `scripts/acceptance/watch.mjs`, `INTEGRATION_CONTRACT_VERSION`, then regenerate the two files below |
| The MCP contract | `UPDATE_MCP_CONTRACT_DOC=1 npm run test -- tests/integration-contract.test.ts` and `npm run developers:check -- --write` |
| An MCP transport tool or its activity label (MCP Apps trial, outside the registry) | `lib/mcp/apps/`, `TRANSPORT_TOOLS` in `scripts/acceptance/protocol.mjs`, `TRANSPORT_OPERATION_ACCESS` in `scripts/acceptance/watch.mjs`, the frozen schema in `docs/qa/2026-11-26-mcp-apps-spike.md`, and `docs/MCP_CONTRACT.md`, "MCP Apps trial" |
| A plugin skill | Edit `integrations/skills/`, then copy the file to both plugin folders |
| A protected page | The `proxy.ts` matcher and `lib/navigation.ts` |
| `STATUS.md` | Stay under 40,000 bytes. Archive only on branch `chore/status-archive`, as its own docs-only PR |
| A `*.local-integration.test.*` file | `scripts/supabase-rehearsal-integration-tests.json`, under run or excluded with a reason |
| A new ticket, decision, messaging, legal, sync contract or SQLite schema number | Run `npm run ids:next` first |
| Code that reads `localStorage` or `sessionStorage` | Use `lib/ui/browser-storage.ts`; ESLint rejects direct access |
| A select that embeds a table linked by more than one foreign key | A `!<foreign_key>` hint; `npm run resolvers:check` fails without it (`node scripts/check-postgrest-embeds.mjs --list` prints the pairs) |

Generated files. Do not edit them by hand:

| File | Regenerate with |
|---|---|
| `docs/NOTICES.md`, `product-map.json`, `docs/PRODUCT_MAP.md` | `npm run map:build` |
| `lib/db/database.types.ts` | The `gen types` command in section 4 |
| The marked block in `docs/MCP_CONTRACT.md` | `UPDATE_MCP_CONTRACT_DOC=1 npm run test -- tests/integration-contract.test.ts` |
| `apps/marketing/src/data/developer-reference.json` | `npm run developers:check -- --write` |
| The index block in `docs/status/README.md` | `npm run status:archive -- --index` |
| Avatar `.webp` renditions | `npm run avatar:build` |

`product-map.json` and `docs/PRODUCT_MAP.md` are gitignored build output. Never
commit them; `npm run agents:check` fails on any tracked file that `.gitignore`
matches. `npm run map:check` also fails when a ratcheted warning category grows past
`scripts/product-map-warning-baseline.json`; `npm run map:build` lowers that baseline
and never raises it.

`docs/TICKETS.md` and `docs/DECISIONS.md` merge with `merge=union` (`.gitattributes`):
two branches that each add an entry merge without a conflict. `agents:check` fails on
a repeated ticket heading. `agents:check` also runs
`scripts/check-contract-numbers.mjs`, which compares the sync contract and desktop
migration numbers copied into tests with their sources.

## 10. Words and strings the checks reject

- `scripts/check-agents.mjs` fails on the retired email provider's name, matched
  case-insensitively as a substring, in `AGENTS.md`, `STATUS.md`, `README.md`,
  `.env.example`, `package.json`, `docs/*.md` and `docs/status/**`. The verb for
  "send again" matches too. Write "send again".
- `scripts/check-resolvers.mjs` fails any file under `app/` or `components/` that
  contains `.rpc(`, `.upsert(`, `intervalDays`, `dayOfMonth`,
  `reminder_offset_minutes`, `scheduled_send_at` or `status === "unresolved"`.
- It fails an `app/api/**/route.ts` that queries or loops without importing
  `lib/services`, and any path under `app/` that contains `dashboard`.
- It scans registered resolver text, comments included, for browser globals, `fetch(`,
  provider names and `process.env`.
- `scripts/check-agents.mjs` requires 12 strings in `AGENTS.md`, including the names of
  the workflow documents and the check commands. Keep them when editing that file.
