# Route Map

This file keeps route names stable across agents. Add routes here before or during implementation so UI, tests, docs, and navigation do not drift.

The current authenticated product routes belong to the Next.js web app. Public
marketing routes are implemented separately in the sibling Astro app under
`apps/marketing` and are scoped in `docs/PUBLIC_PRODUCT_ARCHITECTURE.md`.

## Current app routes

| Route | Status | Purpose | Notes |
|---|---|---|---|
| `/` | implemented | Auth-aware entry route | Redirects authenticated users to `/timeline` and unauthenticated users to `/login`. |
| `/login` | implemented | Google sign-in screen | Uses Supabase OAuth and returns through `/auth/callback`; links to Terms, Privacy, and Trust. Authenticated users can inspect it in any environment with the explicit `/login?preview=1` URL without ending their session; the app shell exposes that link only outside production. `/login?signedout=1` shows the focused signed-out status. |
| `/auth/google` | implemented | Supabase Google OAuth start route | Starts Google OAuth from the server and redirects back through `/auth/callback`; redirects to `/login` with an error when provider setup cannot start. |
| `/auth/callback` | implemented | Supabase OAuth code exchange route | Exchanges the OAuth code for a cookie-backed Supabase session and redirects to a sanitized local `next` path. |
| `/auth/sign-out` | implemented, POST-only | End the current authenticated session | Accepts the current browser PushManager endpoint when available, deactivates only that RLS-visible active subscription before clearing the local Supabase session, and redirects to `/login?signedout=1`. A missing subscription is a no-op; a deactivation or sign-out failure preserves the session and returns a factual error. Non-POST methods return 405. |
| `/auth/test-login` | implemented, dev/test-only | Local QA login route for clean-session onboarding tests | Hidden unless `CADENCE_ENABLE_TEST_LOGIN=1`, blocked in production, restricted to localhost requests, and blocked for hosted Supabase unless `CADENCE_ALLOW_HOSTED_TEST_LOGIN=1` is set. It creates a temporary confirmed Supabase Auth user server-side and signs in with the normal Supabase password flow so protected routes still use ordinary auth cookies and RLS. Each app process permits at most 10 successful temporary-user creations; operators clean up after each run and daily while enabled. |
| `/terms` | implemented, public | Public product terms | Sparse launch terms for the personal behavior tracker; not a marketing site. |
| `/privacy` | implemented, public | Public product privacy notes | Covers account data, behavior data, reminders, providers, export, and deletion. |
| `/trust` | implemented, public | Canonical human Trust page | Preserves durable product commitments and renders nine normalized, time-bound verification checks. |
| `/api/public/trust-evidence` | implemented, public | Normalized current Trust evidence | Validates the public Pages feed, applies freshness and release-subject matching, and fails closed to Stale or Unavailable. |
| `/timeline` | implemented, protected | Primary screen for today's occurrences, a floating Needs decision modal for prior unresolved items plus same-day retained decisions, future preview, inline occurrence time tracking, Timeline gesture refresh, and the optional first-run setup pop-up | This is the main screen. A qualifying mobile pull or desktop upward overscroll at the top reloads Cadence and connected Calendar data once without mutating an Occurrence or adding offline behavior. Track Time is available for active current-day and visible Needs decision occurrences. Stop and Reset tracked time remain inside the existing occurrence disclosure; no route or API route is added. First-run setup links into existing controls and can be dismissed locally. |
| `/behaviors` | implemented, protected | Primary behavior object surface for behavior settings, compact metadata, adherence, heatmaps, archived behavior access, and behavior date review for deliberate status, note, and timing corrections | First-run setup may link to `/behaviors#create-behavior`. Behavior date review reuses analytics resolver/service output, occurrence status/note services, and the existing timing reset service. It adds no route, schema, stored status, or date/time mutation. |
| `/analytics` | implemented, protected compatibility redirect | Redirects to `/behaviors`, preserving supported range and selected behavior-day query parameters | Analytics is no longer a primary navigation destination. Keep the redirect so bookmarks and older internal links do not hard-break. |
| `/export` | implemented, protected | Export & Import surface for JSONL, CSV, full JSON backup, BehaviorLog bundle, Markdown AI-readable summary export, BehaviorLog bundle import, and BehaviorLog restore preview/apply | Export logic belongs in `export.resolver.ts`; BehaviorLog import validation and merge preview belong in `behaviorlog-import.resolver.ts`; BehaviorLog restore preview decisions belong in `behaviorlog-restore.resolver.ts`; the page supports range, archived-behavior, notes, and a default-off `include_time_tracking=1` option. First-run setup may link to `/export#behaviorlog-import`. |
| `/settings` | implemented, protected | Profile, timezone detection/manual override, browser notification permission/subscription settings, trust/legal links, and account deletion | Timezone detection uses browser/OS `Intl` data without geolocation; saving timezone updates the profile, active behavior schedules, and future unresolved occurrences. Browser notification permission is requested here; account deletion requires export acknowledgement and typed confirmation; category editing and any global email settings remain future Settings work. First-run setup may link to `/settings#notifications` and `/settings#timezone`. |

## Marketing routes

These routes are implemented in `apps/marketing`, not in the authenticated
Next.js app shell. Deployments should keep the authenticated app's existing
entry behavior through an app subdomain or app-specific route if marketing owns
the apex `/`.

| Route | Status | Purpose | Notes |
|---|---|---|---|
| `/` | implemented in Astro marketing app | Cadence-led landing page that introduces BehaviorLog as the open portability standard | Includes Try Cadence, Read BehaviorLog, Download Example Bundle, View on GitHub, and Log in CTAs. |
| `/faq` | implemented in Astro marketing app | Frequently asked questions | Covers Cadence philosophy, privacy, time tracking, and BehaviorLog portability. |
| `/docs` | implemented in Astro marketing app | Technical docs entry point for Cadence, BehaviorLog, machine-readable mirrors, and future docs structure | Links to Markdown mirrors, `llms.txt`, `llms-full.txt`, route manifest, sitemap, robots, example bundle, and future docs map. |
| `/examples` | implemented in Astro marketing app | Sanitized sample BehaviorLog bundle page | Downloads a build-generated `.behaviorlog.zip` that passes the pinned BehaviorLog reference validator. |
| `/about` | implemented in Astro marketing app | Philosophy, governance, scope boundaries, and open-source posture | No desktop/mobile teaser, billing, AI, analytics, or marketing-cookie scope. |

Marketing compatibility redirects:

| Route | Status | Destination | Notes |
|---|---|---|---|
| `/cadence` | implemented redirect | `/` | No dedicated page, manifest entry, sitemap entry, or Markdown mirror. |
| `/standard` | implemented redirect | `/` | No dedicated page, manifest entry, sitemap entry, or Markdown mirror. The homepage links to the upstream BehaviorLog repository. |

Marketing machine-readable routes:

| Route | Status | Purpose | Notes |
|---|---|---|---|
| `/index.md` plus page-specific `.md` mirrors | implemented in Astro marketing app | Clean Markdown mirrors for working agents | Generated from `apps/marketing/src/data/routes.ts`. |
| `/llms.txt` | implemented in Astro marketing app | Curated index for working agents and developer tools | Also mirrored at `/.well-known/llms.txt`. |
| `/llms-full.txt` | implemented in Astro marketing app | Small scoped full-site text bundle | Kept under agent-readable size budgets. |
| `/data/route-manifest.json` | implemented in Astro marketing app | Public route manifest for generators and agents | Source of truth for generated machine-readable outputs. |
| `/sitemap.xml` | implemented in Astro marketing app | Canonical marketing route sitemap | Generated from the route manifest. |
| `/robots.txt` | implemented in Astro marketing app | Max-visibility crawl policy and sitemap pointer | Policy decision is recorded in `docs/CRAWL_POLICY.md`. |

## Internal development routes

| Route | Status | Purpose | Notes |
|---|---|---|---|
| `/design-system` | implemented, local/dev-only | Internal design-system bench for fixture-backed UI inspection and traceability | Not in primary navigation, not protected product UI, disabled with `notFound()` in production builds, and excluded from product usage scans. |

## Auth route protection

Next.js 16 uses `proxy.ts` instead of the deprecated `middleware.ts`
convention. This app uses root-level `proxy.ts` to refresh Supabase auth
cookies for the protected app routes listed above and `/api/export/*`.
Unauthenticated app-screen requests redirect to Login. Export API requests are
not classified as app-screen routes, so anonymous or invalid sessions continue
to the route handler and receive its JSON `401` response instead of an HTML
redirect.

The protected app layout also verifies the Supabase user server-side before rendering the app shell. Do not rely on client-only checks for protected app screens.

## Forbidden route

Do not create `/dashboard` in v1. The locked primary route is `/timeline`.

## Planned API routes

| Route | Earliest ticket | Purpose | Required ownership |
|---|---:|---|---|
| `/api/push/subscribe` | implemented in 009; auth-failure rate limit added in 029; current-account ownership verification added after the 2026-07-22 interaction audit | Store browser push subscriptions and verify the exact current-device subscription belongs to the signed-in account | `POST` validates and stores a subscription. `PUT` validates the browser's endpoint and key material, then checks one active current-user row through the authenticated Supabase client and RLS. Both methods rate-limit repeated unauthenticated attempts and call the push subscription service/repository. |
| `/api/reminders/process` | implemented in 010; Vercel Cron GET support added in 013; auth-failure rate limit and bounded `limit` added in 029; browser-push sending added after notification troubleshooting | Protected process route for due reminder deliveries | Route validates `REMINDER_PROCESS_SECRET` or `CRON_SECRET`, supports Vercel Cron `GET` and manual protected `POST`, rate-limits repeated auth failures, bounds batch size, and calls `reminder.service.ts` for email and browser-push channels. Ticket 067 can stop the batch, email sends, or browser-push sends independently before any delivery claim. An open batch breaker returns `503` plus `Retry-After`. |
| `/api/occurrences/sync` | implemented in 038 | Protected process route for daily occurrence horizon extension | Route validates `REMINDER_PROCESS_SECRET` or `CRON_SECRET`, supports Vercel Cron `GET` and manual protected `POST`, rate-limits repeated auth failures, bounds batch size, and calls `occurrence.service.ts` to keep generated occurrence horizons fresh. Ticket 067 can stop the batch before product writes; the route returns `503` plus `Retry-After`. |
| `/api/export/jsonl` | implemented in 012 | JSONL export | Route calls export service/resolver. The proxy refreshes cookie-backed Supabase sessions without changing the route's JSON `401` contract. Ticket 067 applies one atomic account-scoped six-per-minute limit and a separate export breaker before export reads; limited requests return `429` plus `Retry-After` without a partial artifact. |
| `/api/export/csv` | implemented in 012 | CSV export | Uses the same authenticated distributed limit and circuit-breaker contract as JSONL. |
| `/api/export/json` | implemented in 012 | Full JSON backup | Uses the same authenticated distributed limit and circuit-breaker contract as JSONL. |
| `/api/export/behaviorlog` | implemented in BehaviorLog alignment milestone 1 | BehaviorLog `.behaviorlog.zip` interoperability bundle | Route calls export service/resolver and packages generated bundle files as a ZIP. It uses the same authenticated distributed limit and circuit-breaker contract as JSONL. |
| `/api/export/markdown` | implemented in 091 | On-demand Markdown AI summary | Uses the same authenticated limit and circuit breaker as structured exports. |

Do not add API routes that duplicate resolver logic. API routes are request/response adapters.

## Navigation source

`lib/navigation.ts` owns the scaffolded navigation list and default app route. If a route changes:

1. Update `lib/navigation.ts`.
2. Update this file.
3. Update `docs/UI_SPEC.md` and `docs/USER_FLOWS.md` if product behavior changes.
4. Update `interaction-registry.json` when the route change adds, removes,
   moves, or materially changes a user interaction.
5. Update or add tests.
6. Run `npm run agents:check`, `npm run interactions:check`, and
   `npm run resolvers:check`.

## Route creation checklist

Before adding a new app or API route:

- Confirm it is in scope for the active ticket.
- Confirm it does not create a dashboard-centric product model.
- Identify the owning resolver/service if the route performs domain work.
- Add the route to this document.
- Keep UI pages thin. Move calculations and state planning into resolvers/services.
- Add tests for navigation or route behavior when practical.

## Category controls (Tickets 123–124)

Settings owns category management. Behaviors owns category filtering and sorting.
These controls introduce no routes and do not change Timeline.

## Note shortcut operations (Tickets 126–128)

Existing Behaviors and Settings surfaces own shortcut management and opt-in.
Timeline and Behaviors reuse the existing guarded Note save action for insertion
provenance. No new navigation route is added. Authenticated actions call a shared
shortcut service, which calls owner-scoped repositories. A desktop-callable cloud
analysis route remains unavailable until Ticket 126 provider/privacy acceptance;
never expose an arbitrary client-supplied Note corpus or owner ID to a provider.

## Read-only Google Calendar connector (Ticket 134)

These routes return `not_configured` when separate server provider configuration
is absent. The deployed connector has live acceptance evidence; provider scope
approval remains open under Ticket 141.
All API responses are no-store. Cookie writes require same-origin requests; native
clients use verified Supabase bearer sessions and the fixed Tauri origin allowlist.
No route creates, changes, or deletes a provider event.

| Route | Methods | Purpose |
|---|---|---|
| `/api/google-calendar/connection` | GET, POST, DELETE | Read status, start explicit consent, globally disconnect |
| `/auth/google-calendar/callback` | GET | Consume five-minute state, verify the same Google identity, install sealed credentials |
| `/api/google-calendar/calendars` | GET, PUT | List readable calendars; save owner selections and visibility |
| `/api/google-calendar/events?start=YYYY-MM-DD&end=YYYY-MM-DD` | GET | Complete normalized snapshot; inclusive dates from today through at most today + 30 |

`lib/services/google-calendar.service.ts` owns lifecycle and reads.
`lib/services/google-calendar-request.ts` verifies sessions and request bounds.
`lib/db/google-calendar.repo.ts` owns exact database access. Web callbacks require
the initiating cookie user. Desktop callbacks use a fixed result and opaque
Keychain-correlated state, never credentials.

## In-app briefing boundary (Tickets 145–148)

Current code still has disabled `GET /api/advisor/day-context`: 401 without a
credential, 403 for every Bearer credential, and 405 for other methods. It reads
no source data. `docs/qa/advisor-auth-isolation.md` records the historical
external-token finding; delegated authentication is no longer the target design.

Ticket 147 implements first-party `POST /api/advisor/brief`. Reuse server-verified web
sign-in and the existing linked-desktop authenticated request path. The server
derives the owner, local day and allowed fields, calls the bounded internal read
service, then the model adapter. Return validated briefing text and provenance,
not credentials or a raw export. POST starts generation, never a source mutation.

Require web origin/CSRF checks, exact desktop broker origins, RLS ownership,
feature/disclosure checks, bounded attempts, output validation and `no-store`.
No model prompt, owner override or arbitrary URL comes from the caller. Account,
disclosure and source changes fence input and delivery. No external-client OAuth,
public client registration or model write capability is part of the route.

`GET /api/advisor/preferences` returns account-bound availability, enablement,
Calendar disclosure, revision and local day. `PUT` accepts only enabled and
includeCalendar booleans. POST accepts only installationId and retry. Each uses
existing first-party request authentication and private current-session RPCs.
The old GET is retained as an explicitly disabled compatibility boundary.
Ticket 148 invokes generation at Timeline opening and displays the horse bubble.
Enablement, invocation, dismissal and retry are registered in the interaction catalog. The complete
contract remains `docs/plans/first-external-consumer.md`.

### Internal briefing comparisons (Tickets 151–155)

`/design-system?preview=briefing-workbench` renders Synthetic and My account modes.
`GET/POST /api/dev/briefing-comparison` call `briefing-workbench.service.ts`.
Both require development mode, loopback ports 4321–4330 and same-origin Fetch
Metadata. POST additionally requires matching Origin and JSON content type.
Production returns 404. GET uses existing sign-in and returns current briefing
access plus authorized Behavior labels only; it never captures context or generates.
POST accepts either a known fixture ID plus two validated configurations, or exact
fields `mode: "account"`, `accountRef`, `preferenceRevision` and two configurations.
Tickets 176–177 add an optional `review` object (case ID and candidate records) that
saves the case and every run locally, and `mode: "saved"` with `accountRef` (or null)
to rerun one or two configurations on a saved case's frozen inputs.
`GET/POST /api/dev/briefing-reviews` call `briefing-review.service.ts` with the same
guard. GET lists or opens saved cases (`source=synthetic|account`, optional `caseId`)
and never returns captured account inputs. POST saves feedback and proposal
decisions, writes a review packet, or deletes a case. Account sources require sign-in
and use the owner's partition.
The expected account reference is a mismatch guard, never an owner selector.
Account mode authenticates through the existing first-party request boundary and
uses revocable briefing/Calendar consent. One capture supplies both history windows.
Responses use no-store; credentials, raw database IDs and raw history stay server-side.
Synthetic mode uses no account reads. Neither mode uses daily generation admission.

## Travel routing boundary (Tickets 163 and 165)

`GET /api/travel/routes` authenticates the current account and returns only whether
the operator clearance and server credential are configured. Clients must check it
before requesting a device location. `POST /api/travel/routes` is `no-store` and
accepts a one- or two-local-day range, one bounded transient device sample, and up
to eight corrected Calendar-event facts. The server derives the owner, settings,
optional Calendar snapshot, Behavior occurrences, source revisions, selected mode,
and endpoints. It rejects a
clearance-disabled request before reading its body or any route source.

The route never accepts an owner ID, API key, provider URL, raw route result, or
chosen fallback mode. It returns the account-bound mode, navigation preference,
settings revision, earliest expiry, and endpoint-free travel evidence. The service
rechecks settings, Behavior and Occurrence revisions, and Calendar connection and
event revisions before and after provider work. It makes no tracking, Calendar, Behavior, Occurrence, or
Daily Brief mutation.
