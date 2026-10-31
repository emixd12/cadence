import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("Claude cloud dependency cache reporting", () => {
  let directory: string;
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "cadence-cloud-hook-"));
    for (const folder of ["scripts", "apps/example", "packages/example"]) mkdirSync(join(directory, folder), { recursive: true });
    copyFileSync("scripts/claude-cloud-session.sh", join(directory, "scripts/claude-cloud-session.sh"));
    for (const file of ["package.json", "package-lock.json", "apps/example/package.json", "packages/example/package.json"]) writeFileSync(join(directory, file), "{}\n");
    writeFileSync(join(directory, "npm.log"), "");
  });
  afterEach(() => rmSync(directory, { recursive: true, force: true }));
  const run = (mode: "full" | "fallback") => spawnSync("bash", [resolve("tests/fixtures/claude-cloud-session/cache-fixture.sh")], {
    encoding: "utf8", timeout: 10_000,
    env: { ...process.env, CLAUDE_CODE_REMOTE: "true", CLAUDE_PROJECT_DIR: directory,
      CLAUDE_ENV_FILE: join(directory, "session.env"), TMPDIR: directory,
      CADENCE_HOOK_TEST_MODE: mode, CADENCE_HOOK_TEST_NPM_LOG: join(directory, "npm.log") },
  });
  const attempts = () => readFileSync(join(directory, "npm.log"), "utf8").trim().split("\n");
  const mode = () => readFileSync(join(directory, "node_modules/.cadence-cloud-install.mode"), "utf8").trim();

  it("keeps disclosing skipped install scripts on a cached resume", () => {
    const first = run("fallback");
    expect(first.status, first.stderr).toBe(0);
    expect(first.stdout).toContain("install scripts did not run");
    expect(mode()).toBe("ignore-scripts");
    expect(attempts()).toHaveLength(2);

    const resumed = run("full");
    expect(resumed.status, resumed.stderr).toBe(0);
    expect(resumed.stdout).toContain("install scripts did not run");
    expect(attempts()).toHaveLength(2);
  });

  it("clears the fallback state after a full install and on later resumes", () => {
    expect(run("fallback").status).toBe(0);
    writeFileSync(join(directory, "package.json"), '{"name":"changed"}\n');
    const full = run("full");
    expect(full.status, full.stderr).toBe(0);
    expect(mode()).toBe("full");
    expect(full.stdout).not.toContain("install scripts did not run");
    expect(attempts()).toHaveLength(3);

    const resumed = run("fallback");
    expect(resumed.status, resumed.stderr).toBe(0);
    expect(resumed.stdout).not.toContain("install scripts did not run");
    expect(attempts()).toHaveLength(3);
  });
});
