import { writeFile } from "node:fs/promises";

async function latestDeployment(projectId) {
  const team = process.env.VERCEL_TEAM_ID ? `&teamId=${encodeURIComponent(process.env.VERCEL_TEAM_ID)}` : "";
  const response = await fetch(`https://api.vercel.com/v6/deployments?projectId=${encodeURIComponent(projectId)}&target=production&state=READY&limit=1${team}`, { headers: { authorization: `Bearer ${process.env.VERCEL_TOKEN}` }, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error("Unable to resolve a named Ready Vercel deployment.");
  const deployment = (await response.json()).deployments?.[0];
  if (!deployment?.uid || !deployment?.url) throw new Error("Vercel returned no Ready production deployment.");
  return { id: deployment.uid, url: `https://${deployment.url}` };
}

async function temporaryPreviewBypass(deploymentId, operation) {
  const team = process.env.VERCEL_TEAM_ID ? `?teamId=${encodeURIComponent(process.env.VERCEL_TEAM_ID)}` : "";
  const response = await fetch(`https://api.vercel.com/aliases/${encodeURIComponent(deploymentId)}/protection-bypass${team}`, {
    method: "PATCH",
    headers: { authorization: `Bearer ${process.env.VERCEL_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({ ttl: 3600 }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Unable to create a temporary Preview access boundary for ${operation} (HTTP ${response.status}).`);
  const values = Object.keys((await response.json()).protectionBypass ?? {});
  if (values.length !== 1) throw new Error("Vercel did not return one temporary Preview access boundary.");
  return values[0];
}

async function verifyDeploymentOwner(deployment, projectId) {
  const team = process.env.VERCEL_TEAM_ID ? `?teamId=${encodeURIComponent(process.env.VERCEL_TEAM_ID)}` : "";
  const response = await fetch(`https://api.vercel.com/v13/deployments/${encodeURIComponent(deployment.id)}${team}`, {
    headers: { authorization: `Bearer ${process.env.VERCEL_TOKEN}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error("Unable to verify a named Vercel deployment.");
  const value = await response.json();
  if (value.projectId !== projectId || new URL(deployment.url).hostname !== value.url) {
    throw new Error("A named Vercel deployment does not belong to the expected Cadence project.");
  }
}

async function main() {
  const value = (name) => process.argv[process.argv.indexOf(name) + 1];
  const sourceCommit = process.env.TRUST_SOURCE_COMMIT || process.env.GITHUB_SHA;
  const application = process.env.TRUST_APPLICATION_DEPLOYMENT_ID
    ? { id: process.env.TRUST_APPLICATION_DEPLOYMENT_ID, url: process.env.TRUST_APPLICATION_DEPLOYMENT_URL }
    : await latestDeployment(process.env.VERCEL_APPLICATION_PROJECT_ID);
  const marketing = process.env.TRUST_MARKETING_DEPLOYMENT_ID
    ? { id: process.env.TRUST_MARKETING_DEPLOYMENT_ID, url: process.env.TRUST_MARKETING_DEPLOYMENT_URL }
    : await latestDeployment(process.env.VERCEL_MARKETING_PROJECT_ID);
  if (process.env.TRUST_TARGET !== "preview") {
    application.url = process.env.APPLICATION_PRODUCTION_ORIGIN;
    marketing.url = process.env.MARKETING_PRODUCTION_ORIGIN;
  }
  const verifiedAt = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const compact = verifiedAt.replace(/[-:]/g, "").replace(".000", "");
  const pagesOrigin = process.env.TRUST_PAGES_ORIGIN;
  const [owner, repositoryName] = process.env.GITHUB_REPOSITORY.split("/");
  const pagesUrl = new URL(pagesOrigin);
  if (pagesUrl.protocol !== "https:" || pagesUrl.hostname !== `${owner}.github.io` || pagesUrl.pathname.replace(/\/$/, "") !== `/${repositoryName}`) throw new Error("TRUST_PAGES_ORIGIN must identify this repository's GitHub Pages root.");
  const input = {
    repository: process.env.GITHUB_REPOSITORY,
    pages_origin: pagesOrigin,
    prior_snapshot_url: new URL("trust/latest.json", pagesOrigin.endsWith("/") ? pagesOrigin : `${pagesOrigin}/`).toString(),
    source_commit: sourceCommit,
    snapshot_id: `${compact}-${sourceCommit.slice(0, 12)}`,
    built_at: verifiedAt,
    verified_at: verifiedAt,
    application_deployment: application,
    marketing_deployment: marketing,
    workflow_run: { id: process.env.GITHUB_RUN_ID, url: `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` }
  };
  if (process.env.TRUST_TARGET === "preview") {
    await verifyDeploymentOwner(application, process.env.VERCEL_APPLICATION_PROJECT_ID);
    await verifyDeploymentOwner(marketing, process.env.VERCEL_MARKETING_PROJECT_ID);
    input.preview_bypass = {
      application: await temporaryPreviewBypass(application.id, "application"),
      marketing: await temporaryPreviewBypass(marketing.id, "marketing"),
    };
  }
  await writeFile(value("--output"), `${JSON.stringify(input)}\n`, { mode: 0o600 });
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
