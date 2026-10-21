import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { validatePublicTrustEvidence } from "../lib/resolvers/public-trust-evidence.resolver.ts";
import { isPrivateHostname } from "./public-trust-http.mjs";
import developerReference from "../apps/marketing/src/data/developer-reference.json" with { type: "json" };

const publicToolPaths = new Set(developerReference.tools.flatMap(({ slug }) => [`/developers/${slug}`, `/developers/${slug}.md`]));

export function validatePublicTrustDetails(details, subject) {
  const json = JSON.stringify(details);
  if (!details || details.schema !== "cadence.public-trust-details" || details.source_commit !== subject.source_commit || details.application_deployment_id !== subject.application_deployment.id || details.marketing_deployment_id !== subject.marketing_deployment.id) throw new Error("Publication refused invalid Trust details.");
  // Catalog paths name public documentation, not payloads; screen every other byte unchanged.
  const screened = structuredClone(details);
  const marketing = screened.routes?.marketing;
  if (Array.isArray(marketing?.observed)) {
    for (const route of marketing.observed) {
      if (route && publicToolPaths.has(route.path)) route.path = "/public-tool-reference";
    }
  }
  if (Array.isArray(marketing?.failures)) {
    marketing.failures = marketing.failures.map((failure) => {
      if (typeof failure !== "string") return failure;
      const separator = failure.indexOf(": ");
      return separator >= 0 && publicToolPaths.has(failure.slice(0, separator)) ? `/public-tool-reference${failure.slice(separator)}` : failure;
    });
  }
  if (/(?:secret(?!_scanning)|token|password|authorization|cookie|headers?|scanner_(?:match|finding)|user_(?:email|id)|behavior_content|occurrence_content|notes?|provider_payload|private_|bearer\s+|@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/i.test(JSON.stringify(screened))) throw new Error("Publication refused prohibited Trust detail content.");
  for (const match of json.matchAll(/https:\/\/[^"\\\s]+/g)) {
    if (isPrivateHostname(new URL(match[0]).hostname)) throw new Error("Publication refused a private Trust detail hostname.");
  }
}

export async function stagePublicTrustSite({ snapshot, details, outputDirectory, previousDirectory }) {
  const result = validatePublicTrustEvidence(snapshot);
  if (!result.ok) throw new Error(`Publication refused invalid evidence: ${result.errors.join(" ")}`);
  validatePublicTrustDetails(details, snapshot);
  if (previousDirectory) await cp(previousDirectory, outputDirectory, { recursive: true });
  const url = new URL(snapshot.snapshot_url);
  const marker = "/trust/";
  const index = url.pathname.indexOf(marker);
  if (index < 0) throw new Error("Snapshot URL does not contain the Trust evidence root.");
  const relative = url.pathname.slice(index + 1);
  const target = path.join(outputDirectory, relative);
  await mkdir(path.dirname(target), { recursive: true });
  try { await readFile(target); throw new Error("Immutable snapshot already exists."); } catch (error) { if (error.code !== "ENOENT") throw error; }
  const json = `${JSON.stringify(snapshot, null, 2)}\n`;
  await writeFile(target, json, { flag: "wx" });
  const detailsName = path.basename(new URL(snapshot.checks[0].evidence_url).pathname);
  await writeFile(path.join(path.dirname(target), detailsName), `${JSON.stringify(details, null, 2)}\n`, { flag: "wx" });
  await mkdir(path.join(outputDirectory, "trust"), { recursive: true });
  await writeFile(path.join(outputDirectory, "trust", "latest.json"), json);
  const indexPath = path.join(outputDirectory, "trust", "snapshots.json");
  let snapshots = [];
  try { snapshots = JSON.parse(await readFile(indexPath, "utf8")); } catch (error) { if (error.code !== "ENOENT") throw error; }
  snapshots.push(snapshot.snapshot_url);
  await writeFile(indexPath, `${JSON.stringify([...new Set(snapshots)].sort(), null, 2)}\n`);
}

async function main() {
  const value = (name) => process.argv[process.argv.indexOf(name) + 1];
  const snapshot = JSON.parse(await readFile(value("--snapshot"), "utf8"));
  const details = JSON.parse(await readFile(value("--details"), "utf8"));
  await stagePublicTrustSite({ snapshot, details, outputDirectory: value("--output"), previousDirectory: process.argv.includes("--previous") ? value("--previous") : undefined });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
