# Ticket 335: Google Calendar for accounts that do not sign in with Google, local stack

Run November 13, 2026, on branch `claude/sign-in-335-calendar`, against the local Supabase
stack (CLI 2.105.0, API port 55341, `enable_manual_linking = true`, migrations through
`20261113200000`) and `next dev` over HTTPS on port 4335 with `CADENCE_SIGN_IN_LINKING=on`,
`CADENCE_SIGN_IN_EMAIL=on`, `CADENCE_ENABLE_TEST_LOGIN=1` and a synthetic Google Calendar
client. No hosted setting changed and Google was never reached for consent: each check stops
at the provider URL Cadence sends the browser to.

Second run, after the verifier's findings (PR #271 comment): rebased on `2c7f5c62` (after
PR #270), `npm run supabase -- db reset` on the local stack applied every migration through
`20261113210000` cleanly (the CLI's storage step afterwards failed on the stack's known port
mismatch, not on a migration). Read back: `keep_one_auth_identity` security definer, EXECUTE
`postgres` only; `calendar_install_credential` and `calendar_begin_attempt` EXECUTE
`postgres` and `service_role` only, as before.

## Hosted steps

`docs/qa/2026-11-13-ticket-335-hosted-changes.md`: push `20261113210000` (Ready, no new
grant) before Ticket 334's manual linking. No setting changes.

## How to run it

1. Local Supabase running with manual linking on.
2. HTTPS is needed so the Calendar callback origin matches the request origin. `next dev
   --experimental-https` asks for sudo to install mkcert, so use a self-made certificate:
   `openssl req -x509 -newkey rsa:2048 -nodes -keyout key.pem -out cert.pem -days 2 -subj
   "/CN=localhost" -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"`, then
   `npx next dev --experimental-https --experimental-https-key key.pem
   --experimental-https-cert cert.pem -p 4335` with the local Supabase values,
   `CADENCE_SIGN_IN_LINKING=on`, `CADENCE_SIGN_IN_EMAIL=on`, `GOOGLE_CALENDAR_CLIENT_ID`,
   `GOOGLE_CALENDAR_CLIENT_SECRET`, `GOOGLE_CALENDAR_CALLBACK_URL=https://localhost:4335/auth/google-calendar/callback`,
   `GOOGLE_CALENDAR_ENCRYPTION_KEY` (32 random bytes, base64) and `GOOGLE_CALENDAR_KEY_ID`.
3. With the same `GOOGLE_CALENDAR_*` values exported, plus
   `NODE_TLS_REJECT_UNAUTHORIZED=0`, `CADENCE_CALENDAR_SIGN_IN_E2E_URL=https://localhost:4335`,
   `CADENCE_LOCAL_SUPABASE_URL`, `CADENCE_LOCAL_SUPABASE_SERVICE_KEY` and
   `CADENCE_LOCAL_SUPABASE_PUBLISHABLE_KEY` (optional `CADENCE_CALENDAR_SIGN_IN_EVIDENCE=<path>.json`):
   `npx vitest run tests/calendar-google-sign-in.local-integration.test.ts --testTimeout=120000`.

Without those variables the file is skipped, so `npm run test` does not run it.

## Result: 9 of 9 passed (second run; 7 of 7 in the first)

| Case | Result |
|---|---|
| Email account: the view reads `googleSignIn: "add"`; Connect returns Supabase's Google linking URL; the linking flow's return address (`auth.flow_state.referrer`) is `/auth/callback?link=google&next=/settings?calendar=link#connector-google_calendar`; no identity is added before Google answers; once a Google identity exists, Connect returns Calendar consent with `login_hint` equal to that Google subject and the connection row binds to it | passed |
| Supabase's `identity_already_exists` return lands on `/settings?calendar=link&sign_in_method=taken&method=google#connector-google_calendar`; the Sign-in methods row shows no message and the page names no other account | passed |
| One-Google-sign-in account: no `googleSignIn`, Calendar consent hints its subject (as before); **Add Google** is refused as `already_added`; two Google sign-ins read as `multiple` and connect is refused (`same_account_required`) | passed |
| Remove Google refused while Calendar is connected through it (`calendar_connected`, message shown); after Calendar is disconnected Google is removed and the view reads `add` with generation kept; a later Google account rebinds the idle row (subject changes, generation kept) | passed |
| A credential sealed with user ID and Google subject opens for a Google account and for an email account that added Google: `/api/google-calendar/calendars` reaches Google's token endpoint (the synthetic client is refused there: `provider_unavailable`), and the credential and `connected` status stay | passed |
| `leave_reminder_google_subject` with a leave reminder token: no Google → null; added Google → its subject; two Google → null | passed |
| Mac (bearer token): `googleSignIn: "add_on_web"`; a desktop connect is still refused (`same_account_required`) before any provider step | passed |
| Race: a direct delete of the Google identity a connected Calendar uses fails with `cadence_calendar_connected`; an unlink holding the account's row makes a concurrent `calendar_install_credential` wait and return false (identity gone, nothing installed); an install holding the row makes a concurrent **Remove Google** through Cadence answer `calendar_connected` with both identities kept | passed; **fails** with the old function bodies applied (checked, then the migration reapplied) |
| Two Google sign-ins with Calendar connected: the view loads (`multiple`), Disconnect returns 200 and the row is `disconnected`; the crafted return page creates no linking flow | passed |

Also run against the same server and stack:

- `tests/sign-in-methods.local-integration.test.ts` (Ticket 334): 10 of 10 in the second run
  (with `CADENCE_ENABLE_TEST_LOGIN=1`; the first run lacked it and failed the test-login case).
- `tests/sql/ticket-276-leave-reminder-identity-smoke.sql`: passed (rolled back).
- Unit and DOM: `tests/calendar-google-sign-in.dom.test.tsx` (flag off, Mac, two Google
  sign-ins; the panel hides Connect except for `add`; the return messages) and the existing
  Calendar, leave reminder and sign-in methods suites, unchanged.

## Real browser (Chrome, headless, Playwright)

An email-only account, signed in through `/auth/confirm`, with Google's pages replaced by a
stub so no request reached Google:

1. Settings → Connections → Google Calendar shows "Google Calendar is not connected.",
   "Connecting adds the Google account you choose as a way to sign in to Cadence." and
   **Connect Google Calendar**. Clicking it went to Google through Supabase linking; the
   flow's return address was the Calendar return above.
2. The `taken` return shows "That Google account already signs in to a different Cadence
   account, so Google Calendar cannot connect it here. Cadence does not merge accounts.
   Choose another Google account." and the address bar is cleaned to
   `/settings#connector-google_calendar`.
3. Second run: the `added` return, opened with a referer from another site, made no request
   to Google and created no linking flow, for an email-only account and for one with Google.
   It shows "Google added as a way to sign in. Select Connect Google Calendar to give Cadence
   access to your calendars." and cleans the address. Selecting **Connect Google Calendar**
   then opened `accounts.google.com/o/oauth2/v2/auth` with `login_hint` equal to the added
   Google subject. (First run, now removed: the return continued by itself.)
4. With Calendar connected, Sign-in methods → **Remove** → **Remove Google** shows "Google
   Calendar uses this Google account. Disconnect Google Calendar first, then remove Google."
   and both identities stay. Checked at 390 px: no horizontal scroll.
5. The Calendar panel at 390 px: the sentence wraps, no horizontal scroll.
6. `/design-system?preview=module.google-calendar-panel`: the new "Google sign-in" select
   shows each sentence (`add`, `add_on_web`, `unavailable`, `multiple`), including the
   Mac-only `add_on_web` one.

Not checked here: Google's own consent screens and a real linked Google account. Those run
in Ticket 337's production acceptance with test account A after hosted manual linking is on.
