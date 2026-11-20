# Interaction Registry

## Purpose

`interaction-registry.json` is the canonical inventory of implemented user
interaction intents across Cadence. It gives product, design, QA, and coding
agents one index for answering:

- What can a user intentionally do?
- Where and when is the interaction available?
- What state or side effect can it produce?
- Does it require confirmation?
- Which source files and tests own it?

The registry complements, but does not replace, `docs/UI_SPEC.md`,
`docs/USER_FLOWS.md`, or `docs/UX_JOURNEY_INVENTORY.md`. Those documents define
the product behavior and end-to-end experience. The registry provides stable
interaction IDs and implementation traceability.

## Canonical files

- `interaction-registry.json`: canonical data.
- `interaction-registry.schema.json`: field contract.
- `scripts/check-interactions.mjs`: structural, reference, coverage, and drift
  validation.

The current schema version is `1.4.0`. Version 1.1 added required
`user_guidance` metadata without changing the meaning of existing interaction
fields. Version 1.2 adds optional `effect_checks`. Each check binds one recorded
effect to a named implementation handler and stable evidence inside that
handler. `npm run interactions:check` fails when that evidence disappears. It
reports entries without complete mechanical effect coverage for human review
and never counts those entries as mechanically checked.

Version 1.3 adds platform applicability, implementation status, and evidence
for web, desktop, marketing, and future mobile. Existing interaction IDs and
intent stay unchanged. The existing top-level fields retain the implemented
web or marketing contract while the desktop port is pending. Desktop-only
controls use new IDs, with explicit web/marketing exclusions and native evidence
gates. Partial native proof belongs in the applicable intent’s notes; it does
not establish all variants as implemented.

Version 1.4 adds a top-level `features` list and a required `feature` field on
every interaction. A feature is a named product area a person would recognize,
such as Timeline, Daily Brief or Hevy connector. Each feature has a stable id, a
plain-language `meaning`, and a `spec` reference to the doc section that defines
it. `npm run interactions:check` fails when a feature's spec heading is missing,
when an interaction names an unknown feature, or when a feature has no
interactions. The product map (`docs/PRODUCT_MAP_GUIDE.md`) joins features to
journeys, components, tokens, services, API routes, database tables and MCP tools.

Do not maintain a second hand-written list of interaction entries. Query or
transform the JSON registry when another representation is needed.

## Registry unit

One entry represents one meaningful user intent, not every DOM event or every
keystroke. Equivalent controls may be grouped as variants when they have the
same intent and effect. For example, primary navigation is one interaction with
Timeline, Behaviors, Export & Import, and Settings variants.

The registry includes:

- the Astro marketing site;
- public login, Terms, Privacy, and Trust pages;
- the authenticated Next.js application;
- pointer, keyboard, and touch triggers implemented by Cadence;
- confirmation fields when changing them is part of a gated action.

The registry excludes:

- passive scrolling, hover, focus, and text selection;
- browser-native controls inside notification permission prompts, file pickers,
  save dialogs, and download shelves;
- interactions inside Google or other provider-owned pages;
- direct API and cron invocation, because those are operator/system actions;
- the local, dev-only design-system bench;
- new planned or deferred intents with no user-facing implementation on any
  platform. A pending desktop implementation of an existing intent belongs in
  that intent's platform record.

## Required entry fields

Each interaction records:

- a stable `INT-<DOMAIN>-NNN` ID;
- surface and route ownership;
- linked UX journey IDs;
- intent, triggers, availability, and optional variants;
- success and failure results;
- material effects, risk, and confirmation level;
- implementation references;
- user-guidance audience and one or more task-guide references;
- explicit test-coverage level and references.
- a `platforms` record for web, desktop, marketing, and mobile.

`implementation` references use repository-relative paths. A `#symbol` suffix
may identify an exported action or function in that file.

`user_guidance.audience` is `user` for product interactions and `internal_qa`
for test-only interactions. `user_guidance.references` contains unique,
repository-relative `docs/user-guide/*.md#anchor` references. The anchor must be
the GitHub-style slug of an existing Markdown heading. Only `INT-AUTH-002` and
`INT-SHELL-007` use `internal_qa`; their references stay in
`docs/user-guide/internal-qa.md`.

### Test-coverage levels

Coverage describes evidence for the registered user intent and trigger, not
only for adjacent resolver, service, route, or artifact logic:

- `direct`: every cited reference is an automated test under `tests/` that
  renders the registered control or activates the registered interaction and
  asserts its user-visible result or material effect.
- `indirect`: cited automated tests or repository check scripts verify adjacent
  logic, routes, generated artifacts, or state transitions without rendering
  or activating the registered control itself.
- `manual`: the trigger or a browser/provider-owned outcome still requires
  browser, device, or human QA. References may name adjacent automated tests,
  but the notes must state what remains manual.
- `none`: no current test or recorded manual evidence covers the interaction.

Production components, resolvers, services, data modules, and generators are
implementation references, not test evidence. `direct` references must use
`tests/*.test.*` or `tests/*.spec.*`. `indirect` references may additionally use
repository `check-*` scripts.

## Platform parity and release

Each platform records `applicability` and `status`:

- `applicable` uses `implemented` or `planned` status.
- `not_applicable` uses the same status and states an explicit reason.
- `deferred` uses the same status and states the unscheduled scope boundary.

Implemented platforms cite source code in `implementation` and tests or
recorded QA in `evidence`. Empty evidence means verification is not recorded;
it must not imply a passed native check. Desktop implementation must include
an `apps/desktop/` source reference. Shared code alone does not prove desktop
usage. At least one desktop implementation reference must have a cataloged
`source_inventory` entry for the same interaction ID. Excluded developer
benches cannot establish parity, even with existing test references. Planned
platforms cite an existing Markdown ticket heading in
`follow_up`. The validator resolves code references, evidence, and ticket
anchors. Deferred mobile applicability makes no mobile parity commitment.

Run the release gate before signing or publishing a desktop release:

```bash
node scripts/check-interactions.mjs --desktop-release
```

The release gate rejects every applicable desktop interaction that remains
planned or lacks verification evidence. Evidence must include a test or
recorded QA under `docs/qa`; structural checks alone cannot satisfy this gate.
The gate checks references and declared coverage. It does not prove semantic
parity, actual WKWebView behavior, notification delivery, or signed-release
acceptance. Those tests remain separate release requirements.

The native boundary proof is a developer bench, not a tracking implementation.
It does not complete an interaction. Ticket 111 owns tracking parity; Ticket
112 owns native reminder intent, permission, and notification activation.
`docs/DESKTOP_PARITY.md` records the current domain baseline without creating
another list of interaction IDs.

### Google Calendar release state

`INT-CALENDAR-001` through `INT-CALENDAR-007` record implemented source paths
for web and desktop. Their implementation status means the controls and local
logic exist. It does not mean that Google OAuth, hosted migration, deployment,
native behavior, or distribution passed live acceptance.

The server returns `not_configured` unless every required Calendar OAuth and
encryption setting is valid. Desktop exposes Calendar only when its build has a
valid HTTPS connector origin and the user linked a Cadence account. Keep manual
or missing provider/native evidence classified honestly. Do not promote local
fixture, DOM, or structural evidence to live-provider or native acceptance.

The registry's source references cover the user intent. Data custody, cache,
revocation, deletion, and backup promises live in the product and user guides.
Ticket 137 and `docs/qa/day-progress-release.md` own the combined release gate.
Local automated coverage includes `tests/google-calendar-panel.dom.test.tsx`,
`tests/google-calendar-client.test.tsx`,
`tests/day-progress-timeline.dom.test.tsx`, and the connector service tests.
These tests do not replace authorized Google or installed desktop acceptance.

## Updating the registry

Update the registry in the same change whenever a user-facing interaction is
added, removed, renamed, gated differently, moved to another route, given a new
side effect, or receives materially different test coverage.

1. Reuse an existing ID when the user intent is unchanged.
2. Add a new ID when a genuinely new user intent is introduced.
3. Do not recycle removed IDs for unrelated interactions.
4. Update `source_inventory` for new or removed interactive UI source files and
   refresh `interaction_marker_count` when a file's recognized controls or
   event handlers change. The validator reports the expected and actual count.
5. Add or update the relevant implementation and test references.
6. Add or update `user_guidance` so every interaction points to the applicable
   task procedure. Add the guide procedure in the same change when no suitable
   heading exists.
7. Classify test coverage at the registered trigger boundary. Do not call
   adjacent service, route, parser, resolver, or artifact checks `direct`.
8. Run `npm run interactions:check`. The validator checks the declared
   audience, guide path, file existence, resolved Markdown heading anchor, and
   whether automated evidence references use test or check-script paths.
9. For UI work, also run the project-required design and full verification
   commands.
10. Review all four platform records. Link each affected platform to its
    implementation and evidence, a follow-up ticket, or an explicit exclusion.
    Marketing consumes approved product claims; it does not duplicate the app.

The one occurrence-time interaction also covers **Reset tracked time** inside
the Behaviors Review disclosure. It reuses the Timing interaction ID because
the owner-scoped deletion intent and service semantics are unchanged. Its
Behaviors component and action must remain listed beside the Timeline controls.

## Load-test companion manifest

`interaction-registry.json` continues to describe user intent. HTTP execution
metadata belongs in `load-tests/scenarios/interaction-map.json`, keyed by the
stable interaction ID; do not add routes, load weights, environment
eligibility, fixture preconditions, or cleanup ownership to the canonical
registry schema.

Every live interaction must have exactly one companion classification:
`loadable_http`, `browser_only`, `external_provider`,
`destructive_serial_only`, or `not_load_bearing`. A loadable interaction may
map to multiple HTTP requests. Non-loadable entries require a concise reason
without copying the registry's intent, risk, effects, success/failure, or
guidance prose.

When either inventory changes, run both checks:

```bash
npm run interactions:check
npm run load:manifest:check
```

The load validator rejects missing, duplicate, unknown, or misclassified IDs
and prevents destructive interactions from entering ordinary mixed profiles.
See `docs/LOAD_TESTING_PLAN.md` for request naming, environment, secret,
artifact, and execution rules.

Ticket 068 classifies occurrence time tracking as `not_load_bearing`. Its
elapsed duration is user-paced and the ordinary authenticated Timeline document
request remains the shared route-capacity proof.

Ticket 070 registers `INT-EXPORT-019` for the default-off time-tracking export
choice. It is `browser_only` because it changes an unsaved sensitive-data scope
draft before the existing export-options request.

Ticket 071 registers `INT-TIMELINE-010` for mobile Timeline pull-to-refresh.
It is `browser_only` because threshold, direction locking, native-refresh
suppression, and touch feedback require a rendered browser. Existing Timeline
read profiles remain the route-capacity proof.

## Useful queries

List all IDs and names:

```bash
jq -r '.interactions[] | "\(.id)\t\(.name)"' interaction-registry.json
```

List destructive interactions:

```bash
jq -r '.interactions[] | select(.risk == "destructive") | .id + "\t" + .name' interaction-registry.json
```

List interactions without direct automated coverage:

```bash
jq -r '.interactions[] | select(.test_coverage.level != "direct") | .id + "\t" + .name + "\t" + .test_coverage.level' interaction-registry.json
```

List interactions for one journey:

```bash
jq -r '.interactions[] | select(.journeys | index("J07")) | .id + "\t" + .name' interaction-registry.json
```

List interaction guide references:

```bash
jq -r '.interactions[] | .id as $id | .user_guidance.references[] | $id + "\t" + .' interaction-registry.json
```


## Behavior planning fields (Tickets 142–143)

`INT-BEHAVIOR-030` and `INT-BEHAVIOR-031` cover optional duration and end-date
drafts in the shared web/desktop form. Existing create/edit intents persist them.
Restore clears an expired date and the current automatic-archive notification.
Automatic background archival itself is a system action, outside this registry.


Ticket 149 extends `INT-TIMELINE-010` to desktop upward overscroll and awaits
Cadence plus connector reloads before completion feedback. `INT-CALENDAR-005`
keeps bottom previews and opens explicit details in a centered native modal.
The shared Timeline catalog records provider icons and thin facet overlap borders.
