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
