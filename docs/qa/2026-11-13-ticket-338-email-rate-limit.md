# Ticket 338: email sign-in limits per person (November 13, 2026)

Result: the limit is shared. Supabase Auth limits email requests (`/otp`) and code checks
(`/verify`) per IP address, and Cadence makes both calls from its server, so all people
share one count. The fix sends each person's address to Auth. It is merged inactive. It
turns on after the hosted steps below.

Run folder: `.intent/acceptance/t338-rate/` (Intent workspace worktree). Evidence lines:
`evidence.jsonl`, `local-shared.json`, `local-separate.json`.

## A. What was measured

| # | Where | What | Result |
|---|---|---|---|
| 1 | Supabase docs and Auth source (v2.189.0) | How Auth picks the address it limits | `/otp` and `/verify`: 30 per 5 minutes per IP address. The key is the first value of the header that the platform names in `GOTRUE_RATE_LIMIT_HEADER`. With `security_sb_forwarded_for_enabled`, a valid `Sb-Forwarded-For` value is used first. Supabase passes that header only with a secret key (`sb_secret_`). |
| 2 | Hosted, read only | Auth settings | `rate_limit_otp` 30, `rate_limit_verify` 30, `rate_limit_email_sent` 30, `security_sb_forwarded_for_enabled` **false**, CAPTCHA Turnstile on. Keys: legacy anon and service role, one publishable, one secret (`default`). |
| 3 | Hosted, read only | Auth logs, to see the caller address of `/verify` | Not possible: the Management API logs endpoint returns no rows for `auth_logs` or `edge_logs` (as the final check found). |
| 4 | Hosted, 3 requests from the agent's Mac | Does a secret key skip CAPTCHA? `/otp` with `create_user: false` for a new address (no account, no email) | Publishable key: `captcha_failed`. Secret key as supabase-js sends it: `otp_disabled`, so CAPTCHA was skipped. Secret key with the anon JWT as bearer: `captcha_failed`. No rate-limit headers in any answer. |
| 5 | Local copy of hosted limits, Cadence without the fix | Two people, two addresses, through Cadence's routes | **Shared.** After 31 wrong codes from Mallory (198.51.100.10), Bea's right code (198.51.100.20) failed with `over_request_rate_limit`. After 29 email requests from Mallory, Cy's web request and Dee's Mac request were refused (`email_rate_limited`, 429). |
| 6 | Same, Cadence with the fix | Same two-person run | **Separate.** Mallory hit 429 after 31 wrong codes and her right code was then refused. Bea signed in to `/timeline` with a session. Auth saw `Sb-Forwarded-For` 198.51.100.10 and .20. Cy and Dee got their emails after Mallory's 31 requests. A request with no Turnstile token was refused with `email_check_failed`, and Auth got no `/otp` call and sent no email. |
| 7 | Same, with the fix | Ticket 332's email sign-in test | 8 of 9 passed: code, link from another browser, expired link and code, resend inside 60 s, an address with a Google account, password sign-up refused, test login. The ninth calls local Auth directly, not Cadence, and failed because the local stack's own template server is down (766 template fetch errors in its log). It is not affected by this change. |
| 8 | Unaliased test deployment of this branch, no new variables | Vercel's outgoing addresses; the unchanged path on hosted | See section C. |

The local copy is `scripts/auth-rate-limit-local.mjs`: a second Auth container on the
local database with `GOTRUE_RATE_LIMIT_HEADER=X-Forwarded-For`, Sb-Forwarded-For on and
Turnstile's always-pass test secret. A gateway in front sets X-Forwarded-For to the
caller's socket address, as the hosted gateway does. It turns new-format keys into role
JWTs as row 4 measured, and passes Sb-Forwarded-For only with the secret key.

Why not measure the shared limit on hosted: proving it means using up the 30 checks for
Vercel's addresses, which production shares. Real people would be refused for up to
5 minutes. Rows 1 to 4 and the local copy answer the question without that.

## B. The fix

- `lib/auth/auth-forwarding.ts`: reads the person's address from Vercel's `x-real-ip`
  or `x-forwarded-for`. Vercel overwrites both and drops values that a client sends
  (Vercel docs, "Request headers"). The module also runs Cloudflare's siteverify with
  that address. It fails closed on any error.
- Email request (web and the Mac's page): with forwarding, Cadence checks the Turnstile
  token first. Then it calls `/otp` with the secret key and `Sb-Forwarded-For`, and sends
  no CAPTCHA token, because Auth skips the check for a secret key (row 4).
- Code check and link check: the cookie-backed client uses the secret key and
  `Sb-Forwarded-For`, so `/verify` counts per person and the session cookie is set as
  before.
- Forwarding is on only when `SUPABASE_SECRET_KEY` (`sb_secret_`) and
  `CADENCE_TURNSTILE_SECRET_KEY` are both set and the address is a valid IP. Otherwise
  every call is the same as before the change. Since Ticket 339, forwarding also requires
  `VERCEL=1` (section F, row 1).

Brute force: with forwarding, someone with many addresses gets 30 code checks per
5 minutes per address. That is what anyone already gets by calling Supabase's `/verify`
directly with the public key, so the change does not widen it. Today's shared count
also does not protect one address: it blocks everyone instead.

## C. Test deployment

`https://cadence-krubgon3q-emis-projects-4c886aeb.vercel.app` (commit a80fa0cf, production
target, no domain, Production variables only, so forwarding off). Removed after the run.
For this run only, it also carried a route that reports the server's outgoing address.
That route is not in the branch.

| Check | Result |
|---|---|
| Outgoing address of 20 server calls over 15 s, region iad1 | **2 addresses** (15 and 5 calls). Every person's email request and code check reaches Supabase from one of a few Vercel addresses, which confirms row 5 on hosted. |
| `/login/email` | 200, the Turnstile script is present, same page as production. |
| Email request with no Turnstile token, web | `email_check_failed` (hosted Auth answered `captcha_failed`). No email. |
| Same, the Mac's page | 400 `email_check_failed`. |
| Code check with a wrong code (pending cookie for an address with no account) | `code_rejected`. |
| Cross-site post to the code check | 403. |

Hosted Auth counted 2 `/otp` and 1 `/verify` calls against Vercel's addresses, out of 30
each. A real sign-in with forwarding on needs the hosted steps in section D first.

## D. Hosted change list (for a verifier; nothing applied)

Order matters. Each step can be undone on its own. Before step 3, nothing changes for
anyone.

| # | Change | Before | After | Owner approval |
|---|---|---|---|---|
| 1 | Auth setting `security_sb_forwarded_for_enabled` (Management API `PATCH /v1/projects/qjodzutjxtmtzczbloxa/config/auth`, or Authentication → Rate Limits) | `false` | `true` | Not a credential. It is a hosted Auth change, so the coordinator decides. It is harmless alone: calls without the header, which is every call today, behave as before, and the header is accepted only with a secret key. |
| 2 | Vercel Production env `CADENCE_TURNSTILE_SECRET_KEY`, sensitive | unset | the Turnstile secret of the owner's widget (widget `cadence-turnstile-secret-key`; vault item `turnstile-secret-key`; already in hosted Auth CAPTCHA) | **Yes**: a new use of an existing credential. |
| 3 | Vercel Production env `SUPABASE_SECRET_KEY`, sensitive | unset | the project's `default` secret key (`sb_secret_…`), or a new secret key named `cadence-web-auth` so it can be revoked alone | **Yes**: a new credential in Vercel, as powerful as the service role. A new key is the owner's step. |
| 4 | Redeploy production | — | — | Under the normal merge flow. |
| 5 | Acceptance | — | — | See below. |

Check right after step 1 (agent's Mac only, no email sent): call `/auth/v1/verify` with
the publishable key, a made-up code for a throwaway address and a different
`Sb-Forwarded-For` value on each call. The 31st call must get 429. That shows hosted Auth
ignores the header without a secret key, so step 1 gives nobody a fresh limit. It limits
only the agent's own address, for up to 5 minutes.

Prefer a new secret key named `cadence-web-auth` for step 3, so it can be revoked without
touching anything else that uses `default`.

Acceptance after step 4 (agent steps, test accounts and AgentMail; real email):

1. Email sign-in on `app.cadence-me.com` in a real browser with Turnstile: request, code,
   `/timeline`. Then the link in a second browser. Then the Mac's email page from
   Cadence for Mac.
2. Two-network check, safe for production once forwarding is on: from network 1 (the
   agent's Mac), with a throwaway address, enter wrong codes until a right code is
   refused (about 31). From network 2 (a test device over Tailscale), sign in with
   another throwaway address: it must reach `/timeline`. Only network 1's own address is
   limited, for up to 5 minutes; that includes the owner's devices on that network.
3. Settings → Change address for test account A (unchanged path).
4. Read back: `security_sb_forwarded_for_enabled` true; both variables present
   (names only).

Ticket 340 additions (`docs/qa/2026-11-13-ticket-340-auth-call-limits.md`):

5. After step 1, before step 3 (agent's Mac, test account A, no email): with A's access
   token, call `PUT /auth/v1/user` with `{"data":{}}` and, in turn, (a) the publishable
   key, (b) the secret key as `apikey` with A's token as bearer, each with a made-up
   `Sb-Forwarded-For`. Record whether hosted Auth answers (b) as A (200 with A's user)
   and whether its limit follows the header: about 31 calls of (b) with one header value,
   then one with another value. This decides whether Change address can be forwarded
   later (Ticket 340, section C). It limits only the agent's own address, for up to
   5 minutes.
6. After step 4, two-network check of the sign-in callback: from network 1, about 31 loads
   of `https://app.cadence-me.com/auth/callback?code=<random UUID>` until the gateway
   answers 429 (Cadence shows `/login` with `auth_callback_failed` each time); from
   network 2, a fresh Google sign-in as A must reach `/timeline`.
7. After step 4: Settings, add and remove a sign-in method for test account A, and
   Calendar connect (refreshes outside the proxy), each unchanged.

Undo: remove the two Vercel variables and redeploy; set
`security_sb_forwarded_for_enabled` back to false.

## E. Remaining risks

- `rate_limit_email_sent` (30 an hour) is a project-wide count, by Supabase's design. A
  person who solves Turnstile 30 times in an hour can still use up sign-in email for
  everyone. Only a higher limit or Cadence's own per-person send limit changes that.
  Not in this ticket.
- Settings "Change address" still calls Auth from the server without the person's
  address. It needs a signed-in session and a recent sign-in, so abuse is limited to
  the person's own account.
- Token refresh in `proxy.ts` is shared too, and it can sign other people out today.
  The verifier measured it (section F, row 6): 31 page loads with a made-up expired
  session cookie used up the server address's refresh burst, and the next person's
  valid refresh got 429 and was signed out. This is not caused by this change. Fixed by
  Ticket 339 (`docs/qa/2026-11-13-ticket-339-session-refresh-rate-limit.md`).
- The Supabase docs do not say whether a secret key with a user's bearer token keeps
  Sb-Forwarded-For. Cadence does not rely on it.

## F. Verifier check (November 13, 2026)

Run folder: `.intent/acceptance/t338-verify/` (Intent workspace worktree). The verifier ran
its own local stack (project `t338-verify`, ports 566xx), a clean detached worktree with no
`.env.local`, and its own Auth copy and gateway on ports 56697 and 56698. Nothing hosted
changed. One preview deployment carried a header echo route and was removed.

| # | What | Result |
|---|---|---|
| 1 | Can a client forge its address on Vercel? Preview deployment, route returning the headers and `clientAddressOf`. Sent `X-Real-IP`, `X-Forwarded-For` (single and chained), `X-Vercel-Forwarded-For`, `Forwarded`, and duplicate `X-Real-IP` and `X-Forwarded-For` over HTTP/1.1 | **Not forgeable.** In every case all three headers and `clientAddressOf` were the caller's real address. Vercel replaces the headers; it does not append. `app.cadence-me.com` resolves straight to Vercel (76.76.21.21), with no proxy in front that would make every person look like one address. Under `next start` or `next dev` the headers are whatever the client sends, so forwarding must stay off on any host other than Vercel. |
| 2 | Both variables unset | Ticket 332 suite 9 of 9, the Mac email suite 4 of 4, and the two-person test in `shared` mode reproduces the shared limit. New unit test: Auth gets exactly the earlier call (publishable key, the CAPTCHA token, no extra header) and Cloudflare is not called. |
| 3 | Both variables set | Two-person test `separate` 4 of 4; Ticket 332 suite 9 of 9; Mac email suite 4 of 4. |
| 4 | Fail closed, against Cloudflare's real siteverify with its test secrets, web form and Mac page each | Missing token, refused token (`2x…` secret), spent token (`3x…`, Cloudflare's `timeout-or-duplicate`) and Cloudflare unreachable: every case `email_check_failed`, **0 `/otp` calls, 0 emails**. A good token: 2 `/otp` calls, both with `Sb-Forwarded-For` 198.51.100.77, 2 emails. |
| 5 | Secret key in the build (built with marker values) | No marker, variable name, `siteverify` or `sb-forwarded-for` in `.next/static`. The secret key is used only for `/otp` (address from the form, `shouldCreateUser` as before) and `/verify` (address from the pending cookie with a typed code, or a link token hash). Neither client makes any other call, and neither reaches PostgREST. Supabase skips CAPTCHA for these calls, which is why Cadence checks Turnstile first. |
| 6 | Token refresh in `proxy.ts`, both variables irrelevant | **Shared, and it signs people out.** 31 loads of `/timeline` with a made-up session cookie (expired, random refresh token) used up the server address's `/token` burst (30). The next person's valid refresh got 429 `over_request_rate_limit`; Cadence redirected them to `/login` and cleared their session cookie. Control without the attacker: 200, still signed in. |
| 7 | Settings Change address (`PUT /auth/v1/user`) | 45 calls through the Auth copy: no 429. It shares no per-address limit; it uses only the project-wide email count (section E). |
| 8 | Tests are real | 10 deliberate breaks in `auth-forwarding.ts` and `sendEmailSignIn` each failed `tests/auth-forwarding.test.ts`. Removing forwarding from the code check made the two-person test fail: Bea's right code was refused. Restored after each. |
| 9 | CodeQL on the PR | 2 alerts, both in the local test gateway: it built its upstream URL from the request line, so an absolute URL could send it to any host, and it returned error text. Fixed: fixed host, path and query only, and a plain error. |

Turnstile hostname: Cadence does not compare the `hostname` in Cloudflare's answer, and
neither does Supabase's own check. The widget only issues tokens on its allowed hosts.
Cloudflare's test secrets answer `example.com`, so a hostname check would also fail every
local test. Left as is.

Follow-up (not in this ticket): token refresh in `proxy.ts` needs the same treatment. With
the Ticket 338 variables set, the proxy's client could send `Sb-Forwarded-For` with the
secret key for the refresh call only. Until then, anyone can sign other people out for up
to 5 minutes at a time, from one address, with about 30 requests.
