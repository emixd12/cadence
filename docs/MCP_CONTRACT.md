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
  excluded. There are no streaks. Since 1.6.0 the counts and the rate cover
  scheduled Occurrences; `opportunity_completed_count` counts added
  opportunities apart.
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
  record sets `destructiveHint: true`. `create_behavior` and
  `add_opportunity_occurrence` only add a record, so they set `false`. No tool reaches the open internet, so every tool sets
  `openWorldHint: false`. Each tool's rationale is listed in the tool reference
  below.

## Updating the contract

1. Edit the registry in `packages/core/src/integration/`.
2. Follow the versioning table below. Tools can be added, renamed or removed
   through the deprecation path: a new tool is a minor version; a renamed or
   removed tool is marked deprecated for at least one minor release (a rename
   adds the new name beside the old one), then removed in the next major version.
3. Add or update fixtures in `tests/fixtures/integration/`.
4. Regenerate this document:
   `UPDATE_MCP_CONTRACT_DOC=1 npx vitest run tests/integration-contract.test.ts`.
5. Run `npm run core:check` and `npm run test`. The drift test fails when the
   generated section below differs from the registry.

<!-- BEGIN GENERATED: integration contract reference. Do not edit by hand. -->

Contract version: `1.7.0`. Generated from `packages/core/src/integration/`.

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
| `list_day_notes` | List day notes | `cadence.read` | yes | no | yes |
| `get_adherence_summary` | Get adherence summary | `cadence.read` | yes | no | yes |
| `search` | Search Cadence | `cadence.read` | yes | no | yes |
| `fetch` | Fetch Cadence record | `cadence.read` | yes | no | yes |
| `set_occurrence_status` | Set Occurrence status | `cadence.occurrences.write` | no | yes | yes |
| `set_parent_occurrence_status` | Set parent Behavior slot status | `cadence.occurrences.write` | no | yes | yes |
| `update_occurrence_note` | Update Occurrence note | `cadence.occurrences.write` | no | yes | yes |
| `move_occurrence_for_day` | Move Occurrence for today | `cadence.occurrences.write` | no | yes | no |
| `revert_occurrence_move` | Undo Occurrence move | `cadence.occurrences.write` | no | yes | no |
| `update_day_note` | Update day note | `cadence.occurrences.write` | no | yes | yes |
| `add_opportunity_occurrence` | Add opportunity to today | `cadence.occurrences.write` | no | no | no |
| `remove_opportunity_occurrence` | Remove added opportunity | `cadence.occurrences.write` | no | yes | yes |
| `create_behavior` | Create Behavior | `cadence.behaviors.write` | no | no | no |
| `update_behavior` | Update Behavior | `cadence.behaviors.write` | no | yes | yes |
| `archive_behavior` | Archive Behavior | `cadence.behaviors.write` | no | yes | yes |
| `restore_behavior` | Restore Behavior | `cadence.behaviors.write` | no | yes | yes |
| `end_behavior` | End Behavior now | `cadence.behaviors.write` | no | yes | yes |
| `pause_behavior` | Pause Behavior | `cadence.behaviors.write` | no | yes | yes |
| `resume_behavior` | Resume Behavior | `cadence.behaviors.write` | no | yes | yes |

Every tool sets `openWorldHint: false`.

## Scope matrix

| Scope | Required | Grants | Tools |
|---|---|---|---|
| `cadence.read` | yes | Read Behaviors, categories, Occurrences, statuses, notes, day notes, time sessions, adherence, and the profile timezone. | `get_account_context`, `list_behaviors`, `get_behavior`, `list_categories`, `get_timeline`, `list_occurrences`, `get_occurrence`, `list_day_notes`, `get_adherence_summary`, `search`, `fetch` |
| `cadence.occurrences.write` | no | Mark Occurrences Completed, Not Completed, or Unresolved, and edit Occurrence notes and day notes. | `set_occurrence_status`, `set_parent_occurrence_status`, `update_occurrence_note`, `move_occurrence_for_day`, `revert_occurrence_move`, `update_day_note`, `add_opportunity_occurrence`, `remove_opportunity_occurrence` |
| `cadence.behaviors.write` | no | Create and edit Behaviors, and archive or restore them. Nothing is deleted. | `create_behavior`, `update_behavior`, `archive_behavior`, `restore_behavior`, `end_behavior`, `pause_behavior`, `resume_behavior` |

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
| Sub-behaviors per `create_behavior` call | 25 |
| Largest `sub_behavior_sort_order` | 9999 |
| Occurrences per `set_parent_occurrence_status` call | 50 |
| Occurrence note length | 2000 |
| Day note length | 2000 |
| `list_day_notes` maximum date range (days, inclusive) | 92 |
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
- Parent and sub-behavior links, and derived parent slot rollups (never stored)
- Schedules and time entries
- Categories
- Occurrences, stored statuses, and status history
- Occurrence notes and archive notes
- Day notes (one note per calendar date, separate from Occurrence notes and statuses)
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
| Renaming a published tool: the new name is added and the old one deprecated | minor |
| Removing a deprecated tool or a renamed tool's old name | major |

- Clients must ignore output fields they do not recognize; minor versions can add them.
- Clients must treat unknown error codes by their `retryable` flag.
- A tool is deprecated for at least one minor release before a major release removes it. A rename keeps the old name working, marked deprecated, until that major release.

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
| `contract_version` | yes | `"1.7.0"` |
| `freshness` | yes | object |

### `list_behaviors`

**List Behaviors.** Lists the user's Behaviors, the recurring things they track (habits, routines, or recurring tasks), with schedules, reminders, category, run state, archive notes, and sub-behavior links. A parent Behavior lists its sub-behaviors (one level deep). Use it to find a Behavior id or review what the user tracks. Includes archived Behaviors unless filtered.

- Scope: `cadence.read`
- Annotations: readOnlyHint true, destructiveHint false, idempotentHint true, openWorldHint false
- Annotation rationale: Reads account data and changes nothing, so readOnlyHint is true. Claude runs read-only tools without per-call confirmation, and OpenAI asks for readOnlyHint on every read. openWorldHint is false because the tool reaches only the user's own Cadence account.
- Errors: `invalid_input`, `authentication_required`, `rate_limited`, `service_unavailable`, `internal_error`
- Since: 1.0.0

Input:

| Field | Required | Type |
|---|---|---|
| `state` | no | `active`, `archived`, `running`, `not_running`, `all` |
| `category_id` | no | string (uuid) |
| `is_opportunity` | no | boolean |
| `parent_behavior_id` | no | string (uuid) |
| `hierarchy` | no | `all`, `top_level`, `sub_behaviors` |
| `updated_since` | no | string (date-time) |
| `page_size` | no | integer |
| `cursor` | no | string |

Output:

| Field | Required | Type |
|---|---|---|
| `behaviors` | yes | array of object |
| `next_cursor` | yes | string or null |

### `get_behavior`

**Get Behavior.** Returns one Behavior's full definition: schedules and time entries, reminder settings, category, description, location, default duration, run state, end, pause, archive notes, parent link, sub-behaviors, and revision. Use it before editing a Behavior.

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

**Get Timeline.** Returns the Timeline as the Cadence web app groups it: Needs decision (Unresolved Occurrences from before today) plus each day's Occurrences, with parent Behavior slots and their derived progress in `parent_groups`. Use it for questions such as "what's on today" or "what still needs a decision". Covers up to 14 days from the start date.

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

### `list_day_notes`

**List day notes.** Lists the user's day notes for a date range of up to 92 days. A day note is the user's one note about a whole calendar date (for example "Travel day" or "Sick"). It is not an Occurrence note, has no status, and never changes Completed, Not Completed, Unresolved, Needs decision, adherence, or reminders. Use it for questions about how a day went overall. Only dates with a saved note are returned.

- Scope: `cadence.read`
- Annotations: readOnlyHint true, destructiveHint false, idempotentHint true, openWorldHint false
- Annotation rationale: Reads account data and changes nothing, so readOnlyHint is true. Claude runs read-only tools without per-call confirmation, and OpenAI asks for readOnlyHint on every read. openWorldHint is false because the tool reaches only the user's own Cadence account.
- Errors: `invalid_input`, `authentication_required`, `rate_limited`, `service_unavailable`, `internal_error`, `limit_exceeded`
- Since: 1.1.0

Input:

| Field | Required | Type |
|---|---|---|
| `start_local_date` | yes | string (date) |
| `end_local_date` | yes | string (date) |

Output:

| Field | Required | Type |
|---|---|---|
| `timezone` | yes | string |
| `day_notes` | yes | array of object |

### `get_adherence_summary`

**Get adherence summary.** Returns Completed, Not Completed, and Unresolved counts and the adherence rate, overall and per Behavior, for a date range of up to 366 days. Adherence is Completed divided by Completed plus Not Completed. Unresolved Occurrences, including Needs decision, are excluded. It is null when nothing is resolved. Counts and the rate cover scheduled Occurrences; opportunity_completed_count counts added opportunities apart. Use it for "how am I doing" questions. Cadence does not compute streaks.

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

**Search Cadence.** Searches the user's Behaviors (titles, descriptions, archive notes), Occurrence notes, and day notes by text. Returns ids for `fetch` and links into the Cadence web app. Use it to find a habit, routine, or note by keyword. A day note is the user's one note about a whole calendar date (for example "Travel day" or "Sick"). It is not an Occurrence note, has no status, and never changes Completed, Not Completed, Unresolved, Needs decision, adherence, or reminders.

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

**Fetch Cadence record.** Returns the full text of one `search` result: a Behavior's definition, an Occurrence and its note, or a day note. Use it after `search` to read a result. A day note is the user's one note about a whole calendar date (for example "Travel day" or "Sick"). It is not an Occurrence note, has no status, and never changes Completed, Not Completed, Unresolved, Needs decision, adherence, or reminders.

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

### `set_parent_occurrence_status`

**Set parent Behavior slot status.** Marks every sub-behavior Occurrence in one parent Behavior slot Completed or Not Completed in one change, such as a whole skin routine one morning. Name the slot with `local_date`, plus `slot_key` from get_timeline `parent_groups` when the parent has several times that day, or list `occurrence_ids`. Occurrences that already have the status do not change. To mark one step, use set_occurrence_status.

- Scope: `cadence.occurrences.write`
- Annotations: readOnlyHint false, destructiveHint true, idempotentHint true, openWorldHint false
- Annotation rationale: Changes stored statuses of several Occurrences at once, so readOnlyHint is false and destructiveHint is true under Claude's review criteria, which ask for it on tools that modify data; each status can be set back, so the hint is conservative for ChatGPT. The same arguments always leave the same statuses, so idempotentHint is true. openWorldHint is false: only the user's own Cadence account is touched.
- Errors: `invalid_input`, `authentication_required`, `rate_limited`, `service_unavailable`, `internal_error`, `insufficient_scope`, `not_found`, `conflict`, `idempotency_key_reused`, `invalid_state`
- Since: 1.7.0

Input:

| Field | Required | Type |
|---|---|---|
| `parent_behavior_id` | yes | string (uuid) |
| `status` | yes | `completed`, `not_completed` |
| `local_date` | no | string (date) |
| `slot_key` | no | string (date-time) |
| `occurrence_ids` | no | array of string (uuid) |
| `expected_statuses` | no | array of object |
| `idempotency_key` | no | string |

At least one of `local_date`, `occurrence_ids` is required.

Output:

| Field | Required | Type |
|---|---|---|
| `parent_behavior_id` | yes | string (uuid) |
| `status` | yes | `completed`, `not_completed` |
| `occurrences` | yes | array of object |
| `changed_occurrence_ids` | yes | array of string (uuid) |
| `parent_groups` | yes | array of object |
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

### `move_occurrence_for_day`

**Move Occurrence for today.** Moves one of today's Unresolved Occurrences to another start time today. Only that day changes: the Behavior's schedule and the planned time stay the same, and `effective_start_at` shows the new time. The item keeps its length. Reminders follow the new time. Send the `revision` you last read as `expected_revision`. When a rule stops the move (the time has passed, something else is already there, the item changed since you read it), nothing changes and `refusal` explains why and offers up to three free times. Use revert_occurrence_move to undo it.

- Scope: `cadence.occurrences.write`
- Annotations: readOnlyHint false, destructiveHint true, idempotentHint false, openWorldHint false
- Annotation rationale: Changes where today's Occurrence sits, so readOnlyHint is false. The planned time and the Behavior's schedule never change and revert_occurrence_move undoes a move, but Claude's review criteria ask for destructiveHint true on tools that modify data, so it is set. The same idempotency key returns the first result, but a call without one makes a new move each time, so idempotentHint is false. openWorldHint is false: only the user's own Cadence account is touched.
- Errors: `invalid_input`, `authentication_required`, `rate_limited`, `service_unavailable`, `internal_error`, `insufficient_scope`, `not_found`, `idempotency_key_reused`
- Since: 1.3.0

Input:

| Field | Required | Type |
|---|---|---|
| `occurrence_id` | yes | string (uuid) |
| `start_time` | yes | string |
| `expected_revision` | yes | string |
| `idempotency_key` | no | string |

Output:

| Field | Required | Type |
|---|---|---|
| `outcome` | yes | `moved`, `refused` |
| `occurrence` | yes | object |
| `move` | yes | object or null |
| `refusal` | yes | object or null |

### `revert_occurrence_move`

**Undo Occurrence move.** Undoes the latest move of one of today's Unresolved Occurrences, putting it back where it was before that move: its planned time, or an earlier move. Only the latest move can be undone. When there is nothing to undo or the item changed since you read it, nothing changes and `refusal` explains why.

- Scope: `cadence.occurrences.write`
- Annotations: readOnlyHint false, destructiveHint true, idempotentHint false, openWorldHint false
- Annotation rationale: Changes where today's Occurrence sits, so readOnlyHint is false. The planned time and the Behavior's schedule never change and a later move can redo it, but Claude's review criteria ask for destructiveHint true on tools that modify data, so it is set. The same idempotency key returns the first result, but a call without one makes a new move each time, so idempotentHint is false. openWorldHint is false: only the user's own Cadence account is touched.
- Errors: `invalid_input`, `authentication_required`, `rate_limited`, `service_unavailable`, `internal_error`, `insufficient_scope`, `not_found`, `idempotency_key_reused`
- Since: 1.3.0

Input:

| Field | Required | Type |
|---|---|---|
| `occurrence_id` | yes | string (uuid) |
| `expected_revision` | yes | string |
| `idempotency_key` | no | string |

Output:

| Field | Required | Type |
|---|---|---|
| `outcome` | yes | `undone`, `refused` |
| `occurrence` | yes | object |
| `move` | yes | object or null |
| `refusal` | yes | object or null |

### `update_day_note`

**Update day note.** Adds, replaces, or clears the user's one note for a calendar date. A day note is the user's one note about a whole calendar date (for example "Travel day" or "Sick"). It is not an Occurrence note, has no status, and never changes Completed, Not Completed, Unresolved, Needs decision, adherence, or reminders. Use update_occurrence_note for one scheduled instance and set_occurrence_status for Completed or Not Completed. Future dates are allowed.

- Scope: `cadence.occurrences.write`
- Annotations: readOnlyHint false, destructiveHint true, idempotentHint true, openWorldHint false
- Annotation rationale: Replaces the previous day note text, which Cadence does not keep in history, so destructiveHint is true under both Claude's and OpenAI's guidance. The same arguments produce the same day note, so idempotentHint is true. openWorldHint is false.
- Errors: `invalid_input`, `authentication_required`, `rate_limited`, `service_unavailable`, `internal_error`, `insufficient_scope`, `conflict`, `idempotency_key_reused`
- Since: 1.1.0

Input:

| Field | Required | Type |
|---|---|---|
| `local_date` | yes | string (date) |
| `note` | yes | string |
| `expected_revision` | no | string |
| `idempotency_key` | no | string |

Output:

| Field | Required | Type |
|---|---|---|
| `local_date` | yes | string (date) |
| `day_note` | yes | object or null |
| `changed` | yes | boolean |

### `add_opportunity_occurrence`

**Add opportunity to today.** Adds one of the user's opportunity Behaviors (is_opportunity true, running, not archived) to today: at an exact start_time, in a time range (start_time and end_time, or a preset), or, with mark_completed, as done now, marked Completed at the current minute. It adds a new Occurrence and changes no schedule. When a rule stops it, nothing changes and `refusal` says why. remove_opportunity_occurrence takes back an item added by mistake.

- Scope: `cadence.occurrences.write`
- Annotations: readOnlyHint false, destructiveHint false, idempotentHint false, openWorldHint false
- Annotation rationale: Adds a new Occurrence and changes no existing record, like create_behavior, so destructiveHint is false under both Claude's and OpenAI's guidance; readOnlyHint is false, so clients still treat it as a write. Calling it twice without an idempotency_key adds two items, so idempotentHint is false. openWorldHint is false: only the user's own Cadence account is touched.
- Errors: `invalid_input`, `authentication_required`, `rate_limited`, `service_unavailable`, `internal_error`, `insufficient_scope`, `not_found`, `idempotency_key_reused`
- Since: 1.6.0

Input:

| Field | Required | Type |
|---|---|---|
| `behavior_id` | yes | string (uuid) |
| `start_time` | no | string |
| `end_time` | no | string |
| `preset` | no | `morning`, `afternoon`, `evening`, `night` |
| `mark_completed` | no | boolean |
| `idempotency_key` | no | string |

Output:

| Field | Required | Type |
|---|---|---|
| `outcome` | yes | `added`, `logged`, `refused` |
| `occurrence` | yes | object or null |
| `refusal` | yes | object or null |

### `remove_opportunity_occurrence`

**Remove added opportunity.** Removes an opportunity Occurrence that was added to a day, today or still in Needs decision, and cancels its pending reminders. The Behavior stays available as an opportunity. Only a clean item can be removed: Unresolved, never marked, with no note, tracked time or connected activity. A scheduled Occurrence is never removed. When a rule stops it, nothing changes and `refusal` says why.

- Scope: `cadence.occurrences.write`
- Annotations: readOnlyHint false, destructiveHint true, idempotentHint true, openWorldHint false
- Annotation rationale: Deletes an added Occurrence, so destructiveHint is true under both Claude's and OpenAI's guidance; the rules allow it only for a clean, unmarked item, and add_opportunity_occurrence can add it again. Repeating it leaves the same end state, the item gone, so idempotentHint is true. openWorldHint is false.
- Errors: `invalid_input`, `authentication_required`, `rate_limited`, `service_unavailable`, `internal_error`, `insufficient_scope`, `not_found`, `idempotency_key_reused`
- Since: 1.6.0

Input:

| Field | Required | Type |
|---|---|---|
| `occurrence_id` | yes | string (uuid) |
| `expected_revision` | no | string |
| `idempotency_key` | no | string |

Output:

| Field | Required | Type |
|---|---|---|
| `outcome` | yes | `removed`, `refused` |
| `occurrence` | yes | object |
| `refusal` | yes | object or null |

### `create_behavior`

**Create Behavior.** Creates a Behavior, a recurring thing the user wants to track (a habit, routine or recurring task), with schedules (daily, every N days, weekly or every N weeks on chosen weekdays, monthly on day N) and reminders. With is_opportunity true it can be added to today when there is room, and schedules may be empty. `sub_behaviors` creates a parent and up to 25 sub-behaviors in one change; `parent_behavior_id` adds one sub-behavior to an existing parent, and one that follows the parent's schedule needs no `schedules`. An opportunity Behavior is never in a routine. list_categories lists categories.

- Scope: `cadence.behaviors.write`
- Annotations: readOnlyHint false, destructiveHint false, idempotentHint false, openWorldHint false
- Annotation rationale: Adds a new Behavior and changes no existing record, so destructiveHint is false under both Claude's and OpenAI's guidance; readOnlyHint is false, so clients still treat it as a write. Calling it twice without an idempotency_key creates two Behaviors, so idempotentHint is false. openWorldHint is false.
- Errors: `invalid_input`, `authentication_required`, `rate_limited`, `service_unavailable`, `internal_error`, `insufficient_scope`, `not_found`, `idempotency_key_reused`, `invalid_state`
- Since: 1.0.0

Input:

| Field | Required | Type |
|---|---|---|
| `title` | yes | string |
| `description` | no | string |
| `location_text` | no | string |
| `category_id` | no | string (uuid) or null |
| `schedules` | no | array of object |
| `is_opportunity` | no | boolean |
| `reminders` | no | object |
| `default_duration_minutes` | no | integer |
| `parent_behavior_id` | no | string (uuid) |
| `inherit_parent_schedule` | no | boolean |
| `sub_behavior_sort_order` | no | integer |
| `sub_behaviors` | no | array of object |
| `end_on` | no | string (date) |
| `end_time` | no | string |
| `end_date` | no | string (date) |
| `external_ref` | no | string |
| `idempotency_key` | no | string |

At least one of `schedules`, `parent_behavior_id` is required.

Output:

| Field | Required | Type |
|---|---|---|
| `behavior` | yes | object |
| `sub_behaviors` | no | array of object |

### `update_behavior`

**Update Behavior.** Edits a Behavior's title, description, place, category, schedules, reminders, length, end, opportunity flag or sub-behavior link. Only the fields sent change; `schedules` replaces the whole list and may be empty only for an opportunity Behavior. `parent_behavior_id` groups it under a parent, or null makes it top-level; `sub_behavior_sort_order` moves it among its siblings. An opportunity Behavior is never part of a routine. A parent's schedule change also reaches the sub-behaviors that follow it. Past and resolved Occurrences are kept. Read get_behavior first for the revision.

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
| `is_opportunity` | no | boolean |
| `reminders` | no | object |
| `default_duration_minutes` | no | integer or null |
| `end_on` | no | string (date) or null |
| `end_time` | no | string or null |
| `end_date` | no | string (date) or null |
| `parent_behavior_id` | no | string (uuid) or null |
| `inherit_parent_schedule` | no | boolean |
| `sub_behavior_sort_order` | no | integer |
| `idempotency_key` | no | string |

At least one of `title`, `description`, `location_text`, `category_id`, `schedules`, `reminders`, `default_duration_minutes`, `end_on`, `end_time`, `end_date`, `is_opportunity`, `parent_behavior_id`, `inherit_parent_schedule`, `sub_behavior_sort_order` is required.

Output:

| Field | Required | Type |
|---|---|---|
| `behavior` | yes | object |
| `changed` | yes | boolean |

### `archive_behavior`

**Archive Behavior.** Archives a Behavior so it schedules no new Occurrences, with an optional archive note. History, notes, and past Occurrences are kept, and restore_behavior reverses it. Archiving a parent Behavior also archives its active sub-behaviors. Nothing is deleted. Archiving an archived Behavior changes nothing.

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

**Restore Behavior.** Restores an archived Behavior so it schedules Occurrences again from today. Archive notes are kept. Restoring a parent Behavior also restores the sub-behaviors archived with it; a sub-behavior of an archived parent can't be restored on its own. Restoring an active Behavior changes nothing.

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

### `end_behavior`

**End Behavior now.** Ends a Behavior this minute. It stays active, moves to Not running, and schedules nothing more; its Unresolved Occurrences later today, including a window still open, are removed. Marked, noted, and timed Occurrences stay. To end on a later day, use update_behavior with end_on. resume_behavior starts it again. Ending an ended Behavior changes nothing.

- Scope: `cadence.behaviors.write`
- Annotations: readOnlyHint false, destructiveHint true, idempotentHint true, openWorldHint false
- Annotation rationale: Stops scheduling and removes the rest of today's Unresolved Occurrences, so destructiveHint is true under both Claude's and OpenAI's guidance. Repeating it changes nothing, so idempotentHint is true. openWorldHint is false.
- Errors: `invalid_input`, `authentication_required`, `rate_limited`, `service_unavailable`, `internal_error`, `insufficient_scope`, `not_found`, `conflict`, `idempotency_key_reused`, `invalid_state`
- Since: 1.4.0

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

### `pause_behavior`

**Pause Behavior.** Pauses a Behavior from from_on until back_on, when it runs again by itself from the start of that day. A pause can start today or later; today starts now unless from_time is later. A Behavior has one pause at a time: a new pause replaces the old one. No Occurrences are scheduled while paused, and Unresolved ones inside the pause are removed. Marked, noted, and timed Occurrences stay.

- Scope: `cadence.behaviors.write`
- Annotations: readOnlyHint false, destructiveHint true, idempotentHint true, openWorldHint false
- Annotation rationale: Replaces any earlier pause and removes Unresolved Occurrences inside the pause, so destructiveHint is true under both Claude's and OpenAI's guidance. The same arguments leave the same pause, so idempotentHint is true. openWorldHint is false.
- Errors: `invalid_input`, `authentication_required`, `rate_limited`, `service_unavailable`, `internal_error`, `insufficient_scope`, `not_found`, `conflict`, `idempotency_key_reused`, `invalid_state`
- Since: 1.4.0

Input:

| Field | Required | Type |
|---|---|---|
| `behavior_id` | yes | string (uuid) |
| `from_on` | yes | string (date) |
| `from_time` | no | string or null |
| `back_on` | yes | string (date) |
| `expected_revision` | no | string |
| `idempotency_key` | no | string |

Output:

| Field | Required | Type |
|---|---|---|
| `behavior` | yes | object |
| `changed` | yes | boolean |

### `resume_behavior`

**Resume Behavior.** Runs a paused or ended Behavior again from now: it clears the pause, and an end that has passed. An end still to come stays. Resuming a running Behavior changes nothing. Use restore_behavior for an archived Behavior.

- Scope: `cadence.behaviors.write`
- Annotations: readOnlyHint false, destructiveHint true, idempotentHint true, openWorldHint false
- Annotation rationale: Modifies the Behavior's end or pause and resumes scheduling, which Claude's review criteria treat as a data modification, so destructiveHint is true. Repeating it changes nothing, so idempotentHint is true. openWorldHint is false.
- Errors: `invalid_input`, `authentication_required`, `rate_limited`, `service_unavailable`, `internal_error`, `insufficient_scope`, `not_found`, `conflict`, `idempotency_key_reused`, `invalid_state`
- Since: 1.4.0

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

## Connector completion provenance (Ticket 322, D28.7)

A status change written from a connected service's recorded activity appears in `status_history` with `semantics` `system_rule_declared` and `capture_method` `derived`; a revert after the activity is deleted at the source carries the same pair with `status` `unresolved`. Both values were already in the enums, so the tool's schema is unchanged. The user's own marks keep `explicit_user_mark` or `explicit_user_correction` with `manual_tap` or `manual_text`. Clients must not describe a `derived` entry as something the user did.

## Behaviors of Opportunity (contract 1.6.0)

`docs/RECURRENCE_RULES.md`, "Behaviors of Opportunity", holds the rules. In the contract:

- Behaviors carry `is_opportunity`. `list_behaviors` filters on it. `create_behavior` and
  `update_behavior` accept it, and accept `schedules: []` only for an opportunity Behavior.
  `contract.ts` checks that rule, so tool input schemas keep no top-level `anyOf`. An update
  that leaves out `is_opportunity` is checked against the stored flag.
- Occurrences carry `origin` (`scheduled` or `opportunity`) and `added_by` (`user`,
  `daily_brief`, `chat`, `mcp`, or null for scheduled ones).
- `add_opportunity_occurrence` adds an opportunity Behavior to today at an exact time, in a
  custom or preset range, or, with `mark_completed`, as done now. An outside client's item is
  stored with `added_by` `mcp`, Cadence chat's with `chat`. Cadence chat also passes today's
  busy calendar times, so an exact time that another item or an event holds is refused with
  `slot_taken` or `calendar_busy` and up to three free times, by the free-slot rule moves use.
  An `idempotency_key` also fixes the new Occurrence's id, so a retry after a lost reply
  replays instead of adding twice.
- `remove_opportunity_occurrence` removes a clean added item: Unresolved, never marked, with
  no note, tracked time or connected activity. A scheduled Occurrence is refused with
  `scheduled`. Pending reminders are cancelled before the row is deleted.
