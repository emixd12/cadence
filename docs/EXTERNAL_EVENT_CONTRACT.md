# External event interface contract

Status: the versioned contract, provider adapter, OAuth broker, credential
persistence, desktop cache, Settings, deployed web flow, and installed desktop
flow have source and acceptance evidence. Google verified Cadence branding and
accepted the Calendar data-access submission on September 18, 2026. Scope
approval and post-approval smoke checks remain open under Ticket 141. Ticket 137
also retains controlled provider-failure and Workspace-restriction coverage plus
dense/overnight installed fixtures and multi-day resume evidence. Apple-trusted
desktop distribution remains separate under Ticket 115. See `STATUS.md` and
`docs/qa/day-progress-release.md` for current state and dated evidence.

## Purpose and boundary

Cadence consumers must understand external events without parsing provider payloads,
display labels, or screen geometry. Preserve enough scheduling facts for future
day-rearrangement work, but do not implement a planner, model call, schedule write,
MCP server, or additional connector in Tickets 133–137.

Use the existing `NormalizedExternalEvent` family in
`packages/core/src/types/day-progress.ts`. Extend it in Ticket 134 rather than
creating another event model for desktop, UI, or a future model consumer.
The shared event family now distinguishes timed/all-day events, recurrence identity,
missing details, revision, source timezone, event state, busy/free facts, user response,
derived duration, and freshness. The implemented snapshot adds versioned wire
validation, coverage, capabilities, failures, and cancellation tombstones.

The inspiration is MCP's named operations, input/output schemas, structured results,
and capability declarations. This is an internal interface, not MCP compatibility.
See the pinned [MCP tools reference](https://modelcontextprotocol.io/specification/2025-11-25/server/tools).
Cadence keeps normal authenticated services and repositories; no generic plugin
framework or protocol transport is required.

## Owners and data flow

Google response → validated Google adapter → normalized event snapshot → shared
resolvers and web/desktop views. Desktop persists the same validated snapshot in
its separate account-scoped cache. Neither core nor UI consumes raw Google JSON.

| Boundary | Owner and requirement |
|---|---|
| Provider I/O and credentials | Ticket 134 server connector; same Google subject as the authenticated Cadence account; reviewed OAuth custody and revocation |
| Provider mapping | Google adapter validates payloads, maps fields, and reports missing or invalid data |
| Shared semantics | Core types and pure functions validate normalized time/identity semantics and derive duration with Temporal |
| Persistence | Web repositories and desktop cache adapter enforce ownership, atomic replacement, expiry, and cleanup |
| Presentation | Tickets 133/135 consume normalized values; clipping, marker displacement, dismissal, and labels never change event facts |
| Estimates and overlap | Ticket 136 combines normalized intervals with Behavior estimates; no writes or automatic rearrangement |
| Release evidence | Ticket 137 proves contract parity, exclusions, lifecycle, and documentation |

## Contract artifacts required by Ticket 134

Ship a versioned JSON Schema for the event snapshot and operation inputs/results,
paired TypeScript types, runtime boundary validation, a field dictionary with
units/null semantics, provider mapping, and synthetic valid/invalid examples.
Use one schema/type source where practical; otherwise enforce parity in tests.
Do not hand-maintain independent schemas for each platform.
The bounded implementation slice owns these artifacts:

| Artifact | Path and role |
|---|---|
| Shared event types | `packages/core/src/types/day-progress.ts`; normalized event facts consumed by Timeline and future clients |
| Snapshot/types | `packages/core/src/types/external-event.ts`; `ExternalEventSnapshotV1`, coverage, failures, capabilities, tombstones, and scheduling projection |
| JSON Schema | `packages/core/src/external-event.schema.json`; structural wire contract for schema `1.0.0` |
| Runtime validation | `packages/core/src/services/external-event-validation.ts`; semantic checks omitted from JSON Schema, including interval order, exact derived duration, date counts, timezone validity, complete coverage, and revision consistency |
| Scheduling projection | `packages/core/src/services/external-event-projection.ts`; removes rich text and participant details |
| Google adapter/read helper | `lib/services/google-calendar-provider.ts`; safe field adaptation and bounded selected-calendar pagination |
| Contract fixtures | `tests/fixtures/external-event-snapshot.valid.json` and `tests/fixtures/google-calendar/*.json` |
| Contract tests | `tests/external-event-contract.test.ts` and `tests/google-calendar-provider.test.ts` |
| Calendar `1.1.0` (Ticket 221) | `packages/core/src/external-event-1.1.schema.json` reuses the `1.0.0` definitions; `validateVersionedExternalEventSnapshot`, `projectVersionedExternalEventSchedulingFacts`, `externalEventNormalizedId`, and the snapshot scope-key helpers; fixtures `tests/fixtures/external-event-snapshot.{outlook,icloud}.valid.json` |
| Recorded activity (Ticket 221) | `packages/core/src/types/recorded-activity.ts`, `packages/core/src/recorded-activity.schema.json`, `packages/core/src/services/recorded-activity-validation.ts`; fixture `tests/fixtures/recorded-activity-snapshot.valid.json`; tests `tests/recorded-activity-contract.test.ts` |

`ExternalEventFieldAvailability` describes why a field has no usable value:
`not_provided`, `restricted`, `provider_omitted`, `unsupported`, or `unknown`.
An omitted map entry means the normalized value is available. Collection detail
uses `complete`, `provider_omitted`, `client_truncated`, `restricted`,
`unsupported`, or `unknown`. Null never means that the provider supplied an
empty value. It means no usable value crossed the adapter boundary.

The current provider helper exposes two bounded operations:

```ts
readGoogleCalendarCalendars(input: GoogleCalendarListInput):
  Promise<CalendarListEntry[]>

readGoogleCalendarEvents(input: GoogleCalendarReadInput):
  Promise<GoogleCalendarReadResult>
```

Both inputs carry a request-local access token. Calendar listing returns only
reader/writer/owner calendars with validated identifiers, labels, timezones,
selection, primary, and access-role facts. Typed failures use
`GoogleCalendarProviderError.failure`.

The event input also carries the authenticated account ID, connection generation,
selected readable calendars, an inclusive displayed local-date range, fetch time,
and injectable fetch/retry controls. Provider `timeMax` uses the next local
midnight after the inclusive end date. The helper accepts at
most 32 selected calendars, 31 calendar days, 20 pages per calendar, and two
retries per page by default. It requests at most 2,500 events and 100 attendees
per provider page. It never returns or stores the token.

Success returns `{ ok: true, snapshot }` only after every selected calendar
finishes pagination. Failure returns `{ ok: false, error, partialSnapshot }`.
The partial snapshot has `completeness: "incomplete"`, null
`freshness.refreshedAt`, false completeness claims, per-calendar coverage, and a
stable failure. It is diagnostic input and
must not replace the last complete cache.

The connector exposes bounded calendar-list, range-read, and connection reads
through the existing service/API structure. Per-event details use the validated
range snapshot; they do not make a separate provider call. Refresh and
connect/disconnect perform the documented network or credential/cache side
effects. No event-create/update/delete operation is exposed.

Every operation states its input bounds, authentication, ownership, outputs,
side effects, stable error codes, retry semantics, and capability requirements.
The implemented service, repositories, OAuth routes, and desktop cache adapter
use this contract. Their paths and lifecycle are recorded below.

## Scheduling facts

| Fact | Required meaning |
|---|---|
| Identity | Source, calendar ID, provider event ID, normalized ID, and logical instance ID; account-scoped storage/cache identity |
| Timed start/end | Original scheduled instants with offsets normalized to UTC; half-open interval `[startAt, endAt)`; preserve source IANA timezone when supplied and record any fallback |
| Timed duration | Explicit known/unknown result; known seconds are derived from end minus start, not a duplicate editable value; never from row height or a formatted label |
| Unspecified end | Preserve provider `endTimeUnspecified`; any compatibility end value is not an asserted duration; expose unknown duration and do not assert a free interval from it |
| All-day span | Date-only start and exclusive end; expose calendar-day count separately from timed seconds; never assume each local day is 24 hours |
| Recurrence | Series ID and original instance start identify an occurrence even when its current scheduled start moves; display/overlap uses the current scheduled interval |
| Revision/provenance | Provider update timestamp/ETag when available, fetch time, source URL, adapter/schema version; distinguish unavailable revision metadata |
| Event state | Confirmed, tentative, cancelled, or unknown; cancellations may contain only identity, so model deletion records separately from complete events |
| Availability | Preserve busy/free/unknown and the current user's response when supplied; these are source facts, not permission to move an event |
| Missing fields | Preserve absent, restricted, omitted, truncated, unsupported, and unknown distinctions where relevant; never replace missing time/duration with zero |

### Wire field dictionary

| Field | Unit/null rule |
|---|---|
| `schemaVersion` | Exact semantic wire version. Current value is `1.0.0`. |
| `adapterVersion` | Exact provider mapping version. Current value is `google-calendar-v1`. |
| `accountId` | Authenticated Cadence account scope. Never inferred from provider content. |
| `connectionGeneration` | Positive integer. Older responses cannot repopulate a cleared cache. |
| Requested `startLocalDate` / `endLocalDate` | First and last displayed `YYYY-MM-DD` dates, both inclusive. Maximum span is 31 calendar days. |
| `requestedRange.timezone` | IANA timezone used to derive provider `timeMin` and the next local midnight after the inclusive end date for `timeMax`. |
| `fetchedAt` / `revision.providerUpdatedAt` | UTC-normalized instants. Provider update is null only when unavailable. |
| `revision.providerEtag` | Opaque provider revision or null. `revision.availability` agrees with timestamp/ETag presence. |
| Timed `startAt` / `endAt` | UTC-normalized instants. End is exclusive. |
| Timed `duration.seconds` | Positive elapsed seconds derived by instant arithmetic. It is never independently edited. |
| Unknown timed duration | `{ kind: "unknown", reason: "end_unspecified" }`; compatibility `endAt` does not assert duration or a free interval. |
| All-day `startLocalDate` / `endLocalDate` | Date span with exclusive end. |
| All-day `duration.days` | Count of calendar dates. It is never converted to 24-hour seconds. |
| `sourceTimezone` | Provider event timezone, calendar fallback, or request fallback. `sourceTimezoneFallback` records which. |
| `state` | `confirmed`, `tentative`, or `unknown` on live events. Cancelled resources become tombstones. |
| `availability` | `busy`, `free`, or `unknown`. This fact does not authorize moving an event. |
| `currentUserResponse` | Normalized self-attendee response or null when not supplied. |
| `coverage[].itemCount` | Provider items consumed, including cancellation resources. It is not the rendered event count. |
| `paginationComplete` | True only after the provider omits `nextPageToken`. |
| External URLs | Source and attachment links require HTTPS. Conference entries allow HTTPS, `tel:`, or `sip:` by entry type. |
| External text | Bounded plaintext. The adapter converts description and conference HTML to plaintext before normalization. |

Google's [event resource](https://developers.google.com/workspace/calendar/api/v3/reference/events)
documents timed versus date-only bounds, unspecified ends, recurrence instance
identity, cancellation, and transparency. Ticket 134 records exact mappings and
defaults in its field matrix. Do not infer recurrence from titles or deduplicate
distinct recurring instances by `iCalUID` alone. Events copied across calendars
remain distinct unless a documented identity rule proves otherwise.

Validation rejects invalid dates/instants, reversed intervals, incompatible
timed/all-day fields, mismatched duration projections, and cross-account identifiers.
Quarantine malformed provider items and mark affected coverage incomplete; do not
silently discard an item and claim a complete empty calendar. Unknown schema major
versions fail explicitly. Document compatible optional-field additions and cache
upgrade/invalidation rules so older desktop clients cannot misread new semantics.

## Snapshot, coverage, and capabilities

An event list is not sufficient. Its envelope includes schema version, selected
calendar IDs, requested range and timezone, fetched time, per-calendar covered
range, pagination completion, freshness, and typed failures. Distinguish complete
empty results from disconnected, denied, stale, incomplete, or unavailable results.
Record bounded/truncated detail collections independently from time-range coverage.

Retain the last complete cache during interrupted refresh. Do not delete cached
events from partial pages. Apply cancellation records and complete replacements
atomically. Range and selection changes cannot reuse an unrelated completeness
claim. A late response from a previous account or connection generation cannot
repopulate a cleared cache. No UI dismissal modifies this snapshot.

Capabilities explicitly distinguish provider support, granted permission, and
current availability for calendar listing, timed/all-day reads, recurrence,
details, and source links. Read-only access must remain enforced by scopes and
service methods; a capability label is not authorization. Cache state and errors
must not masquerade as absence of scheduling constraints.

The schema requires every capability entry. Each entry separates provider
`support`, granted `permission`, and current `availability`. A successful read
reports supported/granted/available. An interrupted read reports degraded
availability and incomplete freshness.

Stable read error codes are:

| Code | Retry meaning |
|---|---|
| `unauthenticated`, `not_connected`, `wrong_account` | Caller or connection state must change. Do not retry the same request. |
| `reconnect_required` | Provider authorization failed. The owning service clears unusable credentials and requires reconnection. |
| `permission_denied` | Provider rejected access. Do not present an empty calendar. |
| `rate_limited` | Retryable within the finite budget. Provider 403 and 429 responses use this code. |
| `provider_unavailable`, `timeout` | Retryable only within the finite request budget. |
| `malformed_provider_response` | Quarantine the affected item/page and mark coverage incomplete. |
| `incomplete_pagination` | A token repeated or the page ceiling was reached. Do not advance complete cache coverage. |
| `invalid_request` | The bounded request failed validation. |
| `unsupported_schema_version` | The wire version is unsupported. Runtime validation rejects it before use. |

The provider adapter reads every selected calendar. It caps calendar-list and
event reads at 20 pages. Event pages request 2,500 items; calendar-list pages
request 250. Both operations retry at most twice by default with capped
exponential backoff and jitter. They honor a numeric `Retry-After` up to five
minutes. An absent `nextPageToken` is the only completion proof.

Duplicate provider event IDs within one calendar replace the earlier page copy.
Copies in different calendars remain distinct. A cancellation tombstone removes
the matching live event from that response and remains available for atomic cache
reconciliation. The helper returns partial events only inside an explicitly
incomplete result. A caller must never use it as a complete cache replacement.

### Version compatibility

Schema `1.0.0` is the first cacheable snapshot. The current validator accepts
that exact version. A future validator may explicitly accept a minor version
that adds optional fields whose absence preserves the documented default or
unknown meaning. A minor version cannot change identity, interval,
duration, recurrence, availability, cancellation, or coverage semantics.
Changing those facts requires a new major schema and cache invalidation or an
explicit migration. The adapter version changes whenever Google mapping rules
change, even when the wire schema remains compatible. Desktop validates every
snapshot before atomic replacement and retains the last complete snapshot after
any validation or refresh failure.

## Consumer readiness and the planned read-only advisor

Define and fixture-test a minimal scheduling projection from the same event model:
identity, scheduled interval or date span, duration/unknown reason, timezone,
event state, availability, recurrence identity, revision, and snapshot coverage.
Rich descriptions, attendees, conference links, and attachments are not required
to calculate interval overlap and should not enter that projection by default.
Projection tests establish reusable data. They do not grant transmission.

A later scheduling feature must separately decide how to treat all-day, tentative,
declined, transparent, stale, or unknown-end events. For this release, preserve
these facts, retain conservative advisory overlap semantics, and exclude all-day
events from timed warnings. No current calculation declares a day safe to rearrange.

External text and URLs remain untrusted data, never model instructions or authority.
Tickets 146–148 plan Cadence Daily Brief inside the existing horse bubble. Its
day-context service reuses this model for the existing Google Calendar connection.
Future connectors require their own capability/field review; reuse this model only
when its meanings match.
The consumer projection is narrower than the internal snapshot. It returns only
opaque event/calendar/recurrence-instance references, timed interval or all-day
date span, duration/unknown-end reason, source timezone/fallback, event state,
availability, current-user response, connector kind, schema/adapter versions,
coverage, fetched time, revisions/generations, freshness, completeness, and failures.
It excludes title, description, location, attendees,
organizer, conference data, attachments, source URLs, raw recurrence/provider
identifiers, and credentials by default.

Calendar display consent does not authorize model transmission. The in-app
briefing uses existing sign-in and first-party disclosure/enablement bound to the
account, data classes, selected connectors and disclosure revision. It requires
no external consumer login or approval of prewritten briefing text.
Account, disclosure, connector selection, coverage, and revision changes fence pending
delivery. Missing, stale, partial, or failed coverage never proves free time.

The advisor may suggest priorities, timing, sequence, and schedule changes. It
cannot apply them. Reading normalized context and executing Cadence or provider
operations are separate powers. A later write phase is intended, but it needs a
distinct execution grant and separately scoped operations, permissions, preview,
explicit human approval, stale-context checks, conflict handling, idempotency,
audit history, revocation, and atomic apply behavior.

The September 20 correction aligns planning only. No live model transmission, provider action,
or write follows from this contract. No external event enters BehaviorLog,
ordinary account sync, backups, telemetry payloads, or prompt history by default.

## Acceptance examples and required evidence

This Ticket 134 slice adds provider-adapter, schema, duration, and snapshot fixtures:

- `08:00Z–08:45Z` yields 2,700 known seconds; an unspecified end yields unknown.
- Adjacent intervals do not overlap. Overnight bounds retain one event identity.
- DST-crossing timed intervals use instant arithmetic. All-day spans count dates.
- A moved recurring instance preserves original identity and uses its moved interval.
- A cancelled instance with only identity removes the matching cached instance.
- Duplicate pages, multiple calendars, restricted fields, malformed items, partial
  pagination, rate limits, stale cache, account switches, and unsupported versions
  preserve honest completeness and never expose credentials.
- The same normalized fixture produces equal scheduling facts on web and desktop,
  independent of drawer state, dismissed markers, or timeline compression.

Ticket 137 evidence requires an indexed schema, examples, field/capability matrix,
error catalog, code ownership, operational lifecycle/cleanup guidance,
compatibility policy, and links to passing contract tests.
`docs/qa/day-progress-release.md` tracks that evidence alongside live connector,
installed native, deployment, and remaining public-release gates.

Platform impact: web and desktop share the internal contract under 134–136.
Tickets 146–148 plan the hosted read-only consumer service; account-free desktop
stays unchanged and receives no native helper. Marketing documents only verified
user-visible capabilities. Future native mobile and write execution remain deferred,
with no implementation here.

## Connector expansion contracts (Tickets 220–228)

Status, October 18, 2026: Ticket 220 recorded these rules. Ticket 221 implemented
the shared core types, JSON Schemas, runtime validators, projections, and
synthetic fixtures listed in the artifact table above. No provider adapter, route,
migration, consent, or Daily Brief assembly exists for Outlook, iCloud, or Hevy
yet. Provider claims cite dated public documentation in
`docs/INTEGRATION_PLAYBOOK.md`; live-provider and public-approval evidence is not
verified.

Ticket 221 entry points and enforced rules:

- `validateExternalEventSnapshot` stays the exact Google `1.0.0` validator used by
  existing routes and desktop caches. It rejects `1.1.0` with
  `ExternalEventValidationError.code = "unsupported_schema_version"`.
- `validateVersionedExternalEventSnapshot` accepts each source only with its pair
  in `EXTERNAL_EVENT_SOURCE_VERSIONS`. Every event and tombstone must carry the
  snapshot source. Outlook and iCloud `id` and `logicalInstanceId` values must
  start with `<source>/` (`externalEventNormalizedId` builds them).
- Outlook and iCloud events must keep description and location empty and
  organizer, attendees, conference, and attachments null, each marked
  `unsupported`. Outlook live events use `unknown` state. iCloud events have a
  null source URL and null user response.
- `externalEventSnapshotScopeKey` binds source, account, generation, range,
  timezone, and selected calendars.
- `projectVersionedExternalEventSchedulingFacts` returns the unchanged Google
  projection for Google and adds `source` for `1.1.0`.

### Calendar sources beyond Google

Outlook and iCloud calendars describe scheduled events. They reuse this
`NormalizedExternalEvent` family because their meanings match: timed or all-day
scheduled intervals, recurrence instances, cancellation, availability, and
revisions. Ticket 221 owns the shared type change.

| Rule | Requirement |
|---|---|
| Source literal | `ExternalEventSource` adds `outlook_calendar` and `icloud_calendar`. Google stays `google_calendar`. |
| Adapter versions | `outlook-calendar-v1` and `icloud-calendar-v1`. Google stays `google-calendar-v1`. |
| Wire version | Google responses keep exact schema `1.0.0` and their current bytes and routes. New sources use schema `1.1.0`, which adds only the new source and adapter literals. `1.1.0` snapshots are served only by new provider routes. A desktop client that accepts only `1.0.0` never receives them. |
| Validator | Accepts `1.0.0` only with Google literals and `1.1.0` only with Outlook or iCloud literals. Every other version fails as `unsupported_schema_version`. |
| Cache identity | Every cache or stored snapshot key includes source, account ID, connection generation, selected calendar IDs, and requested range. A snapshot from one source can never satisfy or clear another source's cache. |
| Range | Same as Google: today through at most today + 30, inclusive, in the profile timezone. Provider end bound is the next local midnight after the inclusive end date. |
| Bounds | At most 32 selected calendars per source and 20 pages per calendar where the provider paginates. This 20-page calendar bound is unchanged by the 50-page recorded-activity ceiling below. |
| Deadlines and retries | Every provider read receives one absolute deadline: 25 seconds for an interactive Settings or Timeline request. Daily Brief passes the smaller of 25 seconds and its remaining 60-second budget minus a 10-second reserve for generation. Each HTTP attempt times out at 10 seconds or the remaining time, whichever is less. At most two retries per request. Without `Retry-After`, backoff is capped exponential with jitter, at most 5 seconds. A numeric `Retry-After` is honored only when the wait plus one second still fits before the deadline. Otherwise the read stops at once with a typed failure carrying `retryAfterSeconds`. Deadline exhaustion returns `timeout` with an incomplete result. |
| Status mapping | 429 → `rate_limited`. 503 → `provider_unavailable`. Both are retryable only under the deadline rule above. Other 5xx responses → `provider_unavailable`. |
| Failures | Reuse the stable read error codes above. Do not add provider-specific codes. |
| Google follow-up | The existing Google adapter caps `Retry-After` at 300 seconds (`retryAfterSeconds` in `lib/services/google-calendar-provider.ts`) and does not compare it with the remaining request deadline. A caller's abort signal still ends a wait in progress (`wait` in the same file). Its runtime stays unchanged in this expansion. Aligning it with the deadline rule is a separate follow-up recorded in `STATUS.md`. |
| Writes | None. Provider adapters expose no create, update, delete, respond, or move operation. |

Outlook mapping (Ticket 224) uses Microsoft Graph `calendarView`:

| Normalized fact | Graph source and rule |
|---|---|
| Identity | Calendar `id`, event `id` requested with `Prefer: IdType="ImmutableId"`, `seriesMasterId`, and `originalStart` for instance identity. `iCalUId` is never the sole deduplication key. |
| Request | No `Prefer: outlook.timezone` header, so Graph returns UTC, its default. Query bounds carry explicit offsets because Graph interprets `startDateTime`/`endDateTime` by their offset, or as UTC without one. The provider query widens the requested window by one day on each side so all-day events in distant zones are returned; the adapter then filters timed events by instant overlap with the requested local days and all-day events by date overlap. Widening does not change the 31-day request bound or the page bounds. |
| Timed interval | `start` and `end` (`dateTimeTimeZone`, UTC), normalized to instants. |
| Event zone | Resolve `originalStartTimeZone` to IANA. A value Temporal accepts as IANA is used directly. A Windows name maps only through the `windowsZones.xml` table of a pinned Unicode CLDR release, recorded with its version in the adapter and covered by fixtures. Ad hoc mappings are forbidden. `tzone://Microsoft/Custom`, an unmapped name, or a missing value is unresolved. Graph documents Windows zones plus a listed IANA subset in [dateTimeTimeZone](https://learn.microsoft.com/en-us/graph/api/resources/datetimetimezone) (updated 2025-02-11). |
| All-day span | `isAllDay = true`. Graph's event resource says all-day start and end are midnight in one timezone: the event's own zone. The adapter converts the UTC start/end into the resolved event zone and uses those calendar dates. It never re-dates an all-day event into the profile zone. It quarantines the item with a recorded reason (`timezone_unresolved` or `not_midnight`) when the zone is unresolved or either bound is not midnight in that zone, and marks that calendar's coverage incomplete. Required fixture: an all-day event created in Pacific Standard Time, read by a profile in America/New_York, keeps its original date. |
| Source timezone | The resolved event zone. An unresolved zone on a timed event uses the request fallback with `sourceTimezoneFallback` recorded. |
| State | `isCancelled = true` becomes a tombstone. Live events use `unknown` state because Graph has no confirmed/tentative event status. |
| Availability | `showAs`: `free` → free; `busy` and `oof` → busy; `tentative`, `workingElsewhere`, and `unknown` → unknown. |
| User response | `responseStatus.response`, mapped to the existing response vocabulary. |
| Revision | `changeKey`, plus `lastModifiedDateTime` when Graph returns it. Graph documents that `lastModifiedDateTime` does not support `$select` on calendarView, so Ticket 224 does not request it and normally records `changeKey` only (`revision.availability` stays `available`). |
| Details | `subject` only, as bounded untrusted plaintext. `Calendars.ReadBasic` excludes body, attachments, and extensions. Location, attendees, organizer, and online-meeting data are not requested in the first slice and use `unsupported`. |
| Source link | `webLink` is kept only when it is HTTPS on `outlook.office365.com`, `outlook.office.com`, or `outlook.live.com` without credentials or a port; otherwise it is null with `source_url: not_provided`. Ticket 224 found no Microsoft-documented conversion to a newer Outlook on the web format, so none is applied (not verified against live links). |
| Pagination | `$top` of at most 1,000 per page. Completion requires a response without `@odata.nextLink`. Each next link must be HTTPS on `graph.microsoft.com` (default port, no credentials) and keep the same `/v1.0/me/calendars/{id}/calendarView` path, with the `{id}` segment equal to the requested calendar ID after percent-decoding (raw `=` and `%3D` are the same calendar), before the bearer token is sent; otherwise the read fails as `malformed_provider_response`. A repeated link or a 21st page is `incomplete_pagination`. Pages are capped at 5 MB. Each attempt's fetch and body read settle within the attempt budget even if the fetch or stream ignores abort, and a response completing after the absolute deadline is discarded as `timeout`. |
| Quarantine record | Ticket 224: a quarantined item (`timezone_unresolved`, `not_midnight`, `invalid_interval`, `unexpected_response_timezone`, `series_master`, or `malformed_item`) does not stop the read. That calendar's coverage has `paginationComplete: false`, and one non-retryable `malformed_provider_response` failure with its `calendarId` lists the reason counts. The snapshot is `incomplete`. |

iCloud mapping (Ticket 227) uses CalDAV:

| Normalized fact | CalDAV/iCalendar source and rule |
|---|---|
| Identity | Calendar collection href, `UID`, and `RECURRENCE-ID`. The normalized ID is derived from account, collection href, UID, and recurrence ID. |
| Timed interval | `calendar-query` with `CALDAV:expand`, which RFC 4791 §9.6.5 defines as returning expanded instances in UTC. `DTEND` or `DURATION` defines the end. A `DATE-TIME` start with neither is `{ kind: "unknown", reason: "end_unspecified" }`. |
| All-day span | `DTSTART;VALUE=DATE`. Missing end means one calendar date. |
| Floating time | Interpret with the collection `calendar-timezone` when present; otherwise the profile timezone with the fallback recorded. |
| Recurrence | If a returned `VEVENT` still contains `RRULE`, the server did not expand it. Mark that calendar's coverage incomplete and recurrence capability unsupported. The first slice performs no client-side RRULE expansion. |
| State | `STATUS`: `CONFIRMED`, `TENTATIVE`, or absent → confirmed, tentative, or unknown. `CANCELLED` becomes a tombstone. |
| Availability | `TRANSP`: `OPAQUE` → busy; `TRANSPARENT` → free; absent → unknown. |
| User response | Not read in the first slice; null with `unsupported`. |
| Revision | `DAV:getetag` and `LAST-MODIFIED`. |
| Details | `SUMMARY` only, as bounded untrusted plaintext. Description, location, attendees, organizer, alarms, attachments, and URLs are not read in the first slice and use `unsupported`. |
| Source link | None. Use `unsupported`. |
| Pagination | CalDAV `calendar-query` has no page token. A `507` response or a truncated multistatus is `incomplete_pagination`. Response bodies are capped at 5 MB per calendar. |

### Recorded activity snapshot (Hevy)

A recorded workout is an actual past interval. It is not a scheduled event and
never enters `NormalizedExternalEvent`, Calendar markers, Calendar selection, or
overlap cues. Ticket 221 adds a separate `RecordedActivitySnapshotV1` beside the
event snapshot in `packages/core`.

| Field | Unit/null rule |
|---|---|
| `schemaVersion` | Exact `1.0.0` for the recorded-activity contract. It is versioned independently from the event snapshot. |
| `adapterVersion` | `hevy-workouts-v1`. |
| `source` | `hevy`. |
| `accountId`, `connectionGeneration` | Same meanings as the event snapshot. |
| `requestedRange` | Inclusive `startLocalDate`/`endLocalDate` plus IANA `timezone`. Default and maximum: today and up to 30 prior local dates. |
| `fetchedAt` | UTC instant. |
| `completeness` | `complete` only when every page was read before the deadline, no duplicate conflicted, and the pre-read and post-read count and `page_count` match. Otherwise `incomplete` with a stable failure. `complete` means no change was detected. It is not an atomic snapshot: a creation and a deletion during the read can keep both counts unchanged while shifting offset pages, and list ordering is undocumented. |
| `coverage` | `pagesRead`, provider `pageCount`, `countBefore`, `countAfter`, `itemCount` after duplicate removal, `duplicatesRemoved`, and `paginationComplete`. |
| Read bounds | Count preflight, then at most 50 pages of 10 (500 workouts), under the shared 25-second deadline and retry rule. Above 500 workouts the read returns `incomplete_pagination` without reading pages. This 50-page ceiling applies only to recorded activity. Duplicate provider IDs are removed, keeping the copy with the latest `updated_at`. |
| `activities[].id` | Opaque account-scoped ID derived from source and provider workout ID. |
| `activities[].kind` | `workout`. |
| `activities[].startAt` / `endAt` | UTC instants from Hevy `start_time`/`end_time`. End is exclusive and must be later than start; otherwise the item is quarantined and coverage is incomplete. |
| `activities[].duration` | `{ kind: "known", seconds }`, derived by instant arithmetic. Never supplied independently. |
| `activities[].localStartDate` | Profile-timezone date of `startAt`. A workout belongs to the range when its interval intersects the requested local days. |
| `activities[].revision` | `providerUpdatedAt` from `updated_at`, or null with availability `unavailable`. |
| `activities[].fieldAvailability` | `location: "unsupported"` and `sourceTimezone: "unsupported"`. Hevy's documented workout schema has no location or timezone field. Missing location is never inferred from Behavior locations, travel settings, or titles. |

Ticket 221 contract details. The snapshot also carries `failures` (the stable read
error codes; at least one when incomplete, none when complete). It has no stored
freshness field: the consumer projection derives current or stale from the
injected `now` and the five-minute day-context freshness window. Coverage counts
and `pageCount` are null when the provider did not report them. `complete`
additionally requires `itemCount` to equal both counts, so a removed duplicate
that hid a skipped workout cannot pass. `normalizeRecordedWorkout` derives each
activity from provider instants with explicit offsets and the injected fetch time.
It quarantines a missing ID, malformed start or end, missing end, reversed or
zero-length interval, end after fetch time, or malformed revision. The validator
rejects the same intervals, unknown durations, wall-clock durations, and any
extra field. Location and source timezone are always `unsupported`; an earlier
draft's optional location and unknown-duration fields are not part of the
contract.

The adapter discards `title`, `description`, `routine_id`, `exercises`, sets,
weights, reps, notes, and every other field before validation. They never cross
the adapter boundary, enter caches, or reach a consumer.

Recorded activity never completes, marks, or changes a Behavior, Occurrence,
status, Note, reminder, or tracked time. A later feature that suggests a match
needs its own ticket and explicit user action.

### Separate Daily Brief disclosure

Connection and display never grant Daily Brief disclosure. The existing
`includeCalendar` preference keeps its current meaning: Google Calendar only.
Ticket 226 adds one separate default-off disclosure per new source:
Outlook Calendar, iCloud Calendar, and Hevy workout timing. Enabling one
increments the disclosure revision. Validators keep accepting stored preference
records written before these keys existed and treat missing keys as off.

Settings `PUT` follows the existing precedent in
`lib/services/daily-brief.service.ts` (`updateDailyBriefSettings`). It accepts
exactly three key sets: the original two keys, the current four keys, and the
four keys plus the three new source keys. A two- or four-key `PUT` from an older
client sets the new disclosures to off, so an update never grants them silently.
That revocation is expected and must be visible in Settings. Every other key set
is `invalid_request`. Enabling a new source requires its connection to be
connected, as `includeCalendar` does today.

`AdvisorDayContext` is version `1.0` with Google-only connectors. Adding
connector kinds changes its accepted values, so Ticket 221 adds version `1.1`.
Validators accept `1.0` only with Google or no connectors and `1.1` with any
known connector. Saved workbench records at `1.0` stay readable. Desktop does
not consume this contract. Ticket 221 adds `validateVersionedAdvisorDayContext`,
`validateVersionedAdvisorDayContextRequest`,
`projectVersionedAdvisorCalendarConnector`, and `projectAdvisorActivityConnector`
in `packages/core/src/services/advisor-day-context.ts`. The existing `1.0`
validators and projections are unchanged. Ticket 226 wires consent and assembly:
a live brief with a disclosed new source produces `1.1`, and Google-only reads
still produce exact `1.0`. In `1.1`, each source appears at
most once, event refs are unique across connectors, and Outlook and iCloud refs
are namespaced by source before hashing. Google refs are unchanged.

The consumer projection for Outlook and iCloud equals the Google projection
above, with connector kind `outlook_calendar` or `icloud_calendar`. The activity
projection contains only the opaque activity reference, start/end, duration,
local start date, `location: unsupported`, adapter/schema versions, generation,
coverage, fetched time, freshness, completeness, and failures. Titles, provider
IDs, and credentials never enter model input.

Disconnecting a source, disabling its disclosure, switching accounts, or
changing its connection generation fences pending briefing delivery for that
source.
