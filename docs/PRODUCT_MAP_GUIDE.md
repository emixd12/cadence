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
npm run map:build                  # also write product-map.json and docs/PRODUCT_MAP.md
npm run map -- feature:daily-brief # one item, its links and, for a feature, its architecture
npm run map -- occurrences         # every item whose id or name contains the text
```

`npm run map:check` runs in CI (`checks` job), in Dagger (`cadence/productMap`) and
in the required commands. `product-map.json` and `docs/PRODUCT_MAP.md` are
gitignored.

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
| Notice | `notice:<id>` | `lib/notices/*.json` (notices library, build step 2) |
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
| `uses`, `calls` | A file imports a service, or a service reads a table; a file fetches an API route |
| `styled-by`, `aliases` | A component uses a token; a token is another token's alias |
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

## Errors and warnings

Errors fail the check: duplicate ids, a link to an unknown item, a missing
meaning, a journey row without its section, a component source that is not a file,
or a feature with no interactions.

Warnings do not fail it: references that are not files, differences from
`design-system.usage.json` (the map's own scan is the reference), hard-coded colors
in component files, and missing descriptions outside the canonical token file.
