# Cadence

Cadence is a public, open-source personal behavior tracker for explicit decisions, preserved context, longitudinal review, and portable records. It is an authenticated Next.js app with a sibling Astro marketing site under `apps/marketing`.

Cadence generates scheduled Occurrences for recurring Behaviors. The user marks each Occurrence Completed or Not Completed. Unresolved remains separate and never becomes an automatic failure. Cadence is currently available without charge.

Canonical source: <https://github.com/emixd12/cadence>

Future agents should treat the docs as source-of-truth and use `STATUS.md` to understand what has actually been implemented.

## Implemented product

- Google login for independent single-player accounts
- Behavior and category management with daily, interval, weekly, and monthly Schedules
- A timeline with Completed, Not Completed, Unresolved, and derived Needs decision groups
- Notes and start, stop, and reset elapsed-time capture
- Browser reminders and optional email reminders
- Adherence review across 7, 30, or 90 days
- Title and description definition history in JSON and BehaviorLog exports
- JSONL, JSON, CSV, Markdown, and BehaviorLog bundle exports
- Prepared analysis prompts; users export data and choose an external AI service

Cadence does not send behavior data to an AI provider. It is not a collaboration product, social tracker, medical dosing app, payment system, or AI coach.

## Repository workflow

1. Start the coding agent from this repository root.
2. Have the agent read `AGENTS.md`, then `STATUS.md`, then `docs/OPERATIONS.md`, then the relevant files under `docs/`.
3. Use `STATUS.md` to confirm what has already been implemented, verified, blocked, or deferred.
4. Use `docs/TICKETS.md` for ticket scope and acceptance criteria. For a fresh build, begin with the first ticket whose status is not `complete`.
5. Update `STATUS.md` whenever a ticket starts, completes, becomes blocked, or materially changes scope.

If these bootstrap files are copied into a new repository, copy the full project-definition layer, including `AGENTS.md`, `STATUS.md`, `docs/PRODUCT_SPEC.md`, `DESIGN.md`, `.env.example`, `.agents/`, and `docs/`.

Cadence requires Node.js 24.x. Use Node.js 24 for local release
verification so local builds match the Vercel runtime. Install the locked
workspace with `npm ci`.

The target public-product architecture is documented in
`docs/PUBLIC_PRODUCT_ARCHITECTURE.md`.

## Agent checks

```bash
npm ci
npm run agents:check
npm run interactions:check
npm run resolvers:check
npm run lint
npm run typecheck
npm run test
npm run build
npm run marketing:build
npm run marketing:check
```

These checks run without production credentials. Provider-backed smoke checks
remain separate and require the environment described in `docs/OPERATIONS.md`.

Provider workflows are CLI-first:

- Supabase: `docs/SUPABASE_WORKFLOW.md`
- Sequenzy: `docs/SEQUENZY_WORKFLOW.md`
- Vercel: `docs/VERCEL_WORKFLOW.md`

Marketing workspace commands:

```bash
npm run marketing:dev
npm run marketing:build
npm run marketing:check
npm run marketing:preview
```

## License and security

Cadence source code, repository documentation, and synthetic sample content
are licensed under the [MIT License](LICENSE). Third-party material retains its
original license. Copied source notices are recorded in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

The MIT grant does not cover tracked binary non-code assets pending provenance
review. The excluded groups are:

- `app/icon.png` and `app/apple-icon.png`;
- `public/brand/**`, `public/icons/**`, and `public/sounds/**`;
- `apps/marketing/public/brand/**`;
- `docs/design-exploration/**`; and
- image files under `docs/qa/**`.

Those groups include Cadence logos, brand illustrations, product captures,
custom notification icons, design exploration, QA screenshots, and audio. The
Cadence name and logos remain reserved as trademarks. The MIT license grants no
permission to use them as source-identifying marks. Rights available under
applicable nominative-use doctrines are unaffected.

Report suspected vulnerabilities through the private route in
[SECURITY.md](SECURITY.md). Never include credentials, real user data,
behavioral content, or private exports in a public issue.

The source license grants no hosted Cadence service access and no rights to
user-owned behavioral data. Hosted Terms, Privacy, and Trust pages govern the
deployed service separately.

Self-hosters own their deployment, provider accounts, access controls, secret
storage, upgrades, backups, monitoring, and incident response. Values prefixed
with `NEXT_PUBLIC_` and the VAPID public key are browser configuration and may
appear in client artifacts. Supabase service-role keys, OAuth client secrets,
Sequenzy keys, VAPID private keys, process secrets, database credentials,
AgentMail keys, and provider tokens must remain server-only. Use
`.env.example` as the configuration inventory and never commit real values.

## Supabase auth setup

Ticket 002 adds Supabase SSR auth with Google login.

Local `.env.local` needs:

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
NEXT_PUBLIC_SITE_URL=http://localhost:3000
SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID=
SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET=
```

`NEXT_PUBLIC_SUPABASE_ANON_KEY` is still supported as a legacy fallback for older Supabase projects. Do not expose or use the service-role key in browser code.

For Google OAuth, add the local Supabase Auth callback to the Google OAuth
client's authorized redirect URIs:

```text
http://localhost:55321/auth/v1/callback
```

Supabase then redirects back to the app through its separate allowed redirect:

```text
http://localhost:3000/auth/callback
```

`npm run dev` reserves app port `3000` and fails if that port is unavailable.
Local Supabase reserves API/Auth port `55321` in `supabase/config.toml`.

For local Supabase CLI auth testing, `supabase/config.toml` reads the Google
client ID and secret from the `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID` and
`SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET` environment variables.

## Important

The app should stay small. It is not a general task manager, not a medical
dosing app, not a quantified-self analytics platform, and not a collaboration
or admin-heavy SaaS product.
