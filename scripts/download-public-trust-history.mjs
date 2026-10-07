import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { validatePublicTrustEvidence } from "../lib/resolvers/public-trust-evidence.resolver.ts";
import { boundedFetch } from "./public-trust-http.mjs";
import { validatePublicTrustDetails } from "./publish-public-trust-evidence.mjs";

export async function downloadPublicTrustHistory({ origin, outputDirectory, fetcher = fetch, allowEmpty = false }) {
  const base = origin.endsWith("/") ? origin : `${origin}/`;
  const roots = [new URL("trust/", base)];
  if (base === "https://emixd12.github.io/cadence/") roots.push(new URL("https://emixd12.github.io/habit-tracking-app/trust/"));
  function historyPath(value) {
    const url = new URL(value);
    if (typeof value !== "string" || url.href !== value || url.search || url.hash || url.username || url.password
      || !roots.some((root) => url.origin === root.origin && url.pathname.startsWith(root.pathname))
      || !/^\/[A-Za-z0-9._/-]+$/.test(url.pathname)) {
      throw new Error("Existing snapshot index escaped the Pages origin.");
    }
    return url.pathname.slice(url.pathname.indexOf("/trust/") + 1);
  }
  const index = await boundedFetch(origin, new URL("trust/snapshots.json", base).toString(), { fetcher });
  if (index.response.status === 404) {
    if (!allowEmpty) throw new Error("Public Trust history is missing; empty initialization was not authorized.");
    await mkdir(outputDirectory, { recursive: true });
    return 0;
  }
  if (index.response.status !== 200) throw new Error("Unable to read the existing public snapshot index.");
  const urls = JSON.parse(index.body.toString("utf8"));
  if (!Array.isArray(urls) || urls.length > 1_000) throw new Error("Existing snapshot index exceeds the retention bound.");
  const paths = urls.map(historyPath);
  if (new Set(paths).size !== paths.length) throw new Error("Existing snapshot index contains duplicate archive paths.");
  for (const value of urls) {
    const result = await boundedFetch(origin, value, { fetcher, followRedirects: false });
    if (result.response.status !== 200) throw new Error("Existing immutable Trust snapshot is missing.");
    const snapshot = JSON.parse(result.body.toString("utf8"));
    const validation = validatePublicTrustEvidence(snapshot);
    if (!validation.ok || snapshot.snapshot_url !== value) throw new Error("Existing snapshot failed immutable validation.");
    const target = path.join(outputDirectory, historyPath(value));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, result.body, { flag: "wx" });
    for (const detailsUrl of new Set(snapshot.checks.map((check) => check.evidence_url))) {
      if (detailsUrl === snapshot.snapshot_url) continue;
      const detailsTarget = path.join(outputDirectory, historyPath(detailsUrl));
      const detailsResult = await boundedFetch(origin, detailsUrl, { fetcher, followRedirects: false });
      if (detailsResult.response.status !== 200) throw new Error("Existing immutable Trust details are missing.");
      const details = JSON.parse(detailsResult.body.toString("utf8"));
      validatePublicTrustDetails(details, snapshot);
      await mkdir(path.dirname(detailsTarget), { recursive: true });
      await writeFile(detailsTarget, detailsResult.body, { flag: "wx" });
    }
  }
  await mkdir(path.join(outputDirectory, "trust"), { recursive: true });
  await writeFile(path.join(outputDirectory, "trust", "snapshots.json"), `${JSON.stringify(urls, null, 2)}\n`);
  return urls.length;
}

async function main() {
  const value = (name) => process.argv[process.argv.indexOf(name) + 1];
  await downloadPublicTrustHistory({ origin: value("--origin"), outputDirectory: value("--output"), allowEmpty: process.argv.includes("--allow-empty") });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
