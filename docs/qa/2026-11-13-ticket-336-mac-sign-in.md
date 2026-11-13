# Ticket 336: sign-in methods in Cadence for Mac — QA record

Design: `docs/DESKTOP_BUILD.md`, "Sign-in methods (Ticket 336)".

## Local end to end (November 13, 2026)

`tests/desktop-sign-in.local-integration.test.ts` runs the Mac's real `DesktopAuth` class
with only Tauri's IPC replaced (the Keychain becomes a map; the system browser becomes
headless Chrome through `playwright-core`). It talks to a `next dev` server and the local
Supabase stack and reads the code from Mailpit.

How to run:

1. A running local stack (`npm run supabase -- start`). On this Mac the API listens on
   55341; `npm run supabase -- status -o env` needs the same port in
   `supabase/config.toml` (edit, read, revert).
2. `next dev -p 4331` with `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY`, `CADENCE_SIGN_IN_EMAIL=on` and
   `CADENCE_TURNSTILE_SITE_KEY=1x00000000000000000000AA` (Cloudflare's always-pass test key).
3. `CADENCE_DESKTOP_SIGN_IN_E2E_URL=http://localhost:4331` (not `127.0.0.1`: the dev
   server refuses its client scripts on that origin, so the page never hydrates),
   `CADENCE_LOCAL_SUPABASE_URL`, `CADENCE_LOCAL_SUPABASE_PUBLISHABLE_KEY`,
   `CADENCE_LOCAL_SUPABASE_SERVICE_KEY`, optional `CADENCE_DESKTOP_SIGN_IN_EVIDENCE=<dir>`,
   then `npx vitest run tests/desktop-sign-in.local-integration.test.ts`.

Without those variables the file is skipped, so `npm run test` does not run it.

Result, 18:50Z: 4 of 4 passed. Evidence (ignored folder
`.intent/acceptance/2026-11-13-ticket-336-local/`): `evidence.json` and three page
screenshots.

| Case | Result |
|---|---|
| Method list | Google and email offered, Apple off; CORS allows `tauri://localhost` |
| Page | Turnstile test widget passed; code sent; fragment removed; the address in no request URL |
| Wrong code | Refused; the request stays |
| Right code | Linked; session in the Keychain slot without provider tokens; metadata recorded |
| Account client | RLS read of the user's own profile |
| Used code | Refused by the Mac and by Supabase Auth |
| Different account | Refused; new session removed; link metadata unchanged |
| Invalid fragment | The page asks to start again from the Mac |

Found and fixed during the run: React runs the page's mount effect twice in development,
and the first run removes the fragment, so the second read found nothing. The page now
reads the fragment once.

Not covered locally: Supabase Auth with CAPTCHA on (the local stack has it off, so the
page's token is not checked by Auth here). Expiry after one hour is covered by the unit
tests in `tests/desktop-auth-upgrade.test.ts`.
