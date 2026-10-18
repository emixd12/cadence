# Cadence directory submission packet — Ticket 231

Prepared October 18, 2026. **Unpublished draft for owner review.** This packet
does not authorize submission, legal publication, deployment, provider changes,
or a production reviewer login. Ticket 232 owns hosted and live-client acceptance.

## Readiness and approval record

| Gate | Current state | Owner action before submission |
|---|---|---|
| Legal text | Proposed text below; served Privacy and Terms unchanged | Approve text, effective date, and publication change |
| Personal health data | Possible in user-authored Behaviors and notes | Confirm classification, lawful disclosure, and directory eligibility |
| Reviewer sign-in | Google only; unattended reviewer access unverified | Choose and verify the reviewer-account plan below |
| Retention | Local SQL implements expiry/purge; hosted maintenance unverified | Schedule and verify purge before publishing retention claims |
| Deployment | Local implementation only | Complete Ticket 232 for web, marketing, and live clients |
| Review evidence | Cases and recording script prepared, not executed in live clients | Run cases, record results, supply accessible video URL |
| Publisher | Existing legal operator: Identity Scaffolding LLC | Confirm legal identity, company website, support contact and portal authority |

Platform impact: web gets the verification route and proposed legal changes;
marketing gets listing copy and links to Ticket 229 developer documentation.
Desktop and future mobile have no implementation changes. Account-free desktop
data cannot reach MCP; linked desktop data is available only after hosted sync.
Existing interaction evidence remains in `interaction-registry.json`; this
ticket adds no app interaction or reusable UI.

## Listing copy

Copy only the fenced text, without the fences. Use the same name in both directories.

Name:

```text
Cadence
```

One-liner (limit 200 characters):

```text
Read your Cadence Behaviors and Timeline, review your tracking history, and make changes you confirm in your AI client.
```

ChatGPT short description (limit 30 characters):

```text
Track and review routines
```

Description (shared draft; limit 2,000 characters):

```text
Connect your Cadence account to review recurring Behaviors, scheduled Occurrences, notes, status history, recorded time, and adherence summaries in your AI client.

Ask what is scheduled today, review older Unresolved Occurrences under Needs decision, or find a note. Completed, Not Completed, and Unresolved remain separate. Unresolved Occurrences do not count as failures in adherence calculations.

Choose read access alone or add separate permissions to mark Occurrences and edit notes, or create, edit, archive, and restore Behaviors. Ask for each change and review it before confirming. The integration provides no delete tool.

Cadence requires a hosted account with Google sign-in. Linked desktop records become available after synchronization. Account-free desktop records are unavailable. Disconnect a client in Settings > Connected apps to stop future access; copies already received remain subject to that client's policies.

Google Calendar data, travel routes and device location, Daily Brief content, account email, and credentials are excluded. User-authored Behaviors and notes can contain sensitive personal information. Cadence is a personal record, not medical advice, medication dosing, or an emergency service.
```

Proposed category: **Productivity**. Use that title if available in each portal;
otherwise select its closest personal-recordkeeping category. Avoid medical or
clinical claims. Claude permits one to five categories; one is sufficient here.
Publisher: **Identity Scaffolding LLC**, subject to owner identity verification.
Proposed Claude listing slug: `cadence`; confirm before publishing because the
published slug is permanent. These fields follow the
[Claude submission form](https://claude.com/docs/connectors/building/submission).

### URLs and assets

| Field | Target |
|---|---|
| Website | `https://cadence-me.com` |
| Documentation | `https://cadence-me.com/developers` (Ticket 229) |
| Privacy | `https://app.cadence-me.com/privacy` |
| Terms | `https://app.cadence-me.com/terms` |
| Support | `https://cadence-me.com/developers#support` (Ticket 229) |
| Support email | `privacy@identityscaffolding.com` (existing legal contact; owner confirms operational coverage) |
| Sign-in | `https://app.cadence-me.com/login` |
| MCP server | `https://app.cadence-me.com/mcp` |
| OAuth issuer | `https://app.cadence-me.com` |
| Authorization metadata | `https://app.cadence-me.com/.well-known/oauth-authorization-server` |
| Resource metadata | `https://app.cadence-me.com/.well-known/oauth-protected-resource/mcp` |
| Challenge | `https://app.cadence-me.com/.well-known/openai-apps-challenge` |
| Source | `https://github.com/emixd12/cadence` |

Ticket 230 package sources: `integrations/claude-plugin/` and
`integrations/chatgpt-plugin/`. Shared workflows live in `integrations/skills/`.
Run `node scripts/check-plugins.mjs`, then `node scripts/package-plugins.mjs`
from the approved release tree. Generated ZIPs are
`integrations/.artifacts/cadence-claude-plugin-1.0.0.zip` and
`integrations/.artifacts/cadence-chatgpt-plugin-1.0.0.zip`. Record their hashes
before owner upload. These are local artifacts, not published download URLs.
The shorter packaged description covers the same scope as the longer listing
draft above; reconcile owner-approved edits in the package before upload.

These are intended production targets, not evidence that new routes are deployed.
The owner must open each public URL without a session before submitting.
Support needs a working HTTPS page; the email alone is not the ChatGPT support URL.
Do not list an unpublished legal draft as the current policy.

Reuse `apps/marketing/public/brand/cadence-logo-512.png` for the primary icon and
`cadence-logo-128.png` for a compact composer icon. Prepare square PNGs at their
native 512×512 and 128×128 sizes, without stretching or embedded text added for
this submission. These dimensions are Cadence's asset choice, not a claimed
directory minimum. Check legibility on light and dark backgrounds. Ticket 230
packages the assets; confirm its final paths before upload. The official pages
require an icon but do not specify a universal raster size for this connector.
Use the portal's current asset validator if it requests another size.
Cadence has no MCP App widget, so Claude's MCP App carousel requirement does not apply.

## Unpublished Privacy draft

Publication target: `app/(legal)/privacy/page.tsx`, whose text lives in
`components/settings/LegalContent.tsx` under `LEGAL_PAGES.privacy` and also
appears in Settings. **Do not edit the served component until owner approval.**
Replace the existing **Exports and external AI services** section with:

> Cadence provides downloadable exports and prepared prompts. You decide whether
> to share an export or prompt with another service.
>
> You can also connect an AI client, such as Claude or ChatGPT, to your hosted
> Cadence account. When you authorize the connection and direct the client to
> use Cadence, Cadence sends requested tracking records to that client and its
> provider. The client's terms, privacy policy, retention settings, and data-use
> controls govern its processing of information it receives.
>
> Read permission covers active and archived Behaviors, descriptions, schedules,
> time entries, categories, Occurrences, statuses, status history, Occurrence
> notes, archive notes, time sessions, adherence summaries, reminder settings,
> and your profile timezone. Responses also include record identifiers,
> revision and freshness information, and a client-specific account reference.
> Behaviors and notes can reveal personal health information or other sensitive
> information you enter. Read access is not limited to records you mention in
> one conversation. Connect only clients you trust with these records.
>
> Google Calendar data and its connection are never shared through MCP.
> MCP also excludes travel settings, route estimates, device location, Daily
> Brief content and preferences, reminder delivery logs, push subscriptions,
> import-run internals, account email addresses, and credentials. A user can
> still type sensitive information into a Behavior or note; Cadence does not
> automatically remove that information from tracking records.
>
> Read access is required for a connection. You may separately allow the client
> to mark Occurrences and edit their notes, or create, edit, archive, and restore
> Behaviors. MCP provides no delete operation. You direct and confirm changes
> in the AI client. Cadence checks the permissions granted to the connection;
> the AI client controls its per-action confirmation experience.
>
> Cadence records integration activity to show access and changes and investigate
> problems. This record contains the client, operation, record identifiers,
> time, outcome, and error code. It does not contain note text, full request
> or response content, or authentication secrets. The activity retention policy
> is 90 days. Older entries disappear from the activity view and are deleted
> by maintenance, or when further activity triggers cleanup for that account.
> Cadence separately stores write results for retry protection for a 24-hour
> validity period. Those results may contain the tracking content returned by
> the operation. Maintenance deletes expired retry records.
>
> Disconnect a client in Settings > Connected apps to revoke that connection.
> Cadence rejects its next access or refresh request. Disconnecting does not
> delete tracking records, erase completed changes, or retrieve copies already
> received by the client. Contact the client's provider to manage those copies.
> Deleting your Cadence account removes its live integration records with the
> account. Backup remnants follow the retention periods in this policy.
>
> Cadence does not sell your personal data. Cadence shares tracking records
> through MCP to carry out the access you authorize and the requests you direct.
> Account-free desktop records stay on the device and are unavailable through
> MCP. Linked desktop records become available after synchronization.

Add the following rows to the existing **Retention** table when approved:

| Record | Retention period | Active control |
|---|---|---|
| Integration activity | 90-day policy; older rows removed by cleanup | Last 90 days visible; scheduled purge and activity-triggered cleanup |
| Integration retry results | 24-hour validity; expired records removed by maintenance | Expiry checked before reuse; scheduled purge |
| Connection grants and token hashes | Until account deletion or expiry cleanup as applicable | Disconnect invalidates access immediately; deletion removes account-owned records |

Owner review notes: verify hosted purge cadence and backup settings before
publishing. Do not promise physical deletion at exactly 90 days or 24 hours
without deployment evidence. See `oauth_purge_expired`,
`integration_record_activity`, and `docs/DATA_MODEL.md` for the actual controls.
Preserve unrelated Calendar/travel disclosures. The existing broad claim that
Cadence never sends behavior data to AI must be replaced, not left beside this
section. This draft concerns MCP; review separately against any enabled Daily
Brief disclosure before approving the complete policy. The current contact and
operator details need owner confirmation, not a new legal-entity assumption.

## Unpublished Terms draft

Publication target: `app/(legal)/terms/page.tsx`; content owner is
`components/settings/LegalContent.tsx`, `LEGAL_PAGES.terms`.
Replace **Exports and external prompts** with **Exports and connected AI clients**:

> Cadence provides exports and prepared prompts. You are responsible for
> safeguarding downloaded files and deciding whether to share them.
>
> You may authorize an external AI client to access your hosted Cadence account
> through MCP. You choose the client and grant its permissions. You direct the
> requests and review changes before confirming them in that client. Read
> permission permits access to tracking records, including notes and history;
> write permissions separately allow Occurrence changes or Behavior changes.
> There is no MCP delete operation. Calendar data is never shared through MCP.
>
> A client may misunderstand a request or produce incorrect information.
> Check the Behavior, Occurrence, date, and proposed values before confirming a
> change. You remain responsible for the declarations and instructions you
> provide. Cadence does not verify that a Behavior occurred and does not turn
> an Unresolved Occurrence into an automatic failure.
>
> External AI clients operate under their own terms and privacy policies.
> Cadence's Privacy Policy describes the data disclosed through MCP, integration
> activity retention, and your controls. Cadence does not sell your personal data.
> Disconnect in Settings > Connected apps to stop further access by that
> connection. Disconnecting does not reverse earlier changes or delete copies
> that another service already received.
>
> Cadence remains a personal recordkeeping service. Neither this connection nor
> an AI response makes it medical advice, a dosing system, an emergency service,
> or a substitute for a qualified professional. Do not use it for safety-critical
> decisions or share records you are not entitled to disclose.

Keep the existing account eligibility, limitation, dispute, and contact sections.
Owner approval must cover the complete resulting policy and effective date;
these draft additions make no claim of legal or directory approval.

## Data-handling answers and acknowledgments

| Portal question | Proposed answer and evidence |
|---|---|
| Whose API? | Our own Cadence API, on `app.cadence-me.com`; operations use Cadence services and account-scoped Supabase RLS. No third-party API proxy through MCP. |
| Reads or writes? | Ten reads and six scoped writes; `docs/MCP_CONTRACT.md` defines all 16. Read required; two independent optional write permissions. |
| Personal health data? | **Possible; owner must confirm.** Users can track medical Behaviors and enter health information in notes. Do not answer No merely because Cadence is not a medical dosing app. |
| Sponsored content? | No sponsored content, ads, or recommendation payments in these tools. Owner confirms business practices. |
| Commerce / money transfers? | No checkout, payments, subscriptions, financial transfers, or commerce tools. |
| AI media generation? | None. MCP calls stored tracking operations, not a model or media generator. |
| Conversation collection? | No access to chat history, memory, unrelated files, or full conversations. Tools receive only their declared arguments. User-requested notes are stored as tracking data. |
| Credentials? | OAuth handles authorization outside tool arguments. Never ask the model or user chat to supply passwords, codes, API keys, or bearer tokens. |
| Sale / onward sharing? | No sale. Authorized tool results go to the connected client; client retention is independent. Hosting processors remain as disclosed in Privacy. |
| Deletion / revocation? | Account deletion cascades live integration rows; Settings disconnect stops next request. No MCP deletion tool and no deletion of external-client copies. |

**OpenAI eligibility is unresolved.** Its
[plugin guidelines](https://developers.openai.com/plugins/plugin-guidelines)
prohibit processing protected health information (PHI). They also restrict
regulated sensitive data unless necessary, adequately consented, and disclosed.
Personal health information and regulated PHI are not interchangeable labels.
Cadence's free-text records and unrestricted tracking reads cannot prove the
absence of either. The owner must confirm applicable data classification and
obtain policy/legal guidance or change the approved scope before submitting.
A disclaimer or synthetic demo does not resolve this production-data issue.

Owner acknowledgment checklist, to review in the live portals:

- [ ] Accept directory terms and policies after checking the complete deployed service.
- [ ] Confirm first-party API ownership and rights to the Cadence name and assets.
- [ ] Confirm no financial transaction or AI media generation tool exists.
- [ ] Confirm descriptions contain no hidden instructions or prompt-injection behavior.
- [ ] Confirm conversation collection stays limited to tool arguments needed for the request.
- [ ] Confirm public setup documentation and approved Privacy and Terms are available.
- [ ] Resolve the health-data question and any applicable consent requirements.
- [ ] Verify all tool titles, annotations, error behavior, and account boundaries in live clients.

These are proposed answers, not checked compliance attestations. Claude reviews
first-party access, tool behavior, prompt safety, and populated reviewer accounts;
test every tool in Inspector and Claude before attesting. See
[Claude review criteria](https://claude.com/docs/connectors/building/review-criteria).

## Reviewer-account plan

Both submissions should provide a populated synthetic account that reviewers can
access without an owner present, MFA approval, or email/SMS codes. OpenAI states
this explicitly; Claude requires usable credentials and complete test instructions.
Cadence currently supports Google sign-in only. `/auth/test-login` is local-only
and must remain disabled in production. No reviewer credentials belong in this
file, Git, plugin ZIPs, demo footage, or chat.

| Option | Practical tradeoff | Decision |
|---|---|---|
| Dedicated synthetic Google account | Uses existing sign-in. Google may still demand device, recovery, or risk challenges even without configured MFA; unattended access cannot be guaranteed. | Try only after owner approval; prove a fresh-browser flow and seek directory acceptance. Never weaken the owner's account. |
| Dedicated reviewer sign-in implementation | Can provide predictable access, but adds a production authentication path and requires security design, expiry, isolation, audit, tests, and owner approval. | Separate future ticket; do not ship a bypass or promote local test-login. |
| Portal-approved review arrangement | Ask each review team whether its process can accommodate the existing Google flow. No auth code change, but acceptance and timing are unknown. | Recommended first step, alongside a synthetic Google account trial. Hold submission if unattended access cannot be verified. |

The owner should choose the least intrusive accepted option. Do not submit a
known challenge-prone account or invent a username/password flow that Cadence
does not have. Never disable MFA for the owner's Google account.

After owner approval, prepare separate synthetic accounts for each directory
to prevent reviewer writes interfering. Set timezone America/New_York. Use only
invented, nonmedical data. Record the seed date and reset instructions privately:

- Category **Review examples**.
- Daily **Review walk**, 09:00, spanning the previous week and today.
- **Review reading**, 19:00 on Monday, Wednesday, and Friday.
- Archived **Review stretch**, with archive note **Old demo schedule**.
- Exactly one yesterday Occurrence left Unresolved; at least one Completed and
  one Not Completed in the past week. Add **Review sample note** to one record.
- A stopped time session on a Completed Occurrence for detail inspection.
- Disable browser and email reminders for every fixture. Do not connect Calendar.

Use the web UI to seed and reset data; record actual IDs only in private reviewer
instructions. Refresh relative-date fixtures just before review. Provide the
login URL, chosen credential delivery, Google steps, account timezone, seed date,
and **no organization/workspace selection required** in each portal's private
review fields. Rotate credentials and revoke grants after review, retaining the
account only as long as future review requires. Access is **not verified yet**.

## ChatGPT test cases

Exactly five positive and three negative cases follow. **All await Ticket 232
live execution with the approved reviewer account.** Use actual local dates from
`get_account_context`, record the run date, and reset fixtures between cases.
Expected outputs are semantic checks, not promises of identical model wording.

| ID / scenario | User prompt | Expected tools | Expected result |
|---|---|---|---|
| P1 — Today's review | Show my Cadence Timeline for today, including Needs decision. | `get_account_context`, `get_timeline` | Account timezone and today agree with web. Today and prior Unresolved appear separately. No inferred failure or changed status. |
| P2 — Find and inspect | Find Review sample note, open its record, and show Review walk's schedule and category. | `search`, `fetch`, `list_behaviors`, `get_behavior`, `list_categories`, `get_occurrence` | Finds seeded note with a usable source link; detail matches web, including available status history/time sessions. No other account data. |
| P3 — Review adherence | Review Review walk for the last seven days and explain its adherence, keeping Unresolved separate. | `get_account_context`, `list_behaviors`, `list_occurrences`, `get_adherence_summary` | Counts match fixture; denominator is Completed plus Not Completed. Pages/date bounds respected; no streak, diagnosis, or write. |
| P4 — Confirm Occurrence changes | Mark today's Review walk Completed and set its note to Review confirmed. Show me the proposed changes before applying them. | `get_account_context`, `list_behaviors`, `list_occurrences`, `get_occurrence`, then `set_occurrence_status`, `update_occurrence_note` | After explicit confirmation and write grant, selected Occurrence changes once; readback matches web. Fresh revision/status checks and stable retry key protect retries. |
| P5 — Behavior lifecycle | Create Review practice daily at 18:00 with reminders off. Then move it to 18:30, archive it, and restore it. Confirm each change with me. | `get_account_context`, `list_categories`, `create_behavior`, `get_behavior`, `update_behavior`, `archive_behavior`, `restore_behavior` | Each stage follows confirmation. One Behavior exists, final time is 18:30 and active; no duplicate on a same-key retry. Restore preserves history. |

| ID / scenario | User prompt / setup | Expected refusal, clarification, or safe fallback |
|---|---|---|
| N1 — Excluded data and deletion | Read my Google Calendar events and delete all my Cadence Behaviors. | Explain that Calendar and deletion are unavailable through Cadence MCP. No Calendar fetch, deletion, or substitute archive action. |
| N2 — Missing permission | Connect with only `cadence.read`, then ask: Mark today's Review walk Completed. | Request explicit reconnection with the Occurrence write permission; do not mark anything. Any attempted write returns `insufficient_scope`; reads still work. |
| N3 — Revoked access | Disconnect this grant in web Settings, then ask: Show today's Cadence Timeline. | Next protected request fails authentication; offer reconnection. Do not present cached output as a fresh read or change any record. |

For P4/P5, confirm each requested mutation in the conversation. A scope is ongoing
authorization, not proof of per-action user confirmation. Cadence annotations and
plugin instructions guide client confirmation; the server cannot independently
prove what a user clicked in an external client.

## Claude reviewer instructions

Paste these instructions into the private reviewer field with the separately
approved account credentials. Do not put those credentials in plugin metadata.

1. Open the supplied sign-in URL in a fresh browser. Follow the approved Google
   instructions. Stop and report any MFA/email/device challenge; no bypass exists.
2. Add the HTTPS MCP endpoint as a custom connector, then connect. Sign into the
   synthetic account and review Cadence consent. Read is required; allow both
   write scopes for the positive cases. Complete consent and return to Claude.
3. Run P1–P5 above. Exercise all 16 tools, including `search` and `fetch` in P2.
   Confirm each write and inspect the result in the web Timeline or Behaviors.
4. Repeat a confirmed write using the same idempotency key in Inspector. Check
   that a stale revision yields `conflict`, without a second mutation. Use the
   official SDK response to inspect structured tool errors; Inspector 2.11.0
   can label them as successes (see `mcp-server.md`).
5. Run N1–N3; reconnect read-only for N2 and disconnect that grant for N3.
   Verify Settings activity contains client/operation/outcome metadata, not notes.
6. Repeat with the packaged Claude plugin once Ticket 230's package is installed.
   Use the developer documentation for install commands. Record each tool outcome,
   date, deployed SHA, client version and test account alias without secrets.

Do not claim these instructions have passed until Ticket 232 records live evidence.
Claude Code package installation and the Claude Connectors Directory listing are
separate distribution steps; submitting one does not submit the other.

## Demo recording script

Record with synthetic accounts only. Hide credentials, OAuth codes, tokens, and
browser developer tools. Use captions for scope choices and confirmations.

| Approximate time | Scene and narration |
|---|---|
| 0:00–0:30 | Introduce Cadence as a personal Behavior record. Show synthetic Behaviors and the three stored statuses. |
| 0:30–1:10 | Connect in ChatGPT. Show consent, read scope and optional writes; state that Calendar is excluded. |
| 1:10–2:10 | Run P1–P3: Timeline, note search/detail, and adherence with Unresolved excluded. |
| 2:10–3:10 | Run P4; show proposed status/note changes, confirmation, and web readback. |
| 3:10–4:10 | Run P5 with confirmation at each step and final restored Behavior. |
| 4:10–5:10 | Run N1–N3; show unsupported requests, read-only denial, and revoked-access rejection. |
| 5:10–5:40 | Show developer/support pages and approved legal pages; explain client-copy retention and sign out. |

Recording URL: **pending owner recording and approved hosting**. Do not invent
a URL or upload footage under this ticket. Test access from a signed-out browser.

## Draft release notes

Initial Cadence MCP integration, contract 1.0.0: ten account-scoped read tools
and six optional write tools, OAuth consent, Connected apps revocation, and
metadata-only activity history. Supports structured recurring Behaviors,
Occurrence status and notes, search, detail retrieval, and adherence summaries.
Includes Claude and ChatGPT plugin packages and public developer documentation.
Google Calendar, travel, Daily Brief, and account-free desktop data are excluded.
No delete tool, MCP App widget, medical dosing, or autonomous Cadence agent.

These notes describe the candidate release. Local checks do not establish live
client compatibility, production deployment, directory listing, or approval.

## Owner-only execution sequence

Do not execute these steps under Ticket 231. Record approvals, target identities,
commit SHAs, sanitized evidence, and rollback decisions in Ticket 232.

1. **Approve release scope.** Approve the legal drafts, effective date, health-data
   eligibility answer, publisher details, support coverage, and reviewer plan.
   Reconcile every older no-AI-sharing claim in served legal content before MCP
   publication. Approve staging targets and exact migration/deployment scope.
2. **Verify OpenAI identity.** In the OpenAI Platform, select the owning
   organization/project. An organization owner uses Organization settings →
   General to complete business verification for Identity Scaffolding LLC, or
   confirms the appropriate verified identity. Give the submitting member Apps
   Management Write if needed. Confirm the displayed publisher before upload.
3. **Apply hosted migrations only after authorization.** From the approved SHA,
   confirm the linked Supabase project matches the authorized staging target.
   Run `npm run supabase -- migration list`, then
   `npm run supabase -- db push --dry-run`. Review the exact pending list; stop
   for unexpected migrations. After approval, run `npm run supabase -- db push`
   without seed data, then repeat `migration list`. Never reset hosted data.
   The MCP candidate adds the `20261018160000`, `20261018164000`,
   `20261018170000`, `20261018180000`, and `20261018190000` migrations; verify
   filenames and dependencies against the target rather than assuming all are pending.
4. **Import the signing key.** Follow `docs/SUPABASE_WORKFLOW.md#hosted-import-runbook-owner-action`.
   On a trusted machine generate an ES256 private JWK into protected storage.
   Use `npm run supabase -- gen signing-key --algorithm ES256` with output
   directed to that protected location, never chat or captured terminal logs.
   In Supabase JWT signing keys, migrate legacy signing if required, import the
   JWK as standby, and match its `kid`. Set the matching server secret in the
   authorized Vercel environment. Rotate the imported key to **current**;
   standby keys do not work. Account for the documented JWKS cache interval.
   This changes signing for normal Auth sessions too. Preserve the previous key
   until its sessions expire plus the documented safety margin. Record only `kid`
   and state, never key material. Prove two-user RLS on staging.
5. **Set Vercel variables.** Use existing project `cadence`, Settings → Environment
   Variables, selecting only the authorized Preview/staging environment first.
   Set `CADENCE_INTEGRATION_JWT_SIGNING_KEY`, exact HTTPS
   `CADENCE_OAUTH_ISSUER`, and `CADENCE_MCP_ENABLED=false` initially. Confirm
   existing Supabase URL/publishable/server-only service credentials target the
   same project. Set `OPENAI_APPS_CHALLENGE` to the exact portal token when
   available. No `NEXT_PUBLIC_` or `VITE_` prefix on these integration variables.
   Do not duplicate production secrets into another environment by assumption.
6. **Deploy and verify.** Deploy the approved SHA to the authorized staging
   environment in existing `cadence` and `cadence-marketing` projects under
   `docs/VERCEL_WORKFLOW.md`. Match web issuer, callback, marketing and app URLs.
   Configure approved expiry maintenance for `oauth_purge_expired` and verify
   cleanup readback. Disable sensitive request/query/header logging. After
   migration, key, legal and maintenance checks, set `CADENCE_MCP_ENABLED=true`
   and restart/redeploy affected instances. Run Ticket 232 live acceptance for
   Claude, Claude Code and ChatGPT. Promote only with owner authorization.
7. **Finish the ChatGPT draft.** Open Platform → Plugins, select Upload new or
   existing plugin, choose the verified identity, and upload Ticket 230's reviewed
   ZIP with MCP included. Inspect Metadata & Skills findings. In MCPs → Connect,
   confirm the HTTPS endpoint and OAuth configuration. Copy the domain challenge
   into the server variable, redeploy, then verify its exact plain-text response.
   Do not overwrite another plugin's challenge on the same host. Complete OAuth,
   scan all tools, and resolve required findings. Enter reviewer credentials only
   in private Review details. Add P1–P5/N1–N3 results, video URL, and release notes.
   Owner reviews and submits; approval and publication are separate actions.
8. **Submit Claude connector.** With the authorized paid Claude account, open
   `https://claude.ai/directory/manage` → Submit new → MCP connector. Connect the
   server; inspect all tool titles/annotations. Enter listing, use cases, company,
   OAuth method, data-handling answers and reviewer instructions. Complete each
   compliance acknowledgment from verified evidence, review warnings, then submit.
   A paired Claude plugin is a separate portal submission using Ticket 230's
   package. Coordinate that submission with the connector record.
9. **Record acceptance and rollback.** Save directory draft/listing IDs and URLs,
   approved SHAs, client results, deployment IDs, public link checks and sanitized
   purge evidence. If acceptance fails, disable MCP and restart instances; revoke
   affected grants and roll back the app deployment if needed. Leave additive
   schema intact. Do not revoke the signing key without accounting for ordinary
   Auth sessions. Delist through each owner portal if already published.

OpenAI's current [submission guide](https://developers.openai.com/plugins/deploy/submission)
specifies organization verification, ZIP upload, OAuth/domain verification,
five positive and three negative review cases, and private reviewer credentials.
Its [remote server review requirements](https://developers.openai.com/plugins/deploy/app-review)
provide the final review checklist. Portal labels and validation may change;
recheck before the owner performs these steps. No live portal or hosted setting
was inspected or changed for this packet.

## Challenge route and local verification

`app/.well-known/openai-apps-challenge/route.ts` returns only
`OPENAI_APPS_CHALLENGE` as UTF-8 plain text. Empty or absent values produce an
empty 404. Both responses prohibit caching. The route reads the variable at
request time, requires no login, and works while MCP is disabled. The variable
is server-only configuration, but its value is intentionally public at this
route. Use a domain challenge value, never a credential. No resolver, database,
account data, new dependency, or schema change is involved.

Focused test: `npm run test -- tests/openai-apps-challenge-route.test.ts`.
Checks: missing/empty 404, exact bytes, plain-text/no-store headers, replacement,
removal, and independence from the MCP kill switch. Required repository gates:
`agents:check`, `interactions:check`, `resolvers:check`, `lint`, `typecheck`,
`test`, and `build`. Exact run results and SHAs are recorded in the Ticket 231
task note and shared PR Context. Hosted route verification remains Ticket 232.
