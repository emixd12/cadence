# Google agentic OAuth notice: assessment and action plan

Cadence needs a classification decision for Daily Brief before November 11, 2026.
Preserve the existing Calendar client while resolving that decision.
Do not mark the shared client agentic merely to preserve hypothetical MCP access.

Research date: October 12, 2026. Historical assessment below records the investigation.
Implementation update: the owner requested implementation on October 12. Ticket 187
implements Branch B conservatively while Google classification remains unverified.
Agent and standard Calendar clients must use different Google projects because revocation is project-wide.
Source implementation does not establish live provider configuration or deployed acceptance.
See `docs/qa/2026-10-12-agentic-calendar.md` and `docs/OPERATIONS.md#agent-calendar-grant-ticket-187`.
Suggested owner: Emiliano Bache Rodriguez. Dates below are proposed targets, not scheduled reminders.

## Evidence and interpretation

The full Outlook message explicitly identifies `cadence-calendar-498717`.
Outlook reports sender `workspace-noreply@google.com` and receipt at 15:15 EDT on October 12.
Subject: “[Action Required] Mark AI agent OAuth clients as agentic for Google Workspace MCP by Nov 11, 2026”.
The retrieved message extends beyond the supplied screenshot. Mail authentication headers were not available in the retrieved result.

The notice states:

- October 12: developers can classify existing OAuth clients as agentic.
- November 11: Workspace MCP rejects calls authorized through non-agentic clients.
- November 12: existing clients' classifications become permanent; changing classification requires a new client ID.
- Classification work includes AI agents that currently use only Workspace REST APIs.
- Mixed applications need separate clients for agent and ordinary traffic.

The dates come from the email. The public documentation checked today confirms client classification and separation, but not these dates.
Google describes agent clients as retrieving context or performing actions for users.
It requires separate client IDs for standard and agent workflows.
Classification does not grant extra scopes or replace consent and verification.
Source: [Google: Manage OAuth Clients, AI agents section](https://support.google.com/cloud/answer/15549257?hl=en).

**Source-check finding:** Cadence uses Calendar REST endpoints, with no Workspace MCP calls found in the inspected runtime paths.
The announced MCP rejection therefore has no identified direct failure path in the inspected source.
This is not proof that Daily Brief qualifies for the notice's non-agent exemption.

**Interpretation:** Daily Brief warrants agent classification review because Cadence retrieves Calendar context for model-generated recommendations.
Its model cannot call tools or execute changes. Google has not classified this exact architecture in the evidence reviewed.
Treat agent classification as the working planning assumption until Google confirms otherwise.

## Cadence inventory

| Surface | Source evidence | Implication |
|---|---|---|
| Web Google sign-in | `app/auth/google/route.ts`; separate sign-in project recorded in `docs/OPERATIONS.md` | Keep identity sign-in separate from this Calendar review. |
| Desktop Google sign-in | `apps/desktop/src/account/auth.ts` | Uses Supabase Google sign-in; no agent classification change proposed. |
| Calendar consent | `lib/services/google-calendar-oauth.ts` | One configuration; OpenID, calendar-list read-only, and events read-only scopes. |
| Timeline Calendar reads | `lib/services/google-calendar-provider.ts:33`, `:541`; `google-calendar.service.ts` | Calls `www.googleapis.com/calendar/v3`, not Workspace MCP. |
| Daily Brief Calendar context | `lib/services/advisor-day-context.service.ts`, `briefing-account-context.service.ts` | Uses the same Calendar connection and credentials as ordinary display. |
| Private workbench Calendar context | `lib/services/briefing-history.service.ts`, `briefing-workbench.service.ts` | Include current and historical account reads in classification and isolation work. |
| Model execution | `lib/services/daily-brief-openai.ts:16` | Explicitly sets `tools: []` and `tool_choice: "none"`; bounded facts enter the model. |
| Desktop Calendar display | `apps/desktop/src/calendar/google-calendar.ts` | Uses the hosted broker; no separate Google Calendar secret ships in desktop. |
| Credential persistence | `lib/db/google-calendar.repo.ts`, `lib/types/google-calendar.ts` | One connection per owner; no standard-versus-agent credential discriminator. |

Repository evidence records this Calendar client:
`567431620531-jilr3qg9oob1pbbvfhqkdnh797ep21uf.apps.googleusercontent.com`.
Reference: `docs/qa/google-calendar-capabilities.md`.
This public identifier is not a client secret.

**Live verification limit:** the available Chrome account received a project-access denial.
Its account menu did not show the documented support identity.
The live classification, client inventory, enabled MCP services, and deployed Daily Brief configuration remain unverified.
No access request, login, setting change, or model request was made.

## Implications

1. Ordinary Calendar display has no demonstrated November 11 MCP dependency.
2. Marking the shared client agentic would classify ordinary Calendar traffic with agent traffic.
   That creates an avoidable exposure to Workspace administrators' agent restrictions.
3. A separate client is insufficient unless runtime requests and stored grants actually use the intended client.
   Replacing the global client ID would also risk breaking existing refresh flows.
4. New agent consent may require user interaction and provider verification work.
   Existing Calendar approval does not establish acceptance of a changed AI workflow.
5. Client separation within one project does not guarantee independent revocation.
   Google documents project-wide invalidation of a user's grants across clients when revoking access.
   Decide whether coupled disconnect behavior is acceptable before choosing the same project.
   Source: [Google web-server OAuth: revocation](https://developers.google.com/identity/protocols/oauth2/web-server#tokenrevoke).
6. November 12 does not eliminate future MCP adoption. It changes the migration path to a newly classified client.

## Proposed sequence

| Target | Action | Completion evidence |
|---|---|---|
| October 16 | Inspect the Calendar project using its authorized owner session. Record client IDs, classifications, callbacks, scopes, verification status, and enabled APIs. Confirm which source revision and briefing features production runs. | Sanitized inventory; no secrets or event contents. |
| October 16 | Obtain Google's classification of the bounded Daily Brief workflow. Use the unsent support text below. | Written answer or an explicit unresolved classification entry. |
| October 23 | Choose the applicable branch below. Decide project placement and disconnect behavior if separation is required. | Reviewed decision with named owner and implementation scope. |
| November 6 | Complete any required separation and testing, leaving several days before enforcement. | Web and installed-desktop acceptance; classification readback; rollback evidence. |
| November 10 | Recheck the exact clients and record final disposition before November 11 enforcement. | Either supported exemption, verified separation, or the fallback below. |

**Branch A — Google confirms this bounded workflow is non-agentic:** retain the existing client and REST implementation.
Record the answer and the trigger for reassessment: autonomous tools, new agent workflows, or Workspace MCP adoption.

**Branch B — Google classifies Daily Brief as agentic:** retain the standard Calendar client and create a dedicated agentic client.
Route AI-related Calendar access exclusively through that grant. Keep the existing read-only scopes.
Do not add MCP; classification can be addressed without replacing the REST provider.

**Fallback — classification or separation remains unresolved:** propose temporarily excluding Google Calendar from AI inputs and AI-specific retrieval.
Keep ordinary Calendar display and behavior-only briefing available where existing contracts allow them.
Cover private workbench reads, saved Calendar-derived inputs, caches, and pending generation; do not only hide a UI checkbox.
This is a proposed operational choice, not an automatic response to the email or a change performed during this investigation.

## Conditional implementation scope

Branch B needs a small vertical slice, not a credentials-only console change:

- Add explicit standard/agent binding to OAuth attempts, encrypted grants, connection state, and token refresh selection.
- Preserve the existing standard grant. Obtain agent consent through its own client rather than reusing standard refresh tokens.
- Bind encrypted credentials to their client/purpose. Retain same-account, PKCE, expiry, generation, and selection checks.
- Separate pending reads and caches by purpose/client. Agent failure must never fall back to the standard grant.
- Update daily context, workbench current reads, historical reads, and saved-input authorization together.
- Specify disconnect, revocation, deletion, pending-result withdrawal, and rollback for both grants.
- Reuse the existing provider parser and read bounds; no duplicated Calendar domain logic.

Expected touchpoints: `lib/services/google-calendar-oauth.ts`, `google-calendar.service.ts`, `advisor-day-context.service.ts`,
`briefing-account-context.service.ts`, `briefing-history.service.ts`, `briefing-workbench.service.ts`, and callback/API callers.
Persistence changes reach `lib/db/google-calendar.repo.ts`, `lib/types/google-calendar.ts`, tracked Supabase migrations, and generated database types.
Existing fixtures and tests should gain grant-isolation cases rather than a parallel test framework.

The current plan in `docs/plans/first-external-consumer.md` assumes no additional delegated OAuth flow.
Branch B changes Calendar authorization assumptions. Update that plan and the relevant product/security docs before implementation.
This does not reintroduce the abandoned external-advisor account or public MCP product.

Original sequencing required classification before implementation. The owner subsequently
authorized implementation; Ticket 187 records the conservative separation assumption.
Google classification remains a provider rollout gate.
Update `docs/DATA_MODEL.md`, `docs/OPERATIONS.md`, provider QA, and deployment documentation with any implemented changes.
Review disclosures for new consent or onward-use changes.

| Platform | Required impact handling |
|---|---|
| Web | Preserve Timeline and sign-in. Add agent consent/status only if required; verify narrow/mobile layout. |
| Desktop | Preserve local tracking, ordinary broker access, and offline cache. Verify agent consent handoff and linked briefing on an installed build. |
| Marketing | No immediate change. Update Calendar/AI disclosures only when implementation or availability changes. |
| Future mobile | No implementation. Document the shared grant distinction for future clients. |

Use `interaction-registry.json` and the existing design-system catalog for any changed controls.
Do not register planned interactions as implemented. Use the required UI skills before editing consent UI.

## Acceptance and rollback

Verify standard Calendar reads continue when agent access is absent, denied, expired, or administrator-blocked.
Verify AI reads cannot use the standard grant, including retries, cache hits, and workbench history.
Verify same-account enforcement, callback replay rejection, refresh isolation, deletion, and revocation semantics.
Verify model requests contain no credentials and no tools.
Use synthetic tests first. Live model acceptance retains the existing owner-run and disclosure requirements.

Run all required repository checks for implementation: `agents:check`, `interactions:check`, `resolvers:check`,
`lint`, `typecheck`, `test`, and `build`. Add desktop checks and clean local migration verification when those surfaces change.
Check web and installed desktop before declaring completion; source tests do not establish deployed behavior.

Rollback disables the new AI Calendar path while preserving the standard connection and tracking records.
Do not revoke or delete the standard client as a rollback step.
After November 12, do not rely on reversing classification; use the preserved standard client and disable agent use.

## Unsent support question

Project: `cadence-calendar-498717`.
OAuth client: `567431620531-jilr3qg9oob1pbbvfhqkdnh797ep21uf.apps.googleusercontent.com`.

Cadence displays user-selected Calendar events through read-only REST APIs.
An optional Daily Brief also retrieves bounded Calendar facts for an OpenAI-generated daily recommendation.
The model receives no Google credentials, has no tools, and cannot execute changes.
Both workflows currently use the same Calendar OAuth client. Cadence does not call Workspace MCP servers.

Does Daily Brief require an agentic client under your October 12 notice, despite its fixed retrieval and no-tool design?
If so, must its context reads use a separate grant even without MCP?
Please confirm classification for developer-only historical comparisons and Calendar-derived cached inputs as well.
Does adding that client within our verified Calendar project require further review or renewed user consent?
Which administrator restrictions apply to agentic clients using REST, and what migration behavior should existing users expect?

This text was prepared locally. No support message was sent.

## Checks performed for this assessment

Read the full Outlook notice, current Google documentation, Cadence governance, and affected source paths.
Confirmed the public classification guidance independently of the email's redirect links.
Attempted read-only Cloud Console inspection; the available account lacked project access.
Reviewed the saved plan for source links and local file references.
No runtime code, OAuth configuration, credentials, database schema, or deployed behavior changed.
Runtime tests and builds were not run for this research-only document.
