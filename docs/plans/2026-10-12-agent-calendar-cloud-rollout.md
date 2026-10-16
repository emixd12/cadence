# Agent Calendar Cloud Rollout Implementation Plan

> **Execution:** Recommended: one controlled release under Ticket 187, with provider setup and verification proceeding alongside local release preparation.

**Goal:** Preserve Cadence's features while isolating AI Calendar access in a verified, agent-classified Google Cloud project.

**Source of truth:** Ticket 187 in `docs/TICKETS.md`; `docs/OPERATIONS.md#agent-calendar-grant-ticket-187`; `docs/PRODUCT_SPEC.md`; Google's sources linked below.

**Architecture:** Keep sign-in and ordinary Calendar access on their existing clients. Add a dedicated agent project for Daily Brief and private workbench Calendar reads. Reuse Vercel, Supabase, the HTTPS Calendar broker, and the Calendar REST provider.

**Tech Stack:** Google Auth Platform and Calendar API; Next.js/Vercel; Supabase; Tauri/React; existing encrypted credential storage.

---

## Decision and current state

One new production Google Cloud project is required by the selected Cadence architecture.
Google requires separate clients for mixed standard and agent workflows; separate projects additionally isolate project-wide token revocation.
This distinction matters: Google does not require a new hosting stack for this change.
Sources: [agent client rules](https://support.google.com/cloud/answer/15549257?hl=en), [project-wide revocation](https://developers.google.com/identity/protocols/oauth2/web-server#tokenrevoke).

Ticket 187 already implements separate grants, storage, refresh, callbacks, selections, AI reads, and disconnect behavior locally.
Its migration requires new Calendar consent and preserves standard Calendar records.
Existing automated evidence is in `docs/qa/2026-10-12-agentic-calendar.md`.
The source changes remain uncommitted. They do not establish production behavior or provider compliance.

Required remaining work:

1. Verify the live project, client, deployment, migration, and callback inventory.
2. Configure and verify the new Google project and agent client.
3. Correct privacy disclosures before enabling Calendar-to-AI processing.
4. Establish a tested cutover barrier against older AI readers.
5. Complete live consent, revocation, and installed desktop acceptance.

**Confirmed disclosure gap:** `components/settings/LegalContent.tsx` says Calendar information never goes to AI providers.
Its privacy tests also expect no behavior data to reach AI providers.
Those statements conflict with enabled Daily Brief processing. Update the actual shared legal content, not only this plan.

**Unverified:** Google's classification of this exact bounded workflow, project access, deployed source, current verification status, and installed desktop compatibility.
Agent classification remains the conservative implementation assumption. A provider answer must be recorded without silently reversing the separation.

## Minimum infrastructure

| Resource | Required change | Owner/evidence |
|---|---|---|
| Google sign-in | Preserve existing Supabase Google provider and its project/client. | Operator records the existing public client/project identifiers. |
| Standard Calendar | Preserve `cadence-calendar-498717` and its client; verify the standard classification. | Authorized Google project owner reads back classification. |
| Agent Calendar production | Create a distinct project; proposed ID `cadence-calendar-agent-prod`, subject to availability. | Emiliano or an authorized project owner records actual project ID/number. |
| Agent OAuth application | External audience, accurate branding, narrow scopes, verified domains, agent-classified client. | Google Console and verification evidence. |
| Google APIs | Enable `calendar-json.googleapis.com`; keep existing REST operations. | Enabled-service and quota readback. |
| Vercel | Add four server variables to the existing app project; control production versus preview scope. | Environment metadata and deployment IDs, without secret values. |
| Supabase | Apply the existing Ticket 187 migration after cutover protection. | Migration ledger and ownership/fence smoke tests. |
| Desktop | Release the implemented broker/consent changes and verify the installed binary. | Release version, installed build, live callback evidence. |
| Nonproduction | Reuse an isolated test environment if one exists; otherwise create a separate agent test project for staging. | No production credentials or hosted production database in uncontrolled previews. |

The production project must differ from both sign-in and standard Calendar projects.
Do not add Cloud Run, GKE, a new database, storage buckets, service accounts, domain-wide delegation, or Workspace MCP.
User Calendar authorization still belongs to the user. Service accounts do not replace it.
Use existing secure credential custody; adding Google Secret Manager is unnecessary if the approved existing storage already meets requirements.

Google requires console creation and editing of OAuth clients. Do not build a Terraform or custom API workaround.
Project creation, IAM, and API enablement may use supported provider tools during implementation.
Source: [OAuth best practices](https://developers.google.com/identity/protocols/oauth2/resources/best-practices).

## Feature preservation contract

| Feature | Required outcome |
|---|---|
| Google sign-in and account sync | Existing identity and sessions remain usable; no provider replacement. |
| Timeline Calendar and travel context | Existing standard grant, selections, refresh, and display remain usable. |
| Behavior tracking, reminders, exports, analytics | No migration or permission change to these features. |
| Offline desktop tracking and Timeline cache | Preserve current local storage and ownership rules. |
| Behavior-only Daily Brief | Preserve functionality; allow a bounded cutover pause only if the barrier requires it. |
| Calendar-enabled Daily Brief | Same read-only feature after new agent consent, calendar selection, and separate AI disclosure. |
| Private workbench | Current/historical Calendar reads use the agent grant. Old Calendar cases remain review-only under current contracts. |
| Disconnect and account deletion | Each grant disconnects independently; account deletion removes both. |

No token migration can eliminate the new consent requirement.
Do not promise uninterrupted Calendar-enabled briefing before users complete that consent.
Workspace administrators can block the agent client. Cadence must report that condition without using the standard grant as a fallback.

Platform scope follows the existing interaction registry and design-system catalog:

- Web: implemented Settings/Calendar/briefing paths plus public legal content and controlled server rollout.
- Desktop: implemented broker and Keychain paths; installed acceptance and distribution remain required.
- Marketing: validate homepage links and public claims against the updated app legal pages; no new feature launch claim before acceptance.
- Future mobile: no implementation; preserve separate standard/agent grant contracts for future clients.

## Task 1: Establish the live release inventory

**Objective:** Identify the exact resources and deployments that can access production Calendar data.

**Files:** Update `docs/qa/2026-10-12-agentic-calendar.md`, `docs/OPERATIONS.md`, and `STATUS.md` with sanitized evidence.

**Decisions:** The authorized owner records project IDs/numbers, public client IDs, classifications, audiences, scopes, verification states, and exact callbacks.
Also record Vercel production/legacy/preview deployment IDs, source revisions, environment scopes, Supabase migration versions, and installed desktop version.
Inventory local workbench processes that use production credentials. They must join the cutover barrier.
Resolve the existing hosted migration discrepancy noted under Ticket 186 before selecting a deployable migration batch.
Do not assume this branch equals production or apply unrelated pending migrations.

**Tests:** Every production credential consumer maps to a reviewed source revision and resource owner.
Project ID strings in environment variables are assertions, not proof of actual Google client ownership.

**Verification:** `git status --short`, `git rev-parse HEAD`, provider deployment readback, and `npm run supabase -- migration list` against the confirmed project.
Expected evidence: a complete inventory without credentials, tokens, authorization codes, or user Calendar contents.

## Task 2: Provision and classify the Google application

**Objective:** Produce an agent client with the correct project boundary and OAuth configuration.

**Files:** Update provider inventory in `docs/qa/2026-10-12-agentic-calendar.md` and configuration instructions in `docs/OPERATIONS.md`.
Read `lib/services/google-calendar-oauth.ts`; no new provider adapter is required.

**Decisions:** Create the project in the intended organization/folder, or record the owner's deliberate no-organization choice.
Grant only the operator access needed to manage this project and verification; avoid organization-wide Owner grants.
Enable Calendar API and record the effective quota limits. Do not copy assumed limits from the old project.

Create the OAuth client manually as a web application for the existing server-side broker.
Select Google's **Use this client for an AI-powered agent** option.
Document the desktop flow in verification: the hosted server owns the secret and token exchange; the desktop receives broker completion.
Do not embed the web client secret in the native application or claim approval of that flow before review.

Request exactly:

- `openid`
- `https://www.googleapis.com/auth/calendar.calendarlist.readonly`
- `https://www.googleapis.com/auth/calendar.events.readonly`

Register `https://app.cadence-me.com/auth/google-calendar/callback`.
Register a legacy callback only if Task 1 proves it remains supported and runs the reviewed source.
No wildcard callbacks or extra browser origins are required by the present server-side exchange.
Use the existing support identity `info@identityscaffolding.com` only after confirming owner access.
Verify ownership of `cadence-me.com` and confirm public homepage, privacy, and terms URLs before submission.

**Tests:** Standard client remains standard. Agent client belongs to the new project and shows agent classification after reload.
Consent requests show only the three declared scopes and the exact callback.

**Verification:** Sanitized Google Console readback of project, API, client, classification, branding, audience, callback, and scope configuration.
Do not record the client-secret creation screen in public evidence.

## Task 3: Reconcile disclosures and obtain production verification

**Objective:** Make public claims and provider approval match the actual data flow.

**Files:** Modify `components/settings/LegalContent.tsx`, `tests/legal-content.test.tsx`, and `docs/user-guide/privacy-and-account.md`.
Review `app/(legal)/privacy/page.tsx`, `app/(legal)/trust/page.tsx`, `apps/marketing/src/pages/index.astro`, and `components/briefing/DailyBriefSettingsPanel.tsx`.
Audit `lib/services/daily-brief-openai.ts`, `lib/services/briefing-bench-store.ts`, and `docs/qa/2026-10-12-agentic-calendar.md`.

**Decisions:** Replace blanket no-AI claims with accurate optional Daily Brief use, separate Calendar consent, and processor disclosure.
Describe the actual fields transferred, purpose, revocation behavior, storage, retention, and deletion.
Confirm deployed OpenAI account/project data controls before making retention or training claims.
Do not infer provider settings from application code.
Retain Limited Use disclosure and review current Google user-data requirements.
Source: [Workspace user-data policy](https://developers.google.com/workspace/workspace-api-user-data-developer-policy).

Audit desktop cached events and the workbench's existing 30-day saved cases against permitted retention and actual response cache directives.
Classify raw Calendar data and derived inputs explicitly. A local file is still retained data.
Any mismatch blocks release and requires a narrowly scoped correction in the owning cache/store and paired tests.
Do not destroy retained cases or silently remove offline functionality while planning that correction.

Submit the new project's sensitive-scope verification with scope justification and a demo of both grants and the AI disclosure.
Existing project verification does not prove the new application's status.
Google's exact Cadence classification answer remains evidence to obtain; the broader agent rule supports the conservative separation.
Source: [sensitive-scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification).

**Tests:** Legal content accurately distinguishes standard display from opt-in AI use and independent disconnect.
Review every existing no-AI assertion rather than merely deleting failing tests.
Marketing links reach the updated legal pages without authentication.

**Verification:** `npm run test -- tests/legal-content.test.tsx`, rendered legal-page inspection, published URL readback, and Google verification status.
External Testing is insufficient for ordinary production use: Calendar refresh tokens expire after seven days in that status.
Production publishing and verification are distinct checks. Source: [OAuth token expiration](https://developers.google.com/identity/protocols/oauth2#expiration).

## Task 4: Bind credentials to the correct deployment environments

**Objective:** Configure the existing server without leaking or replacing existing grants.

**Files:** Review `.env.example`, `lib/services/google-calendar-oauth.ts`, `tests/google-calendar-oauth.test.ts`, and `tests/google-calendar-agent.test.ts`.
Update `docs/OPERATIONS.md` and provider QA evidence.

| Server variable | Value/handling |
|---|---|
| `GOOGLE_CALENDAR_PROJECT_ID` | Verified standard Calendar project ID. |
| `GOOGLE_CALENDAR_AGENT_PROJECT_ID` | Verified distinct agent project ID. |
| `GOOGLE_CALENDAR_AGENT_CLIENT_ID` | Client created in Task 2. |
| `GOOGLE_CALENDAR_AGENT_CLIENT_SECRET` | Secret from Task 2, stored through existing approved credential custody. |

**Decisions:** Preserve `GOOGLE_CALENDAR_CLIENT_ID`, `GOOGLE_CALENDAR_CLIENT_SECRET`, callback settings, encryption key, key ID, and decryption keyring.
Do not rotate encryption keys or identity clients during this migration.
Production values belong only on reviewed production deployments. Staging uses separate credentials and an isolated database.
Use a fixed HTTPS staging callback; arbitrary preview origins cannot start this flow under the existing callback contract.
Never copy refresh tokens or grant selections between projects. Environment updates require deployment and readback.

**Tests:** Missing config, identical project IDs, identical client IDs, invalid callback, and changed agent client fail closed.
Standard credentials continue decrypting and refreshing. Browser/native bundles contain no server secrets.

**Verification:** `npm run test -- tests/google-calendar-oauth.test.ts tests/google-calendar-agent.test.ts` plus secret-free environment metadata and deployed connection-status checks.

## Task 5: Prove the cutover barrier and rollback

**Objective:** Prevent older AI readers from using standard grants during or after migration.

**Files:** Modify `docs/OPERATIONS.md` with the exact deployed controls and evidence.
Review `app/api/advisor/brief/route.ts`, `app/api/advisor/day-context/route.ts`, `app/api/advisor/preferences/route.ts`, and all `app/api/dev/briefing-*` route families.
Review `lib/services/daily-brief.service.ts`, `lib/services/briefing-account-context.service.ts`, `lib/services/briefing-history.service.ts`, and `lib/services/briefing-workbench.service.ts`.

**Decisions:** Prefer a temporary project-level request denial for `/api/advisor/*` and `/api/dev/briefing-*` during cutover.
Verify that the hosting plan supports the control and that it covers all production-backed deployment URLs, not just the custom domain.
Keep old deployment URLs denied after the new canonical deployment opens. Stop production-connected local workbenches during migration.
Wait for existing requests to drain using the verified deployed duration limits; observe completion before changing SQL fences.
The inspected brief route declares 60 seconds, but verify other deployed paths separately.

This barrier temporarily pauses Daily Brief endpoints, including behavior-only requests. Timeline and sign-in stay available.
Do not remove `OPENAI_API_KEY` as the sole barrier: old deployments retain their configuration, and context reads can occur without model execution.
If the host cannot enforce the barrier across all consumers, stop the rollout and implement a reviewed equivalent before migration.
Do not add an untested feature flag that old deployments ignore.

Rollback keeps the additive schema and separation-aware server.
Disable Calendar disclosure, withdraw pending attempts, and remove agent configuration using the repository's migration/configuration workflows.
Preserve the standard connection and behavior-only briefing. Do not roll back to an old AI reader.

**Tests:** Requests to every recorded old hostname cannot reach Calendar/model processing.
Stale clients cannot enable Calendar through standard credentials. In-flight attempts cannot publish after consent withdrawal.
Rollback leaves standard Calendar and sign-in working; no standard-grant fallback occurs.

**Verification:** Authenticated, owner-controlled requests and redacted server evidence prove denial, drain, and rollback on staging.
Record the exact hosting rules and deployment IDs. A written instruction to pause reads does not satisfy this gate.

## Task 6: Complete staged feature and isolation acceptance

**Objective:** Demonstrate preserved functionality with real Google grants on web and installed desktop.

**Files:** Update `docs/qa/2026-10-12-agentic-calendar.md`.
Use `tests/google-calendar-agent.test.ts`, `tests/desktop-calendar.test.ts`, `tests/briefing-history-calendar.test.ts`, `tests/briefing-workbench-account.test.ts`, and `tests/sql/google-calendar-agent-contract.sql`.

**Decisions:** Use an owner-approved test account and private evidence. Perform real model calls only when explicitly authorized for that test.
Test the current released desktop against the candidate server and the new installed desktop build.
Record whether older clients need an update or web-assisted consent; do not promise compatibility from source tests alone.

**Tests:**

- Existing sign-in, standard Timeline reads, selections, reminders, and local offline tracking survive the change.
- New agent consent uses the signed-in Google account; wrong-account, denied consent, missing scope, replay, and expired attempt fail safely.
- Selecting agent calendars alone does not authorize AI processing; separate disclosure is required.
- Calendar-enabled briefing and current/historical workbench reads use agent credentials only.
- Disconnect agent, then verify standard refresh and sign-in; reconnect, disconnect standard, then verify agent refresh and sign-in.
- Revoked refresh tokens, blocked Workspace policy, quota errors, and network failures surface without fallback or retry storms.
- Account deletion removes both grants locally and attempts both provider revocations; provider failure produces existing recovery guidance.
- Old Calendar-derived saved cases cannot rerun; new captures obey current consent and retention rules.

**Verification:** Repository checks below plus real Google consent/refresh/revocation and installed callback evidence.
Mocks and synthetic UI previews do not establish provider or native acceptance.

## Task 7: Execute the migration and controlled release

**Objective:** Activate the separated grant without exposing production to mixed old/new readers.

**Files:** Existing `supabase/migrations/20261012213059_separate_agent_calendar_grant.sql`, `lib/db/database.types.ts`, `docs/OPERATIONS.md`, `docs/qa/2026-10-12-agentic-calendar.md`, and `STATUS.md`.

**Decisions:** Package only reviewed Ticket 187 changes and dependencies; preserve unrelated working-tree edits.
Obtain the independent review still required by the existing acceptance record.
Inventory and verification can proceed while review runs, but public activation depends on both.

Release order:

1. Confirm provider verification, public disclosures, staging acceptance, and a recoverable pre-migration state.
2. Activate Task 5's barrier across every production-backed consumer; drain requests.
3. Apply only the reviewed migration batch with `npm run supabase -- db push` after deployment authorization.
4. Deploy separation-aware server and correct environment scope; verify actual source and schema versions.
5. Preserve/reset the migration's Calendar disclosure withdrawal; do not copy old user consent or selections.
6. Publish/install the compatible desktop release through `docs/DESKTOP_BUILD.md` acceptance.
7. Reopen only the reviewed canonical server. Keep legacy unsafe deployments denied or retire them through an authorized operation.
8. Complete fresh agent consent, selection, and AI disclosure; repeat independent-disconnect checks on production with the approved test account.
9. Record release evidence and rollback readiness before opening broader availability.

Follow the current Vercel Trust dependency: update `CADENCE_TRUST_MARKETING_DEPLOYMENT_ID` and redeploy the app after the relevant main/marketing deployment.
Verify public legal and Trust links against the actual released deployment.

**Tests:** The migration preserves standard grants and behavior-only preferences while withdrawing prior Calendar disclosures and affected pending attempts.
New consent enables the same Calendar briefing feature. No old deployment can bypass separation after reopening.

**Verification:** `npm run supabase -- migration list`, deployed source/environment metadata, production smoke evidence, installed version, and Trust evidence.

## Task 8: Close acceptance and record operating limits

**Objective:** Leave a supportable, evidence-backed release record.

**Files:** Update `docs/qa/2026-10-12-agentic-calendar.md`, `docs/OPERATIONS.md`, `docs/TICKETS.md`, and `STATUS.md`.

**Decisions:** Use existing error-code logs and provider API dashboards; do not add event-content logging or a new monitoring service.
Record counts/rates for consent failure, refresh failure, provider policy rejection, quota failure, and successful standard/agent reads where available.
Confirm effective quota and billing settings before release. Record an owner and recovery steps for credentials and verification requests.

Google currently lists Calendar standard usage without additional cost and future charges above daily thresholds.
New projects use the newer quota model. Treat future pricing as a dependency to recheck, not a permanent free-use promise.
Source: [Calendar quotas and pricing](https://developers.google.com/workspace/calendar/api/guides/quota).

**Tests:** Release evidence distinguishes automated checks, live provider checks, owner decisions, and remaining limitations.
No unresolved required gate is described as complete.

**Verification:** All tasks have actual evidence, accepted ownership, and a tested recovery path before Ticket 187 closes.

## Verification commands for implementation

Use the supported Node 24 runtime and a disposable local database for reset tests.
Do not reset an owner's working database or print production credentials.

```bash
npm run agents:check
npm run interactions:check
npm run resolvers:check
npm run lint
npm run typecheck
npm run test
npm run build
npm run desktop:typecheck
npm run desktop:build
npm run desktop:native:test
npm run design-system:check
npm run marketing:check
npm run marketing:build
npm run supabase -- db reset
git diff --check
```

Run the three SQL contracts listed in `docs/qa/2026-10-12-agentic-calendar.md` against that disposable database with `ON_ERROR_STOP=1`.
Use its actual local connection; do not assume a port from another stack.
Existing QA records scoped lint/test exclusions for unrelated `.claude` worktrees. Reconfirm and report any such exception explicitly.
Do not rerun the full suite for this planning-only document; run it for the reviewed implementation candidate.

## Targets and completion boundary

| Proposed target | Deliverable |
|---|---|
| October 16 | Live inventory, project creation, disclosure changes, and verification submission. |
| October 23 | Staging consent/revocation acceptance and demonstrated cutover barrier. |
| November 6 | Verified production cutover and installed desktop acceptance, if Google review finishes. |
| November 10 | Final classification, source, and project readback before the notice's deadline. |

These are planning targets, not scheduled jobs or guaranteed Google review dates.
The November 11 MCP enforcement and November 12 classification-lock dates come from the received email.
The public sources reviewed confirm separation but do not independently establish those dates.
Cadence currently uses REST; do not claim its Timeline stops working on November 11 because of MCP enforcement.

If verification or required acceptance remains unresolved, keep agent Calendar unavailable and retain standard features and behavior-only briefing.
That contingency preserves the core product but temporarily limits Calendar-enabled AI features; it is not full feature-parity acceptance.
Completion means verified OAuth separation and accurate disclosures, not a blanket certification of every legal or provider requirement.
