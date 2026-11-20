# Product map

The product map is one graph of Cadence that joins the repository's existing
registries. It answers questions such as "which components, services and database
tables does the Daily Brief use?" or "which features touch the `occurrences`
table?" without anyone keeping a second list by hand.

`scripts/build-product-map.mjs` builds it. The builder uses no model and no
network, and writes no timestamps, so the same files always give the same map.
The map is not committed: build it when you need it.

## Commands

```bash
npm run map:check                  # build in memory; fail on errors, print warnings
npm run map:check -- --verbose     # print every warning
npm run map:build                  # also write product-map.json, docs/PRODUCT_MAP.md and docs/NOTICES.md
npm run map -- feature:daily-brief # one item, its links and, for a feature, its architecture
npm run map -- occurrences         # every item whose id or name contains the text
```

`npm run map:check` runs in CI (`checks` job), in Dagger (`cadence/productMap`) and
in the required commands. `product-map.json` and `docs/PRODUCT_MAP.md` are
gitignored. `docs/NOTICES.md` is committed, and `map:check` fails when it is out of
date with the notices catalog.

## Where each item comes from

Edit the source, never the map.

| Item | Id form | Source |
| --- | --- | --- |
| Journey | `journey:J07` | The journey map table in `docs/UX_JOURNEY_INVENTORY.md` |
| Feature | `feature:timeline` | `features` in `interaction-registry.json` |
| Interaction | `interaction:INT-TIMELINE-001` | `interactions` in `interaction-registry.json` |
| Surface, route | `surface:timeline`, `route:/timeline` | `interaction-registry.json` |
| Component | `component:module.daily-brief` | `design-system.manifest.json` |
| Component family | `family:module.timeline-feed` | `design-system.surfaces.json` |
| Token | `token:--alert-signal` | The token files in `design-system.config.json` |
| Ontology term | `term:config.version` | `docs/ontology/*.json` |
| Database table | `table:occurrences` | `create table` in `supabase/migrations/*.sql`, minus dropped tables |
| MCP tool | `mcp-tool:list_behaviors` | `packages/core/src/integration/operations.ts` |
| Notice | `notice:move.moved` | `packages/core/src/notices/catalog/*.json` (see [Notices](#notices)) |
| File, test, service, repository, API route | `file:…`, `test:…`, `service:lib/services/…`, `repository:lib/db/…`, `api:/api/…` | Repository files that a registry or the scan names |

Journeys, features, interactions, components, families, terms, MCP tools and
notices must each carry a meaning sentence. Tokens in `packages/ui/tokens.css`
must have a description comment: a comment describes the declarations directly
under it, up to the next blank line. Tokens in other token files warn when they
have none.

## Links

Every link names the place it came from by a stable id, never by array position,
for example `interaction-registry.json#INT-AUTH-003/journeys/J02`.

- **Asserted** links are written in a registry by a person: a feature contains an
  interaction, an interaction is implemented in a file, a component belongs to a
  family.
- **Derived** links come from scanning source code with the TypeScript parser: a
  file renders a component, a file uses a service, a file calls an API route, a
  service reads a table, a component is styled by a token.

| Link | Meaning |
| --- | --- |
| `contains` | A journey or feature contains an interaction; a surface contains a route |
| `on` | An interaction happens on a surface or route |
| `implemented-in`, `defined-in` | Where an item's code or definition lives |
| `tested-by`, `explained-in` | Tests and user-guide pages for an interaction |
| `renders` | A file renders a design-system component |
| `shows` | A file shows a notice (it names the notice's id) |
| `uses`, `calls` | A file imports a service, or a service reads a table; a file fetches an API route |
| `styled-by`, `aliases` | A component or notice uses a token (a notice's comes from its style); a token is another token's alias |
| `belongs-to` | A component belongs to a family; a notice belongs to a feature |
| `shown-by` | A notice is shown by an interaction |
| `relates-to` | An ontology term relates to another term |

A feature's architecture follows the links: its interactions' files, the
components those files render, the services, repositories (`lib/db`) and API routes
they reach directly or through up to two helper files, one more hop from API routes
and services to repositories, and the tables those read. A file that implements 4
or more features (such as `apps/desktop/src/product.tsx`) is a shared screen: it
is listed but not followed, unless the feature has no other files. Each MCP tool
links to the services its handler calls; linking tools to features needs a
function-level call graph and is a follow-up (`docs/FUTURE_UPDATES.md`).

## Notices

The notices library holds every sentence Cadence shows about what just happened or
the state something is in. Each file in `packages/core/src/notices/catalog/` is one
feature's notices, keyed by id:

```json
"move.moved": {
  "meaning": "Confirms that the person moved one of today's items to a new time.",
  "text": "{title} moved to {time} for today.",
  "style": "outcome",
  "interactions": ["INT-TIMELINE-014"],
  "previous": [{ "look": "Ink, upright", "until": "2026-11-20", "change": "Outcome style: italic Ink." }]
}
```

- `style` is `outcome`, `error`, `note` or `question` (DESIGN.md, "Notices").
  An error may add `alert` (the Alert notice kind) and `label` ("Not changed").
- `text` is a template: `{name}`, `{name, select, yes {…} other {…}}` and
  `{count, plural, one {…} other {# …}}` (`packages/core/src/notices/format.ts`).
  A missing value throws.
- `channel` is `in-app` (default), `reminder` or `email`; `platforms` is `web`
  and/or `mac` (default both); `status` is `active` (default), `planned` or
  `retired`; `feature` overrides the file's feature.
- `previous` records each earlier version (its text or look, the last day it showed
  and what changed), newest last. `docs/NOTICES.md` lists them as the change table;
  to revert one, copy its text back and drop the record.

Code shows a notice by id: `<Notice id="move.moved" params={{ title, time }} />` in
a screen, `noticeText("move.moved", { title, time })` for a string (server
messages, labels). The map links each file that names a notice's id to it
(`shows`). `map:check` fails when an active notice is shown nowhere, a retired one
is still shown, or a template's braces or `other` branch are wrong.
`tests/notices.test.tsx` checks every template formats and keeps raw
`role="status"`/`role="alert"` outside `components/feedback/` from growing
(`tests/fixtures/notice-role-allowlist.json`; counts only go down).

Covered so far: moves, the Daily Brief and its move lines, the Timeline's reload
line, reminders opened on the Mac, and the Ended and Paused form errors (the three
Ended and Paused Timeline notices are `planned` until that work merges). Other
areas follow after the advisor work merges (`docs/FUTURE_UPDATES.md`).

## Errors and warnings

Errors fail the check: duplicate ids, a link to an unknown item, a missing
meaning, a journey row without its section, a component source that is not a file,
a feature with no interactions, a notice problem (above), or an out-of-date
`docs/NOTICES.md`.

Warnings do not fail it: references that are not files, differences from
`design-system.usage.json` (the map's own scan is the reference), hard-coded colors
in component files, and missing descriptions outside the canonical token file.
