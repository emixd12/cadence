import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parse } from "yaml";
import { expect, it } from "vitest";

const workflow = parse(await readFile(".github/workflows/public-trust-evidence.yml", "utf8"));
const job = workflow.jobs["diagnose-preview-access"];
const diagnostic = job.steps[2];

it("pins trusted diagnostic code separately from the deployed subject without publication capabilities", () => {
  expect(workflow.on.workflow_dispatch.inputs.prepare_only.default).toBe(false);
  expect(job.if).toContain("github.event_name == 'workflow_dispatch'");
  expect(job.if).toContain("inputs.prepare_only");
  expect(job.if).toContain("github.repository == 'emixd12/cadence'");
  expect(job.if).toContain("github.ref == 'refs/tags/trust-preview-diagnostic-232'");
  expect(job.if).toContain("inputs.target == 'preview'");
  expect(job.environment).toBe("public-trust-preview");
  expect(job.permissions).toEqual({ contents: "read" });
  expect(job.steps).toHaveLength(4);
  expect(job.steps[0].with).toEqual({ ref: "eb60072a639399a7b4e056b8cd00912da44a1376", "persist-credentials": false });
  expect(job.steps[1].with).toEqual({ "node-version": "24.x" });
  expect(diagnostic.env).toEqual({
    TRUST_SOURCE_COMMIT: "c42ca9e8a54b3e114df4107d5953bed2205d9e86",
    TRUST_APPLICATION_DEPLOYMENT_ID: "dpl_EaYktaEGaEus5tnFYfzHNmteXHWg",
    TRUST_APPLICATION_DEPLOYMENT_URL: "https://cadence-qg4m7u5fo-emis-projects-4c886aeb.vercel.app",
    TRUST_MARKETING_DEPLOYMENT_ID: "dpl_5EPSFodVy4tkiDtYSx2MFDcxuZEk",
    TRUST_MARKETING_DEPLOYMENT_URL: "https://cadence-marketing-48i0s990p-emis-projects-4c886aeb.vercel.app",
    TRUST_PAGES_ORIGIN: "https://emixd12.github.io/cadence/",
    VERCEL_APPLICATION_PROJECT_ID: "prj_9tZKRXZ6IdT56ZLKVSmoJH5AAYhs",
    VERCEL_MARKETING_PROJECT_ID: "prj_BLlsxoaz1wSvWuK7xcZLLkHglQcR",
    VERCEL_TEAM_ID: "team_BxWfRYU1gqrl6Ba6t7Vm3wp1",
    VERCEL_TOKEN: "${{ secrets.VERCEL_TOKEN }}",
    TRUST_TARGET: "preview",
  });
  expect(workflow.jobs.collect.if).toBe("${{ !inputs.prepare_only }}");
  expect(workflow.jobs.publish.needs).toBe("collect");
  expect(workflow.jobs.publish.if).toBe("${{ !inputs.prepare_only && (github.event_name == 'schedule' || inputs.target == 'production') }}");
  expect(job.steps[3].if).toBe("always()");
});

it.each([
  [0, "", "Preview access diagnostic succeeded; private input removed.\n"],
  [1, "Unable to create a temporary Preview access boundary (HTTP 403).", "403\n"],
  [1, "Unable to create a temporary Preview access boundary (HTTP 429).", "429\n"],
  [7, "private-token in arbitrary provider error", "Preview access diagnostic failed without an HTTP status.\n"],
  [1, "Unable to create a temporary Preview access boundary (HTTP 403).\nprivate-token", "Preview access diagnostic failed without an HTTP status.\n"],
])("runs once, preserves exit %s and removes private files", async (code, message, expected) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cadence-trust-job-"));
  const runner = path.join(root, "runner");
  const bin = path.join(root, "bin");
  const trace = path.join(root, "calls");
  try {
    await mkdir(runner);
    await mkdir(bin);
    await writeFile(path.join(bin, "node"), `#!/bin/bash
test "$1" = scripts/prepare-public-trust-input.mjs && test "$2" = --output || exit 99
printf '%s\\n' call >> "$TRACE_FILE"
printf '%s' private-output > "$3"
printf '%s' private-stdout
printf '%s' "$MOCK_ERROR" >&2
exit "$MOCK_EXIT"
`, { mode: 0o700 });
    const env = {
      PATH: `${bin}:/usr/bin:/bin`, RUNNER_TEMP: runner,
      GITHUB_RUN_ID: "123", GITHUB_RUN_ATTEMPT: "1",
      TRACE_FILE: trace, MOCK_EXIT: String(code), MOCK_ERROR: String(message),
    };
    const result = spawnSync("/bin/bash", ["-e", "-o", "pipefail", "-c", diagnostic.run], { env, encoding: "utf8", timeout: 10_000 });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(code);
    expect(result.stdout).toBe(expected);
    expect(result.stderr).toBe("");
    expect(await readFile(trace, "utf8")).toBe("call\n");
    expect(await readdir(runner)).toEqual([]);
    const residue = path.join(runner, "cadence-trust-diagnostic-123-1");
    await mkdir(residue);
    await writeFile(path.join(residue, "input.json"), "private-residue");
    const cleanup = spawnSync("/bin/bash", ["-e", "-c", job.steps[3].run], { env, encoding: "utf8" });
    expect(cleanup.status).toBe(0);
    expect(await readdir(runner)).toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
