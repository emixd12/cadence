# Ticket 334: sign-in methods on the local stack

Run November 13, 2026, on branch `claude/sign-in-334-methods`, against local Supabase
(CLI 2.105.0, API port 55341 through an uncommitted port edit) with
`enable_manual_linking = true`, and `next dev -p 4329` with `CADENCE_SIGN_IN_EMAIL=on` and
`CADENCE_SIGN_IN_LINKING=on`. Mail went to the local Mailpit inbox only. No hosted setting
changed and no real email was sent. Hosted steps:
`docs/qa/2026-11-13-ticket-334-hosted-auth-changes.md`.

## What Supabase Auth does (measured first)

| Action | Result |
|---|---|
| Email code or magic link to a Google-only account's address | Signs in to that account; adds no email identity |
| `updateUser({ email })` with the current address (any case) | No change, no email |
| `updateUser({ email })` with another account's address | `email_exists` (422), no email |
| `updateUser({ email })` with a new address | Links to the current and the new address (`double_confirm_changes`); after both, `auth.users.email`, `profiles.email` and a new `email` identity use the new address |
| First of the two links | Returns with no `code`; Cadence shows "One link confirmed…" |
| `unlinkIdentity` on the last identity | `single_identity_not_deletable` (422) |
| `unlinkIdentity` on the email identity of a Google + email account | Succeeds, and `auth.users.email` moves back to the Google address, which still receives sign-in codes |
| `linkIdentity({ provider: "google" })` | Returns Supabase's provider URL (Google's authorize page) |

So email is a method of every account with a confirmed address while email sign-in is
on, and Settings does not offer to remove it; it offers **Change address**.

## How to run it

1. `npm run supabase -- start` with `enable_manual_linking = true` (now in
   `supabase/config.toml`).
2. Start the web server with the local values from `npm run supabase -- status -o env`
   (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY`) plus `CADENCE_SIGN_IN_EMAIL=on` and
   `CADENCE_SIGN_IN_LINKING=on`: `npx next dev -p 4329`.
3. `CADENCE_SIGN_IN_METHODS_E2E_URL=http://localhost:4329`, `CADENCE_LOCAL_SUPABASE_URL`,
   `CADENCE_LOCAL_SUPABASE_SERVICE_KEY` (optional `CADENCE_LOCAL_MAILPIT_URL`,
   `CADENCE_LOCAL_SUPABASE_DB_CONTAINER`, `CADENCE_SIGN_IN_METHODS_EVIDENCE=<path>.json`):
   `npx vitest run tests/sign-in-methods.local-integration.test.ts --testTimeout=90000`.

Without those variables the file is skipped, so `npm run test` does not run it.

## Result: 6 of 6 passed (first run)

| Case | Result |
|---|---|
| A Google-only account lists Google and its address with **Change address**, shows no Remove, and a direct remove post is refused with "Add another way to sign in before removing this one."; the identity stays | passed |
| An address that belongs to another account is refused (`email_taken`, no email sent); the current address is refused (`email_same`); Supabase's `identity_already_exists` return shows "That Google account already signs in to a different Cadence account…" and the page names no other account | passed |
| **Add Google** redirects to Google through Supabase linking | passed |
| A post from another site (`Sec-Fetch-Site: cross-site`) gets 403 and starts no address change | passed |
| A Google account changes its address through both links (first "One link confirmed", then "Address confirmed"), gets an email identity and no password, removes Google, cannot remove email, and a new browser signs in by email to the same account and sees its category | passed |
| An Apple relay-address account sees "Type DELETE to confirm" | passed |

## Real browser (Chrome, headless, Playwright)

The same flow by clicks: open the row, **Change address**, type, **Send confirmation
link**, open both emailed links, **Remove** → **Remove Google**. Checked at 1280 px light
and 390 px light and dark (no horizontal scroll), the login hint at 390 px, and Delete
account for a relay address ("Type DELETE to confirm"; the relay address does not enable
the button, `DELETE` does). Focus moves to the field on **Change address** and to
**Cancel** on **Remove**.

- **Found and fixed in the browser:** the address field was disabled on submit, so the
  browser left it out of the form data and the server answered "Enter an email
  address". The HTTP test had not caught it. The field is now read-only while sending.

## After the verifier's findings (November 13, about 18:30Z)

The local database was reset (`npm run supabase -- db reset`), which replayed every migration
including `20261113190000_keep_one_auth_identity.sql`.

| Case | Result |
|---|---|
| Two removals sent at once for an account with two Google identities | one `removed`, one `last_method`, one identity left. With the trigger dropped: both `removed`, none left (the case fails) |
| Google beside an Apple identity whose method is off (Supabase alone would allow it) | no Remove shown; a direct post gets `last_method`; both identities stay |
| A session whose last sign-in is 20 minutes old (`auth.mfa_amr_claims` backdated, access token expired so it refreshes) posts add, change address and remove | each is signed out and sent to `/login?next=%2Fsettings%23sign-in-methods&error=reauth_required`; nothing changes |
| The database refuses deleting the last identity directly; deleting one of two works; Admin API account deletion with two identities cascades; the test login signs in | passed |
| An address that already has an account | `email_sent`, the same as a usable address; no email to it and no pending change |
| `tests/sign-in-methods.local-integration.test.ts` | 10 of 10 passed |
| `tests/email-sign-in.local-integration.test.ts` (Ticket 332) with the trigger in place | 9 of 9 passed |

Chrome, by clicks: an old session pressed **Remove Google**, landed on Login with "Sign in again
to change how you sign in…", signed in by email code and returned to `/settings#sign-in-methods`,
where **Remove Google** then worked. **Change address**, **Remove**, **Remove Google** and
**Cancel** all compute to 12 px (before: 16 px for the first two).

## Not run here

- Completing a Google or Apple link needs a real provider sign-in: Ticket 337 on Preview
  after hosted step 2.
- Apple: no start until Ticket 333; `tests/account-sign-in-methods.test.ts` covers the Apple
  branches (addable, removable, refused).
- The Mac: its Settings does not render the row (Ticket 336).
