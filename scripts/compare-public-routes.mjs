import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import { boundedFetch } from "./public-trust-http.mjs";

const MAX_ROUTES = 96;

function canonicalFromHtml(html, finalUrl) {
  const match = /<link\s+[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["'][^>]*>/i.exec(html)
    ?? /<link\s+[^>]*href=["']([^"']+)["'][^>]*rel=["']canonical["'][^>]*>/i.exec(html);
  return match ? new URL(match[1], finalUrl).toString() : finalUrl;
}

export function compareObservedRoutes(declared, observed) {
  const expected = new Map(declared.map((route) => [route.path, route]));
  const actual = new Map(observed.map((route) => [route.path, route]));
  const failures = [];
  for (const path of expected.keys()) {
    const result = actual.get(path);
    if (!result) failures.push(`${path}: missing`);
    else if (!result.ok) failures.push(`${path}: ${result.reason}`);
  }
  for (const path of actual.keys()) if (!expected.has(path)) failures.push(`${path}: undeclared live route`);
  return { status: failures.length ? "failed" : "passed", checked: declared.length, failures };
}

export async function collectRoutes({ origin, routes, fetcher, vercelShare }) {
  if (!Array.isArray(routes) || routes.length === 0 || routes.length > MAX_ROUTES) throw new Error("Route count is outside the bounded allowlist.");
  const observed = [];
  for (const route of routes) {
    const { response, body, finalUrl } = await boundedFetch(origin, route.path, { fetcher, followRedirects: false, vercelShare });
    const contentType = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() ?? "";
    let reason = "";
    if (response.status !== route.status) reason = `expected status ${route.status}, received ${response.status}`;
    else if (route.content_type && contentType !== route.content_type) reason = `expected content type ${route.content_type}, received ${contentType || "none"}`;
    else if (route.location && new URL(response.headers.get("location") ?? "", origin).toString() !== new URL(route.location, origin).toString()) reason = "redirect target changed";
    else if (route.marker && !body.toString("utf8").includes(route.marker)) reason = "stable page marker missing";
    else if (route.canonical && canonicalFromHtml(body.toString("utf8"), finalUrl) !== new URL(route.canonical, origin).toString()) reason = "canonical URL changed";
    observed.push({ path: route.path, ok: !reason, reason });
  }
  return { observed, ...compareObservedRoutes(routes, observed) };
}

export async function collectRouteCandidates({ origin, candidates, fetcher, vercelShare }) {
  if (!Array.isArray(candidates) || candidates.length > MAX_ROUTES) throw new Error("Candidate route count exceeds the bounded allowlist.");
  const failures = [];
  for (const candidate of candidates) {
    const { response } = await boundedFetch(origin, candidate.path, { fetcher, followRedirects: false, vercelShare });
    if (response.status !== candidate.status) failures.push(`${candidate.path}: undeclared live public route candidate returned ${response.status}`);
  }
  return failures;
}

export function marketingContracts(manifest) {
  const routes = manifest?.schema_version === 1 && Array.isArray(manifest.routes) ? manifest.routes : null;
  if (!routes || routes.length > MAX_ROUTES) throw new Error("Marketing manifest exceeds the route limit or has an unsupported shape.");
  return routes.flatMap((entry) => [
    { path: new URL(entry.url).pathname, status: 200, content_type: "text/html", marker: `<title>${entry.title}`, canonical: entry.canonical_url },
    ...(entry.include_in_markdown_mirror ? [{ path: new URL(entry.markdown_url).pathname, status: 200, content_type: "text/markdown", marker: `canonical_url: ${entry.canonical_url}` }] : []),
  ]);
}

async function main() {
  const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, index, all) => index % 2 === 0 ? [...pairs, [value.replace(/^--/, ""), all[index + 1]]] : pairs, []));
  const config = JSON.parse(await readFile(args.config, "utf8"));
  const routes = args.surface === "marketing" ? marketingContracts(config) : config.routes;
  const result = await collectRoutes({ origin: args.origin, routes });
  await writeFile(args.output, `${JSON.stringify(result, null, 2)}\n`);
  if (result.status === "failed") process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
