import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

// @ts-expect-error Operational JavaScript module intentionally has no declarations.
import { aggregateAudit, aggregateSbom, buildSnapshot, codeqlAnalysisComplete, codeScanningFact, deploymentOwnsOrigin, provenanceSummary, readHostedMigrationBoundary, readIgnorePaths, verifySurfaceProvenance } from "../scripts/collect-public-trust-evidence.mjs";

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

const APP_PATHS: string[] = readIgnorePaths("scripts/vercel-ignore-app.sh");
const MARKETING_PATHS: string[] = readIgnorePaths("scripts/vercel-ignore-marketing.sh");

describe("Vercel ignore path lists", () => {
  it("reads the application dependency paths from its ignore script", () => {
    expect(APP_PATHS).toEqual(expect.arrayContaining(["app", "components", "lib", "packages", "public", "package-lock.json", "vercel.json"]));
    expect(APP_PATHS).not.toContain("apps/marketing");
    expect(APP_PATHS.every((path) => path.length > 0 && !path.includes("#") && !path.includes(" "))).toBe(true);
  });

  it("reads the marketing dependency paths without the comment lines", () => {
    expect(MARKETING_PATHS).toEqual(expect.arrayContaining(["apps/marketing", "packages/ui/tokens.css", "package-lock.json", "lib/resolvers/export.resolver.ts"]));
    expect(MARKETING_PATHS).not.toContain("app");
    expect(MARKETING_PATHS.every((path) => path.length > 0 && !path.includes("#") && !path.includes(" "))).toBe(true);
  });

  it("fails closed on a script without a PATHS list or with an empty one", () => {
    const root = mkdtempSync(join(tmpdir(), "cadence-ignore-paths-"));
    try {
      writeFileSync(join(root, "none.sh"), "#!/usr/bin/env bash\nexit 0\n");
      writeFileSync(join(root, "empty.sh"), "PATHS=(\n  # nothing\n)\n");
      const rootUrl = new URL(`file://${root}/`);
      expect(() => readIgnorePaths("none.sh", rootUrl)).toThrow();
      expect(() => readIgnorePaths("empty.sh", rootUrl)).toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("per-surface deployment provenance", () => {
  const repos: string[] = [];
  // Hook and worktree variables such as GIT_DIR would point git at this checkout.
  const env: NodeJS.ProcessEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_"))) as NodeJS.ProcessEnv;

  function git(cwd: string, ...args: string[]): string {
    const result = spawnSync("git", args, { cwd, encoding: "utf8", env: { ...env, GIT_CONFIG_NOSYSTEM: "1", HOME: cwd } });
    if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
    return result.stdout.trim();
  }

  function commitFile(cwd: string, file: string, content: string): string {
    mkdirSync(dirname(join(cwd, file)), { recursive: true });
    writeFileSync(join(cwd, file), content);
    git(cwd, "add", "--all");
    git(cwd, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", "commit", "--quiet", "--no-verify", "-m", file);
    return git(cwd, "rev-parse", "HEAD");
  }

  function makeRepo() {
    const cwd = mkdtempSync(join(tmpdir(), "cadence-provenance-"));
    repos.push(cwd);
    git(cwd, "init", "--quiet", "--initial-branch=main");
    git(cwd, "config", "core.hooksPath", "/dev/null");
    const base = commitFile(cwd, "app/page.tsx", "export default 1;\n");
    commitFile(cwd, "packages/ui/tokens.css", ":root {}\n");
    commitFile(cwd, "apps/marketing/src/index.astro", "<p>one</p>\n");
    return { cwd, base: git(cwd, "rev-parse", "HEAD"), root: base };
  }

  afterEach(() => {
    for (const cwd of repos.splice(0)) rmSync(cwd, { recursive: true, force: true });
  });

  it("passes an exact commit match", () => {
    const { cwd, base } = makeRepo();
    expect(verifySurfaceProvenance({ ready: true, commit: base, sourceCommit: base, paths: APP_PATHS, cwd })).toEqual({ passed: true, exactMatch: true });
  });

  it("passes an ancestor when only files outside the surface changed", () => {
    const { cwd, base } = makeRepo();
    commitFile(cwd, "docs/notes.md", "docs only\n");
    const appOnly = commitFile(cwd, "app/other.tsx", "export const x = 2;\n");
    const docsOnly = git(cwd, "rev-parse", "HEAD~1");
    expect(verifySurfaceProvenance({ ready: true, commit: base, sourceCommit: docsOnly, paths: APP_PATHS, cwd })).toEqual({ passed: true, exactMatch: false });
    expect(verifySurfaceProvenance({ ready: true, commit: base, sourceCommit: appOnly, paths: MARKETING_PATHS, cwd })).toEqual({ passed: true, exactMatch: false });
  });

  it("fails an ancestor when a surface dependency changed", () => {
    const { cwd, base } = makeRepo();
    const appChange = commitFile(cwd, "app/page.tsx", "export default 2;\n");
    expect(verifySurfaceProvenance({ ready: true, commit: base, sourceCommit: appChange, paths: APP_PATHS, cwd })).toEqual({ passed: false, exactMatch: false });
    const tokensChange = commitFile(cwd, "packages/ui/tokens.css", ":root { --x: 1; }\n");
    expect(verifySurfaceProvenance({ ready: true, commit: appChange, sourceCommit: tokensChange, paths: MARKETING_PATHS, cwd })).toEqual({ passed: false, exactMatch: false });
  });

  it("fails a diverged commit and a commit newer than the source", () => {
    const { cwd, base } = makeRepo();
    git(cwd, "switch", "--quiet", "-c", "side");
    const side = commitFile(cwd, "docs/side.md", "side\n");
    git(cwd, "switch", "--quiet", "main");
    const mainDocs = commitFile(cwd, "docs/main.md", "main\n");
    expect(verifySurfaceProvenance({ ready: true, commit: side, sourceCommit: mainDocs, paths: APP_PATHS, cwd })).toEqual({ passed: false, exactMatch: false });
    expect(verifySurfaceProvenance({ ready: true, commit: mainDocs, sourceCommit: base, paths: APP_PATHS, cwd })).toEqual({ passed: false, exactMatch: false });
  });

  it("fails a commit the repository does not contain", () => {
    const { cwd, base } = makeRepo();
    expect(verifySurfaceProvenance({ ready: true, commit: "a".repeat(40), sourceCommit: base, paths: APP_PATHS, cwd })).toEqual({ passed: false, exactMatch: false });
  });

  it("fails closed on unready, invalid or missing input without running git", () => {
    const sha = "b".repeat(40);
    const other = "c".repeat(40);
    const runGit = () => { throw new Error("must not run git"); };
    const cases = [
      { ready: false, commit: sha, sourceCommit: sha, paths: APP_PATHS },
      { ready: true, commit: null, sourceCommit: sha, paths: APP_PATHS },
      { ready: true, commit: undefined, sourceCommit: sha, paths: APP_PATHS },
      { ready: true, commit: sha.toUpperCase(), sourceCommit: sha, paths: APP_PATHS },
      { ready: true, commit: sha.slice(0, 12), sourceCommit: sha, paths: APP_PATHS },
      { ready: true, commit: sha, sourceCommit: "not-a-sha", paths: APP_PATHS },
      { ready: true, commit: sha, sourceCommit: other, paths: [] },
      { ready: true, commit: sha, sourceCommit: other, paths: undefined },
    ];
    for (const value of cases) expect(verifySurfaceProvenance({ ...value, runGit })).toEqual({ passed: false, exactMatch: false });
  });

  it("fails closed when git errors or exits nonzero", () => {
    const sha = "b".repeat(40);
    const other = "c".repeat(40);
    expect(verifySurfaceProvenance({ ready: true, commit: sha, sourceCommit: other, paths: APP_PATHS, runGit: () => null })).toEqual({ passed: false, exactMatch: false });
    expect(verifySurfaceProvenance({ ready: true, commit: sha, sourceCommit: other, paths: APP_PATHS, runGit: (args: string[]) => args[0] === "diff" ? 1 : 0 })).toEqual({ passed: false, exactMatch: false });
    expect(verifySurfaceProvenance({ ready: true, commit: sha, sourceCommit: other, paths: APP_PATHS, runGit: () => { throw new Error("spawn failed"); } })).toEqual({ passed: false, exactMatch: false });
    const calls: string[][] = [];
    expect(verifySurfaceProvenance({ ready: true, commit: sha, sourceCommit: other, paths: ["app"], runGit: (args: string[]) => { calls.push(args); return 0; } })).toEqual({ passed: true, exactMatch: false });
    expect(calls).toEqual([["merge-base", "--is-ancestor", sha, other], ["diff", "--quiet", sha, other, "--", "app"]]);
  });

  it("keeps each provenance summary valid in a built snapshot", () => {
    const passed = { status: "passed", scope: "A bounded deterministic fixture check.", tool: { name: "fixture", version: "1" }, summary: "The deterministic fixture check passed." };
    const ids = ["source_to_deployment_provenance", "production_dependency_vulnerabilities", "code_scanning", "secret_scanning", "public_artifact_integrity", "application_live_route_comparison", "marketing_live_route_comparison", "hosted_migration_boundary", "cross_account_rls_isolation"];
    expect(provenanceSummary({ passed: true })).toBe("Both Ready deployments name the expected source commit.");
    expect(provenanceSummary({ passed: true, exactMatch: true })).toBe("Both Ready deployments name the expected source commit.");
    const equivalent = provenanceSummary({ passed: true, exactMatch: false });
    expect(equivalent).toBe("Both Ready deployments match or are verified source-equivalent ancestors of the expected source commit.");
    const failed = provenanceSummary({ passed: false, exactMatch: false });
    expect(failed).toBe("The named deployments are not both Ready from or source-equivalent to the expected source commit.");
    for (const [status, summary] of [["passed", equivalent], ["failed", failed]]) {
      const facts = Object.fromEntries(ids.map((id) => [id, id === "source_to_deployment_provenance" ? { ...passed, status, summary } : passed]));
      const snapshot = buildSnapshot({ ...input, facts });
      expect(snapshot.checks.find((check: { id: string }) => check.id === "source_to_deployment_provenance").summary).toBe(summary);
    }
  });
});
