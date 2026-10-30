#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { Temporal } from "@js-temporal/polyfill";

const property = "sc-domain:cadence-me.com";
const serviceAccount = "polyak-agent@polyak-precious--1726112956978.iam.gserviceaccount.com";
const sitesBase = "https://www.googleapis.com/webmasters/v3/sites";
const usage = `Usage: npm run search-console -- <command> [options]

Cadence property: ${property}
Read commands:
  verify
  sitemaps
  inspect --url https://cadence-me.com/
  query --start YYYY-MM-DD --end YYYY-MM-DD [--dimensions date,page] [--limit 1000]
Write commands (require a specific operator instruction):
  submit-sitemap --sitemap https://cadence-me.com/sitemap.xml
  delete-sitemap --sitemap https://cadence-me.com/sitemap.xml

Delete removes a sitemap submission, not website files or search results.
Inspection reads Google's indexed state; it cannot request indexing or list exclusions.`;

function cadenceUrl(value) {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash ||
      (url.hostname !== "cadence-me.com" && !url.hostname.endsWith(".cadence-me.com"))) {
    throw new Error("URL must belong to cadence-me.com, without credentials or a fragment.");
  }
  return url.href;
}

export function buildRequest(args) {
  const { positionals, values } = parseArgs({ args, allowPositionals: true, options: {
    url: { type: "string" }, sitemap: { type: "string" }, start: { type: "string" },
    end: { type: "string" }, dimensions: { type: "string" }, limit: { type: "string" },
    help: { type: "boolean" },
  } });
  if (values.help || positionals.length === 0) return null;
  if (positionals.length !== 1) throw new Error("Expected one command.");
  const command = positionals[0];
  const allowed = {
    verify: [], sitemaps: [], inspect: ["url"],
    query: ["start", "end", "dimensions", "limit"],
    "submit-sitemap": ["sitemap"], "delete-sitemap": ["sitemap"],
  }[command];
  if (!allowed) throw new Error("Unknown Search Console command. Use --help.");
  if (Object.keys(values).some((key) => !allowed.includes(key))) {
    throw new Error("Option does not apply to this command.");
  }
  const base = `${sitesBase}/${encodeURIComponent(property)}`;
  const request = { url: base, method: "GET", write: false };
  if (command === "sitemaps") request.url += "/sitemaps";
  if (command === "inspect") {
    request.url = "https://searchconsole.googleapis.com/v1/urlInspection/index:inspect";
    request.method = "POST";
    request.body = { inspectionUrl: cadenceUrl(values.url), siteUrl: property, languageCode: "en-US" };
  }
  if (command === "query") {
    for (const date of [values.start, values.end]) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? "")) throw new Error("Both dates must use YYYY-MM-DD.");
      Temporal.PlainDate.from(date);
    }
    if (values.start > values.end) throw new Error("Start date must not follow end date.");
    const dimensions = (values.dimensions ?? "date").split(",");
    const known = ["date", "country", "device", "page", "query", "searchAppearance"];
    if (dimensions.some((dimension) => !known.includes(dimension)) || new Set(dimensions).size !== dimensions.length) {
      throw new Error("Dimensions must be unique Search Console dimensions.");
    }
    const limit = Number(values.limit ?? 1000);
    if (!Number.isInteger(limit) || limit < 1 || limit > 25000) throw new Error("Limit must be 1–25000.");
    request.url += "/searchAnalytics/query";
    request.method = "POST";
    request.body = { startDate: values.start, endDate: values.end, dimensions, rowLimit: limit };
  }
  if (command === "submit-sitemap" || command === "delete-sitemap") {
    const sitemap = cadenceUrl(values.sitemap);
    if (!sitemap.startsWith("https:")) throw new Error("Sitemap must use HTTPS.");
    request.url += `/sitemaps/${encodeURIComponent(sitemap)}`;
    request.method = command === "submit-sitemap" ? "PUT" : "DELETE";
    request.write = true;
  }
  return request;
}

export async function runRequest(request, { getToken, fetchResponse }) {
  const scope = `https://www.googleapis.com/auth/webmasters${request.write ? "" : ".readonly"}`;
  const token = getToken(scope);
  const response = await fetchResponse(request.url, {
    method: request.method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: request.body ? JSON.stringify(request.body) : undefined,
    signal: AbortSignal.timeout(30000),
    redirect: "error",
  });
  if (!response.ok) throw new Error(`Search Console HTTP ${response.status}. Check property access, OAuth scope, API enablement, and quota.`);
  const body = await response.text();
  return body ? JSON.parse(body) : { ok: true, status: response.status };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const request = buildRequest(process.argv.slice(2));
    if (!request) console.log(usage);
    else {
      const result = await runRequest(request, {
        getToken: (scope) => {
          try {
            return execFileSync("gcloud", ["auth", "print-access-token",
              "--account=info@identityscaffolding.com", `--impersonate-service-account=${serviceAccount}`,
              `--scopes=${scope}`, "--quiet"], { encoding: "utf8", timeout: 30000, stdio: ["ignore", "pipe", "pipe"] }).trim();
          } catch {
            throw new Error("Google token acquisition failed. Check the existing gcloud login and service-account impersonation access.");
          }
        },
        fetchResponse: fetch,
      });
      console.log(JSON.stringify(result, null, 2));
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
