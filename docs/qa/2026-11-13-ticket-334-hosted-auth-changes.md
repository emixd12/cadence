# Ticket 334: hosted and provider changes for sign-in methods

Written November 13, 2026, for Ticket 334 (D31.3). **Nothing here has been applied.**
The Ticket 334 agent changed no hosted setting, provider or Vercel variable. Agents
apply the steps in order under the coordinator's ruling of November 13, 07:35Z (owner
blockers row 1, which names "manual identity linking on"): record each before and
after value in this file, read the setting back twice (Ticket 332 saw a stale first
read), and recheck Google sign-in and the test login on production after each step.
`CADENCE_SIGN_IN_LINKING` stays unset in Production until Ticket 337 passes for it.

Project `qjodzutjxtmtzczbloxa`. Read and write with the Management API
(`GET` and `PATCH /v1/projects/qjodzutjxtmtzczbloxa/config/auth`) through
`npm run agent:secret -- --caller <caller> --env SUPABASE_ACCESS_TOKEN=supabase-access-token -- <command>`.
"Before" values come from the read of November 13, about 16:12Z, recorded in
`docs/qa/2026-11-13-ticket-332-hosted-auth-changes.md`, step 11; read them again first.

## Ordered steps

| # | Change | Before | After | Rollback | State |
|---|---|---|---|---|---|
| 1 | Read-only: `security_manual_linking_enabled`, `mailer_secure_email_change_enabled`, `mailer_subjects_email_change`, `mailer_templates_email_change_content`, `uri_allow_list` | Manual linking `false` (16:12Z read); the other four not recorded | Values recorded here | None needed | **Ready** |
| 2 | Turn on manual identity linking: `security_manual_linking_enabled` | `false` | `true` | `PATCH` back to `false`. Identities already linked stay and keep signing in | **Ready** (owner blockers row 1). Effect with the flag off: none in Cadence's UI. Any signed-in person could call Supabase's `/user/identities/authorize` directly with their own session; Supabase still refuses an identity that belongs to another user, so no account merge is possible. After it: Google sign-in on production |
| 3 | Redirect allow list `uri_allow_list` | 47 entries, including `https://app.cadence-me.com/auth/callback` | Unchanged | None | **No change.** Linking and the address change return to `/auth/callback?next=…&link=…`, the same path Google sign-in already uses with a query |
| 4 | Vercel Preview: `CADENCE_SIGN_IN_LINKING=on`, with `CADENCE_SIGN_IN_EMAIL=on` | Unset | `on` | Unset, redeploy | **Waiting: step 2.** For Ticket 337 on Preview. An address change on hosted Auth reaches only Supabase team addresses, 2 an hour, until Ticket 332 steps 6–7 |
| 5 | Apple linking | Apple provider off | Apple provider on (Ticket 333's own list) | Ticket 333's rollback | **Waiting: Ticket 333** and owner blockers rows 4 and 5. No Ticket 334 setting: Add Apple shows once `CADENCE_SIGN_IN_APPLE=on` and the provider works |
| 6 | Address change email delivery | Built-in sender | Custom SMTP | Ticket 332 step 6 rollback | **Waiting: Ticket 332 steps 6–7** (owner blockers rows 2 and 3) |
| 7 | Vercel Production: `CADENCE_SIGN_IN_LINKING=on` | Unset | `on`, then redeploy | Unset, redeploy. Linked identities stay valid | **Waiting: Ticket 337** acceptance for linking (D31.6) |

## Notes

- **Secure address change.** Local `double_confirm_changes = true` sends a link to the
  current and the new address; both must be opened. Hosted value not read (step 1). The
  Settings message covers both cases ("If an email also reaches your current address,
  open that link too"). For an Apple account with a relay address, the current-address
  link reaches the person only when Apple's relay accepts Cadence's sender (owner
  blockers row 4d).
- **Address change email.** Hosted uses Supabase's default "Confirm Email Change"
  template, which links to Supabase's verify URL and returns to `/auth/callback`. A
  Cadence-worded template is optional and not proposed here; it would be a messaging
  change (P-054).
- **What manual linking does not change.** Automatic linking by verified email stays
  as it is. A sign-in by a new method whose address matches no account still creates a
  new account; the login page says so while the flag is on.
- **Rows 2–7 each get a dated STATUS.md line when applied.**
