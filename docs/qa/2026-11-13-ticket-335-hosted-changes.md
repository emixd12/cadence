# Ticket 335: hosted changes for Google Calendar without a Google sign-in

Written November 13, 2026, for Ticket 335 (D31.5). Step 1 was applied by the verifier on
November 13 (see Applied). No Vercel variable or Auth setting changed.

Project `qjodzutjxtmtzczbloxa`. Push with `npm run supabase -- db push` and read back
through the Management API (read-only query) with
`npm run agent:secret -- --caller <caller> --env SUPABASE_ACCESS_TOKEN=supabase-access-token -- <command>`.

## Ordered steps

| # | Change | Before | After | Rollback | State |
|---|---|---|---|---|---|
| 1 | Push migration `20261113210000_calendar_google_identity_lock.sql`: `keep_one_auth_identity` also refuses deleting a Google identity a connected Calendar uses and becomes security definer; `calendar_install_credential` locks the user row; `calendar_begin_attempt` rebinds a row that is not connected | `keep_one_auth_identity` not security definer (Ticket 334 step 2 readback); `calendar_*` as in `20260917002649` | `migration list` shows `20261113210000` on hosted. Read back: `prosecdef` true for `keep_one_auth_identity`, still EXECUTE `postgres` only; `calendar_install_credential` and `calendar_begin_attempt` EXECUTE `postgres` and `service_role` only (unchanged); function bodies contain `for update` and `cadence_calendar_connected` | A new migration restoring the three function bodies from `20261113190000` and `20260917002649` (and `security invoker` on the trigger function) | **Done 20:13:20Z** (verifier; see Applied). Adds no grant. Authority: owner blockers row 1, as Ticket 334 step 2 (it changes what Auth may delete), not the additive approval alone. Push before Ticket 334 step 4 (manual linking on), so linking never runs without the lock. Read the Local Supabase rehearsal result on PR #271 first. After it: on production, Google sign-in for test account A, its kept session, A's Calendar connection still `connected` and refreshing, and a throwaway account's deletion through Cadence |
| 2 | Vercel and Supabase Auth settings | – | – | – | **No change.** Ticket 335 rides on `CADENCE_SIGN_IN_LINKING` and Ticket 334's manual linking (`docs/qa/2026-11-13-ticket-334-hosted-auth-changes.md`, steps 4, 6 and 9) |

## Applied

- **Step 1, November 13, 2026, 20:13:17–20:13:20Z.** Pushed by the Ticket 335 verifier with
  `npm run supabase -- db push --linked` (CLI 2.105.0, vault token `supabase-access-token`),
  under owner blockers row 1, after PR #271's checks and Local Supabase rehearsal passed at
  head 752e224b.
  - Before (Management API, read-only query): `migration list` equal to git (124 rows) except
    `20261113210000`. `cadence_private.keep_one_auth_identity` owner `postgres`, not security
    definer, `search_path=""`, ACL `postgres` only. `calendar_install_credential` and
    `calendar_begin_attempt` owner `postgres`, security definer, `search_path=""`, ACL
    `postgres` and `service_role`. Trigger `keep_one_auth_identity` on `auth.identities`
    enabled. `postgres` has UPDATE on `auth.users`, SELECT on `auth.identities` and
    BYPASSRLS; RLS on those tables is not forced. Connected Calendar rows: 2; connected rows
    without their Google identity: 0; accounts with two Google identities: 0.
  - After: `keep_one_auth_identity` security definer, `search_path=""`, ACL `postgres`
    only (`anon`, `authenticated`, `service_role`: no EXECUTE). `calendar_install_credential`
    and `calendar_begin_attempt` unchanged owner, security definer, `search_path` and ACL
    (`postgres`, `service_role`); bodies contain the user-row lock and the idle-row rebind.
    All five `calendar_*`/trigger function bodies have the same md5 as the verifier's local
    stack. Trigger enabled (`O`); `auth.users` triggers unchanged; 7 users, none without an
    identity.
