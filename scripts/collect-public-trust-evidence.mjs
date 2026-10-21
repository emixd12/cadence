import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import { Temporal } from "@js-temporal/polyfill";

import { PUBLIC_TRUST_CHECKS, validatePublicTrustEvidence } from "../lib/resolvers/public-trust-evidence.resolver.ts";
import { buildIntegrityManifest } from "./build-public-integrity-manifest.mjs";
import { collectRouteCandidates, collectRoutes, marketingContracts } from "./compare-public-routes.mjs";
import { boundedFetch } from "./public-trust-http.mjs";

const ROOT = new URL("..", import.meta.url);
const GITHUB_ALERT_PAGE_SIZE = 100;
const GITHUB_ALERT_PAGE_LIMIT = 10;

export function aggregateAudit(audit) {
  const counts = audit?.metadata?.vulnerabilities;
  if (!counts || !["info", "low", "moderate", "high", "critical", "total"].every((key) => Number.isInteger(counts[key]) && counts[key] >= 0)) throw new Error("npm audit output omitted aggregate vulnerability counts.");
  return { ...counts };
}

export function aggregateSbom(sbom) {
  const bytes = Buffer.from(`${JSON.stringify(sbom)}\n`);
  return { sha256: createHash("sha256").update(bytes).digest("hex"), components: Array.isArray(sbom.components) ? sbom.components.length : 0 };
}

export function deploymentOwnsOrigin(value, deployment, projectId) {
  const hostname = new URL(deployment.url).hostname;
  const aliases = Array.isArray(value.alias) ? value.alias.map((item) => typeof item === "string" ? item : item?.domain).filter(Boolean) : [];
  return value.projectId === projectId && [value.url, ...aliases].includes(hostname);
}

function runJson(command, args, allowedStatuses = [0]) {
  const result = spawnSync(command, args, { cwd: ROOT, encoding: "utf8", maxBuffer: 32 * 1024 * 1024, env: process.env });
  if (result.error || !allowedStatuses.includes(result.status)) throw new Error(`${command} collector failed.`);
  try { return JSON.parse(result.stdout); } catch { throw new Error(`${command} collector returned invalid JSON.`); }
}

function deadline(completedAt, id) {
  return Temporal.Instant.from(completedAt).add({ hours: PUBLIC_TRUST_CHECKS[id].freshnessHours }).toString();
}

function makeCheck(subject, id, fact, evidenceUrl, completedAt) {
  const status = fact.status;
  const complete = ["passed", "failed", "stale"].includes(status);
  return {
    id,
    status,
    scope: fact.scope,
    scope_limit: PUBLIC_TRUST_CHECKS[id].scopeLimit,
    tool: fact.tool,
    completed_at: complete ? (fact.completed_at ?? completedAt) : null,
    freshness_deadline: complete ? deadline(fact.completed_at ?? completedAt, id) : null,
    summary: fact.summary,
    unavailable_reason: status === "unavailable" ? fact.unavailable_reason : null,
    evidence_url: evidenceUrl,
    source_commit: subject.source_commit,
    application_deployment_id: subject.application_deployment.id,
    marketing_deployment_id: subject.marketing_deployment.id,
  };
}

export function buildSnapshot(input) {
  const path = `trust/${input.workflow_run.id}/${input.application_deployment.id}/${input.marketing_deployment.id}/${input.snapshot_id}.json`;
  const snapshotUrl = new URL(path, input.pages_origin.endsWith("/") ? input.pages_origin : `${input.pages_origin}/`).toString();
  const subject = { source_commit: input.source_commit, application_deployment: input.application_deployment, marketing_deployment: input.marketing_deployment };
  const evidenceUrl = input.details_filename ? new URL(input.details_filename, snapshotUrl).toString() : snapshotUrl;
  const checks = Object.entries(input.facts).map(([id, fact]) => makeCheck(subject, id, fact, evidenceUrl, input.verified_at));
  const deadlines = checks.map((check) => check.freshness_deadline).filter(Boolean).sort();
  const snapshot = {
    schema: "cadence.public-trust-evidence",
    schema_version: 1,
    snapshot_id: input.snapshot_id,
    snapshot_url: snapshotUrl,
    source_commit: input.source_commit,
    application_deployment: input.application_deployment,
    marketing_deployment: input.marketing_deployment,
    workflow_run: input.workflow_run,
    built_at: input.built_at,
    verified_at: input.verified_at,
    freshness_deadline: deadlines[0],
    checks,
  };
  const result = validatePublicTrustEvidence(snapshot);
  if (!result.ok) throw new Error(`Snapshot validation failed: ${result.errors.join(" ")}`);
  return result.value;
}

export async function githubFacts(input, options = {}) {
  if (input.fixture?.github) return input.fixture.github;
  const fetcher = options.fetcher ?? fetch;
  const token = options.token ?? process.env.GITHUB_TOKEN;
  const origin = "https://api.github.com";
  const repositoryUrl = `${origin}/repos/${input.repository}/`;
  const headers = { authorization: `Bearer ${token}`, accept: "application/vnd.github+json" };
  const get = async (path) => {
    try {
      const { response, body } = await boundedFetch(origin, new URL(path, repositoryUrl).toString(), {
        followRedirects: false,
        fetcher: (url, init) => fetcher(url, { ...init, headers: { ...init.headers, ...headers } }),
      });
      if (response.status !== 200) return null;
      return { data: JSON.parse(body.toString("utf8")), link: response.headers.get("link") };
    } catch { return null; }
  };
  const repo = await get("");
  const countAlerts = async (path) => {
    const endpoint = new URL(path, repositoryUrl);
    endpoint.searchParams.set("state", "open");
    endpoint.searchParams.set("per_page", String(GITHUB_ALERT_PAGE_SIZE));
    const paths = new Set([endpoint.pathname]);
    if (Number.isSafeInteger(repo?.data?.id) && repo.data.id > 0) paths.add(`/repositories/${repo.data.id}/${path.split("?", 1)[0]}`);
    const queryKeys = new Set([...endpoint.searchParams.keys(), "page", "before", "after"]);
    const alertNumbers = new Set();
    let url = endpoint;
    for (let page = 0; page < GITHUB_ALERT_PAGE_LIMIT; page += 1) {
      const result = await get(url);
      if (!Array.isArray(result?.data) || result.data.length > GITHUB_ALERT_PAGE_SIZE) return null;
      for (const alert of result.data) {
        if (!Number.isSafeInteger(alert?.number) || alert.number < 1 || alertNumbers.has(alert.number)) return null;
        alertNumbers.add(alert.number);
      }
      const links = result.link ? result.link.split(",").map((link) => /^<([^>]+)>;\s*rel="([^"]+)"$/i.exec(link.trim())) : [];
      if (links.some((link) => link === null)) return null;
      const next = links.filter((link) => link[2].toLowerCase().split(/\s+/).includes("next"));
      if (next.length === 0) return alertNumbers.size;
      if (next.length !== 1) return null;
      try { url = new URL(next[0][1], url); } catch { return null; }
      if (url.origin !== origin || url.username || url.password || url.hash || !paths.has(url.pathname)) return null;
      const keys = [...url.searchParams.keys()];
      if (new Set(keys).size !== keys.length || keys.some((key) => !queryKeys.has(key))) return null;
      if ([...endpoint.searchParams].some(([key, value]) => url.searchParams.get(key) !== value)) return null;
    }
    // A truncated walk cannot be published as an exact open-alert count.
    return null;
  };
  const [code, checks, secrets, dependabot] = await Promise.all([
    countAlerts("code-scanning/alerts"),
    get(`commits/${input.source_commit}/check-runs?per_page=100`),
    countAlerts("secret-scanning/alerts?hide_secret=true"),
    countAlerts("dependabot/alerts"),
  ]);
  const codeqlComplete = codeqlAnalysisComplete(checks?.data?.check_runs);
  return {
    code_scanning: code === null || checks === null ? null : { open: code, analysis_complete: codeqlComplete },
    dependabot: dependabot === null ? null : { open: dependabot },
    secret_scanning: secrets === null || repo === null ? null : { open: secrets, enabled: repo.data?.security_and_analysis?.secret_scanning?.status === "enabled", push_protection: repo.data?.security_and_analysis?.secret_scanning_push_protection?.status === "enabled" },
  };
}

export function codeqlAnalysisComplete(checkRuns) {
  if (!Array.isArray(checkRuns)) return false;
  const analyses = checkRuns.filter(
    (run) => run?.name === "CodeQL" || /^Analyze \([^)]+\)$/.test(run?.name ?? ""),
  );
  return analyses.length > 0 && analyses.every(
    (run) => run.status === "completed" && run.conclusion === "success",
  );
}

function safeCountFact(value, scope, tool) {
  if (!value) return { status: "unavailable", scope, tool, summary: "The provider did not expose a safe aggregate result.", unavailable_reason: "The collector could not read a complete aggregate provider result." };
  const passed = value.open === 0 && value.enabled !== false && value.push_protection !== false;
  return { status: passed ? "passed" : "failed", scope, tool, summary: passed ? "The configured provider check reported zero open results." : "The configured provider check reported an adverse aggregate result.", unavailable_reason: null };
}

export function codeScanningFact(value, scope, tool) {
  if (!value) return { status: "unavailable", scope, tool, summary: "The provider did not expose a safe aggregate result.", unavailable_reason: "The collector could not read complete aggregate alert and commit analysis results." };
  if (!value.analysis_complete) return { status: "not_run", scope, tool, summary: "CodeQL has not completed successfully for the named source commit.", unavailable_reason: null };
  return { status: value.open === 0 ? "passed" : "failed", scope, tool, summary: value.open === 0 ? "CodeQL completed for the named commit and reported zero open repository alerts." : "CodeQL completed for the named commit and the repository has an adverse aggregate result.", unavailable_reason: null };
}

export async function readHostedMigrationBoundary({ accessToken, projectRef, fetchImpl = fetch }) {
  if (!accessToken || !/^[a-z0-9]{20}$/.test(projectRef ?? "")) return null;
  const response = await fetchImpl(`https://api.supabase.com/v1/projects/${projectRef}/database/migrations`, {
    headers: { authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) return null;
  const rows = await response.json();
  if (!Array.isArray(rows)) return null;
  return rows.map((row) => row?.version).filter((version) => typeof version === "string" && /^20\d{12}$/.test(version)).sort().at(-1) ?? null;
}

async function liveFacts(input) {
  const fixture = input.fixture;
  const [owner, repositoryName] = input.repository.split("/");
  const pages = new URL(input.pages_origin);
  if (pages.protocol !== "https:" || pages.hostname !== `${owner}.github.io` || pages.pathname.replace(/\/$/, "") !== `/${repositoryName}`) throw new Error("Pages origin does not match the named public repository.");
  let inspectedProvenance;
  if (!fixture) {
    const headers = { authorization: `Bearer ${process.env.VERCEL_TOKEN}` };
    const inspect = async (deployment, projectId) => {
      const query = process.env.VERCEL_TEAM_ID ? `?teamId=${encodeURIComponent(process.env.VERCEL_TEAM_ID)}` : "";
      const response = await fetch(`https://api.vercel.com/v13/deployments/${encodeURIComponent(deployment.id)}${query}`, { headers, signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error("Vercel could not verify an allowlisted deployment origin.");
      const value = await response.json();
      if (!deploymentOwnsOrigin(value, deployment, projectId)) throw new Error("A collection origin does not belong to the named Cadence Vercel project and deployment.");
      return { ready: value.readyState === "READY", commit: value.meta?.githubCommitSha ?? value.gitSource?.sha ?? null };
    };
    const [application, marketing] = await Promise.all([
      inspect(input.application_deployment, process.env.VERCEL_APPLICATION_PROJECT_ID),
      inspect(input.marketing_deployment, process.env.VERCEL_MARKETING_PROJECT_ID),
    ]);
    inspectedProvenance = { passed: application.ready && marketing.ready && application.commit === input.source_commit && marketing.commit === input.source_commit };
  }
  const audit = fixture?.audit ?? runJson("npm", ["audit", "--omit=dev", "--json"], [0, 1]);
  const sbom = fixture?.sbom ?? runJson("npm", ["sbom", "--omit=dev", "--sbom-format=cyclonedx", "--package-lock-only"]);
  const auditCounts = aggregateAudit(audit);
  const sbomSummary = aggregateSbom(sbom);
  const github = await githubFacts(input);
  const appConfig = JSON.parse(await readFile(new URL("config/public-app-routes.json", ROOT), "utf8"));
  const marketingCandidates = JSON.parse(await readFile(new URL("config/public-marketing-route-candidates.json", ROOT), "utf8"));
  const integrityConfig = JSON.parse(await readFile(new URL("config/public-integrity-assets.json", ROOT), "utf8"));
  let routes = fixture?.routes;
  if (!routes) {
    const manifestResponse = fixture?.marketing_manifest ? null : await boundedFetch(input.marketing_deployment.url, "/data/route-manifest.json", { vercelShare: input.preview_bypass?.marketing });
    const marketingManifest = fixture?.marketing_manifest ?? JSON.parse(manifestResponse.body.toString("utf8"));
    routes = {
      application: await collectRoutes({ origin: input.application_deployment.url, routes: appConfig.routes, vercelShare: input.preview_bypass?.application }),
      marketing: await collectRoutes({ origin: input.marketing_deployment.url, routes: [...marketingContracts(marketingManifest), ...marketingCandidates.routes], vercelShare: input.preview_bypass?.marketing }),
    };
  }
  if (!fixture?.routes) {
    routes.application.failures.push(...await collectRouteCandidates({ origin: input.application_deployment.url, candidates: appConfig.candidates, vercelShare: input.preview_bypass?.application }));
    routes.marketing.failures.push(...await collectRouteCandidates({ origin: input.marketing_deployment.url, candidates: marketingCandidates.candidates, vercelShare: input.preview_bypass?.marketing }));
    routes.application.status = routes.application.failures.length ? "failed" : "passed";
    routes.marketing.status = routes.marketing.failures.length ? "failed" : "passed";
  }
  const integrity = fixture?.integrity ?? await buildIntegrityManifest({ assets: integrityConfig.assets, maxAssets: integrityConfig.max_assets, origins: { application: input.application_deployment.url, marketing: input.marketing_deployment.url }, bypasses: input.preview_bypass, fetchedAt: input.verified_at });
  const provenance = fixture?.provenance ?? inspectedProvenance;
  let migration = fixture?.migration ?? input.migration;
  if (!migration && process.env.SUPABASE_ACCESS_TOKEN && process.env.SUPABASE_PROJECT_REF) {
    const remote = await readHostedMigrationBoundary({ accessToken: process.env.SUPABASE_ACCESS_TOKEN, projectRef: process.env.SUPABASE_PROJECT_REF });
    const files = await (await import("node:fs/promises")).readdir(new URL("supabase/migrations/", ROOT));
    const boundary = files.map((name) => /^([0-9]{14})_/.exec(name)?.[1]).filter(Boolean).sort().at(-1);
    if (remote) migration = { matched: remote === boundary, boundary, tool_version: "v1 migration inventory" };
  }
  let rls = fixture?.rls ?? input.rls;
  if (!rls && process.env.RUN_RLS === "true") {
    const result = spawnSync("npm", ["run", "--silent", "smoke:rls"], { cwd: ROOT, encoding: "utf8", maxBuffer: 2 * 1024 * 1024, env: process.env });
    const assertions = /Verified (\d+) ownership checks\./.exec(result.stdout)?.[1];
    rls = { passed: result.status === 0 && /Cleaned up temporary users\./.test(result.stdout), assertions: Number(assertions ?? 0) };
  }
  if (!rls && input.prior_snapshot_url) {
    try {
      const priorResponse = await boundedFetch(input.pages_origin, input.prior_snapshot_url);
      const prior = JSON.parse(priorResponse.body.toString("utf8"));
      const validation = validatePublicTrustEvidence(prior);
      const same = validation.ok && prior.source_commit === input.source_commit && prior.application_deployment.id === input.application_deployment.id && prior.marketing_deployment.id === input.marketing_deployment.id;
      const previous = same && prior.checks.find((check) => check.id === "cross_account_rls_isolation");
      if (previous?.completed_at && ["passed", "stale"].includes(previous.status)) {
        rls = { passed: true, assertions: Number(/(\d+) ownership checks/.exec(previous.summary)?.[1] ?? 0), completed_at: previous.completed_at, stale: Temporal.Instant.compare(Temporal.Instant.from(input.verified_at), Temporal.Instant.from(previous.freshness_deadline)) > 0 };
      }
    } catch { /* A missing prior snapshot leaves the check Not run. */ }
  }
  const tool = (name, version = "1") => ({ name, version });
  const facts = {
    source_to_deployment_provenance: { status: provenance?.passed ? "passed" : "failed", scope: "Both named Ready Vercel deployments and their public Git commit metadata.", tool: tool("Vercel REST API"), summary: provenance?.passed ? "Both Ready deployments name the expected source commit." : "The named deployments are not both Ready from the expected source commit." },
    production_dependency_vulnerabilities: { status: auditCounts.total === 0 && github.dependabot?.open === 0 ? "passed" : github.dependabot ? "failed" : "unavailable", scope: "Production dependencies declared by the lockfile, npm advisory data, and Dependabot status.", tool: tool("npm audit", process.env.npm_config_user_agent?.split("/")[1]?.split(" ")[0] ?? "unknown"), summary: `SBOM has ${sbomSummary.components} components with SHA-256 ${sbomSummary.sha256}; audit totals: ${auditCounts.total} (${auditCounts.critical} critical, ${auditCounts.high} high, ${auditCounts.moderate} moderate, ${auditCounts.low} low); Dependabot ${github.dependabot ? `open aggregate ${github.dependabot.open}` : "aggregate unavailable"}.`, unavailable_reason: github.dependabot ? null : "The collector could not read a complete Dependabot aggregate result." },
    code_scanning: codeScanningFact(github.code_scanning, "Configured GitHub code-scanning analyzers for the named public repository and source commit.", tool("GitHub CodeQL")),
    secret_scanning: safeCountFact(github.secret_scanning, "GitHub secret scanning and push protection for the named public repository.", tool("GitHub secret scanning")),
    public_artifact_integrity: { status: integrity.status, scope: `${integrity.entries.length} allowlisted public application and marketing assets.`, tool: tool("SHA-256"), summary: `${integrity.entries.filter((entry) => entry.ok).length} of ${integrity.entries.length} public assets matched status, type, size, and digest bounds.` },
    application_live_route_comparison: { status: routes.application.status, scope: `${routes.application.checked} explicit unauthenticated application route contracts.`, tool: tool("Cadence route comparator"), summary: `${routes.application.checked - routes.application.failures.length} of ${routes.application.checked} application routes matched the registry.` },
    marketing_live_route_comparison: { status: routes.marketing.status, scope: `${routes.marketing.checked} generated marketing HTML and Markdown route contracts.`, tool: tool("Cadence route comparator"), summary: `${routes.marketing.checked - routes.marketing.failures.length} of ${routes.marketing.checked} marketing routes matched the generated manifest.` },
    hosted_migration_boundary: migration ? { status: migration.matched ? "passed" : "failed", scope: "Hosted Supabase migration history compared with the tracked migration boundary.", tool: tool("Supabase Management API", migration.tool_version ?? "unknown"), summary: migration.matched ? `Hosted migration boundary matches ${migration.boundary}.` : "Hosted migration boundary does not match the tracked source boundary." } : { status: "unavailable", scope: "Hosted Supabase migration history compared with the tracked migration boundary.", tool: tool("Supabase Management API"), summary: "The hosted migration boundary was unavailable.", unavailable_reason: "The collector did not receive a sanitized hosted migration boundary." },
    cross_account_rls_isolation: rls ? { status: rls.stale ? "stale" : rls.passed ? "passed" : "failed", completed_at: rls.completed_at, scope: "Disposable-account ordinary-client ownership checks across the public data API.", tool: tool("Cadence RLS smoke"), summary: rls.passed ? `${rls.assertions} ownership checks passed and all temporary users were cleaned up.` : "The RLS smoke failed or could not verify cleanup." } : { status: "not_run", scope: "Disposable-account ordinary-client ownership checks across the public data API.", tool: tool("Cadence RLS smoke"), summary: "The authorized cross-account RLS smoke did not run in this collection.", unavailable_reason: null },
  };
  input.details = {
    schema: "cadence.public-trust-details",
    schema_version: 1,
    source_commit: input.source_commit,
    application_deployment_id: input.application_deployment.id,
    marketing_deployment_id: input.marketing_deployment.id,
    verified_at: input.verified_at,
    dependency: { sbom_sha256: sbomSummary.sha256, component_count: sbomSummary.components, audit_counts: auditCounts, dependabot_open_count: github.dependabot?.open ?? null },
    repository_security: { code_scanning_open_count: github.code_scanning?.open ?? null, secret_scanning_open_count: github.secret_scanning?.open ?? null, secret_scanning_enabled: github.secret_scanning?.enabled ?? null, push_protection_enabled: github.secret_scanning?.push_protection ?? null },
    integrity: integrity.entries,
    routes: { application: routes.application, marketing: routes.marketing },
    hosted_migration_boundary: migration?.boundary ?? null,
    rls_assertion_count: rls?.assertions ?? null,
  };
  return facts;
}

async function main() {
  const fixtureIndex = process.argv.indexOf("--fixture");
  const outputIndex = process.argv.indexOf("--output");
  const input = fixtureIndex >= 0 ? JSON.parse(await readFile(process.argv[fixtureIndex + 1], "utf8")) : JSON.parse(process.env.PUBLIC_TRUST_INPUT ?? "null");
  if (!input || outputIndex < 0) throw new Error("Collector requires input and --output.");
  input.facts = await liveFacts(input);
  input.details_filename = `${input.snapshot_id}.details.json`;
  const snapshot = buildSnapshot(input);
  await writeFile(process.argv[outputIndex + 1], `${JSON.stringify(snapshot, null, 2)}\n`);
  const detailsIndex = process.argv.indexOf("--details-output");
  if (detailsIndex >= 0) await writeFile(process.argv[detailsIndex + 1], `${JSON.stringify(input.details, null, 2)}\n`);
  if (snapshot.checks.some((check) => check.status === "failed")) process.exitCode = 2;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
