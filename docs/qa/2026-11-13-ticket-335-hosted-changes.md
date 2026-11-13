# Ticket 335: hosted changes for Google Calendar without a Google sign-in

Written November 13, 2026, for Ticket 335 (D31.5). **Nothing here has been applied.**
The Ticket 335 agent changed no hosted setting, provider or Vercel variable.

Project `qjodzutjxtmtzczbloxa`. Push with `npm run supabase -- db push` and read back
through the Management API (read-only query) with
`npm run agent:secret -- --caller <caller> --env SUPABASE_ACCESS_TOKEN=supabase-access-token -- <command>`.

## Ordered steps

| # | Change | Before | After | Rollback | State |
|---|---|---|---|---|---|
| 1 | Push migration `20261113210000_calendar_google_identity_lock.sql`: `keep_one_auth_identity` also refuses deleting a Google identity a connected Calendar uses and becomes security definer; `calendar_install_credential` locks the user row; `calendar_begin_attempt` rebinds a row that is not connected | `keep_one_auth_identity` not security definer (Ticket 334 step 2 readback); `calendar_*` as in `20260917002649` | `migration list` shows `20261113210000` on hosted. Read back: `prosecdef` true for `keep_one_auth_identity`, still EXECUTE `postgres` only; `calendar_install_credential` and `calendar_begin_attempt` EXECUTE `postgres` and `service_role` only (unchanged); function bodies contain `for update` and `cadence_calendar_connected` | A new migration restoring the three function bodies from `20261113190000` and `20260917002649` (and `security invoker` on the trigger function) | **Ready.** Adds no grant. Authority: owner blockers row 1, as Ticket 334 step 2 (it changes what Auth may delete), not the additive approval alone. Push before Ticket 334 step 4 (manual linking on), so linking never runs without the lock. Read the Local Supabase rehearsal result on PR #271 first. After it: on production, Google sign-in for test account A, its kept session, A's Calendar connection still `connected` and refreshing, and a throwaway account's deletion through Cadence |
| 2 | Vercel and Supabase Auth settings | – | – | – | **No change.** Ticket 335 rides on `CADENCE_SIGN_IN_LINKING` and Ticket 334's manual linking (`docs/qa/2026-11-13-ticket-334-hosted-auth-changes.md`, steps 4, 6 and 9) |
