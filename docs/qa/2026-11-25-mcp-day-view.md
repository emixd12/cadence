# "Cadence day" MCP Apps view: Ticket 377

Date: November 25, 2026. Decision: `docs/DECISIONS.md`, 2026-11-25, D36. Contract:
`docs/qa/2026-11-26-mcp-apps-spike.md`, "Frozen `show_day` contract".

## Result

The view is built and passes its tests. It was exercised in the `ext-apps` `basic-host`
against a fixture MCP server. Since Ticket 376 merged, Cadence's server serves this HTML
when `CADENCE_MCP_APPS=true`, and the fixtures pass the server's `show_day` output schema.

Not verified: the view against Cadence's own server in a host, and any real host (Claude,
ChatGPT and the others). Both belong to Ticket 378. One attempt at the first was made on
November 26 on a local acceptance stack (`cadence-accept-377`, flag on). It stopped before
any token existed: under the stack's `next dev`, `/oauth/consent` reloaded in a Fast Refresh
loop, so the consent driver found no permission switch (`scope-not-offered`, six tries). The
cause was not found. The stack was removed with 0 grants.

## Bundle

| Measure | Value |
|---|---|
| Stack | Preact 10.27.2, `@modelcontextprotocol/ext-apps` 2.0.4, zod 4.6.7, Vite 8.3.6, `vite-plugin-singlefile` 2.3.4 |
| Raw | 271,236 bytes |
| gzip -9 | 72,598 bytes |
| Spike measurement (Preact with `ext-apps`) | 261,056 raw, 70,140 gzip |

The 10 KB over the spike is the finished view: the styles, the notices catalog file and
the note, parent slot and refusal handling. `tests/mcp-day-view-build.test.ts` fails above
300,000 bytes raw or 80,000 gzip.

The build is deterministic. `packages/mcp-views/scripts/build.mjs` fixes `NODE_ENV` and the
Vite mode and reads no `.env` file, because Vitest's `NODE_ENV=test` changed the bytes
before that. The same test rebuilds the view and compares it with the committed module.

## Tests

`tests/mcp-day-view.dom.test.ts` (24 tests) runs the shipped bundle in jsdom. The window
loads no subresource, and `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `Worker`,
`Image` and `sendBeacon` are replaced by recorders that must stay empty. A mock host
(`packages/mcp-views/src/mock-host.ts`) answers the MCP Apps protocol.

| Area | What the tests assert |
|---|---|
| Reading | Heading, day note, row order, a moved item's time, Needs decision at 0, 1, 4 and above 100, the empty day, loading and cancelled states |
| Labels | "Alongside" for `true` only (true, false, null, absent); "Completed · From Hevy"; the three opportunity labels |
| Status write | `expected_status` from the row, a key of the form `view-` plus 32 hex digits, a re-read with the displayed date, one model-context line |
| Parent slot | Collapsed with the server's progress, each step once, `occurrence_ids` and `expected_statuses` of every displayed step |
| Note save | `expected_revision`, one editor at a time, no note text in the model-context line |
| Conflict | Re-read, the alert, no second write without a click, a new key on the next click; a refused note save keeps the draft beside the saved note; a note changed elsewhere while the editor is open is refused even after a re-read; the person's own mark on the row does not cause a conflict |
| Rate limit | The wait in the alert, controls held, no call during the wait, the same key on the retry |
| Missing scope | Read-only `_meta`, an `insufficient_scope` tool error and a rejected call each end in "Reconnect to allow changes" with no write control |
| Rejected call with a write scope | "Not changed" alert and the same key on the identical retry |
| Inert and offline | Hostile titles, notes and day note render as text with no element created; zero network attempts; the file holds no external script, style, image, font, frame, link, storage or network API |
| Theme | The host's theme and style variables apply at start and on change |

`tests/mcp-day-view-build.test.ts` (4 tests): byte-equal rebuild, the size limits, the
words match the notices catalog, and `ext-apps`, `zod` and `preact` stay out of the root
manifest.

## Hand checks

**Bench.** `/design-system?preview=mcp-day-view` frames the shipped bundle with
`sandbox="allow-scripts"`. Headless Chrome, 375px and 720px, light and dark, with no host
variables and with Claude's published variables. In every state the frame made 0 requests,
its document height equalled its content height, nothing overflowed sideways and no button
measured under 44px. States looked at: normal, empty, read-only, conflict (status and
note), rate limit, connector, parent, opportunity, alongside, hostile, loading.

**`basic-host`.** `ext-apps` tag `v2.0.4`, the build the spike left. The server was a
scratch MCP server that served the shipped HTML as the `ui://cadence/day/v1.html` resource
and answered the four tools from the fixture mock. It is not Cadence's server.

| Step | Server after the step |
|---|---|
| Completed on one Occurrence | `set_occurrence_status` ok, status `completed` |
| Completed on a parent slot | `set_parent_occurrence_status` ok, progress `3/3` |
| Save a note holding `<img src=x onerror=...>` | Note stored unchanged; no `img` element in the view |
| Click after the status changed elsewhere | `conflict`; the view re-read the day and showed the alert |
| Read-only grant, dark, 1200px | "Reconnect to allow changes", 0 write controls |

Each write was followed by a `show_day` re-read carrying `date`. The view frame made 0
requests. After the list grew from 272px to 639px the frame still fitted its content, so
the spike's clipped last row (its finding 9) did not recur. The model-context line reached
the host's "Model Context" panel.

Screenshots are not committed: `docs/qa/` holds no images. The bench reproduces each one.

## For Ticket 378

- The view ignores `ui/notifications/tool-input`. It needs the `show_day` result
  notification with `structuredContent`; a host that sends none leaves placeholder rows.
- With no `_meta` the view shows controls and relies on the error. A rejected call makes it
  re-read `show_day`; if that result has no `_meta` either, it shows "Not changed" and not
  the reconnect line.
- The view does not apply host fonts (`styles.css.fonts`), because that CSS can name files.
  It uses the host's `--font-sans` name only.
- A rate-limited write keeps its idempotency key. Other final errors drop it.
- Not checked on any host: approval prompts on view-initiated writes, safe-area insets, the
  150,000-character result limit in Claude, and how each host caches the HTML.
- `show_day` output larger than the view expects is fine: it reads named fields only.
- The local stack needed `CADENCE_SUPABASE_CLI` set to the repository's pinned CLI
  (`node_modules/@supabase/cli-darwin-arm64/bin/supabase-go`). The Homebrew CLI on this Mac
  refuses `[inbucket]` in `supabase/config.toml`.
- Each write costs two calls against the per-grant limits: the write and one `show_day`
  re-read. A refused write also re-reads once, except a rate-limited one, which does not.
