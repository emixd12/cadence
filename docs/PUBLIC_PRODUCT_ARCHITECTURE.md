# Public Product Architecture

This document records the product posture change from a private personal app to
a public, multi-surface Cadence product.

It does not schedule implementation by itself. Add or update tickets in
`docs/TICKETS.md` before restructuring the repository, materially changing the
marketing site, adding billing, or starting desktop/mobile work.

## Product posture

Cadence is a public, open-source personal behavior tracker for one account at a
time. It remains a small, single-player product: no collaboration, no social
features, no shared workspaces, no gamification, and no expanded productivity
suite.

The final product posture is:

- Free open-source desktop and mobile apps.
- A web app that can support many independent accounts through simple Google
  authentication.
- Future paid capabilities that do not gate the account synchronization
  implemented in Tickets 116–122, plus separately scoped speech-to-speech AI
  features.
- A practical reference implementation and demonstration surface for the
  BehaviorLog Bundle standard:
  `https://github.com/emixd12/BehaviorLog-Bundle`.

The first public-product implementation steps are now present: the current
authenticated web app has been hardened for many independent users, and the
Astro marketing site exists as a sibling app. Tickets 107–114 implement the
local-first macOS desktop track. Ticket 115 defers Apple-trusted distribution.
Tickets 116–122 implement optional Google account linking and offline-capable
desktop synchronization. Tickets 146–148 implement the in-app read-only daily briefing
in the existing horse bubble on web and linked desktop, using server-side model
generation and existing sign-in. General AI chat/coaching, audio speech, billing,
and native mobile remain future scope. Marketing claims require separate acceptance.

## Surface model

The scheduled desktop workspace retains the Next.js app at the repository root:

```text
app/            authenticated Next.js web app, with components/ and lib/ at root
apps/
  marketing/   public Astro website for SEO, product explanation, and standard adoption
  desktop/     scheduled Tauri desktop app

packages/
  core/         recurrence/status/timeline/export resolver logic
  ui/           shared design tokens and framework-light primitives
```

Create shared packages incrementally after the native boundary proof. Do not
move the current app out of the repository root. Broader restructuring,
`packages/db`, `packages/config`, and a mobile workspace remain deferred.

Preferred sequencing:

1. Harden the existing web app for many independent Google-auth accounts.
2. Add a simple Astro marketing site as a sibling app.
3. Extract `packages/core` only when it removes real duplication or unblocks a
   second runtime.
4. Extract `packages/ui` as tokens and primitives first, not full product
   components.
5. Maintain the completed desktop track under Tickets 107–114 and 116–122;
   keep Ticket 115 and mobile deferred.

Use npm workspaces first unless build orchestration becomes painful. Turborepo
may be added later if caching and multi-app task orchestration become
worthwhile.

## Design-system surface model

Cadence uses one canonical design system across surfaces, but implementation is
surface-scoped. The shared design system owns foundations, product language,
state semantics, accessibility expectations, and canonical component-family
contracts. Each surface can satisfy those contracts with native implementation
files for its runtime.

Current design-system inventory layers:

- `DESIGN.md`: human-readable source for the visual system, product voice, and
  surface-specific design rules.
- `design-system.surfaces.json`: canonical cross-surface catalog. It defines
  supported surfaces, component families, shared contracts, and native
  implementation mappings.
- `design-system.manifest.json` and `design-system.usage.json`: current live
  authenticated web-app traceability inventory.
- `/design-system`: local/dev-only global bench. It shows foundations,
  canonical surface/component-family mappings, and the live web-app trace
  cards.

Do not force every surface to share full product components. Astro marketing,
Next.js authenticated app UI, the desktop shell, and future mobile shells have
different runtime boundaries. Share tokens, primitive contracts, terminology,
states, and presentational module specs first. Extract `packages/ui` only when
it removes real duplication or unblocks a scheduled second runtime; keep it
focused on tokens and framework-light primitives before full product modules.

When a new surface starts, add or update its entries in
`design-system.surfaces.json`, then add a native surface manifest or bench only
when there is live UI to verify. Cross-surface catalog entries may point to
Astro templates, CSS/token files, static captures, native component files, or
planned implementation docs, but product usage counts must remain separated
from bench previews.

New or materially changed product/design tickets must address web, desktop,
marketing, and future mobile explicitly. Each platform needs an implementation
reference, a follow-up ticket, or a not-applicable reason. Extend the current
interaction registry with applicability, implementation state, and evidence;
reuse IDs for unchanged intent. Checks reject missing references and incomplete
desktop parity at release. Fixtures and native QA establish semantics; catalog
structure alone does not. Marketing consumes approved claims, not app UI.

## Marketing site

The public marketing site is implemented with Astro under `apps/marketing`. It
shares Cadence's brand voice and design tokens, but it does not share the
authenticated Next.js app shell.

Launch routes:

| Route | Purpose |
|---|---|
| `/` | Cadence-led landing page that introduces BehaviorLog as the open portability standard |
| `/faq` | Frequently asked questions about Cadence philosophy, privacy, time tracking, and BehaviorLog portability |
| `/docs` | Technical docs entry point for Cadence, BehaviorLog, machine-readable mirrors, and future docs structure |
| `/examples` | Sanitized sample bundle page |
| `/about` | Philosophy, governance, scope boundaries, and open-source posture |

`/cadence` and `/standard` are compatibility redirects to `/`. They are not
dedicated pages and do not appear in the manifest, sitemap, Markdown mirrors,
or `llms-full.txt`.

Primary calls to action:

- Try Cadence
- Read BehaviorLog
- Download Example Bundle
- View on GitHub
- Download for Mac
- Log in

The site is static-first and SEO-conscious from the start: semantic HTML,
canonical URLs, useful metadata, Open Graph/Twitter metadata, sitemap/robots
support, accessible headings, generated Markdown mirrors, `llms.txt`,
`llms-full.txt`, and a public route manifest.

Marketing posture:

- Cadence is the site brand, homepage lead, and consumer-facing product name.
- The header uses the Cadence mark and name only.
- The fifth homepage walkthrough module explains optional connectors through
  Timeline context and a static overlap preview. Main copy is provider-neutral;
  supporting copy identifies the current provider and its availability. Detailed
  permissions and disconnect disclosures remain in FAQ and canonical Privacy.
- BehaviorLog is the open bundle standard and portability layer Cadence writes
  and reads. It should be explained in the same manner as a technical base
  layer or open package, not as the primary site brand.
- The header shows the Cadence brand link, a Download for Mac
  button to the current preview DMG, and Log in. About and FAQ are linked
  from the footer. Docs and Examples stay available by direct URL,
  machine-readable mirrors, and in-page content links.
- `/docs` should grow toward a familiar developer-docs structure: Guides,
  Reference, Examples, Agent policy, and Schema history, while preserving
  Markdown mirrors, route manifests, `llms.txt`, and static HTML.

The marketing site is deployed separately from the authenticated Next.js app as
the Vercel project `cadence-marketing`. Its current production alias is
`https://cadence-marketing-two.vercel.app`. `MARKETING_SITE_URL` owns the
Astro `site` value for canonical URLs and sitemap generation.

Marketing analytics and cookies are not launch scope and are not implemented.
Any future analytics layer must include a consent and documentation update.

Do not tease desktop or mobile apps on the marketing site before those surfaces
are real or intentionally announced.

The marketing app uses npm workspace scripts:

```bash
npm run marketing:dev
npm run marketing:build
npm run marketing:check
npm run marketing:preview
```

`npm run marketing:build` generates the sanitized example
`cadence-demo.behaviorlog.zip` download. The generated bundle is not source
data and is rebuilt from `apps/marketing/scripts/build-example-bundle.mjs`.

## Web app launch posture

The current authenticated web app remains the first production surface to
harden. It should support many independent users, each with a private personal
tracker.

Launch auth:

- Google login only.
- Supabase Auth remains the web identity provider.
- The default route after login remains `/timeline`.
- Public registration remains closed until the marketing-content publication
  gates below pass. Existing authenticated accounts may continue to use the
  application.

Simple onboarding is implemented for public launch as a thin, optional pop-up
that links into existing app controls:

1. Create first behavior.
2. Request browser notification permission.
3. Import data when an import path exists.
4. Detect timezone automatically when possible and allow manual override.

Default categories remain useful but user-owned. Users should be able to add
new categories and remove defaults when category management is implemented.

Account deletion and export should be first-class before a broad public launch,
following the BehaviorLog portability posture.

## Data and privacy posture

Cadence supports many independent accounts, not shared accounts. Each account's
data remains inaccessible to other users through Supabase RLS. Normal app code
must keep using authenticated user context and must not use service-role access
for user-facing reads/writes.

No support dashboard or routine admin access to user data is launch scope. If
operational support tooling is ever added, it must be explicitly scoped with a
privacy model, auditability, and source-doc updates.

Before public launch, add standard public-product protections:

- Rate limiting for sensitive routes where practical.
- Signup/auth abuse protections through provider settings.
- Server-side validation on all mutation routes/actions.
- Secret scanning discipline and environment variable ownership.
- Basic monitoring/error reporting without sending sensitive behavior content
  to third-party tools. The first implementation uses privacy-safe structured
  runtime logs rather than adding an external monitoring SDK.
- Account deletion and export paths.
- Terms of Service and Privacy Policy.
- A privacy/trust page explaining ownership, export, reminders, and the
  BehaviorLog portability model.

The approved public retention schedule is:

- routine logs: no more than seven days, with Vercel runtime logs retained one
  day and Supabase API and database logs retained seven days;
- security-incident records: up to 90 days or until the investigation
  concludes when an investigation requires preservation;
- backups: no more than seven days;
- deleted-account live data: immediately when deletion succeeds, with backup
  remnants aging out within seven days;
- browser-push payloads: no more than 24 hours;
- support messages: 12 months after resolution.

Specific records may be retained longer only for security investigations,
fraud prevention, or legal preservation. The owner confirmed verification of
the active settings against this schedule on 2026-08-31. Sanitized evidence and
the completion attestation live in `docs/OPERATIONS.md`.

## Marketing content and legal contract

Cadence's public source is
`https://github.com/emixd12/cadence` under the repository MIT
license. The application origin is the only canonical host for `/trust`,
`/privacy`, and `/terms`; the Astro marketing site must link to those routes
and must not publish copies.

Cadence provides prepared prompts, but the user exports data and chooses any
external AI service. Cadence does not send behavior data to an AI provider.
Public copy names exactly five export formats: JSONL, JSON, CSV, Markdown, and
BehaviorLog bundle.

The public legal entity is Identity Scaffolding LLC, a Wyoming limited
liability company assumed authorized in New York. Its public address is 30 N
Gould St Ste R, Sheridan, WY 82801. The minimum age is 18. New York law
governs, subject to nonwaivable consumer protections. Disputes use informal
resolution first, then a court of competent jurisdiction in New York State.
The initial Terms require neither arbitration nor a class-action waiver.

Legal-copy publication and public registration require all three gates:

1. Sanitized evidence verifies provider capabilities against the retention
   schedule.
2. `privacy@identityscaffolding.com` is created and confirmed with one harmless
   route test.
3. One legal review approves the final Privacy and Terms text, entity facts,
   retention language, disclaimers, liability language, and dispute process.

All three gates passed on 2026-08-31. The owner confirmed the active retention
settings, the privacy mailbox route test, legal review, and publication
approvals. The canonical Privacy and Terms routes may publish, and public
registration is approved.

## Source, asset, trademark, and disclosure boundaries

Cadence source code, repository documentation, and synthetic sample content use
the root MIT license. Tracked binary non-code assets remain excluded pending
provenance review. The excluded groups include app icons, Cadence logos, brand
illustrations, product captures, custom notification icons, design exploration,
QA screenshots, and audio.

Copyright licensing of a logo image does not grant permission to use Cadence as
a source-identifying mark. Cadence names and logos remain reserved as
trademarks, subject to applicable nominative-use doctrines. The source license
also grants no hosted-service access and no rights to user-owned behavioral
data. Hosted Terms, Privacy, and Trust pages remain separate service documents.

Security reports use the dedicated private email named in `SECURITY.md`.
GitHub private vulnerability reporting becomes a secondary route after Ticket
100 enables it. Do not publish a security defect through an issue or marketing
surface before coordinated remediation.

## Public Trust evidence

`schemas/public-trust-evidence.schema.json` is the versioned machine contract
for every public Trust check. The release evidence workflow owns publishing.
The pure resolver validates snapshots and derives freshness for scripts and
future Trust consumers.

Each immutable snapshot names one source commit, application deployment,
marketing deployment, workflow run, build time, verification time, and
freshness deadline. Retain every published snapshot at its commit- or
workflow-run-pinned URL. GitHub Pages paths must include the workflow run and
both deployment IDs. `latest.json` may point to the newest valid snapshot, but
it must not replace or mutate an older snapshot.

Consumers show all nine required checks. They keep Failed, Not run, and
Unavailable results visible. They derive Stale when a Passed check exceeds its
fixed check-specific deadline or when any named source or deployment differs
from the current release. Validation derives each deadline from its completion
time, so a new snapshot cannot extend an old result.

Public evidence contains sanitized aggregates and public identifiers only. It
is bounded operational evidence and establishes no assurance beyond each
check's stated meaning and scope limit.

The app owns the canonical human route at `/trust` and the same-origin machine
route at `/api/public/trust-evidence`. Both use the same normalized view. The
runtime validates the Pages feed before caching it. An outage downgrades a
validated cached copy to Stale; without one, every check is Unavailable.
Production config names the current source commit and both Vercel deployment
IDs so an older Passed result cannot describe a newer release.

## Desktop and mobile relationship

`docs/DESKTOP_BUILD.md` records completed Tickets 107–114. Desktop targets
Apple Silicon with macOS 14 as its declared minimum, using Tauri v2, Vite,
React, and SQLite. Ticket 115 defers actual macOS 14 compatibility and Apple-
trusted distribution. Tracking works without login or network under one stable
local profile. Tickets 116–122 add optional use of the existing Google account;
SQLite remains the offline working copy. `docs/DESKTOP_PARITY.md` records the
current tracking baseline and verification state.

The desktop release preserves all current tracking capabilities and includes:

- usable without login,
- local data by default,
- optional account synchronization with explicit first-link and
  disconnect choices,
- native reminders targeting 30 days, nearest first, with OS-readback coverage
  and a clearly displayed shorter horizon when OS limits require it,
- signed/notarized artifacts and signed, user-approved updates for the original
  final release, now explicitly deferred rather than passed.

On 2026-08-31, the owner authorized an unnotarized, ad hoc signed Apple Silicon
preview milestone within Ticket 113. Preserve Cadence, `app.cadence.desktop`,
and existing local data. Apple enrollment, Developer ID signing, notarization,
and final-release acceptance remain deferred; they do not block preview work.
Prepare artifacts and a dedicated HTTPS preview feed locally for the existing
`emixd12/cadence` repository. Candidate-building checks must not depend
on updater evidence that requires those candidates. Final production checks
remain strict, and updater signing remains distinct from Apple signing.

Preview publication, public uploads, and feed exposure require approval of the
concrete files and destination. Local authorization does not publish a release
or authorize marketing availability claims. The owner authorized the six exact
asset hashes in `docs/qa/2026-08-30-desktop-asset-provenance.md` for distribution
inside Cadence. MIT exclusions, third-party notices, and reserved marks remain.

Mobile implementation remains deferred. Final Apple-trusted desktop publication
still requires Ticket 115. Do not add CI infrastructure, a background helper,
desktop email delivery, billing, or duplicate public/legal pages. Tickets
116–122 own account controls, synchronization, conflict handling, and their
release acceptance.

The web app remains cloud-first through Supabase. Desktop account mode bridges
its local-first data with hosted Supabase only when the user opts in. Account-
free desktop mode remains complete. Hosted access keeps existing ordinary-user
RLS. SQLite stays authoritative for the device working copy and keeps atomic
domain mutation, tombstone, and outbox writes. Credentials and device-specific
notification state do not enter the synchronized account snapshot. Ticket 122
accepted the current account-sync preview. Marketing must still identify it as
an unnotarized preview while Ticket 115 remains deferred.

## Pricing and future AI

Billing is not launch scope.

The intended future commercial shape is:

- free open-source desktop and mobile apps,
- a paid web/shared-account layer for cross-app saving,
- future paid speech-to-speech AI behavior-review features.

Do not gate current launch features behind pricing. Do not add payment
infrastructure until a billing ticket updates product, route, data, legal, and
operations docs.

General AI coaching/chat and audio speech remain future scope. The September 20
product-direction update scopes the in-app read-only horse briefing under
Tickets 146–148. It does not enable autonomous execution or broader AI features.

## Source documents affected

When public-product work starts, keep these files in sync:

- `AGENTS.md`
- `docs/PRODUCT_SPEC.md`
- `README.md`
- `docs/PRODUCT_SPEC.md`
- `docs/UI_SPEC.md`
- `docs/USER_FLOWS.md`
- `docs/ROUTE_MAP.md`
- `docs/DATA_MODEL.md`
- `docs/NOTIFICATION_SPEC.md`
- `docs/EXPORT_FORMATS.md`
- `docs/DECISIONS.md`
- `docs/FUTURE_UPDATES.md`
- `docs/TICKETS.md`
- `docs/OPERATIONS.md`
- `docs/VERCEL_WORKFLOW.md`
- `docs/DESKTOP_BUILD.md`
- `STATUS.md`
