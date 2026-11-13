# Ticket 333: hosted and provider changes for Apple sign-in

Written November 13, 2026, for Ticket 333 (D31.2, L-024, L-025). **Nothing here has been
applied.** No hosted setting, provider setting or Apple Developer item changed in this
task. Agents apply the steps in order under the coordinator's ruling of November 13,
07:35Z (owner blockers rows 1 and 6): record each before and after value in this file,
read each setting back, and recheck Google sign-in on production after each Auth change.
`CADENCE_SIGN_IN_APPLE` stays unset in Production until Ticket 337 passes for Apple.

Project `qjodzutjxtmtzczbloxa`. Supabase settings: Management API `GET` and
`PATCH /v1/projects/qjodzutjxtmtzczbloxa/config/auth` through
`npm run agent:secret -- --caller <caller> --env SUPABASE_ACCESS_TOKEN=supabase-access-token -- <command>`.
"Before" values for Supabase come from the owner blockers note's read of November 13
("Apple provider: off, no client ID"); reread them before each change.

State values: **Ready** (an agent can do it now), **Waiting: row N** (a row in the Owner
blockers note), **Waiting: step N** (an earlier step here).

## Ordered steps

| # | Change | Before | After | Rollback | State |
|---|---|---|---|---|---|
| 1 | Push migration `20261113180000_apple_sign_in_tokens.sql` (table `cadence_calendar_private.apple_sign_in_tokens`, functions `apple_sign_in_keep_token` and `apple_sign_in_read_tokens`, `service_role` only) | Not present | Present; `has_function_privilege('authenticated', …, 'execute')` false for both; RLS on | A new migration: `drop function public.apple_sign_in_keep_token(uuid,text,text); drop function public.apple_sign_in_read_tokens(uuid); drop table cadence_calendar_private.apple_sign_in_tokens;` | **Ready: the owner said yes on November 13, 18:18Z (row 10; `docs/DECISIONS.md`, 2026-11-13, "Service-role functions for the sealed Apple token").** New objects only, but the migration grants `execute` to `service_role`, which the standing approval for additive migrations (`docs/DECISIONS.md`, 2026-11-10) excludes; migration `20261111150000` needed the owner's yes for the same reason. Push before or with the merge. Verifier, November 13: `db reset` on a separate local stack applied it; RLS on, no policies, table reachable only through the two functions, `anon` refused, cascade on user deletion. With the flag off, nothing calls the functions; account deletion calls the read only for an account with an Apple identity |
| 2 | Apple portal: a new primary App ID with Sign in with Apple, for example `app.cadence.signin` ("Cadence sign-in") | Not verified whether one exists | Present, Sign in with Apple enabled as a primary App ID | Remove the capability or delete the App ID | **Waiting: row 4** (A: owner at the Mac for 1Password and two-factor). Do not add the capability to `app.cadence.desktop`: it can invalidate the Developer ID profile Mac releases use |
| 3 | Apple portal: Services ID, for example `app.cadence.web`, description "Cadence" (the name Apple's page shows). Configure: primary App ID from step 2; domain `qjodzutjxtmtzczbloxa.supabase.co`; return URL `https://qjodzutjxtmtzczbloxa.supabase.co/auth/v1/callback` | None | Present and configured | Remove the domain and return URL, or delete the Services ID | **Waiting: row 4.** The Services ID must not contain the team ID |
| 4 | Apple portal: a Sign in with Apple key for the primary App ID. Download the `.p8` once; note the Key ID. Store both in the Cadence Release vault as `apple-sign-in-key` | None | Key in the vault | Revoke the key in the portal (every secret made from it stops working) | **Waiting: row 4** (B: who creates the key and where it lives) |
| 5 | Make the client secret: `scripts/apple-client-secret.mjs` with the key, Key ID, team `HK26VT477G`, the Services ID and `--days 180` | None | A JWT and its expiry date | None needed | **Waiting: step 4.** Write the expiry into the dated `STATUS.md` row the same day |
| 6 | Supabase Apple provider: `external_apple_enabled`, `external_apple_client_id`, `external_apple_secret` | `false`, empty, empty | `true`, the Services ID, the step 5 secret | `external_apple_enabled` `false` | **Waiting: step 5.** With the flag unset, no Cadence page offers Apple, but `/auth/v1/authorize?provider=apple` on Supabase works for anyone who builds the URL; that creates an ordinary account, as Google would |
| 7 | Vercel Production and Preview: `APPLE_SIGN_IN_SERVICES_ID`, `APPLE_SIGN_IN_CLIENT_SECRET` (sensitive) | Unset | The Services ID; the step 5 secret | Unset both | **Waiting: step 5.** `CONNECTOR_CREDENTIAL_ENCRYPTION_KEY` and `CONNECTOR_CREDENTIAL_KEY_ID` must already be set (Ticket 235 connectors are live, so they are expected to be; not verified in this task) |
| 8 | Supabase redirect allow list `uri_allow_list` | 47 entries, including `https://app.cadence-me.com/auth/callback` | Unchanged | None | **No change.** Apple returns through `/auth/callback?next=…&via=apple`; Google already returns with a query on that entry. Confirm on the first Preview run in step 11 |
| 9 | Apple portal, Services → Sign in with Apple for Email Communication: register email sources. Domain `cadence-me.com` (SPF and DKIM from owner rows 2 and 3) and the addresses `login@cadence-me.com` (sign-in email) and the reminder sender | None | Each source shows a green SPF check | Remove the source | **Waiting: rows 2, 3 and 4.** The reminder sender address was not read in this task: read it with `npm run sequenzy -- transactional get <SEQUENZY_REMINDER_TEMPLATE_SLUG>` first. Today the only Sequenzy domain is the shared `identityscaffolding.sequenzymail.com`. Apple needs SPF or DKIM that passes for each source, so move the reminder sender to `cadence-me.com` (for example `reminders@cadence-me.com`) once that domain verifies, then register it. Sequenzy's `websites list` has an `appleEmailSources` field to check against |
| 10 | Vercel Preview: `CADENCE_SIGN_IN_APPLE=on` | Unset | `on` on Preview only | Unset | **Waiting: step 6** |
| 11 | Production check on a Preview with the test Apple Account (Ticket 337 rows): a new Apple user gets an account and lands on `next`; a returning one reaches the same account; one with "Hide My Email" gets the relay address in Settings; the kept-token row exists (read `apple_sign_in_read_tokens` count only); deleting the account returns 200 from Apple (no `account_deletion_apple_revocation_failed` event) and account.apple.com no longer lists Cadence; an email reminder to the relay address arrives | None | Recorded in Ticket 337's run | None | **Waiting: rows 4 and 5** (test Apple Account); the reminder part waits on step 9 |
| 12 | Vercel Production: `CADENCE_SIGN_IN_APPLE=on` | Unset | `on` | Unset (Login hides Apple at once; existing Apple accounts keep their sessions but cannot sign in again until it is back) | **Waiting: Ticket 337** passes for Apple, and the owner's yes for the public flag |

## Not in this list

- Apple's server-to-server notification endpoint (Apple tells the server when a person
  stops using Sign in with Apple or deletes their Apple Account). Not built. A follow-up
  could delete the kept token and show the account's state; nothing here depends on it.
- Native Sign in with Apple and the Mac App Store or iPhone app (L-024; out of scope).
- The Mac account panel's Apple sign-in (Ticket 336).

## Risks to watch on the first production run

- **Refresh token from Supabase.** The callback keeps `session.provider_refresh_token`.
  Supabase is expected to pass Apple's refresh token there after its code exchange, as it
  does for Google. This was not verified against Apple: the local run used a stub. If the
  first real sign-in logs `apple_sign_in_token_missing`, revocation on deletion cannot
  work, and L-025 must record the gap.
- **Missing email.** The callback maps Supabase's error description that names the email
  to `apple_email_missing`. The wording of Supabase's description was not read from a real
  Apple sign-in.
