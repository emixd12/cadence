# MCP Operation Contract

This document describes the versioned contract for every Cadence MCP tool
(Ticket 221). The contract lives in `packages/core/src/integration/` and is the
single source for tool names, scopes, descriptions, annotations, input and
output schemas, error codes, and limits. The MCP endpoint, the integration
handlers, the plugin packages, and the developer docs read from it. For the
integration direction, security model, and request flow, see
[MCP_INTEGRATION.md](MCP_INTEGRATION.md).

Scope: shared core only. Handlers (Tickets 224–225), the database (Ticket 222),
the transport (Ticket 228), and OAuth (Ticket 226) consume this contract.

## How the contract is built

- **One schema source.** Each schema is written once with a small builder in
  `schema.ts`. The builder produces the published JSON Schema 2020-12 object
  and the TypeScript type from the same definition. There are no hand-kept
  duplicates.
- **Runtime validation.** `validate.ts` interprets the published schema objects
  directly. `assertSupportedSchema` rejects any keyword outside the supported
  subset. `contract.ts` adds the cross-field rules JSON Schema cannot express:
  date-range order and caps, and custom time ranges whose ends differ.
- **Reference check.** Tests also validate every schema and fixture with Ajv's
  JSON Schema 2020-12 implementation, so the core validator and a reference
  validator must agree.
- **Portability.** The module imports only Temporal and other core files, so
  `npm run core:check` passes and desktop or a future mobile client can reuse it.
- **No new runtime dependency.** `ajv` is a dev dependency used only by tests.

## Output conventions

- Cadence domain terms: Behavior, Occurrence, Completed, Not Completed,
  Unresolved, and Needs decision. Stored statuses are `unresolved`,
  `completed`, and `not_completed`. `status_label` gives the display words.
  There is no "missed" status.
- Calendar days are `local_date` values (`YYYY-MM-DD`) in the account's IANA
  timezone. Outputs give instants in UTC (ending in `Z`). Inputs accept any
  RFC 3339 offset.
- Entity ids are UUIDs. Editable records (Behaviors and Occurrences) carry an
  opaque `revision` token.
- `needs_decision` is derived (Unresolved and `local_date` before today). It is
  never stored.
- Adherence is Completed divided by Completed plus Not Completed. Unresolved is
  excluded. There are no streaks.
- Account identity appears only as `account_ref`, a per-client pairwise id.
  The internal user id and the email address are never returned.
- Every output object sets `additionalProperties: false`. Tests check that no
  output property name refers to an excluded data class.

## Write inputs (Facets foundations)

- Every write accepts an optional `idempotency_key`. A repeat with the same key
  and input returns the first result. Reusing a key with different input
  returns `idempotency_key_reused`.
- Concurrency: `set_occurrence_status` accepts `expected_status`; the other
  writes accept `expected_revision`. `update_behavior` requires it. A stale
  value returns `conflict` and changes nothing.
- `create_behavior` accepts an optional `external_ref`, stored for the calling
  client only.
- List reads (`list_behaviors`, `list_categories`, `list_occurrences`) accept
  `updated_since` for incremental reads.

## Annotation guidance (checked 2026-10-18)

- Claude's connector review criteria require a `title` on every tool,
  `readOnlyHint: true` on read-only tools, and `destructiveHint: true` on tools
  that modify or delete data. Claude runs read-only tools without per-call
  confirmation and always confirms destructive tools.
- OpenAI's MCP server guide sets `readOnlyHint: true` only when a tool cannot
  change state, and `destructiveHint: true` when a tool can cause irreversible
  or hard-to-reverse outcomes. It also asks for the standard `search` and
  `fetch` input shapes, absolute user-openable URLs, and internal ids in `id`.
- Cadence applies the stricter rule. Every write that modifies an existing
  record sets `destructiveHint: true`. `create_behavior` only adds a record, so
  it sets `false`. No tool reaches the open internet, so every tool sets
  `openWorldHint: false`. Each tool's rationale is listed in the tool reference
  below.

## Updating the contract

1. Edit the registry in `packages/core/src/integration/`.
2. Follow the versioning table below. Published tool names never change.
3. Add or update fixtures in `tests/fixtures/integration/`.
4. Regenerate this document:
   `UPDATE_MCP_CONTRACT_DOC=1 npx vitest run tests/integration-contract.test.ts`.
5. Run `npm run core:check` and `npm run test`. The drift test fails when the
   generated section below differs from the registry.

<!-- BEGIN GENERATED: integration contract reference. Do not edit by hand. -->

Contract version: `1.0.0`. Generated from `packages/core/src/integration/`.

## Operations

| Tool | Title | Scope | Read only | Destructive | Idempotent |
|---|---|---|---|---|---|
| `get_account_context` | Get Cadence account context | `cadence.read` | yes | no | yes |
| `list_behaviors` | List Behaviors | `cadence.read` | yes | no | yes |
| `get_behavior` | Get Behavior | `cadence.read` | yes | no | yes |
| `list_categories` | List categories | `cadence.read` | yes | no | yes |
| `get_timeline` | Get Timeline | `cadence.read` | yes | no | yes |
| `list_occurrences` | List Occurrences | `cadence.read` | yes | no | yes |
| `get_occurrence` | Get Occurrence | `cadence.read` | yes | no | yes |
| `get_adherence_summary` | Get adherence summary | `cadence.read` | yes | no | yes |
| `search` | Search Cadence | `cadence.read` | yes | no | yes |
| `fetch` | Fetch Cadence record | `cadence.read` | yes | no | yes |
| `set_occurrence_status` | Set Occurrence status | `cadence.occurrences.write` | no | yes | yes |
| `update_occurrence_note` | Update Occurrence note | `cadence.occurrences.write` | no | yes | yes |
| `create_behavior` | Create Behavior | `cadence.behaviors.write` | no | no | no |
| `update_behavior` | Update Behavior | `cadence.behaviors.write` | no | yes | yes |
| `archive_behavior` | Archive Behavior | `cadence.behaviors.write` | no | yes | yes |
| `restore_behavior` | Restore Behavior | `cadence.behaviors.write` | no | yes | yes |

Every tool sets `openWorldHint: false`.

## Scope matrix

| Scope | Required | Grants | Tools |
|---|---|---|---|
| `cadence.read` | yes | Read Behaviors, categories, Occurrences, statuses, notes, time sessions, adherence, and the profile timezone. | `get_account_context`, `list_behaviors`, `get_behavior`, `list_categories`, `get_timeline`, `list_occurrences`, `get_occurrence`, `get_adherence_summary`, `search`, `fetch` |
| `cadence.occurrences.write` | no | Mark Occurrences Completed, Not Completed, or Unresolved, and edit Occurrence notes. | `set_occurrence_status`, `update_occurrence_note` |
| `cadence.behaviors.write` | no | Create and edit Behaviors, and archive or restore them. Nothing is deleted. | `create_behavior`, `update_behavior`, `archive_behavior`, `restore_behavior` |

## Error catalog

| Code | HTTP status | Retryable | Before retrying | Meaning |
|---|---|---|---|---|
| `invalid_input` | 400 | yes | `after_change` | The input does not match the tool's schema or rules. `field_errors` names each problem. |
| `limit_exceeded` | 400 | yes | `after_change` | The request asks for more than a contract limit allows, such as too long a date range or too large a result. Narrow the request. |
| `not_found` | 404 | no | `never` | No record with that id exists for this account. |
| `conflict` | 409 | yes | `after_refresh` | The record changed since it was read: `expected_status` or `expected_revision` is stale. Nothing changed. |
| `idempotency_key_reused` | 409 | yes | `after_change` | The `idempotency_key` was already used with a different input. Use a new key for a new request. |
| `invalid_state` | 409 | yes | `after_refresh` | The record's current state does not allow this change. |
| `authentication_required` | 401 | yes | `after_authorization` | The access token is missing, expired, revoked, or issued for another resource. Reconnect Cadence. |
| `insufficient_scope` | 403 | yes | `after_authorization` | The connection does not include the permission this tool needs. `required_scopes` lists it. |
| `rate_limited` | 429 | yes | `after_delay` | Too many requests for this connection. Retry after `retry_after_seconds`. |
| `service_unavailable` | 503 | yes | `after_delay` | Cadence integrations are temporarily unavailable. |
| `internal_error` | 500 | yes | `after_delay` | Cadence could not complete the request. Nothing is assumed to have changed; retry once with the same `idempotency_key`. |

## Limits

| Limit | Value |
|---|---|
| Default page size | 50 |
| Maximum page size | 100 |
| `list_occurrences` maximum date range (days, inclusive) | 92 |
| `get_adherence_summary` maximum date range (days, inclusive) | 366 |
| `get_timeline` maximum days | 14 |
| Needs decision lookback (days) | 90 |
| Needs decision items returned | 100 |
| Behavior ids per filter | 50 |
| Search query length (characters) | 200 |
| Search results | 20 |
| Behavior title length | 160 |
| Behavior description length | 1000 |
| Location text length | 500 |
| Schedules per Behavior | 6 |
| Time entries per schedule | 8 |
| Recurrence interval (input) | 999 |
| Default duration (minutes) | 1440 |
| Occurrence note length | 2000 |
| Archive note length | 2000 |
| Cursor length | 512 |
| Revision length | 128 |
| Idempotency key minimum length | 8 |
| Idempotency key maximum length | 128 |
| External reference length | 200 |
| Idempotent replay window (seconds) | 86400 |
| Maximum result size (UTF-8 bytes) | 100000 |
| Reminder offsets (minutes) | 0, 15, 60, 1440, 4320 |

## Data included and excluded

Included:

- Behaviors, including archived Behaviors
- Schedules and time entries
- Categories
- Occurrences, stored statuses, and status history
- Occurrence notes and archive notes
- Occurrence time sessions
- Adherence analytics (Unresolved excluded, no streaks)
- Per-Behavior reminder settings
- The profile timezone

Excluded:

- Google Calendar events and the calendar connection
- Travel settings, routes, and device location
- Daily Brief text and preferences
- Reminder delivery logs and push subscriptions
- Import-run internals
- Credentials and tokens
- The email address and display name
- The internal account user id (only a per-client pairwise id is returned)

## Versioning

| Change | Version bump |
|---|---|
| Description, title, or documentation wording that does not change behavior | patch |
| New tool, new optional input field, new output field, or new error code | minor |
| Raised limit, or a relaxed input constraint | minor |
| New required input field, removed or renamed field, changed field type or meaning | major |
| Removed tool, lowered limit, new required scope, or stricter input constraint | major |
| Renaming a published tool | never |

- Clients must ignore output fields they do not recognize; minor versions can add them.
- Clients must treat unknown error codes by their `retryable` flag.
- A tool is deprecated for at least one minor release before a major release removes it.

## Tool reference

### `get_account_context`

**Get Cadence account context.** Returns the account's timezone, today's local date and time, the permissions this connection has, and how fresh the data is. Use it first to learn what "today" means for this user and which Cadence tools the connection may call.

- Scope: `cadence.read`
- Annotations: readOnlyHint true, destructiveHint false, idempotentHint true, openWorldHint false
- Annotation rationale: Reads account data and changes nothing, so readOnlyHint is true. Claude runs read-only tools without per-call confirmation, and OpenAI asks for readOnlyHint on every read. openWorldHint is false because the tool reaches only the user's own Cadence account.
- Errors: `invalid_input`, `authentication_required`, `rate_limited`, `service_unavailable`, `internal_error`
- Since: 1.0.0

Input:

No fields.

Output:

| Field | Required | Type |
|---|---|---|
| `account_ref` | yes | string |
| `timezone` | yes | string |
| `today_local_date` | yes | string (date) |
| `local_time` | yes | string |
| `now` | yes | string (date-time) |
| `granted_scopes` | yes | array of `cadence.read`, `cadence.occurrences.write`, `cadence.behaviors.write` |
| `contract_version` | yes | `"1.0.0"` |
| `freshness` | yes | object |

### `list_behaviors`

**List Behaviors.** Lists the user's Behaviors, the recurring things they track (habits, routines, or recurring tasks), with schedules, reminders, category, and archive notes. Use it to find a Behavior id or review what the user tracks. Includes archived Behaviors unless filtered.

- Scope: `cadence.read`
- Annotations: readOnlyHint true, destructiveHint false, idempotentHint true, openWorldHint false
- Annotation rationale: Reads account data and changes nothing, so readOnlyHint is true. Claude runs read-only tools without per-call confirmation, and OpenAI asks for readOnlyHint on every read. openWorldHint is false because the tool reaches only the user's own Cadence account.
- Errors: `invalid_input`, `authentication_required`, `rate_limited`, `service_unavailable`, `internal_error`
- Since: 1.0.0

Input:

| Field | Required | Type |
|---|---|---|
| `state` | no | `active`, `archived`, `all` |
| `category_id` | no | string (uuid) |
| `updated_since` | no | string (date-time) |
| `page_size` | no | integer |
| `cursor` | no | string |

Output:

| Field | Required | Type |
|---|---|---|
| `behaviors` | yes | array of object |
| `next_cursor` | yes | string or null |

### `get_behavior`

**Get Behavior.** Returns one Behavior's full definition: schedules and time entries, reminder settings, category, description, location, default duration, end date, archive notes, and revision. Use it before editing a Behavior.

- Scope: `cadence.read`
- Annotations: readOnlyHint true, destructiveHint false, idempotentHint true, openWorldHint false
- Annotation rationale: Reads account data and changes nothing, so readOnlyHint is true. Claude runs read-only tools without per-call confirmation, and OpenAI asks for readOnlyHint on every read. openWorldHint is false because the tool reaches only the user's own Cadence account.
- Errors: `invalid_input`, `authentication_required`, `rate_limited`, `service_unavailable`, `internal_error`, `not_found`
- Since: 1.0.0

Input:

| Field | Required | Type |
|---|---|---|
| `behavior_id` | yes | string (uuid) |

Output:

| Field | Required | Type |
|---|---|---|
| `behavior` | yes | object |

### `list_categories`

**List categories.** Lists the user's Behavior categories in display order. Use it to choose a category id when creating or editing a Behavior.

- Scope: `cadence.read`
- Annotations: readOnlyHint true, destructiveHint false, idempotentHint true, openWorldHint false
- Annotation rationale: Reads account data and changes nothing, so readOnlyHint is true. Claude runs read-only tools without per-call confirmation, and OpenAI asks for readOnlyHint on every read. openWorldHint is false because the tool reaches only the user's own Cadence account.
- Errors: `invalid_input`, `authentication_required`, `rate_limited`, `service_unavailable`, `internal_error`
- Since: 1.0.0

Input:

| Field | Required | Type |
|---|---|---|
| `updated_since` | no | string (date-time) |
| `page_size` | no | integer |
| `cursor` | no | string |

Output:

| Field | Required | Type |
|---|---|---|
| `categories` | yes | array of object |
| `next_cursor` | yes | string or null |

### `get_timeline`

**Get Timeline.** Returns the Timeline as the Cadence web app groups it: Needs decision (Unresolved Occurrences from before today) plus each day's Occurrences. Use it for questions such as "what's on today" or "what still needs a decision". Covers up to 14 days from the start date.

- Scope: `cadence.read`
- Annotations: readOnlyHint true, destructiveHint false, idempotentHint true, openWorldHint false
- Annotation rationale: Reads account data and changes nothing, so readOnlyHint is true. Claude runs read-only tools without per-call confirmation, and OpenAI asks for readOnlyHint on every read. openWorldHint is false because the tool reaches only the user's own Cadence account.
- Errors: `invalid_input`, `authentication_required`, `rate_limited`, `service_unavailable`, `internal_error`
- Since: 1.0.0

Input:

| Field | Required | Type |
|---|---|---|
| `start_local_date` | no | string (date) |
| `days` | no | integer |
| `include_needs_decision` | no | boolean |

Output:

| Field | Required | Type |
|---|---|---|
| `timezone` | yes | string |
| `today_local_date` | yes | string (date) |
| `needs_decision` | yes | object or null |
| `days` | yes | array of object |
| `freshness` | yes | object |

### `list_occurrences`

**List Occurrences.** Lists Occurrences (single scheduled instances of a Behavior, such as one day's habit check-in) over a date range of up to 92 days, filtered by status or Behavior. Use it for history questions or to find an Occurrence id. Results are ordered by date and time.

- Scope: `cadence.read`
- Annotations: readOnlyHint true, destructiveHint false, idempotentHint true, openWorldHint false
- Annotation rationale: Reads account data and changes nothing, so readOnlyHint is true. Claude runs read-only tools without per-call confirmation, and OpenAI asks for readOnlyHint on every read. openWorldHint is false because the tool reaches only the user's own Cadence account.
- Errors: `invalid_input`, `authentication_required`, `rate_limited`, `service_unavailable`, `internal_error`, `limit_exceeded`
- Since: 1.0.0

Input:

| Field | Required | Type |
|---|---|---|
| `start_local_date` | yes | string (date) |
| `end_local_date` | yes | string (date) |
| `statuses` | no | array of `unresolved`, `completed`, `not_completed` |
| `needs_decision_only` | no | boolean |
| `behavior_ids` | no | array of string (uuid) |
| `updated_since` | no | string (date-time) |
| `page_size` | no | integer |
| `cursor` | no | string |

Output:

| Field | Required | Type |
|---|---|---|
| `timezone` | yes | string |
| `occurrences` | yes | array of object |
| `next_cursor` | yes | string or null |
| `freshness` | yes | object |

### `get_occurrence`

**Get Occurrence.** Returns one Occurrence with its note, full status history, measured time sessions, and revision. Use it before changing an Occurrence's status or note.

- Scope: `cadence.read`
- Annotations: readOnlyHint true, destructiveHint false, idempotentHint true, openWorldHint false
- Annotation rationale: Reads account data and changes nothing, so readOnlyHint is true. Claude runs read-only tools without per-call confirmation, and OpenAI asks for readOnlyHint on every read. openWorldHint is false because the tool reaches only the user's own Cadence account.
- Errors: `invalid_input`, `authentication_required`, `rate_limited`, `service_unavailable`, `internal_error`, `not_found`
- Since: 1.0.0

Input:

| Field | Required | Type |
|---|---|---|
| `occurrence_id` | yes | string (uuid) |

Output:

| Field | Required | Type |
|---|---|---|
| `occurrence` | yes | object |

### `get_adherence_summary`

**Get adherence summary.** Returns Completed, Not Completed, and Unresolved counts and the adherence rate, overall and per Behavior, for a date range of up to 366 days. Adherence is Completed divided by Completed plus Not Completed. Unresolved Occurrences, including Needs decision, are excluded. It is null when nothing is resolved. Use it for "how am I doing" questions. Cadence does not compute streaks.

- Scope: `cadence.read`
- Annotations: readOnlyHint true, destructiveHint false, idempotentHint true, openWorldHint false
- Annotation rationale: Reads account data and changes nothing, so readOnlyHint is true. Claude runs read-only tools without per-call confirmation, and OpenAI asks for readOnlyHint on every read. openWorldHint is false because the tool reaches only the user's own Cadence account.
- Errors: `invalid_input`, `authentication_required`, `rate_limited`, `service_unavailable`, `internal_error`, `limit_exceeded`
- Since: 1.0.0

Input:

| Field | Required | Type |
|---|---|---|
| `start_local_date` | yes | string (date) |
| `end_local_date` | yes | string (date) |
| `behavior_ids` | no | array of string (uuid) |

Output:

| Field | Required | Type |
|---|---|---|
| `start_local_date` | yes | string (date) |
| `end_local_date` | yes | string (date) |
| `timezone` | yes | string |
| `adherence_definition` | yes | `"Adherence is Completed divided by Completed plus Not Completed. Unresolved Occurrences, including Needs decision, are excluded. It is null when nothing is resolved."` |
| `overall` | yes | object |
| `behaviors` | yes | array of object |

### `search`

**Search Cadence.** Searches the user's Behaviors (titles, descriptions, archive notes) and Occurrence notes by text. Returns ids for `fetch` and links into the Cadence web app. Use it to find a habit, routine, or note by keyword.

- Scope: `cadence.read`
- Annotations: readOnlyHint true, destructiveHint false, idempotentHint true, openWorldHint false
- Annotation rationale: Reads account data and changes nothing, so readOnlyHint is true. Claude runs read-only tools without per-call confirmation, and OpenAI asks for readOnlyHint on every read. openWorldHint is false because the tool reaches only the user's own Cadence account.
- Errors: `invalid_input`, `authentication_required`, `rate_limited`, `service_unavailable`, `internal_error`
- Since: 1.0.0

Input:

| Field | Required | Type |
|---|---|---|
| `query` | yes | string |

Output:

| Field | Required | Type |
|---|---|---|
| `results` | yes | array of object |

### `fetch`

**Fetch Cadence record.** Returns the full text of one `search` result: a Behavior's definition or an Occurrence and its note. Use it after `search` to read a result.

- Scope: `cadence.read`
- Annotations: readOnlyHint true, destructiveHint false, idempotentHint true, openWorldHint false
- Annotation rationale: Reads account data and changes nothing, so readOnlyHint is true. Claude runs read-only tools without per-call confirmation, and OpenAI asks for readOnlyHint on every read. openWorldHint is false because the tool reaches only the user's own Cadence account.
- Errors: `invalid_input`, `authentication_required`, `rate_limited`, `service_unavailable`, `internal_error`, `not_found`
- Since: 1.0.0

Input:

| Field | Required | Type |
|---|---|---|
| `id` | yes | string |

Output:

| Field | Required | Type |
|---|---|---|
| `id` | yes | string |
| `title` | yes | string |
| `text` | yes | string |
| `url` | yes | string (uri) |
| `metadata` | yes | object |

### `set_occurrence_status`

**Set Occurrence status.** Marks one Occurrence Completed or Not Completed, or returns it to Unresolved. Use it when the user says they did, or did not do, a scheduled habit, routine, or task. Setting the current status again changes nothing. Each change is kept in the status history.

- Scope: `cadence.occurrences.write`
- Annotations: readOnlyHint false, destructiveHint true, idempotentHint true, openWorldHint false
- Annotation rationale: Changes stored data, so readOnlyHint is false. Claude's review criteria ask for destructiveHint true on tools that modify data, so Claude confirms each call; OpenAI reserves it for hard-to-reverse outcomes, and a status can be set back, so the hint is conservative for ChatGPT. The same arguments always produce the same end state, so idempotentHint is true. openWorldHint is false: only the user's own Cadence account is touched.
- Errors: `invalid_input`, `authentication_required`, `rate_limited`, `service_unavailable`, `internal_error`, `insufficient_scope`, `not_found`, `conflict`, `idempotency_key_reused`, `invalid_state`
- Since: 1.0.0

Input:

| Field | Required | Type |
|---|---|---|
| `occurrence_id` | yes | string (uuid) |
| `status` | yes | `unresolved`, `completed`, `not_completed` |
| `expected_status` | no | `unresolved`, `completed`, `not_completed` |
| `idempotency_key` | no | string |

Output:

| Field | Required | Type |
|---|---|---|
| `occurrence` | yes | object |
| `previous_status` | yes | `unresolved`, `completed`, `not_completed` |
| `changed` | yes | boolean |

### `update_occurrence_note`

**Update Occurrence note.** Adds, replaces, or clears the note on one Occurrence. Use it when the user wants to record context about a specific scheduled instance, such as how a workout went.

- Scope: `cadence.occurrences.write`
- Annotations: readOnlyHint false, destructiveHint true, idempotentHint true, openWorldHint false
- Annotation rationale: Replaces the previous note text, which Cadence does not keep in history, so destructiveHint is true under both Claude's and OpenAI's guidance. The same arguments produce the same note, so idempotentHint is true. openWorldHint is false.
- Errors: `invalid_input`, `authentication_required`, `rate_limited`, `service_unavailable`, `internal_error`, `insufficient_scope`, `not_found`, `conflict`, `idempotency_key_reused`
- Since: 1.0.0

Input:

| Field | Required | Type |
|---|---|---|
| `occurrence_id` | yes | string (uuid) |
| `note` | yes | string |
| `expected_revision` | no | string |
| `idempotency_key` | no | string |

Output:

| Field | Required | Type |
|---|---|---|
| `occurrence` | yes | object |
| `changed` | yes | boolean |

### `create_behavior`

**Create Behavior.** Creates a Behavior, a recurring thing the user wants to track (a habit, routine, or recurring task), with structured schedules and reminder settings. Supports daily, every N days, weekly or every N weeks on chosen weekdays, and monthly on day N. Browser reminders default to on and email reminders to off. Use list_categories to pick a category.

- Scope: `cadence.behaviors.write`
- Annotations: readOnlyHint false, destructiveHint false, idempotentHint false, openWorldHint false
- Annotation rationale: Adds a new Behavior and changes no existing record, so destructiveHint is false under both Claude's and OpenAI's guidance; readOnlyHint is false, so clients still treat it as a write. Calling it twice without an idempotency_key creates two Behaviors, so idempotentHint is false. openWorldHint is false.
- Errors: `invalid_input`, `authentication_required`, `rate_limited`, `service_unavailable`, `internal_error`, `insufficient_scope`, `not_found`, `idempotency_key_reused`
- Since: 1.0.0

Input:

| Field | Required | Type |
|---|---|---|
| `title` | yes | string |
| `description` | no | string |
| `location_text` | no | string |
| `category_id` | no | string (uuid) or null |
| `schedules` | yes | array of object |
| `reminders` | no | object |
| `default_duration_minutes` | no | integer |
| `end_date` | no | string (date) |
| `external_ref` | no | string |
| `idempotency_key` | no | string |

Output:

| Field | Required | Type |
|---|---|---|
| `behavior` | yes | object |

### `update_behavior`

**Update Behavior.** Edits a Behavior's title, description, location, category, schedules, reminders, default duration, or end date. Only the fields sent change; `schedules`, when sent, replaces the whole schedule list. Past and resolved Occurrences are preserved. Use get_behavior first to read the current definition and revision.

- Scope: `cadence.behaviors.write`
- Annotations: readOnlyHint false, destructiveHint true, idempotentHint true, openWorldHint false
- Annotation rationale: Overwrites Behavior fields, and a schedule change can remove future Unresolved Occurrences, so destructiveHint is true under both Claude's and OpenAI's guidance. Repeating the same arguments leaves the same definition, so idempotentHint is true. openWorldHint is false.
- Errors: `invalid_input`, `authentication_required`, `rate_limited`, `service_unavailable`, `internal_error`, `insufficient_scope`, `not_found`, `conflict`, `idempotency_key_reused`, `invalid_state`
- Since: 1.0.0

Input:

| Field | Required | Type |
|---|---|---|
| `behavior_id` | yes | string (uuid) |
| `expected_revision` | yes | string |
| `title` | no | string |
| `description` | no | string or null |
| `location_text` | no | string or null |
| `category_id` | no | string (uuid) or null |
| `schedules` | no | array of object |
| `reminders` | no | object |
| `default_duration_minutes` | no | integer or null |
| `end_date` | no | string (date) or null |
| `idempotency_key` | no | string |

At least one of `title`, `description`, `location_text`, `category_id`, `schedules`, `reminders`, `default_duration_minutes`, `end_date` is required.

Output:

| Field | Required | Type |
|---|---|---|
| `behavior` | yes | object |
| `changed` | yes | boolean |

### `archive_behavior`

**Archive Behavior.** Archives a Behavior so it schedules no new Occurrences, with an optional archive note. History, notes, and past Occurrences are kept, and restore_behavior reverses it. Nothing is deleted. Archiving an archived Behavior changes nothing.

- Scope: `cadence.behaviors.write`
- Annotations: readOnlyHint false, destructiveHint true, idempotentHint true, openWorldHint false
- Annotation rationale: Modifies the Behavior and stops future scheduling, which Claude's review criteria treat as destructive, so destructiveHint is true. It is reversible with restore_behavior, so OpenAI's stricter reading would allow false; the conservative value keeps confirmation in both clients. Repeating it changes nothing, so idempotentHint is true. openWorldHint is false.
- Errors: `invalid_input`, `authentication_required`, `rate_limited`, `service_unavailable`, `internal_error`, `insufficient_scope`, `not_found`, `conflict`, `idempotency_key_reused`
- Since: 1.0.0

Input:

| Field | Required | Type |
|---|---|---|
| `behavior_id` | yes | string (uuid) |
| `archive_note` | no | string |
| `expected_revision` | no | string |
| `idempotency_key` | no | string |

Output:

| Field | Required | Type |
|---|---|---|
| `behavior` | yes | object |
| `changed` | yes | boolean |

### `restore_behavior`

**Restore Behavior.** Restores an archived Behavior so it schedules Occurrences again from today. Archive notes are kept. Restoring an active Behavior changes nothing.

- Scope: `cadence.behaviors.write`
- Annotations: readOnlyHint false, destructiveHint true, idempotentHint true, openWorldHint false
- Annotation rationale: Modifies an existing Behavior's state and resumes scheduling, which Claude's review criteria treat as a data modification, so destructiveHint is true. Under OpenAI's guidance the change is easy to reverse, so the value is conservative there. Repeating it changes nothing, so idempotentHint is true. openWorldHint is false.
- Errors: `invalid_input`, `authentication_required`, `rate_limited`, `service_unavailable`, `internal_error`, `insufficient_scope`, `not_found`, `conflict`, `idempotency_key_reused`
- Since: 1.0.0

Input:

| Field | Required | Type |
|---|---|---|
| `behavior_id` | yes | string (uuid) |
| `expected_revision` | no | string |
| `idempotency_key` | no | string |

Output:

| Field | Required | Type |
|---|---|---|
| `behavior` | yes | object |
| `changed` | yes | boolean |

<!-- END GENERATED: integration contract reference -->
