# Ticket 340: every server-side Auth call, and its limit (November 13–14, 2026)

Result: three kinds of server-side Auth call count against a per-address limit and were
not forwarded: the sign-in callback's code exchange, the same exchange on a return from
adding a sign-in method, and session refreshes made by the cookie client outside
`proxy.ts`. All three use Supabase's `/token` bucket. Ticket 340 forwards the person's
address on those calls under the Ticket 338 conditions. Change address (`PUT /user`) is
also per address; it is listed as a remaining risk, not changed (section C).

## A. Audit

Sources for the bucket column:

- Supabase Auth source v2.189.0 (the version Ticket 338 read):
  `internal/api/api.go` (routes and their limiters), `internal/api/token.go` (one limiter,
  `limiterOpts.Token`, for the `password`, `refresh_token`, `id_token` and `pkce` grants),
  `internal/api/apilimiter/apilimiter.go` (`Token` uses `GOTRUE_RATE_LIMIT_TOKEN_REFRESH`;
  `User`, `Otp`, `MagicLink`, `Recover`, `Resend` and `Signups` use `GOTRUE_RATE_LIMIT_OTP`),
  `internal/api/middleware.go` (`performRateLimiting`: the key is `Sb-Forwarded-For` when
  Auth accepted it, otherwise the first value of the rate-limit header, which is the
  caller's address on hosted).
- Supabase docs, "Rate limits" (read November 14, 2026): `/token` 150 per 5 minutes per
  address, burst 30, for the password, refresh, ID token and PKCE grants; `/verify` 30 per
  5 minutes per address; `/signup`, `/recover`, `/resend`, `/magiclink`, `/otp` and `/user`
  30 per 5 minutes per address; email sending is per project.
- Local copy (`scripts/auth-rate-limit-local.mjs`): the Ticket 339 verifier measured that a
  PKCE exchange and a refresh share one bucket, in both directions (QA record 339, H,
  row 11).

"Person" means the call runs inside a request from the person's own browser or Mac, so the
request carries that person's address. "Job" means a cron run or a server-to-server call
with no person's address. "Forwards" is the state on origin/main before this ticket, then
after it.

| # | Call (file) | Cadence routes | Auth endpoint | Bucket | Caller | Forwards: before → after |
|---|---|---|---|---|---|---|
| 1 | Session refresh by the proxy (`lib/supabase/proxy.ts`, inside `getClaims`) | Pages in the proxy matcher, `/api/export/*`, `/oauth/consent` | `POST /token?grant_type=refresh_token` | `/token`, per address | Person | Yes (Ticket 339) → yes, unchanged |
| 2 | JWKS read by the proxy and by `getClaims` (`proxy.ts`, `lib/auth/current-user.ts`, `sign-in-methods.service.ts`) | Same as row 1, and every `getClaims` caller | `GET /.well-known/jwks.json` | None | Person | No → no (not limited) |
| 3 | **Sign-in code exchange** (`app/auth/callback/route.ts`, `exchangeCodeForSession`) | `/auth/callback` after Google or Apple | `POST /token?grant_type=pkce` | `/token`, per address, the same bucket as row 1 | Person | **No → yes** |
| 4 | **Code exchange on a link return** (`app/auth/callback/route.ts`, `finishLink`) | `/auth/callback?link=google`, `link=apple`, `link=email` (add a sign-in method, confirm a new address) | `POST /token?grant_type=pkce` | `/token`, per address | Person | **No → yes** |
| 5 | **Session refresh by the cookie client outside the proxy** (`lib/supabase/server.ts`; auth-js refreshes inside `getUser`, `getClaims`, `getSession`, `signOut`, `linkIdentity`, `updateUser` and `unlinkIdentity` when the access token has expired) | Every route outside the proxy matcher that uses the cookie client: `/auth/sign-out`, `/auth/sign-in-methods/*`, `/auth/google-calendar/callback`, `/auth/outlook-calendar/callback`, `/api/*` except `/api/export/*` (Calendar, Outlook, iCloud, Hevy, push, advisor, travel, occurrences), Server Actions only when the proxy did not refresh first | `POST /token?grant_type=refresh_token` | `/token`, per address | Person | **No → yes** |
| 6 | Email request (`lib/auth/email-sign-in-server.ts`, `sendEmailSignIn`) | `POST /auth/sign-in/email`, `POST /auth/email/mac` | `POST /otp` | `/otp`, per address; email count per project | Person | Yes (Ticket 338) → yes, unchanged |
| 7 | Email code check (`verifyEmailCode`) | `POST /auth/email/verify` | `POST /verify` | `/verify`, per address | Person | Yes (Ticket 338) → yes, unchanged |
| 8 | Email link check (`confirmEmailLink`) | `POST /auth/confirm` | `POST /verify` | `/verify`, per address | Person | Yes (Ticket 338) → yes, unchanged |
| 9 | Sign-in start (`lib/auth/sign-in-start.ts`, `signInWithOAuth`) | `/auth/google`, `/auth/sign-in/[method]` | None: auth-js builds the `/authorize` URL and writes the code-verifier cookie without a call | — | Person | — |
| 10 | Read the user (`getUser` with the cookie session: `current-user.ts`, `account.service.ts`, `sign-in-methods.service.ts`, the Calendar callbacks, `google-calendar-request.ts`) | Server pages, actions and routes | `GET /user` | None (only `PUT /user` has a limiter) | Person | No → no (not limited; a refresh before it is row 5) |
| 11 | Add a sign-in method (`linkIdentity`, `startAddSignInMethod`) | `POST /auth/sign-in-methods/add` | `GET /user/identities/authorize` | None | Person | No → no |
| 12 | Change address (`updateUser({ email })`, `sign-in-methods.service.ts`) | `POST /auth/sign-in-methods/email` | `PUT /user` | `User`, per address (`GOTRUE_RATE_LIMIT_OTP`, 30 per 5 minutes); email count per project | Person, signed in, signed in within 15 minutes | No → **no, deferred** (section C) |
| 13 | Remove a sign-in method (`unlinkIdentity`) | `POST /auth/sign-in-methods/remove` | `DELETE /user/identities/{id}` | None | Person | No → no |
| 14 | Sign out (`signOut({ scope: "local" })`; `"global"` on account deletion) | `POST /auth/sign-out`, Settings sign-in-method refusals, Delete account | `POST /logout` | None | Person | No → no |
| 15 | Mac bearer check (`google-calendar-request.ts`, `client.auth.getUser(token)`) | Mac calls to `/api/google-calendar/*`, `/api/auth/apple-sign-in-token` and the connector routes | `GET /user` | None. The Mac refreshes against Supabase directly from its own address | Person (Mac) | No → no |
| 16 | Admin reads and deletes (`auth.admin.getUserById`, `auth.admin.deleteUser`: `account.service.ts`, `google-calendar.repo.ts`) | Delete account, Calendar connect | `GET`/`DELETE /admin/users/{id}` | None (admin) | Person's request, service role | Never: the service role is not a person's call |
| 17 | Test login (`app/auth/test-login/route.ts`: `admin.createUser`, `admin.generateLink`, `verifyOtp`, `admin.deleteUser`) | `/auth/test-login` | `/admin/*`, `POST /verify` | `/verify`, per address | Test only: closed in Production (`resolveTestLoginGate`) | No → no |
| 18 | Jobs: reminders, connector completion, leave reminders, Calendar grant retirement, occurrence sync (`lib/integrations/*-caller.ts`, `createServiceRoleClient`) | `/api/reminders/process`, `/api/connectors/completions/process`, `/api/travel/leave-reminders/process`, `/api/google-calendar/agent-grants/retire`, `/api/occurrences/sync` | None. With the `accessToken` option supabase-js has no Auth client; the service-role client makes data and RPC calls only | — | Job | Never |
| 19 | MCP requests (`lib/integrations/request-context.ts`) and Cadence's OAuth token endpoint (`lib/services/oauth/server.ts`) | `/mcp`, `/oauth/*` | None (Cadence's own tokens; data and RPC calls) | — | MCP client | Never |
| 20 | Raw fetches to `/auth/v1` | — | None in `app/` or `lib/`; only the URL comparison in `lib/auth/auth-forwarding.ts` | — | — | — |

Search used (repository root): `rg -n '\.auth\.(admin\.)?[a-zA-Z]+\(' app lib proxy.ts`,
`rg -n 'createClient\(|createServiceRoleClient\(|createServerClient\(|from "@supabase/supabase-js"' app lib`
and `rg -n 'auth/v1' app lib`. Tests and `apps/desktop` (client code) are excluded.

## B. The fix

Same mechanism and conditions as Tickets 338 and 339: the secret key and
`Sb-Forwarded-For` go on the one call, only on Vercel (`VERCEL=1`) with
`SUPABASE_SECRET_KEY` (`sb_secret_…`) and `CADENCE_TURNSTILE_SECRET_KEY` both set, and
only with a valid address from Vercel's headers. Otherwise every request is the same as
today.

- `lib/auth/auth-forwarding.ts`: `isPersonTokenGrantUrl` matches
  `POST {SUPABASE_URL}/auth/v1/token` with `grant_type` `refresh_token` or `pkce`. These
  two grants are the only ones Cadence's server makes, and each carries state from the
  person's own cookies (the refresh token, or the code verifier). `withTokenGrantForwarding`
  (renamed from `withRefreshForwarding`) sets the secret key and the address on that one
  request.
- `lib/supabase/server.ts`: the cookie client's fetch reads the request's headers once and
  forwards rows 3, 4 and 5 only. Every other call of that client (`/user`, `/logout`,
  identities, JWKS, PostgREST, RPC) keeps the publishable key and gets no extra header.
  Ticket 338's `forwarding` option (email checks) is unchanged.
- `lib/supabase/proxy.ts` keeps forwarding the refresh only (row 1); it never exchanges
  a code.
- Jobs never forward: they use the service role or a minted token, with no Auth call
  (rows 16, 18, 19), and a request without a person's cookies makes no refresh or
  exchange.

The code exchange and its cookies. `exchangeCodeForSession` reads the code verifier from
the `…-auth-token-code-verifier` cookie, sends it to Auth, removes that cookie and writes
the session cookies through the same cookie adapter. The fetch wrapper changes only the
outgoing request's `apikey`, `Authorization` and `Sb-Forwarded-For` headers. The cookie
reads and writes are untouched.

CAPTCHA. A secret key makes the call an admin call, and Supabase skips its CAPTCHA check
for admin calls. That does not matter for these calls: Auth never runs CAPTCHA on the
`pkce` and `refresh_token` grants (`isIgnoreCaptchaRoute` in `middleware.go`), with or
without a secret key. Turnstile protects the email request, where Cadence checks it itself
(Ticket 338).

Proxy fix (Ticket 339 verifier, H row 6). A refresh that succeeds followed by a failed
JWKS read answered 503 without the new cookie, so the browser kept the rotated-out refresh
token. The proxy now writes the refreshed session cookies on that 503. It does so only
when the refresh itself returned 2xx and the cookie writes include a session value, so a
refused refresh still writes nothing.

## C. Remaining risks

- Change address (row 12) counts against a per-address bucket. It needs the person's
  bearer token, so forwarding would send the secret key as `apikey` with a user token in
  `Authorization`. Supabase does not document whether its gateway passes
  `Sb-Forwarded-For` in that combination (QA record 338, E), and that cannot be measured
  until hosted step D1 is on. Abuse needs a signed-in account with a sign-in in the last
  15 minutes, and each call also uses the project-wide email count, which is the tighter
  limit. Proposed measurement in the hosted list (338, D, after step 1).
- Ticket 338's E risk about the project-wide email count stands.
- Until the hosted steps run, rows 3 to 5 stay shared: about 30 made-up exchanges from one
  address can delay Google and Apple sign-in for everyone for a few minutes.

## D. Results

Local stack (API port 55341), the Auth copy and gateway from
`scripts/auth-rate-limit-local.mjs` (ports 55398 and 55397), Cadence under `next dev` on
port 4325 against the gateway. Run folder `.intent/acceptance/t340-auth-calls/` (Intent
workspace worktree). Auth restarted before each run. Nothing hosted changed.

`tests/auth-callback-rate-limit.local-integration.test.ts` signs people in through
`/auth/callback` with real PKCE codes: the test asks the copy for a PKCE email
(`code_challenge`), reads the `pkce_` token hash from Mailpit and follows `/verify` to get
the code Auth would hand to Google's or Apple's return. Those two calls use the `/otp` and
`/verify` buckets of the test's own address, not `/token`.

| # | Run | Result |
|---|---|---|
| 1 | Branch, forwarding on (`VERCEL=1`, both variables), `separate` | 3 of 3. Real code: 307 to `/timeline`, session cookie set, verifier cookie removed; the one `/token` call was an admin call with `Sb-Forwarded-For` 198.51.100.30. Expired session on `/api/google-calendar/connection` (outside the proxy): 200, one refresh, admin, 198.51.100.31; no other Auth call carried the secret key or the header. Attack: Mallory (198.51.100.10) needed 31 made-up codes to reach her own 429; Bea (198.51.100.20) then signed in (307 to `/timeline`, `/token` 200 with her address). |
| 2 | origin/main's `lib/supabase/server.ts`, forwarding on, `separate` | **0 of 3**: no call forwarded, and Mallory hit the shared 429 after 29 codes. The test fails without the fix. |
| 3 | Branch, forwarding off, `shared` | 3 of 3: no call forwarded; after Mallory's codes Bea's real code got 429 `over_request_rate_limit` and Cadence sent her to `/login` with `auth_callback_failed`, as on main. |
| 4 | Ticket 339 refresh test, `shared` and `separate`, on the branch | 4 of 4 each. |
| 5 | Unit tests | `tests/supabase-server-forwarding.test.ts` (new, real `@supabase/ssr` and auth-js): forwarding off in five ways (no variables, off Vercel, either secret missing, no address) leaves the exchange request unchanged, passes the earlier fetch function itself and never reads the request headers; forwarding on changes only `apikey`, `Authorization` and `Sb-Forwarded-For` on the exchange and the refresh, the request body and the cookie writes are identical, `/user`, `/logout` and PostgREST keep the publishable key, and a request without cookies makes no Auth call. `tests/auth-forwarding.test.ts`: `isPersonTokenGrantUrl` (refresh and PKCE only; password, ID token, other paths and hosts refused). `tests/supabase-proxy.test.ts`: refresh 200 then JWKS 503 keeps the new cookie on the 503 and on `/login`. Deliberate breaks (exchange no longer forwarded; JWKS fix removed) each failed these tests. |

Sign-in by Google and Apple, linking returns, email and sign-out with the variables unset:
the cookie client is the same object as before (row 5, first case), the proxy refresh path
is unchanged apart from the JWKS case, and the Ticket 338 email code is untouched.

## E. Hosted steps

None new. These calls turn on with Ticket 338's change list
(`docs/qa/2026-11-13-ticket-338-email-rate-limit.md`, section D); Ticket 340 adds its
acceptance items there.
