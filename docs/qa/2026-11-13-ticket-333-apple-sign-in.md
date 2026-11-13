# Ticket 333: Apple sign-in on the local stack

Run November 13, 2026, on branch `claude/sign-in-333-apple`, against local Supabase (CLI
2.105.0, API on port 55341) after `migration up` applied
`20261113180000_apple_sign_in_tokens.sql`, and a `next dev` server with
`CADENCE_SIGN_IN_APPLE=on` and `CADENCE_SIGN_IN_EMAIL=on`. No hosted setting changed and
no request reached Apple. The hosted steps are in
`docs/qa/2026-11-13-ticket-333-apple-hosted-changes.md`.

## Why a stub

Supabase Auth's Apple provider always talks to `appleid.apple.com`: its URL setting is
ignored for Apple (from memory of the Auth source, not rechecked), so a local OIDC
provider cannot stand behind it. `scripts/apple-sign-in-stub.mjs` stands where the web app
expects Supabase instead. It forwards every request to local Supabase, and plays Apple's
part of two calls: `/auth/v1/authorize` returns to `redirect_to` with a stub code (or with
Auth's error for a missing email), and the PKCE token exchange for a stub code returns a
real local session for the scenario's user, with an Apple identity in `auth.identities`
and `provider_refresh_token` set. It also plays Apple's revoke endpoint. Everything else
is the real stack: Cadence's routes, cookies, the callback, the database, RLS and the
migration.

What the stub cannot show, and Ticket 337 checks on production: Apple's own page,
Supabase's Apple code exchange and its `provider_refresh_token`, Supabase's account
creation and automatic linking by a verified email, and the name Apple sends only on the
first sign-in reaching `user_metadata`.

## How to run it

1. `npm run supabase -- start`, then `npm run supabase -- migration up --local`.
2. Environment (values from `npm run supabase -- status -o env`; use the port the stack
   really listens on): `CADENCE_LOCAL_SUPABASE_URL`, `CADENCE_LOCAL_SUPABASE_SERVICE_KEY`,
   `CADENCE_LOCAL_SUPABASE_PUBLISHABLE_KEY`, `APPLE_STUB_PORT=55390`,
   `CADENCE_APPLE_STUB_URL=http://127.0.0.1:55390`,
   `CADENCE_APPLE_SIGN_IN_E2E_URL=http://localhost:4328`, and a throwaway
   `CONNECTOR_CREDENTIAL_ENCRYPTION_KEY` (`openssl rand -base64 32`) with
   `CONNECTOR_CREDENTIAL_KEY_ID`.
3. `node scripts/apple-sign-in-stub.mjs`.
4. `NEXT_PUBLIC_SUPABASE_URL=$CADENCE_APPLE_STUB_URL NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=… SUPABASE_SERVICE_ROLE_KEY=… CADENCE_SIGN_IN_APPLE=on npx next dev -p 4328`
   (with the connector key variables from step 2).
5. `npx vitest run tests/apple-sign-in.local-integration.test.ts --testTimeout=60000`
   (optional `CADENCE_APPLE_SIGN_IN_EVIDENCE=<path>.json`).

Without those variables the file is skipped, so `npm run test` does not run it. It takes
about 5 seconds.

## Result: 7 of 7 tests passed (17:36Z), 10 recorded cases

| Case | Result |
|---|---|
| Login offers Continue with Apple; the start sends `provider=apple`, a PKCE challenge and `redirect_to=/auth/callback?next=%2Fbehaviors&via=apple` | passed |
| A new Apple user: account, signed in, lands on `next`, name in the profile; the refresh token is kept sealed (the ciphertext does not contain it; it opens to the same value) | passed |
| A returning Apple user with no name: the same account (one user for the address), the name stays, the kept token is replaced | passed |
| A Hide My Email address beside an existing Google account: a separate, empty account with no name; Settings shows the relay address | passed |
| Auth's missing-email error: Login with the Apple message, `next` kept, no session | passed |
| Any other provider error: the generic message | passed |
| A Google sign-in with a forged `via=apple`, for a user who also has an older Apple identity: nothing kept | passed |
| Deletion: the token is read before the Auth user is deleted, the row cascades, and Apple's revoke receives `client_id`, `client_secret`, `token` and `token_type_hint=refresh_token` | passed |
| Apple refuses (400), or the client secret is unset: the error reaches the caller (account deletion reports it and still succeeds) | passed |
| The token functions refuse anonymous and signed-in callers; the private table is unreachable; the service role needs an Apple identity | passed |

`tests/account-deletion.service.test.ts` adds the order inside account deletion: Apple
tokens are read before the Auth user is deleted and revoked after; a refused revocation
still completes the deletion; an account without an Apple identity reads nothing.

## Browser check

Headless Google Chrome (playwright-core from the repo) against the same server, at
1280 × 900 and 390 × 844:

- Login with both flags on: Continue with Google (primary text action), Continue with
  Apple (Apple's black button, 223 × 44 px), Continue with email (secondary text action),
  8 px apart. The Apple button is not smaller than the Google action (154 × 44 px).
- Continue with Apple with a Hide My Email scenario reached `/timeline` signed in;
  Settings → Profile showed the relay address.
- The missing-email scenario returned to `/login?next=%2Ftimeline&error=apple_email_missing`
  with the message above the methods.
- `/design-system?preview=flow.sign-in-methods` shows six states, including Google and
  Apple only, Google and email only, and everything disabled.

Finding fixed during the check: the first build rendered the Apple title and logo black
on the black fill. The base `a { color: inherit }` rule is unlayered and beats Tailwind
utilities, and `button { font: inherit }` dropped the 19 px title on the disabled button.
The button now uses an unlayered class, `.apple-sign-in-action`, in `app/globals.css`, as
`.product-action` does.
