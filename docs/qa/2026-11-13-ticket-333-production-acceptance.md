# Ticket 333: production acceptance of Apple sign-in

Run November 13, 2026, 18:35–19:15Z (and continuing), by the Apple enablement agent. Run
folder (git-ignored): `.intent/acceptance/t333-enable/` in the Intent workspace worktree
(`evidence.jsonl`, `rechecks.jsonl`, `auth-*.json`, `events.jsonl` for the vault reads).
No token, client secret, key, cookie or email address was printed or recorded; addresses
appear only as their domain.

**Result so far: every Apple row run has passed, apart from the Hide My Email relay row,
which waits on one more owner sign-in.** `CADENCE_SIGN_IN_APPLE` stays off in production
until that row passes.

## Setup

- **Client secret.** Made at 18:58:09Z with `release-credentials.mjs apple-sign-in-secret`
  (PR #269). The owner approved the key read (`release-secrets` for this run). It
  **expires May 12, 2027, 18:58Z**. **Rotate by April 12, 2027.** Apple's token endpoint
  answered `invalid_grant` to a dummy code (it accepted the client), not `invalid_client`.
- **Hosted changes.** Before and after values: `docs/qa/2026-11-13-ticket-333-apple-hosted-changes.md`, "Applied".
- **Where the app ran.** Preview has no Supabase variables, so, as in Ticket 332, the
  agent made an unaliased production-target deployment from `origin/main` 736aace4 with
  the flag on for that deployment only (`dpl_WA8MkhB6CRNyVZChkaddwAxFYxXv`). The agent
  opened it in Cadence QA Chrome with the project's automation bypass, which was never
  printed. `app.cadence-me.com` kept serving the production deployment with the flag
  off: Login showed only Continue with Google after every change.
- **Browser.** The Intent in-app browser tab never mounted, so the agent used the Cadence
  QA Chrome window. The owner signed in there with their personal Apple Account (Apple
  refused to create a test account, owner row 5).

## Rows

| Row | Result | Evidence |
|---|---|---|
| First sign-in creates an account and keeps the name | **Passed** after one rerun. The first attempt (19:06Z) created the account, with the full name in Auth metadata and the profile, but returned to `app.cadence-me.com` instead of the test deployment. See "Finding: redirect allow list" | `apple-users` reads: user `61133341…`, `name_present: true`, `profile_name: true` |
| Supabase returns `provider_refresh_token`; a sealed row exists | **Passed.** The session after the 19:10:42Z sign-in carried a provider refresh token (presence read only). One row in `apple_sign_in_tokens` for that user, subject digest `638b28a6…`, one Apple identity. No `apple_sign_in_token_missing` event | `who`, `apple-token-rows`, `logs-scan` |
| Returning sign-in reaches the same account | **Passed.** The 19:10:42Z sign-in reached user `61133341…`, created 19:06:48Z. No second user | `apple-users` |
| What Settings shows | **Passed.** The email row shows the address Apple shared. On this run that was the owner's real address (`gmail.com`), because Apple's sharing prompt was answered with Share My Email | `settings` read, addresses masked |
| Relay address (Hide My Email) | **Waiting** on the owner's third sign-in. Apple asks the sharing question only on first authorization. After the deletion below revoked Cadence's authorization, the next sign-in should ask again | — |
| An email reaches the relay address | **Skipped** by the owner ("skip the test email") | — |
| Account deletion revokes at Apple and removes the row | **Passed.** Settings → Delete account (export box checked, the address typed) at 19:12:30Z. Session 401 afterwards; the Auth user and the token row are gone. Runtime logs for the deployment hold no warn or error line in the deletion window, so neither `account_deletion_apple_token_absent` nor `account_deletion_apple_revocation_failed` fired (both log at warn). A successful revoke logs nothing; the fresh consent prompt on the next first sign-in is the Apple-side check | `account-deletion`, `logs-scan` |
| Google sign-in and kept sessions after each change | **Passed** at baseline (18:42Z) and after the Apple provider (19:00Z): kept sessions A and B refresh; a fresh Google sign-in as A on `app.cadence-me.com` returns A's user ID. Google as A on the test deployment returned to it after the allow-list fix (19:09Z) | `rechecks.jsonl`, `evidence.jsonl` |

## Finding: redirect allow list

Supabase Auth compares `redirect_to` with each allow-list entry as a whole-URL glob,
query string included. An exact entry `https://<host>/auth/callback` therefore does not
match `/auth/callback?next=…&via=apple`, and Supabase falls back to the Site URL.
Production is not affected: Supabase accepts any redirect on the Site URL's own host
(`app.cadence-me.com`). Ticket 333's change list said the exact entry is enough because
"Google already returns with a query on that entry"; that worked only because of the Site
URL rule. For any other host (a test deployment, a future custom domain), add
`https://<host>/auth/callback**`. The test entry was swapped at 19:09Z and is removed
after the run.

## Cleanup (at the end of the run)

- Remove `https://cadence-311hbjk9f-emis-projects-4c886aeb.vercel.app/auth/callback**`
  from the allow list and delete the test deployment.
- Clear `appleid.apple.com` and `apple.com` cookies from Cadence QA Chrome.
- Delete the owner's third-run Apple account through Settings.
