# Ticket 332: email sign-in on the local stack

Run November 13, 2026, on branch `claude/sign-in-332-email`, against local Supabase
(CLI 2.105.0) after `db reset` replayed every migration, and a `next dev` server with
`CADENCE_SIGN_IN_EMAIL=on`. Mail went to the local Mailpit inbox only. No hosted setting
changed and no real email was sent. The hosted steps are in
`docs/qa/2026-11-13-ticket-332-hosted-auth-changes.md`.

## How to run it

1. `npm run supabase -- start` (a fresh database: `npm run supabase -- db reset`).
2. Put the local values from `npm run supabase -- status -o env` in the environment:
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY`, plus `CADENCE_SIGN_IN_EMAIL=on`.
3. `npx next dev -p 4329`.
4. In another shell, with `CADENCE_EMAIL_SIGN_IN_E2E_URL=http://localhost:4329`,
   `CADENCE_LOCAL_SUPABASE_URL`, `CADENCE_LOCAL_SUPABASE_SERVICE_KEY` and
   `CADENCE_LOCAL_SUPABASE_PUBLISHABLE_KEY` set (optional:
   `CADENCE_LOCAL_MAILPIT_URL`, `CADENCE_LOCAL_SUPABASE_DB_CONTAINER`,
   `CADENCE_EMAIL_SIGN_IN_EVIDENCE=<path>.json`):
   `npx vitest run tests/email-sign-in.local-integration.test.ts --testTimeout=60000`.

Without those variables the file is skipped, so `npm run test` does not run it. It takes
about 70 seconds: one case waits out the 60-second resend interval. It writes a JSON list
of case results when `CADENCE_EMAIL_SIGN_IN_EVIDENCE` is set.

## Result: 9 of 9 passed (16:13Z)

| Case | Result |
|---|---|
| Continue with email opens `/login/email` and keeps `next` | passed |
| A new address gets one email; a wrong code is refused; the right code (typed with a space) signs in, returns to `next`, stores no password and creates the profile; the same code again is refused | passed |
| The link opens `/login/confirm` in another browser, its button signs in; the same link again is refused with "Send sign-in email" offered | passed |
| A link and a code more than an hour old are refused with a way to send another | passed |
| "Send a new email" inside 60 seconds sends nothing and keeps the code step | passed |
| An address that has a Google identity signs in to the same user, and no second user appears | passed |
| A password sign-up for an existing address and for a new address gets no session and no stored password; the owner of the existing address then signs in by email to their own account | passed |
| A signed-in person's `updateUser({ password })` stores nothing; password sign-in fails | passed |
| An `@example.invalid` user created like the test login keeps its password and signs in | passed |

`npm run supabase -- db reset` replayed all migrations, including
`20261113160000_refuse_auth_passwords.sql`, without error.

Screens checked at 1280 px and 390 px: Login, the address step, the address step with an
error, the code step, a rejected code, a refused resend, the link page and a refused link.

## Findings

- **Code sign-up stores a password.** Before the trigger, a new address created through
  `/auth/v1/otp` had a 60-character password hash (Supabase Auth sets a random one). The
  trigger drops it too, so a code or link account never has a password.
- **Local config was more open than hosted.** With confirmation off (the old local value),
  a password sign-up got a session at once. Local now matches hosted.
- **PKCE requests change the token hash.** A request made with a PKCE code challenge
  produces a token hash that starts with `pkce_`, and Auth's own verify URL then returns a
  `code` for `/auth/callback`. Cadence's web request uses no PKCE, so the hash verifies
  directly at `/auth/confirm`. Ticket 336 should request without PKCE or use the code.
- **Mail scanners.** Verifying on a button press, not on opening the link, keeps a scanner
  that opens links from using up both the link and the code (they share one token).
- **The link does not carry `next`.** In the browser that asked, the link returns to
  `next` (the pending cookie holds it). In another browser it returns to Timeline. The
  code keeps `next` everywhere.
- **CAPTCHA.** With `[auth.captcha]` on and Cloudflare's always-pass test secret
  (`1x0000000000000000000000000000000AA`), requests to `otp`, `signup` and password `token`
  without a token failed with `captcha_failed`; with the test token they passed. `verify`
  (token hash and typed code), refresh, Google `authorize` and the service-role admin API
  needed no token. The config was put back afterwards.
- **Local stack on this Mac.** The CLI binary in `node_modules` has an invalid signature
  and macOS kills it (exit 137; `docs/SUPABASE_WORKFLOW.md`). An ad-hoc `codesign --force -s -`
  of the local copy fixed it. Port 55321 was held by a stale Docker forward, so the run used
  55341 through an uncommitted edit that was reverted.
- **Not run:** `tests/mcp-session-broker.local-integration.test.mjs` needs its own
  disposable stack (`CADENCE_QA_BROKER_LOCAL=1`). Its link reader now rebuilds Auth's
  verify URL from the new email's token hash; that URL was checked by hand on this stack
  (303 to `/auth/callback?code=…`).

## Independent verification, November 13, 2026

Run by the coordinator's verifier on the same local stack (API 55341), against
`claude/sign-in-332-email`.

- **Login CSRF found and fixed.** A post from another site to `/auth/confirm` with the
  attacker's own token hash set a Cadence session (login CSRF). The three POST routes now
  refuse a cross-site post with 403 (`crossSitePost` in `lib/auth/email-sign-in-server.ts`):
  `Sec-Fetch-Site` decides when present, else `Origin` must be this site; a request with
  neither is not a browser form and passes.
- **The first form of that fix broke the link in a real browser.** `/login/confirm` set
  `referrer: no-referrer`, so Chrome posted `Origin: null` and the origin-only check
  refused it (blank 403). Fixed two ways: `Sec-Fetch-Site: same-origin` now decides, and
  the page uses `strict-origin`, which keeps the Origin header and still sends no path (no
  token) onward. Checked in the in-app Chrome: the button now lands on `/timeline`
  signed in. The integration test client now sends `Origin` and `Sec-Fetch-Site` like a
  browser.
- **Cross-site results on the server:** foreign origin 403; `same-site` 403; same-origin
  303 with a session; no browser headers 303 with a session. `/auth/sign-in/email` and
  `/auth/email/verify` with a foreign origin: 403.
- **End to end:** 9 of 9, twice (before and after the browser-header change).
- **Flag unset:** `/login/email`, `/login/confirm`, `GET /auth/sign-in/email` 307 to
  `/login?…error=sign_in_method_unavailable`; `POST /auth/sign-in/email`,
  `/auth/email/verify`, `/auth/confirm`, `/auth/sign-in/apple` 303 to the same; no user
  created; `/login` shows only Continue with Google; `/auth/google` starts OAuth.
- **Trigger, as `supabase_auth_admin`:** eleven row shapes (null email, null and empty
  password, two `@`, upper case, `attest.com`, `example.com.evil.org`, a non-ASCII domain,
  bare `test`, `sub.EXAMPLE`) inserted without an error; real addresses lost the password,
  reserved ones kept it. An existing password survived a no-op update and an email
  change; a new password on that row was dropped. Delete works. With the trigger disabled a
  password sign-up stored a 60-character hash; enabled, 0.
- **Tests are real.** Each break failed tests and was restored: Sec-Fetch-Site ignored
  (9 failed), flag check removed (4), confirm CSRF check removed (4), `next` not
  normalized (1), code length 8 against config 6 (1).
