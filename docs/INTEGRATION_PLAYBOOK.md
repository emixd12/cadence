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

## Worked briefs: connector expansion (Tickets 220–228)

Status, October 18, 2026: Ticket 220 completed these briefs as documentation.
No runtime code, provider configuration, private account read, or deployment has
occurred. `docs/EXTERNAL_EVENT_CONTRACT.md` owns the planned wire contracts.
`STATUS.md` owns current state.

### Shared boundary

- **User benefit:** One Settings connector library shows Google Calendar,
  Outlook Calendar, iCloud Calendar, and Hevy workout timing. Timeline shows
  selected scheduled events and recorded workouts as context. Daily Brief may
  use each source only after its own disclosure.
- **Data direction:** Provider → Cadence only. Write authority is `none` for
  every provider.
- **Account mapping:** The Supabase user ID owns every connection. New provider
  identities bind to that Cadence account. They need not match the Google
  sign-in identity. One linked account per provider. Existing Google
  same-subject rules are unchanged.
- **Source of truth:** Providers own source records. Hosted connection rows own
  consent, identity binding, generation, and selection. A validated snapshot owns
  one read. Desktop caches own only the last complete matching copy. Cadence
  owns all tracking records.
- **Onward disclosure:** Separate default-off Daily Brief disclosure per source.
  The existing `includeCalendar` grant stays Google-only.
- **Explicit exclusions:** Provider writes, invitation responses, automatic
  Behavior completion, workout coaching, exercise analysis, Apple Health,
  EventKit and local-only Mac calendars, multiple accounts per provider,
  account-free desktop connectors, background polling, a generic connector
  registry or SDK, new primary routes, and native mobile.

| Platform | Impact |
|---|---|
| Web | Provider routes and services under Tickets 222–224 and 227; Settings library and Timeline under Ticket 225; Daily Brief under Ticket 226. |
| Desktop | Linked-account mode only. Desktop calls hosted brokers with its Supabase session and never stores provider credentials. Per-source disposable caches stay outside `cadence.sqlite3` and user-created backups. No EventKit bridge. Local mode shows the library as requiring an account. |
| Marketing | Ticket 228 updates provider availability, credential custody, retention, model disclosure, and pending-approval language. No connector runtime. |
| Future mobile | Deferred. The validated hosted contracts remain reusable. No mobile permission, cache, or offline behavior is implied. |

Shared lifecycle (Ticket 222): connect installs owner-bound AES-256-GCM sealed
credentials in the existing private schema and increments the generation.
Disconnect fences new reads, deletes credentials and caches, then performs any
documented provider revocation. Account deletion captures cleanup, deletes the
Auth user and cascading connection rows, and then attempts external revocation.
Credentials, raw responses, and cached source records are excluded from exports,
BehaviorLog, account synchronization, user-created backups, telemetry, and logs.
Sealed ciphertext may remain in infrastructure backups for the documented
seven-day window.

### Provider research, October 18, 2026

Each row is **documented support** from a public source read on October 18,
2026. None is live-provider, deployed, or public-approval evidence.

| Claim | Source |
|---|---|
| Hevy's public API is version `0.0.1`, available only to Hevy Pro users, may change or be abandoned, and uses an `api-key` header. | [Hevy OpenAPI initializer](https://api.hevyapp.com/docs/swagger-ui-init.js) |
| `GET /v1/workouts` takes `page` (≥ 1) and `pageSize` (max 10) and returns `page`, `page_count`, and `workouts`. It has no date filter and documents no ordering. | Same |
| `GET /v1/workouts/events?since=` returns updated/deleted events, newest first. Whether workout creation emits an `updated` event is not documented. | Same |
| The workout schema has `id`, `title`, `routine_id`, `description`, `start_time`, `end_time`, `updated_at`, `created_at`, and `exercises`. It has no location or timezone field. | Same |
| `GET /v1/user/info` returns `data.id`, `username`, `name`, `url`, units, and `is_pro`. | Same |
| The same key can create and update workouts, routines, templates, folders, and body measurements. No read-only key scope is documented. No rate limit, 401, or 429 response is documented. Hevy asks hourly or daily pollers to avoid the exact top of the hour. | Same |
| `calendarView` returns occurrences, exceptions, and single instances in a range. `Calendars.ReadBasic` is least privileged for work/school and personal accounts. `$top` is 1–1,000. Paging uses `@odata.nextLink`. Bounds use their own offsets; responses are UTC unless `Prefer: outlook.timezone` is sent. | [List calendarView](https://learn.microsoft.com/en-us/graph/api/calendar-list-calendarview?view=graph-rest-1.0), updated 2026-06-19 |
| Listing calendars uses `Calendars.ReadBasic` as least privileged and returns `id`, `name`, `canEdit`, `owner`, and related flags. | [List calendars](https://learn.microsoft.com/en-us/graph/api/user-list-calendars?view=graph-rest-1.0), updated 2026-10-15 |
| `Calendars.ReadBasic` excludes body, attachments, and extensions and needs no admin consent. | [Permissions reference](https://learn.microsoft.com/en-us/graph/permissions-reference), updated 2026-09-15 |
| Event `id` changes on a move unless `Prefer: IdType="ImmutableId"` is sent. Events expose `isAllDay`, `isCancelled`, `showAs`, `type`, `seriesMasterId`, `originalStart`, `originalStartTimeZone`, `responseStatus`, `changeKey`, and `webLink`. | [Event resource](https://learn.microsoft.com/en-us/graph/api/resources/event?view=graph-rest-1.0), updated 2026-04-20 |
| `sub` is an immutable per-application identifier. `tid` is the tenant; personal accounts use `9188040d-6c67-4c5b-b112-36a304b66dad`. `oid` requires the `profile` scope. Email and `preferred_username` are mutable and must not authorize. | [ID token claims](https://learn.microsoft.com/en-us/entra/identity-platform/id-token-claims-reference), updated 2026-06-15 |
| Authority segments are `common`, `organizations`, `consumers`, or a tenant. PKCE is recommended for confidential clients. Refresh tokens need `offline_access`, have no fixed web lifetime, and may be replaced on redemption. | [Authorization code flow](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow), updated 2026-06-15 |
| `dateTimeTimeZone.timeZone` accepts Windows zones plus a listed IANA subset. `America/New_York` is listed; `America/Toronto` and `Europe/Madrid` are not. | [dateTimeTimeZone](https://learn.microsoft.com/en-us/graph/api/resources/datetimetimezone), updated 2025-02-11 |
| Outlook allows 10,000 requests per 10 minutes and four concurrent requests per app and mailbox. | [Throttling limits](https://learn.microsoft.com/en-us/graph/throttling-limits), updated 2026-09-17 |
| With risk-based step-up consent, users cannot consent to most newer multitenant apps from unverified publishers. Verification needs a verified Microsoft AI Cloud Partner Program account and a non-`onmicrosoft.com` publisher domain. | [Publisher verification](https://learn.microsoft.com/en-us/entra/identity-platform/publisher-verification-overview), updated 2026-06-15 |
| Apple lets users authorize "supported" third-party apps for iCloud Mail, Calendar, and Contacts and revoke them under Account Data Sharing. It names no eligibility, registration, protocol, scopes, or token lifetime. | [Apple Support 121539](https://support.apple.com/en-us/121539), published 2025-10-07 |
| Apps without that support can use an app-specific password. It needs two-factor authentication. Users may hold 25. Removing one signs that app out. Changing the Apple Account password revokes all of them. | [Apple Support 102654](https://support.apple.com/en-us/102654), published 2025-10-08 |
| CalDAV discovery, `calendar-query`, `time-range`, and `expand` are standardized. | [RFC 4791](https://www.rfc-editor.org/rfc/rfc4791), [RFC 5397](https://www.rfc-editor.org/rfc/rfc5397), [RFC 6764](https://www.rfc-editor.org/rfc/rfc6764) |

Research gaps, all **not verified**:

- No public Apple developer documentation for the Apple Account authorization
  flow was found on 2026-10-18. Its eligibility and protocol remain unknown.
- Apple publishes no iCloud CalDAV host in a primary source that was found.
  `caldav.icloud.com` appears only in third-party guides.
- Apple does not limit an app-specific password to Calendar. Apple 102654 says
  the app "can access information like mail, contacts, and calendars that you
  store in iCloud". Cadence treats it as reaching at least iCloud Mail,
  Contacts, and Calendar.
- No Microsoft primary source found documents an API that lets a web app revoke
  its own delegated grant within the requested delegated scopes. Deleting an
  `oauth2PermissionGrant` needs higher, admin-consented permission (not
  re-fetched). Third-party guides point users to Microsoft account consent pages.
- Hevy documents no key revocation operation, ordering for workout lists, or
  rate limits.

### Hevy workout timing (Ticket 223)

| Item | Decision |
|---|---|
| Identity | `GET /v1/user/info` `data.id` binds the connection. Reconnect with another ID requires disconnect first. Username, name, and profile URL are not stored. |
| Connect | The user pastes a Hevy API key into Settings on web or linked desktop. The hosted service validates it with `user/info`, rejects `is_pro = false` as `permission_denied`, seals it, and returns only connection state. The key is never echoed, logged, or stored on desktop. |
| Allowed calls | Exactly `GET /v1/user/info`, `GET /v1/workouts/count`, and `GET /v1/workouts`. A fixed method/path allowlist and tests reject every other call. Cadence enforces read-only behavior because Hevy has no read-only key. |
| Range | Today and up to 30 prior local dates in the profile timezone. |
| Pagination | Call `GET /v1/workouts/count` first. Above 500 workouts, return `incomplete_pagination` without reading pages. Otherwise read `pageSize=10`, pages 1 through `page_count`, at most 50 pages, sequentially. Remove duplicate IDs, keeping the latest `updated_at`. Call `count` again after the last page. The read is `complete` only if every page was read, the count and `page_count` match before and after, and the 25-second deadline held. This 50-page ceiling applies only to the activity contract; the 20-page calendar bound is unchanged. An early-stop rule requires documented ordering or recorded live evidence and a contract revision. |
| Residual limits | Offset pages with undocumented ordering mean a workout created or deleted during the read can shift pages and be skipped. Equal before/after counts do not exclude a creation plus a deletion. `complete` therefore means no change was detected, not an atomic snapshot. Fifty-two sequential calls may not fit the deadline on slow responses; that returns `timeout`. Accounts with more than 500 workouts always read as incomplete. Ticket 228 discloses the 500-workout limit. |
| Fields | Workout ID, start, end, derived duration, and update revision. Everything else is discarded in the adapter. |
| Missing values | Location and source timezone are `unsupported`. An invalid or reversed interval quarantines the item and makes coverage incomplete. |
| Failures | 401/403 → `reconnect_required`; 404 user → `reconnect_required`; 429 if returned → `rate_limited`; 503 and other 5xx → `provider_unavailable`; deadline exhaustion → `timeout`. Retries follow the shared deadline rule in `docs/EXTERNAL_EVENT_CONTRACT.md`. Schema drift → `malformed_provider_response`. |
| Refresh | Manual and existing foreground refresh only. No polling. |
| Disconnect | Delete the sealed key and caches. Hevy documents no revocation call. Settings tells the user to remove or regenerate the key in Hevy's developer settings. |
| Account deletion | The confirmation screen gives the same Hevy key instruction before deletion. Deletion removes the sealed key with the account. |
| Model disclosure | Separate default-off Hevy disclosure. Only the activity projection reaches the model. |
| Live-access gate | An owner-authorized Hevy Pro test account and key. Not available in this wave. |
| Public-approval gate | None documented. Hevy terms review is not verified. |

### Outlook Calendar (Ticket 224)

| Item | Decision |
|---|---|
| Registration | One Microsoft Entra multitenant app that also accepts personal accounts (authority `common`), a server-held client secret or certificate, and exact web callback `/auth/outlook-calendar/callback`. Desktop uses the hosted broker with an opaque Keychain-correlated state, like Google. |
| Scopes | `openid offline_access Calendars.ReadBasic`. `profile`, `email`, `User.Read`, `Calendars.Read`, and write scopes are not requested. `Calendars.Read` would expose body and attachments that Cadence does not need. |
| Identity | Validated ID token `tid` plus `sub` (pairwise for Cadence's client ID). Reconnect must return the same pair or the callback fails as `wrong_account`. Email never identifies. |
| Connect | Five-minute one-use state, PKCE `S256`, nonce, issuer validation per tenant, and exact granted-scope validation. Refresh-token rotation replaces the sealed credential atomically. Ticket 224 implementation: state is a target marker (`w` or `d`) plus 32 random bytes; the stored hash covers the marker. The nonce is derived from the sealed PKCE verifier. The ID token comes directly from the token endpoint over TLS, so Cadence checks its claims (audience, `https://login.microsoftonline.com/{tid}/v2.0` issuer, `ver` 2.0, nonce, expiry) and not its signature. A present token `scope` must carry exactly one Graph permission, `Calendars.ReadBasic`; OpenID scopes may be echoed. An omitted `scope` is accepted, because Microsoft's v2 auth-code flow documents that it then covers the scopes requested on the initial leg. Token requests and token refreshes share the read's absolute deadline, and a refresh completing after it is discarded before use or rotation. Web callbacks require the initiating cookie user. Desktop callbacks forward the code and state to `cadence://outlook-calendar/callback` without consuming the attempt; the app then calls `PUT /api/outlook-calendar/connection` with its Cadence session and Keychain client state, and the service requires the same owner and client state before redeeming the code. OAuth state alone never binds an account. `consent_required` and AADSTS 65001/90094/90095 map to `admin_approval_required`; other denials map to `cancelled`. Provider error text is never stored or shown. |
| Calendars | `GET /me/calendars`, paged by `@odata.nextLink`, at most 20 pages. |
| Events | `GET /me/calendars/{id}/calendarView` with offset-bearing bounds widened by one day on each side, `$top=1000`, `Prefer: IdType="ImmutableId"`, no `Prefer: outlook.timezone`, and the event-zone all-day rule in `docs/EXTERNAL_EVENT_CONTRACT.md`. Windows zone names map only through a pinned CLDR `windowsZones.xml` release. Calendars are read sequentially to stay under four concurrent requests. |
| Missing values | Location, attendees, organizer, online meeting, and body are `unsupported` by scope or policy. Event state is `unknown` unless cancelled. |
| Failures | `invalid_grant` or `interaction_required` → `reconnect_required`; 403 → `permission_denied`; 429 → `rate_limited`; 503 → `provider_unavailable`. `Retry-After` is honored only when it fits the remaining deadline; otherwise the read stops with `retryAfterSeconds`. |
| Disconnect | Delete the sealed refresh credential and caches. No documented app-side revocation call was found. Settings links users to Microsoft account or My Apps permission pages to remove Cadence. |
| Account deletion | Same as disconnect after Auth deletion. No external revocation call. |
| Model disclosure | Separate default-off Outlook disclosure using the Calendar consumer projection. |
| Live-access gate | App registration, server secret, callback configuration, one personal Microsoft account, and one work/school tenant that permits user consent. Not available in this wave. |
| Public-approval gate | Publisher verification before public release, separate from technical acceptance. Tenant consent policies remain per customer and may require an administrator. |

### iCloud Calendar (Ticket 227)

The user confirmed iCloud on web and desktop on October 18, 2026. A hosted
server-side connector is the only path that reaches both surfaces. Apple's
"supported app" authorization had no public developer documentation that could
be found on 2026-10-18, so Cadence does not pursue that path. The only path with
Apple-documented user steps is an app-specific password used for CalDAV.

| Item | Decision |
|---|---|
| Credential | Apple Account email plus a user-generated app-specific password, entered in Settings on web or linked desktop and sent once over HTTPS to the hosted service. The service seals both values. Desktop never stores them. The UI says Apple does not limit the password to Calendar and that it can reach at least iCloud Mail, Contacts, and Calendar, that Cadence reads only Calendar, and how to revoke it. |
| Endpoint | `https://caldav.icloud.com` from third-party evidence only. Redirects are followed only to HTTPS hosts under `icloud.com`, at most three hops. |
| Discovery | `PROPFIND` depth 0 for `DAV:current-user-principal`; `PROPFIND` on the principal for `CALDAV:calendar-home-set`; `PROPFIND` depth 1 on the home for `DAV:resourcetype`, `DAV:displayname`, `CALDAV:supported-calendar-component-set`, `CALDAV:calendar-timezone`, and `DAV:getetag`. Only collections supporting `VEVENT` are listed. |
| Identity | The `current-user-principal` href binds the connection. Reconnect with a different principal requires disconnect first. The email is a login value, not an identity key. |
| Events | `REPORT` `calendar-query` with a `VCALENDAR/VEVENT` comp-filter, a UTC `time-range`, and `calendar-data` with `expand` over the same range, plus `DAV:getetag`. |
| Allowed methods | Only `PROPFIND` and `REPORT`. A method allowlist and tests reject `PUT`, `DELETE`, `MKCALENDAR`, `PROPPATCH`, `MOVE`, `COPY`, and `POST`. |
| Bounds | 32 calendars, 31 days, 5 MB per response, and the shared retry budget. |
| Missing values | Follow the iCloud mapping in `docs/EXTERNAL_EVENT_CONTRACT.md`. Unexpanded recurrence makes that calendar incomplete. |
| Failures | 401 → `reconnect_required`; 403 → `permission_denied`; 429 → `rate_limited`; 503 → `provider_unavailable`; `Retry-After` follows the shared deadline rule; malformed XML → `malformed_provider_response`; 507 or truncation → `incomplete_pagination`. |
| Disconnect | Delete the sealed credential and caches. Apple documents no programmatic revocation. Settings tells the user to remove the password at account.apple.com under Sign-In and Security → App-Specific Passwords, using Remove or Revoke All. |
| Account deletion | The confirmation screen gives the same instruction before deletion. |
| Model disclosure | Separate default-off iCloud disclosure using the Calendar consumer projection. |
| Files | `lib/services/icloud-calendar-provider.ts`, `lib/services/icloud-calendar.service.ts`, `lib/services/icloud-calendar-request.ts`, `lib/db/icloud-calendar.repo.ts`, `app/api/icloud-calendar/{connection,calendars,events}/route.ts`, and `apps/desktop/src/calendar/icloud-calendar.ts`. |
| Tests | `tests/icloud-calendar-provider.test.ts` with synthetic multistatus fixtures under `tests/fixtures/icloud-calendar/` covering discovery, timed, all-day, floating, `DURATION`, unspecified end, expanded and unexpanded recurrence, cancelled instances, `TRANSP`, 401, 403, 429 with fitting and non-fitting `Retry-After`, 503, deadline exhaustion, 507, oversize, malformed XML, off-domain redirects, and the method allowlist. Lifecycle tests cover sealing, wrong principal, disconnect, account deletion, and export exclusion. |
| Live-access gate | An owner-authorized Apple Account with two-factor authentication and an app-specific password. Not available in this wave. |
| Public-approval gate | None for the app-specific-password path. Apple "supported app" eligibility is unknown and not pursued. |

Local source work for Ticket 227 is approved and proceeds now: the intake route,
sealing, schema, provider adapter, and tests with synthetic credentials. Owner
acceptance of hosted app-specific-password custody is a product decision required
before any real Apple credential is used and before user release. Deployment and
live reads remain unauthorized.

### Later coverage, not implemented

Generic CalDAV for providers such as Fastmail, Zoho, and Yahoo, and read-only
subscription feeds such as Proton shared links, are later coverage. Each needs
its own provider authentication research, freshness disclosure, and ticket. They
are listed in `docs/FUTURE_UPDATES.md`. No code, route, or claim exists for them.

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
