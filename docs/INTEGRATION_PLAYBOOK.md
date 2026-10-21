# Service integration playbook

Use this playbook before committing Cadence to another external service. It
defines the planning brief, implementation sequence, and evidence labels. It is
not a connector registry, runtime status ledger, or generic plugin framework.
`STATUS.md` remains the current implementation ledger.

Runtime product connections are separate from agent access to provider accounts.
Repository work does not authorize a provider login, consent grant, account read,
configuration change, deployment, publication, or support request. Reuse an
existing authorization only when its target and purpose cover the next action.
Request only the missing authority or human-only action, with its exact target
and purpose.

## Evidence labels

Name the evidence class for every claim. Never promote one class into another.

| Label | What it proves | What it does not prove |
|---|---|---|
| Documented support | A dated provider or platform reference describes a capability, field, permission, limit, or release rule. | Cadence implemented it or the provider returned it. |
| Source check | Current code and static checks implement a boundary. | A packaged client, provider, or deployment works. |
| Fixture or contract check | Synthetic inputs verify mappings, validation, errors, and side effects. | A live account exposes the same fields or failure modes. |
| Native runtime | An installed desktop build completes a named flow and preserves local data. | Web deployment, Apple trust, or public provider approval. |
| Live provider | An authorized test account completes a bounded provider operation. | Another account type, a deployed public client, or provider approval. |
| Deployed behavior | The promoted web application completes the named flow. | Installed desktop parity or provider approval. |
| Public approval | The provider or platform approved the named client, scopes, brand, or distribution artifact. | Broader capabilities, later changes, or unrelated legal review. |

Keep dated historical checkpoints intact. Correct only current summaries. Link
current state to `STATUS.md` instead of creating another status inventory.

## Reusable integration brief

Copy this section into the integration ticket or proposal. Complete it before
scope commitments.

### 1. Outcome and boundary

- **User benefit:** Name the user problem and the smallest useful result.
- **Data direction:** Inbound to Cadence, outbound from Cadence, or both.
- **Account mapping:** Name the Cadence owner key, provider identity key, and
  same-account or cross-account rule.
- **Source of truth:** Name the owner for connection state, provider facts,
  cached facts, and Cadence domain facts.
- **Read authority:** List exact facts and ranges Cadence may read.
- **Write authority:** List exact Cadence and provider mutations, or state `none`.
- **Onward disclosure:** Treat an inbound connector grant and disclosure to a
  downstream consumer as separate permissions. Name the consumer, data classes,
  connectors, account binding, grant generation, and revocation behavior.
- **Explicit exclusions:** List adjacent data, automation, accounts, and product
  behavior that remain out of scope.

### 2. Platform impact

| Platform | Implementation, follow-up, or not-applicable reason |
|---|---|
| Web | Name routes, services, UI, and deployment evidence. |
| Desktop | Name broker/native boundaries, cache, offline behavior, and installed evidence. |
| Marketing | Name required disclosure or explain why no public claim changes. |
| Future mobile | Name the shared contract impact or state why it is deferred. |

Use `interaction-registry.json`, `design-system.manifest.json`,
`design-system.surfaces.json`, and `design-system.usage.json` for existing
interactions and reusable UI. Update the registry only when an implemented
interaction changes. Do not register proposed interactions as implemented.

### 3. Capability research

Date and cite the provider research. Record:

- fields, types, units, ordering, pagination, and time boundaries;
- every missing-value meaning, including omitted, restricted, unsupported,
  truncated, unavailable, deleted, and unknown;
- exact permissions and why each narrower permission is insufficient;
- request, page, range, attendee/item, rate, retry, and retention limits;
- revocation scope, delay, cross-client effects, and reconnect behavior;
- test-account, domain, disclosure, demonstration, provider-review, deployment,
  and distribution requirements.

For each claim, label documented support, fixture evidence, and live proof
separately. Do not claim fresh provider requirements from repository memory.

### 4. Contract and ownership

List every operation with:

- authenticated owner and identity/provenance inputs;
- bounded input schema and version;
- success result and stable failure result;
- runtime validation at every trust boundary;
- schema compatibility and cache invalidation rules;
- coverage, completeness, freshness, and revision facts;
- finite retry budget, backoff, timeout, and cancellation behavior;
- storage, provider, UI, audit, and notification side effects;
- the owner of provider I/O, mapping, domain decisions, persistence, and UI.

Reuse an existing domain model only when meanings match. Provider adapters own
provider payloads. Services own orchestration. Pure core code owns shared domain
decisions. Repositories or native adapters own atomic persistence. UI consumes
validated results. Do not force unrelated data into the Calendar event model.
For an external consumer, define a literal minimum projection instead of exposing
an internal snapshot wholesale. Include capture time, revision, coverage,
freshness, completeness, and stable failures whenever they affect interpretation.

### 5. Security and lifecycle

Define credential custody and minimum data before implementation. Credentials
stay in the narrowest server or native secret boundary. Never place server
credentials in a browser bundle, desktop package, ordinary database row, export,
user-created backup, telemetry, or log. If sealed credential ciphertext can enter
infrastructure backups, document its encryption, retention, deletion limit, and
operator boundary explicitly. Never store plaintext provider credentials there.

Define these transitions explicitly:

| Transition | Required decision |
|---|---|
| Connect | Consent, identity binding, one-use state, expiry, cancellation, and atomic credential install. |
| Cancel | Pending state removal and proof that no Cadence tracking records or provider source records changed. |
| Refresh | Range and selection bounds, complete versus partial results, stale-cache policy, and deduplication. |
| Reconnect | Credential replacement, generation change, old-response fencing, and user-visible recovery. |
| Disconnect | New-read fence, local credential/cache cleanup, provider revocation order, and revocation-failure disclosure. |
| Account switch | Old account, connection, selection, range, and pending-response cleanup before showing new-account data. |
| Account deletion | Preserve the account if deletion fails. State when external revocation runs and who owns failures after deletion. |
| Export/backup | State every included and excluded provider fact and credential. |

Fence obsolete account, connection generation, selection revision, request
range, and callback responses before they can mutate state. Retain a last known
complete snapshot after a partial read only when the UI labels its freshness.

Keep read and execution authority separate. A read grant cannot authorize a
write, even when a consumer returns a proposed change or the user approves text
inside that consumer. A write phase needs named operations, a distinct grant,
preview, explicit human approval, stale-source revalidation, conflict handling,
idempotency, audit history, revocation fencing, and atomic apply behavior.

### 6. Smallest end-to-end slice

Prove consent → bounded read → render → disconnect early on every in-scope
surface. Use one controlled account and harmless fixtures. A hosted-only consumer
may mark account-free desktop not applicable with a reason; it does not need a
native helper. Add only the operations required by that slice.

The acceptance matrix must cover:

- consent denial, cancellation, wrong account, expired callback, and reconnect;
- one complete empty read, one complete populated read, and one partial read;
- stale or late response fencing across account, selection, and range changes;
- offline restart and online recovery where a cache exists;
- bounded retry exhaustion and provider failure recovery;
- disconnect, revocation failure, and account-switch isolation;
- Cadence data preservation and provider-source non-mutation;
- deployment, installed runtime, and public approval as separate gates.

### 7. Release, rollback, and cleanup

Identify domain, callback, transport policy, disclosure, test-account,
demonstration, provider-review, deployment, and distribution dependencies before
the release slice. Assign an owner to each human-only action and monitoring inbox.

Record rollback targets for schema, deployment, provider configuration, and
native build. Define cleanup for test grants, credentials, caches, pending state,
fixtures, private artifacts, provider configuration, and test accounts. Read
back cleanup. Keep secrets and private provider payloads outside git.

## Implementation sequence

1. Complete the brief and capability matrix.
2. Trace existing models, services, repositories, adapters, interactions, and tests.
3. Choose the smallest existing model whose meanings match.
4. Define versioned inputs/results, stable errors, validation, and compatibility.
5. Implement one provider adapter and one service path per operation.
6. Prove the web slice with fixtures, then an authorized live account.
7. Prove the installed desktop slice, including restart and cleanup.
8. Add deployment and public-approval evidence without rewriting earlier evidence.
9. Reconcile current summaries and update `STATUS.md`; preserve dated checkpoints.

## Observed Calendar lessons

These are observed outcomes, not general provider requirements.

| Lesson | Evidence | Reusable rule |
|---|---|---|
| A packaged native client can block a valid broker before application code runs. | `docs/qa/day-progress-release.md` records preview.33 failing because production CSP omitted the exact broker origin. | Include installed transport policy and exact origin checks in the first native slice. |
| A valid URL and permission do not prove the transport call is correct. | The same ledger records preview.35 calling browser `fetch` with the broker as receiver; preview.36 passed after using `globalThis`. | Exercise the packaged transport with a live bounded read. Keep a regression at the transport boundary. |
| External-browser callbacks can complete server-side while installed UI remains stale. | Preview.36 and later checkpoints record stale handoff messages, rejected callbacks, and recovery after navigation or restart. | Treat the authenticated connection read as authoritative. Consume callback state once, then refresh current state. |
| A late callback or refresh can overwrite a newer scope. | Final local review found obsolete account/range callbacks; coordinator regressions cover both fences. | Capture account, generation, selection, and range. Ignore results whose scope no longer matches. |
| Partial reads cannot mean an empty calendar. | `docs/EXTERNAL_EVENT_CONTRACT.md`, provider tests, and desktop cache tests preserve incomplete coverage and the last complete cache. | Return typed incomplete results. Replace caches only with validated complete snapshots. |
| Account switching exposes unrelated data-loss and isolation paths. | Preview.38–40 found and corrected replacement races before there-and-back account and Calendar isolation passed. | Protect data first. Verify old-account cleanup, zero cross-account rows, and full restoration before acceptance. |
| Public release depends on more than runtime success. | Tickets 138–141 required domain ownership, disclosures, controlled demonstration, branding review, data-access submission, and monitoring. | Identify public prerequisites before the implementation is called releasable. Keep provider approval separate from technical acceptance. |

## Worked brief: optional Google Calendar context

This example records the existing display connector. Tickets 145–148 separately
plan advisor disclosure; the display grant does not authorize that future use.

### Outcome and boundary

- **User benefit:** Show selected Calendar events beside Timeline Occurrences as
  optional context for planning and review.
- **Data direction:** Google Calendar → Cadence only.
- **Account mapping:** Supabase user ID owns Cadence state. The connector requires
  the Google `sub` already attached to that Cadence account. Email is not an
  identity key.
- **Source of truth:** Google owns source events. Hosted connection/preferences
  own consent and selection. A normalized snapshot owns one read result. The
  desktop cache owns only the last complete matching local copy. Cadence owns
  Behaviors, Occurrences, statuses, Notes, reminders, and timing.
- **Read authority:** List readable subscribed calendars. Read events only from
  selected calendars and the displayed range, from today through at most 30
  days later.
- **Write authority:** None. Cadence exposes no create, edit, delete, or calendar
  mutation operation.
- **Explicit exclusions:** Calendar sync, event editing, automatic rearrangement,
  automatic status changes, Drive reads, Calendar data in BehaviorLog/export,
  model transmission, a second provider, and a generic integration framework.

### Platform impact

| Platform | Current implementation or reason |
|---|---|
| Web | `/api/google-calendar/*`, `/auth/google-calendar/callback`, `lib/services/google-calendar.service.ts`, and Settings/Timeline controls implement the deployed read-only slice. |
| Desktop | `apps/desktop/src/calendar/google-calendar.ts`, `coordinator.ts`, and `cache.ts` use the hosted broker and a separate disposable SQLite cache. Installed preview.40 evidence covers account isolation and restoration. |
| Marketing | Public homepage, FAQ, Privacy, and user guide describe optional read-only use and pending Calendar data-access approval. Marketing has no connector runtime. |
| Future mobile | Deferred. A future client may consume the shared normalized contract after defining its own credential, cache, and lifecycle boundaries. |

Existing interaction evidence is `INT-CALENDAR-001` through
`INT-CALENDAR-007` in `interaction-registry.json`. The synthetic Calendar bench
uses production components and no provider or account reads.
`design-system.manifest.json` catalogs `module.google-calendar-panel`, and the
surface/usage catalogs trace its Settings and test consumers. `DESIGN.md` records
the shared Settings panel and Timeline presentation.

### Capability and contract evidence

The 2026-09-16 provider research in
`docs/qa/google-calendar-capabilities.md` documents subscribed-calendar listing,
timed/all-day events, recurrence instances, cancellation, restricted details,
pagination, and OAuth behavior. It is dated research; this playbook does not
freshly verify those requirements.

Source and fixture evidence:

- `packages/core/src/types/external-event.ts` defines schema `1.0.0`, bounds,
  capabilities, coverage, failures, tombstones, and scheduling projection.
- `packages/core/src/services/external-event-validation.ts` validates exact keys,
  dates, instants, timezones, identities, durations, revisions, coverage, and
  completeness at runtime.
- `packages/core/src/services/external-event-projection.ts` removes rich text,
  participants, conference details, and attachments from scheduling facts.
- `lib/services/google-calendar-provider.ts` maps Google pages, sanitizes text,
  bounds calendars/ranges/pages/items/attendees, applies finite retries, and
  returns a typed partial snapshot on interrupted reads.
- `tests/external-event-contract.test.ts`,
  `tests/google-calendar-provider.test.ts`, and their JSON fixtures prove valid,
  malformed, incomplete, cancelled, duplicate, restricted, and versioned cases.

Live and release evidence remains separate:

| Evidence class | Calendar result |
|---|---|
| Native runtime | Installed previews 36–40 collectively passed consent/reconnect, selection, refresh, offline restart, disconnect cleanup, wrong-account rejection, secondary-account isolation, future-range extension, and primary-data restoration. Immediate callback rendering was not observed in the dedicated-account flow. Apple-trusted distribution remains under Ticket 115. |
| Live provider | Authorized test accounts completed same-account reads and wrong-account rejection. Controlled provider-failure and Workspace-restriction coverage remains incomplete. |
| Deployed behavior | Production web passed consent, selection, bounded refresh, Timeline details, disconnect, dedicated demonstration, and public-route checks recorded in the QA ledgers. |
| Public approval | Google verified Cadence branding. Google accepted the Calendar data-access submission on September 18, 2026 and reports it under review. Calendar scope approval and post-approval smoke checks remain open under Ticket 141. |

### Operations and results

| Operation | Inputs and bounds | Result and side effects |
|---|---|---|
| Connection status | Authenticated Cadence owner. | `CalendarConnectionView`; no provider read. |
| Start connection | Web or desktop target; desktop state is 32–128 URL-safe characters. | One five-minute, one-use attempt and provider URL. No credential install yet. |
| Finish connection | One-use state, bounded code, initiating web cookie or opaque desktop return state. | Exact-scope and same-subject validation installs an owner-bound sealed refresh credential atomically, or returns a stable cancelled/error result. |
| List calendars | Connected owner and ephemeral access token. | Complete readable calendar list after bounded pagination. Token is not returned or stored in the result. |
| Save preferences | Unique selected/hidden IDs, booleans, at most 32 IDs, and live membership validation. | Owner-scoped preference write and selection revision change. Old snapshots no longer match. |
| Read events | Connected owner; today as start; inclusive range of 0–30 additional days; profile timezone and current selection. | Validated complete snapshot. Provider failure returns a stable error; diagnostic partial data never becomes a complete cache. Identical in-flight reads coalesce. |
| Disconnect | Connected owner. | Fence/delete credential state first, attempt provider revocation, return factual revocation warning, and clear desktop pending/cache state. |

Stable read failures and retry meanings live in
`docs/EXTERNAL_EVENT_CONTRACT.md`. Provider pages use finite retries, capped
backoff and jitter, and bounded `Retry-After`. Authentication, wrong-account,
permission, invalid-request, schema, and repeated-pagination failures require a
state or input change instead of an unbounded retry.

The snapshot carries account ID, connection generation, selected calendar IDs,
range, timezone, fetch time, coverage, completeness, capabilities, failures,
revisions, and field-availability reasons. Desktop replacement additionally
matches the cache request and rejects incomplete results. Coordinator epochs
and request scopes prevent a cleared or obsolete response from repopulating the
cache.

### Custody, minimization, and lifecycle

The Calendar OAuth project is separate from the Supabase sign-in project. The
server owns Google client credentials, refresh credentials, token refresh,
identity checks, pagination, and response adaptation. Desktop receives only its
Supabase session, an opaque short-lived pending state in Keychain, normalized
results, and factual connection state. Google access tokens remain request-local.

Hosted refresh credentials are owner-bound AES-256-GCM ciphertext in a private
schema. The desktop event cache is separate from `cadence.sqlite3`. Credentials,
raw provider responses, and cached events are excluded from Cadence exports,
BehaviorLog, account sync, and user-created desktop backups. Hosted sealed
ciphertext can remain in infrastructure backups under the documented retention
window.

Consent denial and cancellation consume pending state without changing Cadence
tracking records. Reconnect increments the
connection generation. Selection changes increment its revision. Refresh keeps
the last complete snapshot when a read fails or is incomplete. Desktop sign-out,
account disconnect, global Calendar disconnect, and account switching clear local
Calendar state.

Global Calendar disconnect deletes live credential state before attempting
provider revocation. Account deletion differs: Cadence captures revocation work,
deletes the Auth user and cascading hosted credential first, then attempts external
revocation. Failed Auth deletion preserves the Calendar connection. A later
provider outage cannot turn completed account deletion into a retry.

### Early slice and remaining gates

The web and installed desktop consent → bounded read → render → disconnect slice
has live evidence. Offline restart, recovery, cancellation, wrong-account
rejection, stale-cache labeling, account switching, cache cleanup, and Cadence
data preservation also have recorded installed evidence. Source and fixture tests
cover partial pages, rate limits, malformed data, stale responses, and generation
fences.

Remaining gaps are explicit:

- Google Calendar data-access approval and post-approval web/native smoke checks;
- controlled live provider-failure and Workspace field-restriction cases;
- Apple-trusted public desktop distribution under Ticket 115;
- dense/overnight installed native fixtures and multi-day resume evidence noted
  in `docs/DESKTOP_PARITY.md`;
- fresh provider research if a later change depends on requirements after the
  dated 2026-09-16 review.

These gaps do not invalidate source or installed evidence. They prevent broader
public-release claims.

### Rollback and cleanup ownership

Release QA records exact prior Vercel deployments, preserved native builds,
database backups, callback compatibility, and migration evidence. The service
owner rolls back the web deployment or schema. The desktop release owner restores
the preserved build and protected database only through the documented release
workflow. The Google project owner changes callbacks, branding, audience, scopes,
or publication state.

Test cleanup removes the grant where authorized, disconnects the hosted
connection, clears desktop cache and pending state, restores the primary account,
and verifies SQLite integrity and owner rows. Private backups, recordings,
tokens, account identifiers, and provider payloads stay outside git.

## Proposed improvements

These are proposals, not observed behavior or accepted scope:

- Add a compact evidence table like the one above to each future integration QA
  note so source, fixture, native, live, deployed, and approval claims stay apart.
- Run the smallest installed transport smoke immediately after the first broker
  build. This should include one complete read and disconnect cleanup.
- Add controlled live failure and restricted-field fixtures when an authorized
  provider account can supply them. Synthetic coverage remains valid meanwhile.

Do not add a connector SDK, generic provider registry, or common event envelope
until a second accepted integration proves matching semantics.

## Cadence MCP server (Tickets 220–232)

`docs/MCP_INTEGRATION.md` is the completed brief for the remote MCP server and
the Claude and ChatGPT plugins. Its operation contract is `docs/MCP_CONTRACT.md`
(Ticket 221). The integration operations layer is one transport adapter (MCP)
over one versioned contract. It is not a connector SDK, provider registry, or
common event envelope, so the rule above still holds. A later REST or webhook
adapter would reuse the same contract under its own ticket.
