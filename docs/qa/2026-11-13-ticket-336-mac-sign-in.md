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

## Installed run on the test Mac (November 13, 2026)

Preflight `desktop-test-mac`: 7 ready; one owner item (Notifications and Location
permissions) does not touch sign-in and was not needed. Run folder
`.intent/acceptance/2026-11-13-ticket-336-installed/` (ignored).

Backend: this branch's web app (`next build` and `next start`, `CADENCE_SIGN_IN_EMAIL=on`,
Turnstile always-pass test key) and the local Supabase stack, served to the tailnet only
over HTTPS with `tailscale serve` (443 for the web app, 8443 for Supabase). Production
previews sit behind Vercel login, so the Mac cannot use one. The dev build `0.1.11-dev.3`
(source `fea9ffc4`, executable `384cd1a5…`) compiled those two origins in and, for this
build only, added them to the content security policy; the edit was reverted after the
build and is not in the branch.

Install: 0 pending writes, normal quit, `protect-before-install.sh` saved
`backups/pre-0.1.11-dev.3-ticket336-20261113T185910Z/` (schema 24, 40 Behaviors,
206 Occurrences, integrity `ok`, rollback ZIP of `0.1.11-dev.2`). Rename swap; signature
verified; executable hash matched the build report.

| Step | Result |
|---|---|
| Launch against the local backend | The saved production session failed to refresh: "Needs reconnection"; the panel read "Signed in as …" with no provider named |
| Reconnect account | The panel offered **Continue with Google** and **Continue with email**; Apple stayed hidden because the hosted list has it off |
| Different-account guard | Email with a new address: the page in the test Mac's Chrome passed Turnstile and sent the code; a wrong code showed "That code did not work…" and kept the request; the right code showed "Disconnect the current account before signing in with a different account." The link record's hash matched the protected copy; 40 Behaviors and 0 pending writes stayed |
| Link by email and sync | After **Disconnect › Keep a local copy**, email with another new address and its code: "Signed in as …", then the first-link choice. **Import** was refused by an existing first-link rule ("The local account snapshot contains branched status history"), not by this ticket, so the run used **Ignore local data and use account data** after cancelling the stale attempt and signing in again: "Account linked", "Account data is current", sync cursor 19:13:15Z, 0 pending writes, protected backup written |
| Production build, method list | `0.1.11-dev.4` (production values, executable `aa4c2d84…`) after **Keep a local copy**: the panel offered only **Continue with Google**, because production has email and Apple off (the route is not deployed yet, so the Mac fell back to Google alone) |
| Google through the system browser | Test account A from the Google chooser; the link record matched A's original hash (`812fcdb2…`) |
| Re-link A | Refused by the existing first-link rule: "The hosted account snapshot contains branched status history" (`account-sync.resolver.ts:821`, Tickets 116–122). Not caused by this ticket |

Tailnet serve was turned off and the local web server stopped after the run.

### State left on the test Mac

`0.1.11-dev.4`, signed in as A, link paused on the error above. Production data is
untouched. Restoring the protected copy `backups/pre-0.1.11-dev.3-ticket336-…` (A's
linked database) lets A reconnect without a first link; that restore needs the owner's
instruction (Owner blockers row 15).

### Finding for a follow-up

Test account A's hosted history has two root status events for one occurrence: a Hevy
connector completion (`reason_code` `connector:hevy`, Completed, 04:36:30Z on November 13)
and a manual Not Completed 48 seconds later, also with `previous_status` Unresolved and no
`revises_event_id`. The second mark was made without seeing the first, the race that
connector completion (D28) allows. `connectorAndManualMark` in
`packages/core/src/resolvers/account-sync.resolver.ts` accepts that pair only while one
mark is local and the other hosted. Once both are hosted, every first link to the account
fails at line 821. This is a product defect from connector completion, not bad test data
(verifier, November 13: read-only query of A's events; one branched occurrence). It needs
its own ticket.

### Not run on the installed app

- Apple: the local stack has no Apple provider, and production has Apple off.
- Email against production: waits for this PR to deploy and `CADENCE_SIGN_IN_EMAIL` to be
  on (Ticket 337).

## Release-packet notes (for the owner's release instruction)

- Carries: Ticket 336. No SQLite migration (schema 24); no new native command or
  Keychain slot (the email request reuses `pending-state`).
- Content security policy unchanged: the Mac talks only to the existing hosted origin.
- Release acceptance to add: Settings › Account offers exactly the production method list;
  a linked Mac upgrade keeps its session; a Reconnect after the upgrade works by Google.
- After the release: Ticket 337 runs email and Apple on the installed release once their
  production flags are on.
