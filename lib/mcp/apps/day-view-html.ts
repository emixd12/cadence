/**
 * The "Cadence day" view as one HTML string, served by `resources/read` for
 * `ui://cadence/day/v1.html` (Ticket 376).
 *
 * PLACEHOLDER. Ticket 377 replaces this whole file with the module its build generates
 * from `packages/mcp-views`. The replacement must keep the export name and type:
 * `export const DAY_VIEW_HTML: string`. It must stay one self-contained document under
 * `MCP_APP_RESOURCE_BYTE_CAP` bytes (`lib/mcp/apps/config.ts`), with no network
 * request and no external asset.
 *
 * This placeholder has no script, no style sheet link, no image and no form, so it makes
 * no request of any kind.
 */
export const DAY_VIEW_HTML: string = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Cadence day</title>
</head>
<body>
<p>Cadence day view is not built yet.</p>
</body>
</html>
`;
