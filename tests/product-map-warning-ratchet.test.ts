import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

type Baseline = {
  about: string;
  unratcheted: Record<string, string>;
  ratcheted: Record<string, string[]>;
};

const baselinePath = "scripts/product-map-warning-baseline.json";
const committed = JSON.parse(readFileSync(baselinePath, "utf8")) as Baseline;
const directory = mkdtempSync(join(tmpdir(), "cadence-map-ratchet-"));
afterAll(() => rmSync(directory, { recursive: true, force: true }));

function check(baseline: Baseline, ...extra: string[]) {
  const file = join(directory, `baseline-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(file, `${JSON.stringify(baseline, null, 2)}\n`);
  const result = spawnSync(
    process.execPath,
    ["scripts/build-product-map.mjs", "check", "--baseline", file, ...extra],
    { encoding: "utf8" },
  );
  return { status: result.status, output: result.stdout + result.stderr, file };
}

function copy(): Baseline {
  return JSON.parse(JSON.stringify(committed)) as Baseline;
}

// Each test runs the map builder once or twice as a child process. That takes about
// 2 s here and has passed 5 s on a loaded CI shard, so the default timeout is too short.
describe("product map warning ratchet", { timeout: 30_000 }, () => {
  it("keeps design-system.usage.json differences out of the ratchet", () => {
    expect(committed.unratcheted).toHaveProperty(["design-system.usage.json differences"]);
    expect(committed.ratcheted).not.toHaveProperty(["design-system.usage.json differences"]);
    expect(committed.ratcheted).toHaveProperty(["token descriptions"]);
  });

  it("passes at the committed baseline", () => {
    const result = check(copy());
    expect(result.output).toContain("map:check passed");
    expect(result.output).not.toContain("warning ratchet failed");
    expect(result.status).toBe(0);
  });

  it("fails when a ratcheted category grows and lists the new warning", () => {
    const baseline = copy();
    const [removed, ...rest] = baseline.ratcheted["token descriptions"];
    expect(removed).toBeTruthy();
    baseline.ratcheted["token descriptions"] = rest;
    const result = check(baseline);
    expect(result.status).toBe(1);
    expect(result.output).toContain('Warning category "token descriptions" grew');
    expect(result.output).toContain(`+ ${removed}`);
    expect(result.output).toContain("Raising a baseline is a deliberate edit");
  });

  it("fails on a warning category that is in neither list", () => {
    const baseline = copy();
    delete baseline.ratcheted["token descriptions"];
    const result = check(baseline);
    expect(result.status).toBe(1);
    expect(result.output).toContain('Warning category "token descriptions" is not in');
  });

  it("passes below the baseline, says it can be lowered, and lowers it on request", () => {
    const baseline = copy();
    const fixed = "app/globals.css: --fixed-token has no description comment";
    baseline.ratcheted["token descriptions"] = [...baseline.ratcheted["token descriptions"], fixed].sort();
    const result = check(baseline);
    expect(result.status).toBe(0);
    expect(result.output).toContain("Warning baseline can be lowered");
    expect(result.output).toContain('"token descriptions"');

    const lowered = check(baseline, "--lower-baseline");
    expect(lowered.status).toBe(0);
    expect(lowered.output).toContain("Updated the warning baseline");
    const written = JSON.parse(readFileSync(lowered.file, "utf8")) as Baseline;
    expect(written.ratcheted["token descriptions"]).not.toContain(fixed);
    expect(written.ratcheted["token descriptions"]).toEqual(committed.ratcheted["token descriptions"]);
    expect(written.unratcheted).toEqual(committed.unratcheted);
  });

  it("never raises a baseline when lowering", () => {
    const baseline = copy();
    baseline.ratcheted["token descriptions"] = baseline.ratcheted["token descriptions"].slice(1);
    const result = check(baseline, "--lower-baseline");
    expect(result.status).toBe(1);
    const written = JSON.parse(readFileSync(result.file, "utf8")) as Baseline;
    expect(written.ratcheted["token descriptions"]).toEqual(baseline.ratcheted["token descriptions"]);
  });
});
