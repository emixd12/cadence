import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// @ts-expect-error Operational JavaScript module intentionally has no declarations.
import { aggregateAudit, aggregateSbom, buildSnapshot, codeqlAnalysisComplete, codeScanningFact, deploymentOwnsOrigin, readHostedMigrationBoundary } from "../scripts/collect-public-trust-evidence.mjs";

// @ts-expect-error Operational JavaScript module intentionally has no declarations.
import { isRepositoryPagesOrigin } from "../scripts/public-trust-http.mjs";

const input = JSON.parse(readFileSync("tests/fixtures/public-trust-collector/input.json", "utf8"));

describe("GitHub Pages origin of a repository", () => {
  it.each([
    ["https://emixd12.github.io/cadence/", "emixd12/cadence"],
    ["https://emixd12.github.io/cadence", "emixd12/cadence"],
    ["https://example-org.github.io/cadence/", "Example-Org/cadence"],
    ["https://Example-Org.github.io/cadence/", "Example-Org/cadence"],
  ])("accepts %s for %s", (origin, repository) => {
    expect(isRepositoryPagesOrigin(origin, repository)).toBe(true);
  });

  it.each([
    ["http://example-org.github.io/cadence/", "Example-Org/cadence"],
    ["https://other-org.github.io/cadence/", "Example-Org/cadence"],
    ["https://example-org.github.io.attacker.example/cadence/", "Example-Org/cadence"],
    ["https://example-org.github.io/other/", "Example-Org/cadence"],
    ["https://example-org.github.io/Cadence/", "Example-Org/cadence"],
    ["https://example-org.github.io/cadence/trust/", "Example-Org/cadence"],
    ["https://example-org.github.io:8443/cadence/", "Example-Org/cadence"],
    ["https://user@example-org.github.io/cadence/", "Example-Org/cadence"],
    ["https://example-org.github.io/cadence/", "Example-Org"],
    ["https://example-org.github.io/cadence/", "Example-Org/cadence/extra"],
    ["not a url", "Example-Org/cadence"],
    ["https://example-org.github.io/cadence/", undefined],
  ])("refuses %s for %s", (origin, repository) => {
    expect(isRepositoryPagesOrigin(origin, repository)).toBe(false);
  });
});

describe("public Trust collector", () => {
  it("builds one valid deterministic snapshot with immutable Pages evidence paths", () => {
    const facts = Object.fromEntries([
      "source_to_deployment_provenance", "production_dependency_vulnerabilities", "code_scanning", "secret_scanning", "public_artifact_integrity", "application_live_route_comparison", "marketing_live_route_comparison", "hosted_migration_boundary", "cross_account_rls_isolation",
    ].map((id) => [id, { status: "passed", scope: "A bounded deterministic fixture check.", tool: { name: "fixture", version: "1" }, summary: "The deterministic fixture check passed." }]));
    const snapshot = buildSnapshot({ ...input, facts });
    expect(snapshot.checks).toHaveLength(9);
    expect(snapshot.snapshot_url).toContain("/123456789/dpl_application/dpl_marketing/");
  });

  it("publishes only aggregate audit counts and a stable SBOM digest", () => {
    expect(aggregateAudit(input.fixture.audit).total).toBe(0);
    expect(aggregateSbom(input.fixture.sbom).sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("reads only the hosted migration boundary through the Management API migration inventory", async () => {
    let request: { url?: string; method?: string } = {};
    const boundary = await readHostedMigrationBoundary({
      accessToken: "secret",
      projectRef: "abcdefghijklmnopqrst",
      fetchImpl: async (url: string, init: RequestInit) => {
        request = { url, method: init.method };
        return new Response(JSON.stringify([{ version: "20260824080815" }, { version: "20260825080815" }]), { status: 200 });
      },
    });
    expect(boundary).toBe("20260825080815");
    expect(request.url).toContain("/database/migrations");
    expect(request.method).toBeUndefined();
  });

  it("rejects invalid project references and migration responses", async () => {
    const neverFetch = async () => { throw new Error("must not fetch"); };
    expect(await readHostedMigrationBoundary({ accessToken: "secret", projectRef: "invalid", fetchImpl: neverFetch })).toBeNull();
    expect(await readHostedMigrationBoundary({
      accessToken: "secret",
      projectRef: "abcdefghijklmnopqrst",
      fetchImpl: async () => new Response(JSON.stringify([{ version: "not-a-boundary" }]), { status: 201 }),
    })).toBeNull();
  });

  it("does not pass CodeQL before the named commit analysis succeeds", () => {
    const tool = { name: "GitHub CodeQL", version: "1" };
    expect(codeScanningFact({ open: 0, analysis_complete: false }, "scope", tool).status).toBe("not_run");
    expect(codeScanningFact({ open: 0, analysis_complete: true }, "scope", tool).status).toBe("passed");
  });

  it("recognizes only a complete successful CodeQL analyzer set", () => {
    expect(codeqlAnalysisComplete([
      { name: "Analyze (actions)", status: "completed", conclusion: "success" },
      { name: "Analyze (javascript-typescript)", status: "completed", conclusion: "success" },
      { name: "Analyze (python)", status: "completed", conclusion: "success" },
    ])).toBe(true);
    expect(codeqlAnalysisComplete([
      { name: "Analyze (actions)", status: "completed", conclusion: "success" },
      { name: "Analyze (python)", status: "in_progress", conclusion: null },
    ])).toBe(false);
    expect(codeqlAnalysisComplete([
      { name: "verify", status: "completed", conclusion: "success" },
    ])).toBe(false);
  });

  it("binds a public Production alias to the exact named Vercel deployment", () => {
    const deployment = { url: "https://app.example" };
    expect(deploymentOwnsOrigin({ projectId: "prj_app", url: "immutable.example", alias: ["app.example"] }, deployment, "prj_app")).toBe(true);
    expect(deploymentOwnsOrigin({ projectId: "prj_other", url: "immutable.example", alias: ["app.example"] }, deployment, "prj_app")).toBe(false);
  });
});
