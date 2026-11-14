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

## H. Verifier check (November 13, 2026)

Result: part 2 behaves as section B says; no protected data is served on the 503 path.
Own Next dev server (port 56900) against the shared local stack, through a fault gateway
(port 56901) that answered Auth calls with chosen statuses; own Auth copy
(`scripts/auth-rate-limit-local.mjs`, ports 56997 and 56998) for the callback
measurement. Throwaway users deleted, containers and servers stopped. Nothing hosted
changed.

| # | Check | Result |
|---|---|---|
| 1 | Refresh answer classes, `/timeline` and `/api/export/json` | 200: new cookie. 400 (`invalid_grant`, `refresh_token_not_found`, `refresh_token_already_used`), 401, 403, 404: 307 to `/login`, cookie cleared; export 401. 429 (JSON or HTML), 500, 502, 503, 520, 522, empty 500, connection reset: 503 page or JSON, `Cache-Control: private, no-store`, `Retry-After: 5`, no cookie written. 200 with an HTML or empty body: 307 to `/login`, cookie kept (as on main). |
| 2 | Same classes on main | 429: signed out (cookie cleared). 500 and connection reset: 307 to `/login`, cookie kept. |
| 3 | Real ended sessions | Revoked (admin global sign-out), deleted account, made-up token: 307, cookie cleared. Revoked session behind two 429s: 503, 503, then 307 with the cookie cleared on the first real answer. |
| 4 | Retry time | auth-js retries 5xx, network errors and unparseable bodies for about 25 s (8 Auth calls) before the proxy answers, on main and on the branch. A 429 is not retried. Auth that never answers holds the request until the platform timeout (unchanged). |
| 5 | Parallel requests, one expired session, 6 at once | No fault: 6 × 200 with a new cookie. Two or five 429s mixed in: the refused ones 503 with no cookie, the rest 200; applying the answers in arrival order left a working cookie in 8 of 8 trials. |
| 6 | Refresh 200 then JWKS 503 (cold key cache) | 503 without the new cookie, so the browser keeps the rotated-out refresh token. 12 s later the old token still refreshed (200): Auth accepts the parent of the active token. One extra 503, no sign-out. |
| 7 | Chrome (headless, own profile) | Page load during three 429s: 503, 503, 503 at 5 s intervals, then 200 `/timeline`. Client navigation to `/behaviors` during 429: the RSC fetch got 503, Next fell back to a full load, the retry page showed, then `/behaviors` loaded. Save behavior during 429: the action POST got 503, nothing was saved, nothing was replayed after Auth recovered; the app showed its error ("An unexpected response was received from the server") and the typed title was lost. On main the same POST also fails and signs the person out. Sign out: cookie removed, `/timeline` then goes to `/login`. |
| 8 | Forwarding on (`VERCEL=1`, both variables) | Only `POST /token?grant_type=refresh_token` carried `sb_secret_…` and `Sb-Forwarded-For`; both JWKS calls and all 16 PostgREST calls used the publishable key. |
| 9 | `VERCEL` on Vercel | Vercel documents `VERCEL=1` at build and runtime when system variables are exposed; the project's `autoExposeSystemEnvs` is `true` (Vercel API). Ticket 338's email paths keep forwarding there. |
| 10 | Tests are real | 12 breaks of the rule, the 503 path, `/login`, Cache-Control, forwarding scope and the Vercel gate: 11 failed the unit tests. Forwarding every `/token` grant passed, so the verifier added `isSessionRefreshUrl` cases (PKCE, password, other paths and hosts); that break and dropping the host check now fail. |
| 11 | Does the sign-in callback share the bucket? | **Yes.** Auth copy with hosted limits, one address: 30 made-up refreshes, then a PKCE exchange got 429 `over_request_rate_limit`; 30 made-up PKCE exchanges, then a refresh got 429. Until the callback forwards the address too, one address can block new Google and Apple sign-ins for everyone for up to a few minutes. Follow-up, not fixed here: forward `Sb-Forwarded-For` on the callback's `grant_type=pkce` exchange under the same conditions. |

What a person sees during a 5-minute Auth outage. On main, a page load that needs a refresh
waits about 25 s, then goes to `/login` (cookie kept for 5xx, cleared for 429). On the
branch, the same wait ends on "Cadence could not check your sign-in just now", which
reloads every 5 s (each reload waits about 25 s again for 5xx) and returns to the page
after Auth recovers. A form submitted during the outage is lost on both. Load: one
waiting tab sends about 8 Auth calls every 30 s during a 5xx outage, or 1 every 5 s during
429s, until it gets through. The reload has no jitter or backoff.

## I. Production (November 13–14, 2026)

PR #279 merged at 23:56:28Z as 94220cb1; production deployment `dpl_Cnij3SrQsaXSSB7jtFsUBCtCEZ6N`
ready at about 23:57Z. Run folder `.intent/acceptance/t339-verify/` (Intent workspace
worktree), own Chrome profiles on ports 4437 and 4439.

| Check | Result |
|---|---|
| Kept sessions A and B | `/timeline` 200, `/api/export/json` 200 with the profile, each |
| A's kept session with `expires_at` in the past | 200 `/timeline`, new refresh token and expiry in the cookie, written back to the Keychain; A's kept session still loads after |
| Made-up expired cookie | 307 to `/login?next=%2Ftimeline`, cookie cleared |
| Fresh Google sign-in as A | Landed on `/timeline` as A; sign-in methods google, apple, email |
| Sign-out as A | Session cookies removed; `/timeline` then goes to `/login` |
| Email sign-in by code (AgentMail) | Landed on `/timeline` (`amr` otp); account deleted through Settings, 0 rows left in `auth.users` |
| 503s after the deploy | 0 of 41 production requests between 23:57Z and 00:17Z |
