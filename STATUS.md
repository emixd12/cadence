# Implementation Status

## How to use this file

This file holds current state: the open-work table and the newest dated entries.
History lives in `docs/status/archive/`, one file per month, moved there unchanged.
`docs/status/README.md` maps each ticket number to its archive file and heading.
Search the archive with grep for older facts; do not read it in full.
`npm run agents:check` fails when this file is larger than 40,000 bytes.

## Update rules

Update this file whenever a ticket starts, completes, becomes blocked, is reopened, or materially changes scope.

Use these status values:

- `not_started`: No implementation work has begun.
- `in_progress`: Work has begun but is not complete or verified.
- `blocked`: Work cannot continue until a specific dependency or decision is resolved.
- `complete`: Acceptance criteria are satisfied and required verification has run, or unavailable commands are explicitly noted.
- `deferred`: Work is intentionally postponed and should not be implemented in v1 unless the docs change.

When updating a ticket row:

1. Keep the ticket scope anchored to `docs/TICKETS.md`.
2. Record key files changed, not every trivial file.
3. Record verification commands with pass/fail status.
4. Record blockers and follow-ups as concrete next actions.
5. Do not mark a ticket `complete` if `npm run lint`, `npm run typecheck`, `npm run test`, or `npm run build` failed or could not be run without explanation.
6. Do not use this file to expand v1 scope. Put future ideas in `docs/FUTURE_UPDATES.md` unless a user explicitly moves them into scope.

Recent entries and the archive:

- Add each new dated entry at the top of "Recent entries", newest first, with the date in its heading (`## <title> — <Month D, YYYY>`).
- When `npm run agents:check` reports that this file is too large, run `npm run status:archive`. It moves the oldest entries, unchanged, into `docs/status/archive/` and regenerates the index.
- Never delete history. Do not edit or reword archived entries.

## Open work

Sources: `docs/TICKETS.md` `Status:` lines for tickets that are not complete, and dated entries
from October 18, 2026 onward (in "Recent entries" below or in `docs/status/archive/`). "TICKETS"
means `docs/TICKETS.md`; "STATUS" means a dated entry, found here or through
`docs/status/README.md`. Where an entry and `git log` disagree, the row says so. Older
owner-gated items are grouped into one row per area (marked "grouped").

Compiled November 9, 2026; MCP, acceptance tooling and travel rows reconciled November 11, 2026.
Check the cited entry before acting on a row.

| Ticket or area | State | Next action or blocker | Source |
| --- | --- | --- | --- |
| Tickets 331–337: sign-in by email and Apple (D31) | 331 complete (PR #264); 332 complete: email sign-in live in Production since November 13, 21:35Z (`CADENCE_SIGN_IN_EMAIL` on; Sequenzy SMTP, Turnstile CAPTCHA, rate 30 an hour); 333 merged behind `CADENCE_SIGN_IN_APPLE` (unset in Production; PR #267); 334 merged behind `CADENCE_SIGN_IN_LINKING` (PR #266; migration `20261113190000` pushed; hosted manual linking on since November 13, 20:26Z); 336 merged (PR #270), not in a Mac release yet; 335 merged behind `CADENCE_SIGN_IN_LINKING` (PR #271; migration `20261113210000` pushed); 337 first pass done, no flag on; three linking rows wait on owner row 16 | 332: none; measure sign-in email volume in the first week (`docs/COSTS.md`); messaging P-051 and P-052 (`docs/qa/2026-11-13-ticket-332-hosted-auth-changes.md`, "Applied, go-live"). 333: migration `20261113180000` pushed November 13, 18:20Z (step 1, owner's yes for its `service_role` grants; grants read back); the Apple portal, provider, relay and production steps in `docs/qa/2026-11-13-ticket-333-apple-hosted-changes.md` wait on owner rows 4 and 5; L-024 licence question for the owner | TICKETS, Tickets 331–337; DECISIONS, 2026-11-13 (D31); STATUS, "Ticket 332", "Ticket 333" |
| Sign in with Apple client-secret rotation (Ticket 333), row dated November 13, 2026 | No secret exists yet: the first one waits on owner row 4 (step 5 of the Ticket 333 change list) | The agent that makes a secret writes its expiry here and a rotate-by date 30 days earlier (at most about 182 days after it was made). Rotate with `docs/OPERATIONS.md`, "Sign in with Apple (Ticket 333)"; the same section covers a missed rotation | OPERATIONS, "Sign in with Apple (Ticket 333)" |
| Tickets 310–324: connector completion (D28) | 310–324 complete; `CADENCE_CONNECTOR_COMPLETION` on in Production since November 13, 2026, 04:30 UTC. Ticket 323 matrix passed on a local stack, deployed web and the installed Mac 0.1.10 (`docs/qa/2026-11-12-connector-completion-acceptance.md`) | Owner deletes the Hevy test workouts and routines, then an agent records the `deleted`-event rows. One-day Vercel usage measurement due after November 14, 04:30 UTC (US$5/month ceiling, `docs/COSTS.md`). Mac count control is a follow-up | TICKETS, Tickets 310–324; DECISIONS, 2026-11-12 |
| First account link times out for a large account | Fixed: PR #247 merged as `7e829202` with hosted migration `20261112120000`; the owner's Mac first link passed November 12 at 05:52Z | The Mac error-text fix ships with the next Mac release | STATUS, "Owner's Mac first link after the hosted fix — November 12, 2026" |
| Ticket 326: configuration history in two key shapes (defect D2, web export 500) | Read-side fix on branch `claude/fix-export-camelcase-60ae30`: export, BehaviorLog restore and Daily Brief history normalize camelCase snapshots; the export route logs failures | Merge and check export as account A on production; Mac account sync still uploads camelCase snapshots (writer fix ships with a later Mac release); optional data migration needs the owner's approval | TICKETS, Ticket 326; STATUS, "Ticket 326: web export reads Mac-written configuration history — November 11, 2026" |
| Ticket 293: test-access preflight | Merged November 10, 2026; awaiting verification | First live preflight run per suite | TICKETS, Ticket 293; STATUS, "Ticket 293: test-access preflight for acceptance runs — November 7, 2026" |
| Tickets 294–300: Daily Brief on the user's ChatGPT plan | 294–299 merged; hidden behind `VITE_CADENCE_CHATGPT_PLAN`; 300 deferred | Paused by the owner on November 12: the feature stays hidden and Ticket 300 waits until the owner turns it on. The production device-model flag must stay unset; L-019 logo gap and P-029 to P-031, P-045 and P-046 messaging review remain activation gates | TICKETS, Tickets 294–300; `docs/DECISIONS.md`, 2026-11-12 |
| Tickets 289–290: Daily Brief prompt, model and effort candidates | Candidates in the development workbench; production pinned; comparison on H1–H10 and S1 prepared November 11 | Owner sets a spend cap (US$2 asked) and optionally names extra models; agents run the comparison; the owner promotes or rejects under Ticket 184's rules | TICKETS, Tickets 289–290; `docs/qa/daily-brief-prompt-consolidation.md`, "Prepared owner comparison" |
| Ticket 291: skill-rule acceptance scenarios | Local-stack run with `claude-code` passed all three scenarios November 11 | Production run with the API clients; needs a spend cap for the QA keys | TICKETS, Ticket 291; `docs/qa/mcp-server.md`, "First local run — November 11, 2026" |
| Leave reminder send-time Calendar read (follow-up) | Entry says "not pushed"; `git log` shows PR #200 merged as `2d16bf12` | Deployment not recorded: unclear — see source | STATUS, "Follow-up: keep a leave reminder when the send-time Calendar read fails — November 8, 2026" |
| Behavior place edit withdraws its leave time (web) | Entry says "not pushed"; `git log` shows PR #198 merged as `d643a6e7` | Not yet rechecked live | STATUS, "Follow-up after the Wave 6 deploy: a Behavior place edit withdraws its leave time — November 7, 2026" |
| Mac leave reminders for newly added Calendar events | PR #198 in 0.1.10; installed run on November 12 inconclusive (event too close to plan a reminder) | Rerun on the test Mac with an event at least two hours ahead | STATUS, "Cadence for Mac 0.1.10 notarized — November 12, 2026" |
| Updater key rotation and new Developer ID identity | 0.1.10 published November 12, 05:29–05:33Z, with the rotated key and new identity; 0.1.9 and earlier install it by hand once | Renew the certificate before December 11, 2027. The next release (PR #241 native code, PR #243 UI) needs a new dormant build and ordinary installed acceptance | DECISIONS, 2026-11-11; STATUS, "Cadence for Mac 0.1.10 notarized — November 12, 2026"; release packet, "PR review follow-up" |
| Ticket 325: release credential backup and restore | Identity, notarization-password and updater backups verified November 12; API-key backup and checks recorded as passed in `dd4cb67b`; notarization uses the API key (0.1.10) | Certificate-renewal spike | DECISIONS, 2026-11-11 (D29); TICKETS, Ticket 325; STATUS, "Ticket 325: live backups verified — November 12, 2026"; 0.1.10 release packet |
| Cadence for Mac 0.1.10 | Published November 12, 2026 (0.1.9 on November 7) | macOS 14 not tested; 0.1.9 and earlier install 0.1.10 by hand once (rotated updater key) | `docs/qa/2026-11-12-desktop-0.1.10-release-packet.md`, "Publication" |
| Ticket 285: installed Mac acceptance | Run November 6–7, including Calendar-event activation on published 0.1.9 | Closure not stated: unclear — see source; user guide line for `P-027` still to add | TICKETS, Ticket 285; STATUS, "Ticket 285 defect fixed: blank Mac window from the archive notice — November 7, 2026" |
| Ticket 284: web acceptance with the real clock | Evidence recorded, awaiting verification; seven findings fixed on `travel-wave6` (merged as PR #196 per `git log`) | Verification of the evidence and fixes; Ticket 283 Outlook or iCloud routed event not checked (no test connector) | TICKETS, Ticket 284; STATUS, "Travel advisory revamp Wave 6: Ticket 284 web acceptance with the real clock — November 6, 2026" |
| Travel revamp Tickets 260–283 | Merged as PRs #189–#194 and #196, November 5–7, 2026; live on web; Mac parts released in 0.1.9; hosted equals git, so the 275–277 migrations are applied; TICKETS reconciled November 11, 2026 | Release acceptance continues under Tickets 165, 284 and 285; production setting of `CADENCE_LEAVE_REMINDER_JOB` not checked | TICKETS, Tickets 260–283; STATUS, "Ledger cleanup — November 11, 2026" |
| Ticket 165: travel release acceptance | In progress | Denied state; installed Open Location Services and Check again; installed status-only permission regression. Directions matrix: web rows in Ticket 284, installed Mac row in Ticket 285 | TICKETS, Ticket 165; STATUS, Ticket 284 and Ticket 285 entries (November 6–7) |
| Ticket 187: agentic Calendar access | Live since October 24, 2026 | Google sensitive-scope verification (Ticket 245); published Mac against the 187 server; installed desktop consent; `P-012` | TICKETS, Ticket 187 |
| Launch narrative follow-ups (D30, Ticket 327 complete) | `docs/NARRATIVE.md` accepted November 13; positioning is "behavioral remodeling assistant"; no public copy changed | Owner decides the beta audience from the Ticket 328 report and approves interviews; the marketing site rewrite (P-048), listings, visual identity and the social system each need a ticket; claims table not checked against production | TICKETS, Ticket 327; DECISIONS, 2026-11-13 (D30); P-048 |
| Tickets 245–246: messaging track | Filed October 27; not development tickets | 245: Google verification submission, gated on `P-010` and `P-012`. 246: pre-launch messaging pass | TICKETS, Tickets 245–246; STATUS, "Messaging track — October 27, 2026" |
| Ticket 212: home and travel in onboarding | Live on web since October 24 | Authenticated browser QA of the setup row against a real routing report; installed desktop QA | TICKETS, Ticket 212 |
| Ticket 216: completion place labels | Live on web since October 24 | iPhone Safari re-prompt check; installed signed-desktop CoreLocation acceptance; `P-001` | TICKETS, Ticket 216 |
| Ticket 217: learned travel habits | Live on web since October 24 | Production QA; installed desktop acceptance; `P-002` | TICKETS, Ticket 217 |
| Ticket 218: weather travel margin | Code live; weather off | Operator clearance (`CADENCE_WEATHER_PROVIDER_CLEARANCE`); paid plan; deployed-web and installed acceptance; `P-003` | TICKETS, Ticket 218 |
| Ticket 219: travel facts in Daily Brief input | Stages 1 and 2 live on web | Google's reply to support case 76805292 and the day-level-facts decision; `P-004`, `P-012`; installed desktop acceptance | TICKETS, Ticket 219 |
| Ticket 184: owner-reviewed briefing candidate | Candidate 3 (`daily_brief@1.2`) from the October 23 review | Held-out cases, quality acceptance, promotion and rollback execution | TICKETS, Ticket 184; STATUS, "Ticket 184 candidate 3 — October 23, 2026" |
| Ticket 188: duration estimates from descriptions | Implementation started; recovered for owner review October 22 | Landing decision: unclear — see source | TICKETS, Ticket 188; STATUS, "Tickets 187, 184 candidate 2 and 188 recovered for review — October 22, 2026" |
| Ticket 130: account synchronization | TICKETS says in progress (2026-09-08) | The owner decides its state | TICKETS, Ticket 130; STATUS, "Ticket ledger reconciled with production — October 27, 2026" |
| Account sync timezone rule | PR #159 merged October 28; hosted push authorized | Not verified: a timezone change synced from an installed Mac after the push; authenticated hosted sync against the new rule | STATUS, "Account sync timezone rule for archived Behaviors — October 27, 2026" |
| Ticket 232: MCP production acceptance | Live acceptance complete October 31 | Trust Preview → Production run: unclear — see source | STATUS, "Ticket 232 live acceptance complete — October 31, 2026" |
| Trust evidence binding (launch gate) | Marketing-ID refresh paused before public launch; the Trust page reads Stale; the nightly collection still runs | Before launch: automate the refresh after each production deploy, run it once, collect Production evidence and confirm Passed. No agent refreshes or asks before then | DECISIONS, 2026-11-11, "No Trust marketing-ID refresh before launch"; `docs/OPERATIONS.md`, "Public-product operations" |
| MCP acceptance tooling, Tickets 247–258 | Complete except conditional Ticket 253 (on hold); TICKETS reconciled November 11, 2026 | Consent Allow or Deny before hydration returns 500 (product finding, not fixed) | STATUS, "Automated MCP client acceptance: Tickets 247–258 — October 31, 2026"; TICKETS, Ticket 253 |
| Connector Tickets 236, 240–242 (Hevy, iCloud, Outlook) | Hevy, Outlook (personal account) and iCloud (owner's Apple Account) passed on production web and installed Mac 0.1.10 (November 11–12); cross-tenant Outlook checks skipped by owner decision | Not verified on production: an iCloud event on Timeline (no events in the selected calendars), the Outlook `cadence://` completion, sign-out and account-switch cache cleanup, Hevy key entry on the Mac. Owner revokes the "Cadence QA" app-specific password when testing ends. 241 step 7 copy is live and awaits the owner's review | TICKETS, Tickets 236, 240, 241, 242; STATUS, "iCloud production acceptance — November 12, 2026" |
| Tickets 243–244: travel backlog | Filed October 22; backlog | None scheduled | TICKETS, Tickets 243–244 |
| Daily Brief release acceptance (grouped): Tickets 147, 148, 155, 161, 168, 169, 172, 173, 174, 182, 183, 185 | In progress or implemented in source; reconciled October 27: still open | Ticket 174 carries hosted, deployed-web and installed-desktop gates; 182–183 owner-run live checks; 185 awaits owner product decisions | TICKETS, Ticket 174 and each listed ticket |
| Google Calendar Timeline (grouped): Tickets 133–137, 141, 150 | In progress; reconciled October 27: still open | Post-approval web and native consent smoke checks; 137 provider-failure, Workspace and installed fixture cases; 150 live custom-name check | TICKETS, Tickets 137, 141, 150 |
| Earlier travel tickets (grouped): 160, 162–164, 166, 167, 170, 171 | Implemented in source or discovery complete | Release gates sit in Tickets 165 and 174; owner re-acceptance for 166–167 | TICKETS, each listed ticket |
| Desktop release follow-ups (grouped): Tickets 142, 143 | Complete in source; web deployed September 18 | Installed-native release acceptance | TICKETS, Tickets 142–143 |
| Operations (grouped): Tickets 091, 104, 105, 128 | 091 and 105 in progress; 104 and 128 blocked; reconciled October 27 | 104: operator diagnostics or an authorized route test; 105: verify deployed browser-push delivery after the reviewed web-push 4.0.0 upgrade; 128: a revised candidate needs a new measured gate | TICKETS, Tickets 091, 104, 105, 128 |

## Recent entries

## Ticket 332: email sign-in live in production — November 13, 2026

- **Live.** `CADENCE_SIGN_IN_EMAIL` is `on` in Production since 21:35Z; `/login` offers
  Continue with email at 390 px and desktop. One real email sign-in on production passed;
  the account was deleted.
- **Hosted, 21:13–21:35Z.** Owner rows 11–13 answered at 21:11Z. Hosted Auth SMTP through
  Sequenzy as `Cadence <login@cadence-me.com>` with the new Identity Scaffolding key; email
  rate limit 2 → 3 → 30 an hour; CAPTCHA on with the owner's Turnstile widget (its secret in
  hosted Auth, `cadence-blush-three.vercel.app` added to its hostnames); Vercel Production
  `CADENCE_TURNSTILE_SITE_KEY`. Sequenzy company-wide: Reply-To changed from the owner's Gmail
  to `Cadence <login@cadence-me.com>` (a Reply-To is required), click tracking off; a test
  reminder still renders. Before and after values:
  `docs/qa/2026-11-13-ticket-332-hosted-auth-changes.md`, "Applied, go-live".
- **Accepted with Turnstile on** (unaliased flag-on deployment, removed after): new account,
  code, link in another browser, wrong and used code and link refused, no token and a fake
  token refused by Supabase, `/login/email/mac` page and post. Rechecks after each Auth
  change: kept sessions A and B, Google sign-in as A, Google and Apple starts, admin link-token
  path, `qa:preflight --suite mcp-protocol` 9 of 9
  (`docs/qa/2026-11-13-ticket-332-production-acceptance.md`, "Go-live run").
- **For the owner, not blocking.** The widget allows `localhost` and `127.0.0.1`; the SMTP key
  has full access where the sender preset would do.

Platform impact: web sign-in (email live); Mac email sign-in uses `/login/email/mac`, which
works on production now, and ships with the next Mac release (owner row 14); marketing not
applicable; mobile web checked at 390 px. Messaging impact: P-051 and P-052 updated.

## Ticket 337: sign-in acceptance, first pass — November 13, 2026

- Preflight suite `sign-in` and the hosted Auth probe `scripts/acceptance/access/auth-config.mjs`
  (`docs/qa/agent-secrets.md`, "Sign-in suite").
- Hosted, 20:26Z: Ticket 334 step 3 no change (secure email change already on); step 4 manual
  identity linking on. Rechecks passed (`docs/qa/2026-11-13-ticket-334-hosted-auth-changes.md`).
- On a flag-on test deployment (removed after): Sign-in methods row, neutral refusal of a Google
  account owned by another account, 15-minute rule, last-method refusal, Calendar unchanged,
  MCP consent and deletion for an email-only account, 390 px. Successful adds wait on owner row
  16 (a third Google test account) or email (rows 11–13). `CADENCE_SIGN_IN_EMAIL`,
  `CADENCE_SIGN_IN_APPLE` and `CADENCE_SIGN_IN_LINKING` stay off in Production
  (`docs/qa/2026-11-13-ticket-337-acceptance.md`).

## Ticket 335: Google Calendar for accounts that do not sign in with Google — November 13, 2026

- **Built, behind `CADENCE_SIGN_IN_LINKING` (draft PR #271).** An account with no Google
  sign-in is told "Connecting adds the Google account you choose as a way to sign in to
  Cadence."; Connect adds Google through Ticket 334's `startAddSignInMethod`, returns to
  Settings, and the next click on **Connect Google Calendar** opens consent for that Google
  account. A Google account on another Cadence account is refused without naming it.
- **Rules.** One Google sign-in per account: the add path refuses a second (`already_added`);
  two (only by a race) read as `multiple`, Calendar does not connect, Disconnect still works.
  Removing Google is refused while Calendar is connected through it (`calendar_connected`).
- **Verifier fixes.** Migration `20261113210000_calendar_google_identity_lock.sql` (pushed
  to hosted November 13, 20:13:20Z, by the verifier; `docs/qa/2026-11-13-ticket-335-hosted-changes.md`,
  step 1, before and after read back; no grant changed): the identities
  trigger refuses removing Calendar's Google identity and `calendar_install_credential` takes
  the same user-row lock, closing a race that left Calendar connected without Google (8 of 40);
  `calendar_begin_attempt` rebinds an idle row, replacing a service-role table write. The
  return from adding Google no longer starts consent from the address alone.
- **Verified locally.** `db reset` clean; `tests/calendar-google-sign-in.local-integration.test.ts`
  9 of 9 (the race case fails with the old functions); Ticket 334's suite 10 of 10; flows in
  Chrome; bench shows the four sentences
  (`docs/qa/2026-11-13-ticket-335-calendar-google-sign-in.md`).
- **Verifier, second round (local stack of its own, Google stubbed).** Race: 0 of 60 unforced
  trials and the forced run end with Calendar connected without Google (was 8 of 40); both
  lock orders serialize in the database; deletion still cascades; two removals at once keep
  one identity (15 of 15). Suites for Tickets 332, 333, 334 and 335 pass (9, 9, 10, 9). Flag
  off matches `origin/main` step for step; a token sealed on main opens. A crafted return
  link starts nothing; Disconnect revokes in the `multiple` state.

Platform impact: web Calendar connect and Sign-in methods; Mac shows the add-on-web sentence
and keeps working; marketing not applicable; mobile web checked at 390 px. Messaging impact:
none new (P-051).

## Ticket 336: sign-in methods in Cadence for Mac — November 13, 2026

- **Merged (PR #270, verified November 13), not in a Mac release yet.** Settings › Account offers the methods the hosted app
  reports as on (`GET /api/auth/sign-in-methods`), with the web's labels and order. Google
  and Apple use the system browser and the PKCE callback. Email: the address is typed in
  the app, the browser opens `/login/email/mac` (Turnstile when on), and the 6-digit code
  is typed in the app. Panel text no longer says "with Google".
- **Kept.** One finish step for every method holds the different-account guard; sessions
  stay in Keychain, now without provider tokens; Apple's refresh token goes once to the
  hosted app for revocation (L-025). ChatGPT disconnect on account change (D27) and sync
  are unchanged.
- **Why the browser for the code request:** `docs/DESKTOP_BUILD.md`, "Sign-in methods
  (Ticket 336)".
- **Installed run (test Mac, dev builds 0.1.11-dev.3 and dev.4).** Against this branch's
  web app and local Supabase over the tailnet: the method list, the email page with
  Turnstile, wrong and right codes, the different-account refusal, and link plus sync by
  email passed. Against production: only Google is offered. Record:
  `docs/qa/2026-11-13-ticket-336-mac-sign-in.md`.
- **Open.** Re-linking test account A is refused by an existing first-link rule (branched
  status history on A's hosted account); the test Mac waits on owner row 15 to restore its
  protected database. Apple on the installed app and email against production wait on
  Ticket 337. A Mac release needs the owner's instruction (owner row 14).

Platform impact: Mac account panel and auth client; web gains the Mac's email page and
three routes, no change to web sign-in; marketing not applicable; mobile not applicable.
Messaging impact: P-051 (existing).

## Ticket 332: production setup and acceptance of email sign-in — November 13, 2026

- **Applied.** Sequenzy sending domain `cadence-me.com` added and verified; Cloudflare DNS
  for it (DKIM `sq1`/`sq2`, return path `rp`/`rp2`, DMARC `p=none`, root SPF). Hosted Auth
  code length 8 → 6. Each change and its recheck: `docs/qa/2026-11-13-ticket-332-hosted-auth-changes.md`.
- **Accepted on production Supabase.** New account, link in another browser, 6-digit code,
  wrong, used and expired values, the one-email-a-minute limit, A's Google address reaching A's account,
  SPF/DKIM/DMARC pass, MCP consent and account deletion for an email-only account
  (`docs/qa/2026-11-13-ticket-332-production-acceptance.md`). Test accounts deleted.
- **Not on.** `CADENCE_SIGN_IN_EMAIL` stays off and hosted SMTP and CAPTCHA are off. The
  vault SMTP key belongs to another Sequenzy company, whose template drops the code; the
  Cloudflare token cannot create a Turnstile widget. Owner rows 11–13.
- **Code.** Test login signs in with a link token, so it works with CAPTCHA on (PR #268).

Platform impact: web Auth config and test login; Mac follow-up Ticket 336; marketing not
applicable; mobile web shares the form. Messaging impact: none new (P-052).

## Ticket 334: sign-in methods in Settings, behind its flag — November 13, 2026

- **Built.** Settings, Account and data, has a Sign-in methods row behind
  `CADENCE_SIGN_IN_LINKING`: it lists Google, Apple and the email address; **Add Google**
  and **Add Apple** use Supabase manual identity linking; **Change address** (or **Add
  email**) moves email sign-in to a new address after a confirmation link, with no
  password; **Remove** unlinks Google or Apple while another enabled way in remains. The
  server refuses the last way in and email removal, not only the UI. A Google or Apple
  account or address that belongs to another account is refused without naming it. Login
  shows a one-account hint while the flag is on. Delete account asks for `DELETE` with no
  address or an Apple relay address.
- **Seam for Ticket 335.** `startAddSignInMethod` in `lib/services/sign-in-methods.service.ts`.
- **Verifier fixes (November 13).** Two removals at once left an account with no identity
  (10 of 10). Migration `20261113190000_keep_one_auth_identity.sql` adds a trigger that locks
  the user row and refuses deleting the last identity; account deletion, the test login and
  email sign-up still pass. Add, Remove and Change address now need a sign-in within 15
  minutes (coordinator decision, recorded as an assumption). A taken address gets the same
  answer as a usable one.
- **After Ticket 333 merged.** Rebased on `2482fcb1`. Removing Apple revokes its kept token
  at Apple and forgets the row (migration `20261113200000`); a refused or unconfigured
  revocation never blocks the removal. An Apple account added from Settings keeps its token
  too. Ticket 333's suite 9 of 9 with the two new cases; Ticket 334's 10 of 10; Ticket
  332's 9 of 9.
- **Verified locally.** `tests/sign-in-methods.local-integration.test.ts`: 10 of 10 (6 at first) against a
  running server, Mailpit and manual linking on; the same flow by clicks in Chrome at
  1280 and 390 px, which found and fixed a disabled field dropped from the form
  (`docs/qa/2026-11-13-ticket-334-sign-in-methods.md`).
- **Hosted, 18:48Z.** The verifier pushed `20261113190000` (trigger
  `keep_one_auth_identity`) and `20261113200000` (`apple_sign_in_forget_token`,
  `service_role` only) and read both back (hosted change list, "Applied"). Verifier
  re-check: 20 of 20 concurrent removal trials through Cadence and 20 of 20 against
  Supabase's unlink endpoint kept one identity. Hosted manual linking stays off and
  `CADENCE_SIGN_IN_LINKING` stays unset; the remaining steps are in
  `docs/qa/2026-11-13-ticket-334-hosted-auth-changes.md`. Local `enable_manual_linking`
  is on.

Platform impact: web Settings, routes and login hint; Mac shows no row (Ticket 336);
marketing not applicable; mobile web checked at 390 px. Messaging impact: P-054.

## Ticket 333: Apple sign-in built behind its flag — November 13, 2026

- **Built.** Continue with Apple starts Supabase Auth's Apple provider and returns
  through `/auth/callback?…&via=apple`. Apple's black custom button on Login (L-024 lists
  the rules relied on); the method list now has an 8 px gap and email is a secondary
  action (the Ticket 331 verifier's design note).
- **Revocation.** Supabase hands Apple's refresh token to the callback once and keeps
  none, so the callback seals it with the connector key (migration
  `20261113180000_apple_sign_in_tokens.sql`, service role only). Account deletion reads it
  first and revokes at Apple after deleting the Auth user; a failure is reported, never a
  retry. L-025 records the remaining gaps.
- **Apple's cases.** A missing email gets its own message. A Hide My Email address makes
  a separate, empty account and shows the relay address in Settings (Ticket 334 owns
  linking). The name, sent only on the first sign-in, stays in the profile.
- **Verified locally.** `tests/apple-sign-in.local-integration.test.ts`: 7 of 7 against a
  running server, local Supabase and a stub that plays Apple
  (`scripts/apple-sign-in-stub.mjs`). Headless Chrome at 1280 and 390 px. A real-browser
  bug was fixed: the button's title rendered black on black.
- **Not done.** Nothing hosted changed. The Apple Developer setup, the provider, relay
  registration and the production check wait on owner rows 4 and 5:
  `docs/qa/2026-11-13-ticket-333-apple-hosted-changes.md`. Rotation runbook and recovery:
  `docs/OPERATIONS.md`, "Sign in with Apple (Ticket 333)".

Platform impact: web login, callback, deletion and one migration; Mac follow-up Ticket 336;
marketing not applicable; mobile web shares the button, checked at 390 px. Messaging
impact: P-051, P-053.

## Ticket 332: email sign-in built behind its flag — November 13, 2026

- **Built.** Continue with email opens `/login/email`. One email carries a link and a
  6-digit code; either signs in, and a new address creates the account. The link opens
  `/login/confirm`, whose button verifies on Cadence's own domain, so it works in another
  browser and a mail scanner cannot use it up. Wrong, used and expired links and codes,
  and a second request inside 60 s, each show a plain message with a way forward. Optional
  Cloudflare Turnstile (`CADENCE_TURNSTILE_SITE_KEY`).
- **No passwords.** Hosted Auth has no switch for that. Migration
  `20261113160000_refuse_auth_passwords.sql` drops any new password for a real address,
  including the random one Auth sets on a code sign-up. Reserved test addresses keep
  theirs, so the test login still works.
- **Local parity.** `supabase/config.toml` now has confirmation on, 60 s between emails,
  TOTP on and the sign-in template, as hosted. Code length stays 6 locally; hosted sends 8.
  The owner decides (one setting: `EMAIL_SIGN_IN_CODE_LENGTH`).
- **Verified.** `db reset` replayed every migration. `tests/email-sign-in.local-integration.test.ts`:
  9 of 9 passed against a running server and the local inbox
  (`docs/qa/2026-11-13-ticket-332-email-sign-in.md`). CAPTCHA measured locally: code
  requests, sign-up and password sign-in need a token; verify, refresh and Google do not.
- **Verified and applied (November 13, verifier).** A login CSRF on `/auth/confirm` was
  found and fixed (cross-site posts get 403; the confirm page uses `strict-origin`).
  Hosted steps 1–4 applied: 0 real addresses had a password (4 test ones); migration
  `20261113160000` pushed and read back; both sign-in templates set. Steps 5–9 wait on the
  owner. Evidence: both QA records named above.

Platform impact: web form, routes and Auth config; Mac follow-up Ticket 336 (code entry;
CAPTCHA effect recorded); marketing not applicable; mobile web shares the form, checked at
390 px. Messaging impact: P-051, P-052.

## Ticket 330: Complete from Hevy on a linked Mac — November 13, 2026

- **Built:** a linked Mac shows Complete from Hevy in Behavior settings and Create behavior,
  reading and saving through the hosted link route over the authenticated broker. A save
  syncs first (so a Behavior made on the Mac exists on the account) and again after.
- **Installed acceptance passed** on the test Mac (0.1.11-dev.2, account A): a settings save
  and a create-time link both reached hosted and synced back to SQLite. Local mode on the
  owner's Mac (0.1.11-dev.1) shows no control. Both Macs run dev builds until the next release.

Platform impact: Mac; web unchanged. Messaging impact: P-050.

## Ticket 331: login page and routes for more than one sign-in method — November 13, 2026

- **Built.** `lib/auth/sign-in-methods.ts` lists Google, Apple and email. Login renders the
  enabled ones; `lib/auth/sign-in-start.ts` starts them from `/auth/google` and the new
  `/auth/sign-in/[method]`. Sign-in errors name no provider.
- **Flags.** `CADENCE_SIGN_IN_APPLE` and `CADENCE_SIGN_IN_EMAIL`, on only when exactly `on`.
  Both are unset everywhere. A flag shows nothing until Ticket 333 or 332 gives the method
  its start.
- **Unchanged.** With the flags off, the Login HTML equals `origin/main` `07ce9a03` in five
  states, apart from the two reworded errors. Test login and MCP consent sign-in untouched.
- **Verified.** On a local stack next to `origin/main`: same Login HTML, Google start
  URL, test login and MCP consent return. `dagger check --cadence`: 10 passed.
- **Fixed in review.** `normalizeRedirectPath` refuses `/.//host` and `/\host`. Before,
  `/login?next=/.//host` sent a signed-in person to another site.

Platform impact: web login and auth routes; Mac not applicable (Ticket 336); marketing not
applicable; mobile web shares the page, bench checked at 390 px. Messaging impact: P-051.

## Tickets 331–337 filed: sign-in by email and Apple (D31) — November 13, 2026

- **Decision D31.** Supabase Auth stays; WorkOS is not adopted. Email sign-in uses a link
  or a 6-digit code, with no password. Apple sign-in uses the web flow. Every method
  reaches the same account. ChatGPT sign-in is dropped; the D27 deferral stands.
  Connecting Google Calendar adds that Google account as a sign-in method.
- **Tickets.** 331 login page and routes, 332 email, 333 Apple, 334 Settings and the
  one-account rule, 335 Google Calendar, 336 Mac, 337 acceptance. All `not_started`.
  Ticket 330 is the Mac Hevy link (draft PR #261).
- **Not verified.** The WorkOS, Supabase, Apple and OpenAI provider facts were not
  rechecked for the entry; the hosted Auth email settings and custom SMTP on the hosted
  plan are unread. L-024 and L-025 hold Apple's rules, from memory.
- **Not changed.** No code and no public copy. P-051 lists the text that names Google
  sign-in.

Platform impact: documentation only; web Tickets 331–335, Mac Ticket 336, marketing none,
mobile web shares the login page. Messaging impact: P-051.

## Ticket 329: Complete from Hevy at Behavior creation — November 13, 2026

- **Built:** Create behavior on the web shows the Complete from Hevy choices when the flag is
  on and Hevy is connected. Save behavior creates the Behavior, then saves the link through
  the existing route; a refused or failed link keeps the Behavior and says so. The link
  route's form state accepts an empty `behaviorId` for a Behavior being created.
- **Owner request:** the link could only be set on an existing Behavior.

Platform impact: web form; Mac follow-up (links are web-only); marketing not applicable;
mobile web shares the form. Messaging impact: P-049.

## Ticket 328: launch audience research — November 13, 2026

- **Report.** `docs/research/2026-11-13-launch-audience-research.md`: desk research on one
  day. Sources are one survey of 5,067 U.S. adults read in full, ten competitor home pages
  and one distribution guide.
- **Recommendation.** Beta audience: professionals who already use AI agents, with parents
  in professional jobs and Hevy trainers as variants. Self-improvement practitioners after
  the iPhone app. No separate executive campaign.
- **Finding to act on.** Habitify, Todoist and Divitica already offer MCP access, so AI
  access alone does not set Cadence apart.
- **Open.** The owner's decision; ten interviews; newsletters, creators and press were not
  researched.

Platform impact: documentation only. Messaging impact: none.
