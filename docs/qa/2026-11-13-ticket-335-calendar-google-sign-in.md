# Ticket 335: Google Calendar for accounts that do not sign in with Google, local stack

Run November 13, 2026, on branch `claude/sign-in-335-calendar`, against the local Supabase
stack (CLI 2.105.0, API port 55341, `enable_manual_linking = true`, migrations through
`20261113200000`) and `next dev` over HTTPS on port 4335 with `CADENCE_SIGN_IN_LINKING=on`,
`CADENCE_SIGN_IN_EMAIL=on` and a synthetic Google Calendar client. No hosted setting changed,
no migration was added and Google was never reached for consent: each check stops at the
provider URL Cadence sends the browser to.

## Hosted steps

None. Ticket 335 adds no migration and no setting. It goes live with Ticket 334's hosted
manual linking and `CADENCE_SIGN_IN_LINKING` (`docs/qa/2026-11-13-ticket-334-hosted-auth-changes.md`).

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

## Result: 7 of 7 passed

| Case | Result |
|---|---|
| Email account: the view reads `googleSignIn: "add"`; Connect returns Supabase's Google linking URL; the linking flow's return address (`auth.flow_state.referrer`) is `/auth/callback?link=google&next=/settings?calendar=link#connector-google_calendar`; no identity is added before Google answers; once a Google identity exists, Connect returns Calendar consent with `login_hint` equal to that Google subject and the connection row binds to it | passed |
| Supabase's `identity_already_exists` return lands on `/settings?calendar=link&sign_in_method=taken&method=google#connector-google_calendar`; the Sign-in methods row shows no message and the page names no other account | passed |
| One-Google-sign-in account: no `googleSignIn`, Calendar consent hints its subject (as before); **Add Google** is refused as `already_added`; two Google sign-ins read as `multiple` and connect is refused (`same_account_required`) | passed |
| Remove Google refused while Calendar is connected through it (`calendar_connected`, message shown); after Calendar is disconnected Google is removed and the view reads `add` with generation kept; a later Google account rebinds the idle row (subject changes, generation kept) | passed |
| A credential sealed with user ID and Google subject opens for a Google account and for an email account that added Google: `/api/google-calendar/calendars` reaches Google's token endpoint (the synthetic client is refused there: `provider_unavailable`), and the credential and `connected` status stay | passed |
| `leave_reminder_google_subject` with a leave reminder token: no Google → null; added Google → its subject; two Google → null | passed |
| Mac (bearer token): `googleSignIn: "add_on_web"`; a desktop connect is still refused (`same_account_required`) before any provider step | passed |

Also run against the same server and stack:

- `tests/sign-in-methods.local-integration.test.ts` (Ticket 334): 9 of 10. The failing case
  calls `/auth/test-login`, which needs its own environment variables that this server did
  not set (`test_login_unavailable`); it is not related to this change.
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
3. After a Google identity was added, the `added` return went straight on to
   `accounts.google.com/o/oauth2/v2/auth` with `login_hint` equal to the added Google subject.
4. With Calendar connected, Sign-in methods → **Remove** → **Remove Google** shows "Google
   Calendar uses this Google account. Disconnect Google Calendar first, then remove Google."
   and both identities stay. Checked at 390 px: no horizontal scroll.
5. The Calendar panel at 390 px: the sentence wraps, no horizontal scroll.

Not checked here: Google's own consent screens and a real linked Google account. Those run
in Ticket 337's production acceptance with test account A after hosted manual linking is on.
