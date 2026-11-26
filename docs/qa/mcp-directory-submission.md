# Cadence directory submission packet — Ticket 231

Prepared October 18, 2026. **Unpublished draft for owner review.** This packet
does not authorize submission, legal publication, deployment, provider changes,
or a production reviewer login. Ticket 232 owns hosted and live-client acceptance.

Updated November 26, 2026 (Ticket 380, D36), still unpublished: the text that said
Cadence signs in with Google only is corrected in place, each change marked
"Corrected November 26, 2026". Three sections were added at the end:
"Unpublished MCP Apps listing drafts", "Sign-in corrections to the Ticket 231
text" and "Deferred owner steps for MCP Apps". Nothing was submitted, listed or
published, and no provider form was opened.

## Readiness and approval record

| Gate | Current state | Owner action before submission |
|---|---|---|
| Legal text | Complete owner-approved Privacy/Terms, separate Daily Brief disclosure, and matching marketing copy implemented locally under Ticket 232 | Independently review the local candidate; authorize publication separately and set the actual publication date in America/New_York |
| Personal health data | Possible in user-authored Behaviors and notes | Confirm classification, lawful disclosure, and directory eligibility |
| Reviewer sign-in | Google, email (a link or a 6-digit code, no password) and Apple, live since November 13, 2026 (D31). Corrected November 26, 2026; this row said "Google only". Unattended reviewer access unverified | Choose and verify the reviewer-account plan below |
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

Cadence requires a hosted account. Sign in with Google, Apple, or a link or code sent by email. Linked desktop records become available after synchronization. Account-free desktop records are unavailable. Disconnect a client in Settings > Connected apps to stop future access; copies already received remain subject to that client's policies.

Google Calendar data, travel routes and device location, Daily Brief content, account email, and credentials are excluded. User-authored Behaviors and notes can contain sensitive personal information. Cadence is a personal record, not medical advice, medication dosing, or an emergency service.
```

Corrected November 26, 2026 (Ticket 380): the fourth paragraph of the description
said "a hosted account with Google sign-in". The description is 1,273 characters
after the change. The view is not named in this copy yet: see "Unpublished MCP
Apps listing drafts".

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
| Support | `https://github.com/emixd12/cadence/issues` (current package support URL) |
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
GitHub issues are public: use the email for private account or privacy requests,
and never post health data, credentials, or private records in an issue. Ticket
229's planned `/developers#support` section can explain these two channels;
align the package and this table if the owner chooses it as the listing target.
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
Corrected November 26, 2026 (Ticket 380): that sentence holds only while
`CADENCE_MCP_APPS` is off in production. Once the "Cadence day" view is released
(D36), the listing is an MCP App and needs the carousel screenshots drafted under
"Unpublished MCP Apps listing drafts".

## Unpublished Privacy draft

Historical Ticket 231 draft below; superseded for local implementation by the
complete owner-approved Ticket 232 candidate in `components/settings/LegalContent.tsx`.
Publication remains unauthorized. See the local legal-copy acceptance record
in `docs/qa/mcp-server.md`; do not publish this historical excerpt.

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

Historical excerpt, superseded by the complete owner-approved Ticket 232
local candidate in `components/settings/LegalContent.tsx`.

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
[plugin guidelines, Privacy → Data collection](https://developers.openai.com/plugins/plugin-guidelines#data-collection)
(checked October 18, 2026) prohibit processing protected health information (PHI). They also restrict
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
Cadence signs in with Google, with email (a link or a 6-digit code, no password)
and with Apple, all live on web since November 13, 2026 (D31). Corrected
November 26, 2026 (Ticket 380): this paragraph said "Google sign-in only". No
method is a password, so none gives a reviewer unattended access by itself; see
"Sign-in corrections to the Ticket 231 text". `/auth/test-login` is local-only
and must remain disabled in production. No reviewer credentials belong in this
file, Git, plugin ZIPs, demo footage, or chat.

| Option | Practical tradeoff | Decision |
|---|---|---|
| Dedicated synthetic Google account | Uses existing sign-in. Google may still demand device, recovery, or risk challenges even without configured MFA; unattended access cannot be guaranteed. | Try only after owner approval; prove a fresh-browser flow and seek directory acceptance. Never weaken the owner's account. |
| Dedicated reviewer sign-in implementation | Can provide predictable access, but adds a production authentication path and requires security design, expiry, isolation, audit, tests, and owner approval. | Separate future ticket; do not ship a bypass or promote local test-login. |
| Portal-approved review arrangement | Ask each review team whether its process can accommodate the existing Google flow. No auth code change, but acceptance and timing are unknown. | Recommended first step, alongside a synthetic Google account trial. Hold submission if unattended access cannot be verified. |
| Email sign-in for a reviewer mailbox (added November 26, 2026) | Uses the email method that is live since D31: the reviewer types an address and receives a link or a 6-digit code. It needs a mailbox the reviewer can read. OpenAI's guide excludes "email or SMS codes" and "magic links" for reviewer accounts, so this does not meet OpenAI's rule. Anthropic asks for test access by email only if a listing goes to Verified review, and does not say which sign-in methods it accepts. | Not verified with either review team. Ask before relying on it. |

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

1. Open the supplied sign-in URL in a fresh browser. Follow the approved sign-in
   instructions for the method the owner chose (Google, email or Apple; corrected
   November 26, 2026, this step named Google only). Stop and report any
   MFA/email/device challenge; no bypass exists.
2. Add the HTTPS MCP endpoint as a custom connector, then connect. Sign into the
   synthetic account and review Cadence consent. Read is required; allow both
   write scopes for the positive cases. Complete consent and return to Claude.
3. Run P1–P5 above. Exercise all 16 tools, including `search` and `fetch` in P2.
   Confirm each write and inspect the result in the web Timeline or Behaviors.
4. Prepare the retry checks in Inspector with the same account and client,
   within the 24-hour retry window. Read a synthetic Occurrence with
   `get_occurrence` and save its revision as R. Confirm an
   `update_occurrence_note` call setting `Review first` with `expected_revision`
   R and a fresh `idempotency_key` K. Save the exact input and successful result.
   Read the new revision, then confirm another note change to `Review second`
   using that revision and a different fresh key.
5. **Replay:** repeat the exact saved input with key K, including revision R
   and note `Review first`. Expect the original successful result, not a
   conflict. Read the Occurrence again: its note must remain `Review second`.
   Replaying the receipt must not repeat the mutation.
6. **Key reuse rejection:** copy the saved input, retain key K, and change only
   the note to `Review altered`. Expect `idempotency_key_reused`, not a conflict.
   Read back the Occurrence and verify its note remains `Review second`.
7. **Stale revision conflict:** copy the original saved input with stale
   `expected_revision` R, but replace K with a NEW, unused key. Expect
   `conflict`, with no mutation; readback must still show `Review second`.
   Use the official SDK response to inspect structured tool errors; Inspector
   2.11.0 can label them as successes (see `mcp-server.md`).
8. Run N1–N3; reconnect read-only for N2 and disconnect that grant for N3.
   Verify Settings activity contains client/operation/outcome metadata, not notes.
9. Repeat with the packaged Claude plugin once Ticket 230's package is installed.
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

The owner selected existing production for Ticket 232 planning on October 18,
2026. This replaces the staging-first assumption, not the execution gates.
Use the target-specific review packet in the Ticket 232 workspace note before
any hosted action. No directory submission is authorized by that selection.

These are separate approval tracks, not authority inherited from step order.
Disabled technical deployment requires a reviewed maintenance/legal candidate,
Node 24 checks, exact migration/deployment authority, runtime pairing and a
backup/rollback plan. Public activation additionally requires disclosure/data
policy, retention/logging, signing/Auth/RLS proof and explicit all-user activation
approval. Directory publisher, reviewer, challenge and submission gates apply
only to directory publication. User-operated Google test access does not prove
unattended directory reviewer access.

1. **Approve release scope.** Approve complete Privacy/Terms text and dates in
   `components/settings/LegalContent.tsx`, including older no-AI-sharing claims.
   Verify public routes, Settings consumers and public-content tests; route
   metadata changes only when approved copy requires them. Approve production
   targets and exact migration/deployment scope separately from public activation.
   Decide health-data eligibility before activation. Publisher details, support
   coverage and reviewer access belong to the separate directory track.
2. **Verify OpenAI identity for directory publication.** In the OpenAI Platform, select the owning
   organization/project. An organization owner uses Organization settings →
   General to complete business verification for Identity Scaffolding LLC, or
   confirms the appropriate verified identity. Give the submitting member Apps
   Management Write if needed. Confirm the displayed publisher before upload.
3. **Apply hosted migrations only after authorization.** From the approved SHA,
   confirm the linked Supabase project matches the authorized production target.
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
   and state, never key material. Prove two-user RLS with dedicated synthetic accounts.
5. **Set Vercel variables.** Use existing project `cadence`, Settings → Environment
   Variables, selecting only the explicitly authorized Production environment.
   Set `CADENCE_INTEGRATION_JWT_SIGNING_KEY`, exact HTTPS
   `CADENCE_OAUTH_ISSUER`, and `CADENCE_MCP_ENABLED=false` initially. Confirm
   existing Supabase URL/publishable/server-only service credentials target the
   same project. Set `OPENAI_APPS_CHALLENGE` only under separate directory approval
   when the portal provides it. No `NEXT_PUBLIC_` or `VITE_` prefix on these variables.
   Do not duplicate production secrets into another environment by assumption.
6. **Deploy and verify.** Deploy the approved SHA to the authorized Production
   environment in existing `cadence` and `cadence-marketing` projects under
   `docs/VERCEL_WORKFLOW.md`. Match web issuer, callback, marketing and app URLs.
   Configure approved expiry maintenance for `oauth_purge_expired` and verify
   cleanup readback. Approve any changes to sensitive request/query/header logging.
   Keep the deployment disabled until the separate public-activation gates above
   pass and the owner explicitly authorizes `CADENCE_MCP_ENABLED=true` plus restart.
   All eligible users can then connect; there is no synthetic-only activation.
   Run Ticket 232 acceptance only with named test identities and approved actions.
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
   purge evidence. If acceptance fails, disable MCP and restart instances; prefer
   retaining the reviewed candidate's maintenance and approved disclosures.
   Older `041546e` lacks both; use only a separately reviewed recovery build
   preserving them. Protocol routes absent in that build return 404, not 503.
   Revoke grants only with scoped authority. Preserve key overlap and shared SQL;
   migration `20261018180000` changes an existing status function. Use reviewed
   forward fixes, never automatic backup restoration. Shared client registrations
   stay; used DCR/CIMD metadata does not expire. Dedicated test registrations need
   accepted retention or separately approved ID-bound cleanup proving no grants,
   pending requests or shared use. Delisting requires separate portal authority.

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

## Unpublished MCP Apps listing drafts — Ticket 380

Prepared November 26, 2026 (D36). **Unpublished draft for owner review.** Every
item below waits on the marketing site overhaul (`P-048`, Ticket 246) and the
owner's instruction. Nothing here was submitted, listed or published, and no
provider form or console was opened.

State on November 26, 2026:

- `CADENCE_MCP_APPS` is off in production. No public tool list names `show_day`.
- No AI client has rendered the view. Host acceptance is Ticket 378, which has
  not started; Ticket 375's real-host part waits on owner sign-ins.
- The only screenshots that exist are bench captures from fixtures. They are not
  listing screenshots.
- No credential, reviewer account or token is in this file or anywhere in the
  repository. Reviewer access follows "Reviewer-account plan" above.

### Requirements read on November 26, 2026

These are the provider pages as they read on that date. Recheck each before use.

| Source | What it asks for | Cadence's input |
|---|---|---|
| [Claude: Submit a connector](https://claude.com/docs/connectors/building/submission.md) | An MCP App adds carousel screenshots: PNG; at least 1000px wide; 3–5 images; cropped "to the app response only, without the prompt in the image"; any aspect ratio; the prompt text supplied separately for each; no separate mobile assets; no video or GIF. Allowed link URIs are optional and apply only to a connector that calls `ui/open-link`; every origin listed must belong to the submitter. "Don't put credentials in the portal"; a Verified reviewer asks for test access by email. | "Screenshot prompts" and "Screenshot capture" below. The view calls no `ui/open-link`, so Cadence declares no link URIs. |
| [Claude: Connector pre-submission checklist](https://claude.com/docs/connectors/building/review-criteria.md) | Every tool has a `title` and `readOnlyHint` or `destructiveHint`; tool names are 64 characters or fewer. A submission is listed as a Community connector by default; Anthropic may escalate it to Verified review, where reviewers test each tool. "An MCP App's embedded websites and entry points are available only under a Verified listing." | `show_day` has a title and `readOnlyHint: true` (`docs/MCP_CONTRACT.md`, "MCP Apps trial"). "Reviewer test cases for the view" below. |
| [Claude: entry points](https://claude.com/docs/connectors/building/mcp-apps/entry-points.md) | A tool marked with `_meta["openai/ui"].entrypoints` of type `global` can be listed on Claude's Artifacts page. Verified directory connectors and custom connectors can have entry points; a Community listing cannot. Every input must be optional. | Not built. `show_day` carries no entry-point mark. Its one input, `date`, is optional. Adding the mark is a server change and needs a ticket. |
| [OpenAI: Upload and submit your plugin](https://developers.openai.com/plugins/deploy/submission.md) | Changes to metadata or skills need a new ZIP. Hosted tool changes are scanned on the server; a new tool stays unavailable until approved. Five positive and three negative test cases, a video walkthrough and release notes. Reviewer credentials must work "without MFA approval, email or SMS codes, magic links, or private-network access". "If your plugin uses iframes, explain what each embedded page does, why it is needed, and who controls its domain." | "CSP statement" and "Reviewer test cases for the view" below; "ChatGPT test cases" above. |
| [OpenAI: Add UI to your MCP server](https://developers.openai.com/apps-sdk/mcp-apps-in-chatgpt.md) | Link the tool with `_meta.ui.resourceUri`; serve `text/html;profile=mcp-app`. Declare `connectDomains` for API requests, `resourceDomains` for assets and `frameDomains` only for embedded origins. "Nested frames are blocked by default." "The plugin review process checks the declared policy against the UI behavior." The resource URI is a cache key. Keep tools useful without UI. | "CSP statement" below. `show_day` returns the day as text for a host that shows no view. A breaking view change gets a new URI. |
| [Google: Connected Apps Platform MCP server guide](https://developers.google.com/connected-apps/mcp) | Four phases: build, validate with MCP Inspector, deploy and test in Gemini Developer Mode, then register. Access to registration is requested through an interest form. The Google Connected Console takes app details, authentication, endpoints and tool discovery, manages testers and submits for review. UI binding uses `meta={"ui": {"resourceUri": "ui://..."}}`. | "Google Connected Apps: what the forms will ask" below. |
| [Google: OAuth 2.1 implementation guide](https://developers.google.com/connected-apps/mcp/oauth) | Authorization code with PKCE. Metadata is read first from `/.well-known/oauth-authorization-server`, and the first URL that answers is used, even an error. The metadata must hold `authorization_endpoint`, `token_endpoint`, `response_types_supported` with `code`, and a `registration_endpoint` (or a client ID and secret typed into the console). Six Google redirect patterns must be allowed. Google recommends returning the same refresh token on refresh ("Persistent Linking"). A square SVG logo of at least 500 by 500 pixels. | Same section below. |

### Screenshot prompts

Five shots, one prompt each. The prompt is supplied as text beside its image and
never appears in the image. `scripts/acceptance/listing-capture.mjs` holds the
same list (`LISTING_SHOTS`); `tests/acceptance-web-client/listing-capture.test.mjs`
fails when a prompt here differs from the script.

| ID | Prompt | What the image shows | Bench fixture |
|---|---|---|---|
| `today` | Show my Cadence day. | Today with a day note, the Needs decision count line and rows with Completed, Not Completed and Note. | `normal`, light |
| `mark-completed` | I just finished my morning walk. Open today in Cadence so I can mark it. | The same day after the person clicked Completed on Morning walk. | `normal`, light, one click |
| `routine-steps` | Show today in Cadence. I want to see the steps of my skin routine. | A routine opened to its steps, with the progress the server derived. | `parent`, light, one click |
| `note` | Open my Cadence day. I want to add a note to Stretch. | The note editor open on one row, before Save note. | `normal`, light, one click and typed text |
| `connected-service` | Show today in Cadence, with anything a connected service marked. | Dark theme. A row a connected service marked reads "Completed · From Hevy"; the person can still change it. | `connector`, dark |

Notes for the owner:

- No prompt was tried in a real client. Ticket 378 learns whether each one makes
  the client call `show_day`. Change the wording here and in the script together.
- In a test run, send each prompt with the `[Cadence QA]` marker in front, as
  every acceptance prompt is. The paired prompt text for the listing has no marker.
- Host captures come from test accounts A and B only, with invented Behaviors.
  The fixture names above (Morning walk, Vitamins, Stretch, Read, Skin routine, Gym)
  are a starting list for that test data.
- `connected-service` shows the name "Hevy" as text. `docs/LEGAL.md`, `L-020`,
  holds the open question about provider marks. A public listing image is a new
  place for that question; the owner decides whether this shot is used.
- The Claude directory takes 3 to 5 images. Dropping `connected-service` or `note`
  leaves a valid set.

### Screenshot capture

`scripts/acceptance/listing-capture.mjs` writes one PNG and one JSON sidecar per
shot. The sidecar holds the paired prompt, the source, the size and the time. It
refuses an image narrower than 1000px and an output directory inside the
repository that git does not ignore. The default directory is
`.local/listing-captures/`, which `.gitignore` covers. Files are mode 0600.

```sh
# Today: bench captures from fixtures. Start the app first: npm run dev
node scripts/acceptance/listing-capture.mjs bench
node scripts/acceptance/listing-capture.mjs bench --base-url http://127.0.0.1:3000 --shot note

# After Ticket 378 has a host run: the view frame in the open QA Chrome tab
node scripts/acceptance/listing-capture.mjs host --client claude-web --shot today --selector '<the view frame>'

node scripts/acceptance/listing-capture.mjs list
```

| Mode | Files | Sidecar says | Use |
|---|---|---|---|
| `bench` | `.local/listing-captures/bench/bench-<id>.png` and `.json` | `source: "bench"`, `listing_candidate: false`, and a label that it is not a listing screenshot | Layout and wording review only. No AI client rendered these. |
| `host` | `.local/listing-captures/host/<client>/host-<id>.png` and `.json` | `source: "host"`, `listing_candidate: true`, the client | Listing candidates, after the owner looks at each one. |

- Bench mode loads `/design-system?preview=mcp-day-view` from a loopback address
  only, with Claude's published style variables and the 720px frame at twice the
  pixel density (1436px wide in the November 26 run). Its browser context refuses
  every request that is not loopback. The bench is a 404 in production.
- Host mode attaches to the Cadence QA Chrome profile that a Ticket 378 run left
  open. It captures the one frame the selector names and refuses anything that is
  not an `iframe`, so no prompt, sidebar or chat title is in the image. It never
  navigates, types or clicks. `--scale` multiplies the pixel density for a frame
  narrower than 1000px.
- The command line knows Claude web and ChatGPT web. The harnesses that Ticket 378
  adds for Claude Desktop, Claude mobile, VS Code and Gemini call
  `captureHostView()` with their own page.
- Not done: no host capture exists. The frame selector for each client is unknown
  until Ticket 378 sees the view in that client. Host mode is tested against a
  stub page only.
- Run on November 26, 2026 against `next dev` on loopback: five bench captures,
  1436px wide, 0 refused requests. Tests: `npm run test:web-client`.

### CSP statement

For the ChatGPT resubmission's review information, and for any reviewer who asks.
Copy only the fenced text.

```text
Cadence serves one UI resource, ui://cadence/day/v1.html ("Cadence day"), as one self-contained HTML file with the MIME type text/html;profile=mcp-app. Its declared policy is _meta.ui.csp = { connectDomains: [], resourceDomains: [] }. Both lists are empty on purpose. No frameDomains are declared and _meta.ui.domain is not set.

The view makes no network request. It loads no external script, style sheet, image or font: all code and styles are inline in the one file. It embeds no nested frame and opens no link. It uses no cookie, localStorage, sessionStorage or IndexedDB. No credential or token reaches the view.

The view talks only to its host, through the MCP Apps bridge (JSON-RPC over postMessage). It reads the result of the show_day tool. When the person clicks Completed, Not Completed or Save note, it asks the host to call one of three existing Cadence tools (set_occurrence_status, set_parent_occurrence_status, update_occurrence_note) under the permissions the person granted when connecting. Text the person wrote is shown as text, never as HTML.

Iframes: the plugin embeds no page. The only frame is the one the host creates to run this view. Its content is the HTML that Cadence's MCP server at app.cadence-me.com returns from resources/read. Identity Scaffolding LLC controls that domain.
```

How each claim is tested:

| Claim | Test or check |
|---|---|
| The server declares the empty policy on `resources/list` and `resources/read` | `tests/mcp-apps-server.test.ts`, `tests/mcp-apps-show-day.test.ts` |
| The shipped bundle makes no network attempt across reads, writes, refusals and a theme change | `tests/mcp-day-view.dom.test.ts`: `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `Worker`, `Image` and `sendBeacon` are recorders that must stay empty |
| The file holds no external script, style, image, font, frame, link, storage or network API | `tests/mcp-day-view.dom.test.ts`, "Inert and offline" (`docs/qa/2026-11-25-mcp-day-view.md`) |
| Titles, notes and the day note render as text | Same file, hostile-text cases |
| The served file is the tested file | `tests/mcp-day-view-build.test.ts` rebuilds the view and compares bytes |
| A sandboxed frame with scripts only made 0 requests | Hand checks in `docs/qa/2026-11-25-mcp-day-view.md` (bench and `basic-host`); the bench capture run above refused 0 requests |

Not tested: the policy as a real host enforces it. OpenAI's review compares the
declared policy with what the view does; Ticket 378 is the first run in ChatGPT.

### Reviewer test cases for the view

Five cases, written in the form of "ChatGPT test cases" above. **None has run in a
real client.** Ticket 378 runs them; record results there before any submission.
The view opens when the client calls `show_day`. A client that shows no view still
gets the day as text, and P1 above then applies.

Seed additions to "Reviewer-account plan": a routine **Review routine** with three
steps scheduled today, and today's **Review walk** and **Review reading** left
Unresolved before the run.

| ID / scenario | Setup and prompt | In the view | Expected tools | Expected result |
|---|---|---|---|---|
| V1 — Mark | Full grant. "Show my Cadence day." | Click Completed on Review walk. | `show_day`, then `set_occurrence_status`, then `show_day` | The row reads Completed in the view and on the web Timeline. One write. The assistant does not ask to confirm again and calls no write tool itself. |
| V2 — Parent slot | Full grant. "Show today in Cadence. I want to see the steps of Review routine." | Open the routine, then click Completed on the routine's own row. | `show_day`, then `set_parent_occurrence_status`, then `show_day` | The routine reads Completed in the view and every step is Completed on the web. One write for the slot, none per step. |
| V3 — Note | Full grant. "Open my Cadence day. I want to add a note to Review walk." | Click Note on Review walk, type **Review view note**, click Save note. | `show_day`, then `update_occurrence_note`, then `show_day` | The note shows under the row and on the web. Connected apps activity shows the operation and outcome, never the note text. |
| V4 — Read-only grant | Connect with read permission only. "Show my Cadence day." | Look for controls. | `show_day` only | The view shows "Reconnect to allow changes" and no Completed, Not Completed or Note control. No write is attempted. Asking the assistant to mark an item gets the reconnect explanation (N2 above). |
| V5 — Conflict | Full grant. "Show my Cadence day." Then, in the web app in another tab, mark today's Review reading Completed. | Without reloading, click Not Completed on Review reading. | `show_day`, then `set_occurrence_status` (refused with `conflict`), then `show_day` | The view says "Not changed. This changed somewhere else. Check it and try again." and now shows Completed. The web Timeline still shows Completed. Nothing is written until the person clicks again. |

- Each write is followed by one `show_day` read, so a case costs two calls against
  the per-grant limits.
- In Settings > Connected apps the reads appear as "show day" and "read view
  resource".
- OpenAI asks for exactly five positive and three negative cases. V1 to V3 are
  positive. V4 and V5 are safe-fallback cases. The owner chooses which of P1 to P5
  and N1 to N3 they replace at resubmission.
- Unknown until Ticket 378: whether a client shows its own approval prompt before
  a write the view starts. If it does, the reviewer approves it, and the case text
  must say so.

### Facts for listing copy

Listing copy that names the view is written in the messaging track (Ticket 246)
from `docs/NARRATIVE.md`. These are facts it may state, not copy:

- One view, "Cadence day". It shows today only.
- Each Occurrence has Completed, Not Completed and Note. A routine shows its steps.
- Earlier Unresolved items appear as one count line, never a list.
- A click in the view is the person's confirmation. It writes through the existing
  permissions; there is no new permission.
- A client that shows no view gets the same day as text.
- The view shows no Calendar event, travel, leave time, Daily Brief text, location
  or Period.

### Google Connected Apps: what the forms will ask

Nothing was sent to Google. No Gemini client has connected to Cadence.

| Google asks for | Cadence today | Open |
|---|---|---|
| Metadata at `/.well-known/oauth-authorization-server` | `https://app.cadence-me.com/.well-known/oauth-authorization-server` ("URLs and assets" above) | None known. |
| `registration_endpoint` in the metadata | Cadence's metadata has one (`lib/services/oauth/server.ts`) | Not tried with Google's client. |
| Google's six redirect patterns allowed | Cadence matches a web redirect exactly, per registered client | Not tested: whether the URIs Google registers pass Cadence's redirect rules. |
| PKCE | S256 is required on every request | None known. |
| The RFC 8707 `resource` parameter | Cadence requires it | Unknown whether Gemini sends it (Ticket 375, unknown 7). A change is Ticket 381. |
| The same refresh token returned on refresh ("Persistent Linking") | Cadence rotates the refresh token on every refresh and revokes the token family on reuse (`docs/MCP_INTEGRATION.md`, section 6) | Possible gap. Not tested. Any change is an OAuth security change and belongs to Ticket 381. |
| A square SVG logo, at least 500 by 500 pixels | PNG logos only (`apps/marketing/public/brand/`) | An SVG is needed. Design work, not engineering. |
| Tool annotations on every tool | Present on every registry tool and on `show_day` | None known. |

## Sign-in corrections to the Ticket 231 text

Ticket 231 wrote this packet on October 18, 2026, when Cadence signed in with
Google only. Email and Apple sign-in went live on web on November 13, 2026 (D31).
Corrected in place on November 26, 2026, each marked with that date:

1. "Readiness and approval record", the Reviewer sign-in row.
2. "Listing copy", the description's fourth paragraph.
3. "URLs and assets", the sentence that says the carousel requirement does not
   apply.
4. "Reviewer-account plan", its first paragraph, and one new row in its table.
5. "Claude reviewer instructions", step 1.

What the correction does not change: no sign-in method is a password. OpenAI's
guide excludes email codes and magic links for reviewer accounts, so unattended
reviewer access is still unverified, as the plan says.

Other Ticket 231 text that is out of date and was left as written, because Ticket
380 covers sign-in text only. Fix each before a submission:

- "Ten reads and six scoped writes" and "all 16 tools". The registry holds 30 tools
  on November 26, 2026 (`REGISTRY_TOOLS` in `scripts/acceptance/protocol.mjs`).
- The expected-tools lists in P1 to P5 and the draft release notes describe
  contract 1.0.0.
- "Paste these instructions into the private reviewer field with the separately
  approved account credentials." Anthropic's page now says not to put credentials
  in the portal.
- Statements that hosted launch and live-client acceptance are pending. The MCP
  server is live since October 29, 2026 (Ticket 232).

## Deferred owner steps for MCP Apps

Each step is the owner's, waits on the marketing site overhaul (`P-048`, Ticket
246) and needs the owner's instruction at the time. None is authorized by this
file. An agent may prepare an input; an agent does not open a provider form.

Before any of them: Ticket 378 passes on the required hosts; the owner turns
`CADENCE_MCP_APPS` on in production (D36); and `show_day` joins the contract
registry after the alongside edition folds in (Ticket 365).

| # | Owner step | Input in the repository | Waits on |
|---|---|---|---|
| 1 | Claude directory update: the listing becomes an MCP App with carousel screenshots and their prompts | This file: "Listing copy", "Screenshot prompts", "Screenshot capture". `scripts/acceptance/listing-capture.mjs` in `host` mode makes the images; they are not in the repository | `P-097`, `P-048` |
| 2 | Claude Verified listing, and the Artifacts entry point that needs it | This file: "Reviewer test cases for the view", "Reviewer-account plan", "Claude reviewer instructions". The entry point itself is not built: marking `show_day` in `lib/mcp/apps/show-day.ts` needs a ticket | `P-097`, `P-048` |
| 3 | ChatGPT plugin resubmission: new ZIP, tool rescan, review information | `integrations/chatgpt-plugin/` (`plugin.json`, `mcp.json`), `node scripts/package-plugins.mjs`; this file: "CSP statement", "Reviewer test cases for the view", "ChatGPT test cases" | `P-097`, `P-048`; `P-100` if the ZIP carries the skill update |
| 4 | Google's Connected Apps interest form and the Google Connected Console | This file: "Google Connected Apps: what the forms will ask", "URLs and assets". Ticket 378's Gemini Developer Mode result; Ticket 381 if it finds a sign-in gap | `P-101`, `P-048` |
| 5 | Publish the `daily-check-in` skill update in both plugins | `integrations/drafts/skills/daily-check-in/SKILL.md`; steps in `integrations/drafts/README.md` | `P-100`, `P-048` |
| 6 | `/developers` and marketing copy that describe the view | `apps/marketing/src/data/developers.ts` and the generated developer reference; facts in `docs/MCP_CONTRACT.md`, "MCP Apps trial", `docs/MCP_INTEGRATION.md`, section 17, and "Facts for listing copy" above | `P-099` for the developer docs; `P-097` and `P-048` for marketing |
| 7 | Privacy, Terms and Trust text about views shown inside AI clients | `components/settings/LegalContent.tsx`; the facts to state are in `P-098` | `P-098`, `P-048` |

The plan sets no order among these steps. Three dependencies are fixed:

- Step 7 comes before any listing that links to Privacy or Terms. "URLs and
  assets" above says not to list an unpublished legal draft as the current policy.
- The entry point in step 2 needs a Verified listing, so it follows step 1.
- A skill change needs a new ChatGPT ZIP, so step 5 goes with step 3 or before it.
