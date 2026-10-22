# Ticket 187: agent Calendar grant isolation

Source implementation: October 12, 2026. Release acceptance remains open.
The owner requested implementation of the OAuth assessment. Google has not confirmed Cadence's classification.
This change follows the conservative agent-separation branch and requires a separate Google project.

## Implemented boundaries

- Standard Timeline and agent Calendar use separate connection, selection, credential and one-time attempt records.
- Agent ciphertext binds the OAuth client ID. Changed clients require reconnection; existing standard ciphertext remains readable.
- Agent callback state, desktop Keychain state, refresh credentials and pending range reads are purpose-specific.
- Timeline event endpoints reject agent-purpose requests. AI reads never fall back to standard credentials.
- Daily Brief, current account comparisons and retrospective Calendar reads use only the agent grant.
- Saved pre-separation Calendar cases remain reviewable locally but cannot be sent to the model again.
- Daily Brief SQL preference, admission and completion fences reference the agent connection.
- The migration clears prior Calendar disclosure and affected outstanding brief attempts. It preserves behavior-only preferences and standard grants.
- Account deletion attempts both grant revocations after successful Auth deletion. One corrupt credential cannot suppress the other's revocation.
- Web and linked desktop reuse the Settings panel. Agent selection omits Timeline display controls and requires separate model disclosure.

Primary source files: `lib/services/google-calendar-oauth.ts`, `google-calendar.service.ts`,
`lib/db/google-calendar.repo.ts`, `lib/types/google-calendar.ts`, Calendar API routes,
briefing context/history/workbench services, Settings panels, and desktop Calendar adapters.
Migration: `supabase/migrations/20261022180000_separate_agent_calendar_grant.sql`
(renamed October 22, 2026 from `20261012213059_…`; never applied to hosted).
Generated types: `lib/db/database.types.ts`.
Interaction variants: INT-CALENDAR-001–004 and INT-BRIEF-004 in the existing registry.
The existing design-system manifest and usage inventory include the changed controls.

## Verification

Node 24.19.0 supplied the supported project runtime.

- `npm run agents:check`, `interactions:check`, and `resolvers:check`: passed.
- `npm run typecheck` and `desktop:typecheck`: passed.
- `npm run lint -- --ignore-pattern '.claude/**'`: passed. Unscoped lint includes unrelated nested worktrees and generated artifacts and fails there.
- Full Vitest suite: 2,547 passed, 29 skipped across 283 passing files. Uses `--exclude '.claude/**' --maxWorkers=2 --testTimeout=30000`.
- `npm run build`: passed with network access for the existing Google Font dependency. The sandbox-only attempt failed on that fetch.
- `npm run desktop:build`: passed. Existing bundled `use client` directive warnings remain.
- `npm run desktop:native:test`: 110 passed.
- `npm run design-system:check`: passed, 39 components and 167 usage records.
- The full token-baseline scan is unconfigured: no accepted repository baseline exists, and the scan includes vendored/generated trees.
  No baseline was added. Comparing the five changed product TSX files against HEAD found zero additional raw token violations.
- `git diff --check`: passed.

A separate empty Supabase project, `cadence-agent-187`, replayed all migrations through `npm run supabase -- db reset`.
Only this disposable stack used the verification ports; published ports bound to 127.0.0.1.
Existing owner databases remained untouched. Database types were generated from that replay.
The disposable stack is stopped. Its restrictive proxy denied the CLI cleanup prune; direct readback confirmed no ticket containers remain running. Volumes remain preserved.
These SQL contracts passed with `ON_ERROR_STOP=1` and rollback:

- `tests/sql/google-calendar-contract.sql`.
- `tests/sql/google-calendar-agent-contract.sql`: credential/RLS isolation, wrong identity, replay, late callbacks, independent disconnect,
  standard consent rejection by Daily Brief, agent consent acceptance, and post-disconnect fence rejection.
- `tests/sql/ticket-147-daily-brief-smoke.sql`: existing admission/completion checks, updated to use the agent Calendar fixture.

Browser QA used synthetic fixtures at `http://127.0.0.1:4324/design-system?preview=module.google-calendar-panel`.
Connected, unconfigured and reconnect states rendered correctly. Save and Refresh showed expected feedback.
The agent variant omitted Timeline display controls. At 390×844, the panel measured 356px wide with 356px scroll width.
The disclosure and actions wrapped within the panel. Desktop-width inspection also passed.
Shared DOM tests cover independent selection, absent event refresh, and disconnect.
Screenshot from this session: `/tmp/cadence-agent-calendar-preview.jpg` (synthetic data, temporary artifact).

## Open acceptance gates

1. Independent review. The orchestration skill requires: “Accept a substantial implementation only after the fresh reviewer returns `ship`.”
   Its supported review models are unavailable through the current delegation tool. The parent inspected the diff; this is not independent acceptance.
2. An authorized owner must verify the Google project/client inventory, actual project ownership, agentic classification, callback registrations and scopes.
3. Provision and verify the separate agent project/client. Configure the four documented server variables; keep secrets server-only.
4. Authorize and apply the hosted migration and deploy the matching application. Follow the cutover order in `docs/OPERATIONS.md#agent-calendar-grant-ticket-187`.
5. Complete live web and installed desktop consent, revocation, Workspace-policy, account-deletion and sign-in regression checks.
6. Complete provider verification and review public consent/AI disclosures before public availability claims.

No Google configuration, hosted database, deployment, sign-in client, public release, or real model request changed during implementation.
No MCP integration or broader OAuth scopes were added. No commit or push was performed.

Rollback disables agent configuration and Calendar disclosure while preserving standard grants and the additive schema.
Do not revert to source that sends standard-grant Calendar data to AI.

API-EQUIVALENT COST RECEIPT: unavailable. Parent token usage is unobservable; no subagents ran, and no delegation savings are claimed.
