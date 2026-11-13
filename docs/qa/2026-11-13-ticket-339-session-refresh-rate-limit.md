# Ticket 339: session refresh limits per person (November 13, 2026)

Result: reproduced and fixed. Cadence's proxy refreshes expired sessions from its server,
so Supabase Auth's per-address `/token` limit was shared by everyone, and Cadence treated
a refused refresh as a signed-out session. About 30 page loads with a made-up session
cookie signed the next person out. Two changes fix it:

1. **Part 1, inactive until the Ticket 338 hosted steps run.** The refresh call carries the
   person's address (`Sb-Forwarded-For`) with the secret key, so the limit counts per
   person. Active only on Vercel with both Ticket 338 variables set.
2. **Part 2, live on merge.** A refresh that Auth refuses for now (429, a server error, or
   no answer) no longer clears the session cookie or sends the person to `/login`.

Run folder: `.intent/acceptance/t339-refresh/` (Intent workspace worktree):
`before-shared.json`, `after-shared.json`, `after-separate.json`, `t338-separate.json`,
`latency.json`.

## A. Reproduction (code before the fix)

Local stack plus `scripts/auth-rate-limit-local.mjs` (Auth copy keyed by the caller's
address, hosted limits: `/token` 150 per 5 minutes, burst 30). Cadence under `next dev`,
both Ticket 338 variables unset.

`tests/session-refresh-rate-limit.local-integration.test.ts`, mode `shared`, on
origin/main 025d6c8c: 3 of 4 passed; the attack case failed. Mallory (198.51.100.10) loaded
`/timeline` 24 times with a made-up expired session; the earlier cases had used 6 refreshes,
so the 30-call burst was gone. Bea (198.51.100.20), a real account with an expired access
token, then loaded `/timeline`: Auth answered 429 `over_request_rate_limit`, and Cadence
answered 307 to `/login` and cleared her session cookie. This is the Ticket 338 verifier's
finding (QA record 338, section F, row 6).

## B. The rule for part 2

The proxy watches every Auth answer it receives while it checks the session. The last
answer decides.

| Auth's last answer | Meaning | Cadence |
|---|---|---|
| 200 | Session refreshed | As before: continue, new cookie |
| 400, 401, 403, 404 | The session has ended: refresh token not found, already used outside the 10 s reuse window, revoked, account deleted, user banned, made-up token | As before: clear the cookie, protected pages redirect to `/login` |
| 429 | Auth's rate limit | Keep the session: 503 with `Retry-After: 5`, no cookie written |
| 500–599 (including Cloudflare 52x) | Auth or its gateway failed | Keep the session: 503 |
| No answer (network error, timeout) | Unknown | Keep the session: 503 |

Why by HTTP status and not by the auth-js error class: auth-js already keeps the session
for 5xx and network errors, but it reports 429 as an ordinary API error and removes the
session, and an HTML answer from a gateway (for example a Cloudflare 429 page) becomes an
`AuthUnknownError` with no status. The status is what Auth said; the class depends on the
auth-js version.

Why keeping an ended session cannot happen silently: Auth answers an ended session with a
4xx in the 400–404 range, never 429 or 5xx. A 429 or 5xx only delays the answer. The next
request that reaches Auth gets the 4xx and the cookie is cleared. A retried call that ends
in 400 counts as ended, because the last answer decides. Keeping the cookie grants nothing:
the proxy does not let the request through, and every server page and route checks the
user again.

Where the 503 goes:

- Protected pages and `/`: a small page, "Cadence could not check your sign-in just now.
  You are still signed in. This page tries again in a few seconds." It reloads after 5 s.
- `/api/export/*`: JSON `{"error":"auth_unavailable"}`, status 503.
- `/oauth/consent`: the same page (before, the request went on to the consent page
  without a session).
- `/login`: the login page as before, with the request's cookies unchanged and no cookie
  written.

A side effect: two requests with the same refresh token where one gets a new session and
the other gets a 429 no longer race. Before, the 429 answer could carry cookie removals that
overwrote the other answer's new session.

## C. Part 1: forwarding the refresh

- `lib/supabase/proxy.ts` passes a fetch wrapper to the proxy's Supabase client. For
  `POST {SUPABASE_URL}/auth/v1/token?grant_type=refresh_token` only, it sets `apikey` and
  `Authorization` to the secret key and adds `Sb-Forwarded-For`. Every other Auth call (JWKS,
  `/user`) keeps the publishable key. The refresh is the only call the secret key makes
  from the proxy; it touches no data.
- `authForwardingFor` (`lib/auth/auth-forwarding.ts`) now also requires `VERCEL=1`, for the
  proxy and for Ticket 338's email paths. The Ticket 338 verifier showed the address headers
  are trustworthy only on Vercel; under `next start` or `next dev` a client sets them.
- With either variable unset, or off Vercel, the refresh request is the same as before
  (unit test compares the headers exactly).

## D. Results after the fix

| # | Run | Result |
|---|---|---|
| 1 | Integration test, `shared` (no forwarding) | 4 of 4. Valid session: 200, no `/token` call. Expired session: 200, one refresh, new cookie. Ended sessions: revoked (admin global sign-out), deleted account, signed out through Cadence's Sign out, made-up token: each 307 to `/login` and cookie cleared; malformed and non-JSON cookies: 307 to `/login` (no Auth call, same as before). Two parallel requests with one refresh token: both 200 with a new cookie. Attack: Mallory 24 loads to 429, then 503 for her; Bea 429 from Auth, Cadence 503 with `Retry-After: 5`, cookie kept; within seconds (retries 1 s apart) the same cookie refreshed (200, new cookie). |
| 2 | Integration test, `separate` (both variables, `VERCEL=1`) | 4 of 4. Every refresh reached Auth as an admin call with the person's address. Mallory needed 31 loads to reach her own 429; Bea refreshed at once (200, `Sb-Forwarded-For` 198.51.100.20). No other Auth call carried the secret key. |
| 3 | Ticket 338 two-person email test, `separate`, with `VERCEL=1` and `CADENCE_SIGN_IN_EMAIL=on` | 4 of 4. |
| 4 | Unit tests (`tests/supabase-proxy.test.ts`, `tests/auth-forwarding.test.ts`) | 429, 500, 503, 522 and network failure keep the session (503, no cookie); 400, 401, 403, 404 end it; last answer decides; `/login` and `/api/export` shapes; refresh-only forwarding; forwarding off without Vercel or either variable. |
| 5 | Added latency, in-process, 3,000 runs each, Supabase answered by a stub | Valid session: p50 41 µs main and branch, p99 52 vs 58 µs. Expired session with refresh: p50 78 vs 79 µs, p99 103 vs 107 µs. The fix adds no network call. |

## E. Paths that do not use this proxy

`proxy.ts` matches `/`, `/login`, the app pages, `/api/export/*` and `/oauth/*`, and skips
every `/oauth/*` path except `/oauth/consent`. The Mac refreshes its session against
Supabase directly from the person's own address and calls Cadence with a bearer token
(Ticket 336 routes `/api/auth/*`, `/auth/email/mac`, `/login/email/mac` are outside the
matcher). MCP clients use `/api/mcp` and the OAuth endpoints with Cadence's own tokens.
None of them is changed.

## F. Hosted steps

None new. Part 1 turns on with Ticket 338's change list
(`docs/qa/2026-11-13-ticket-338-email-rate-limit.md`, section D). Add to that acceptance:

1. After step 4, with test account A signed in on `app.cadence-me.com`, wait for the
   access token to expire (1 hour), or set `expires_at` to a past time in a copy of the
   cookie, and load `/timeline`: 200 and a new cookie.
2. Two-network check: from network 1, about 31 loads of `/timeline` with a made-up expired
   cookie until the page shows "Cadence could not check your sign-in just now"; from
   network 2, A's expired session refreshes at once.

Part 2 goes live on merge. Production check after deploy: A's kept session loads
`/timeline`; a made-up expired cookie still goes to `/login` with the cookie cleared.

## G. Remaining risks

- Without forwarding (today, until the Ticket 338 steps run), the limit is still shared:
  one address can make everyone's refresh wait for up to a few minutes, with the
  "try again" page. Nobody is signed out.
- The Google sign-in callback (`/auth/callback`, `/token?grant_type=pkce`) also calls
  `/token` from Cadence's server and is not forwarded. If Auth counts it in the same
  bucket, the same attack can delay new Google sign-ins. Not measured; a follow-up.
- The 503 page reloads every 5 s while Auth refuses. Each reload is one refresh call.
