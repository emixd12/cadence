import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

type Source = { path: string; interaction_marker_count: number; interaction_ids: string[] };
type Interaction = {
  id: string;
  implementation?: string[];
  platforms?: Record<string, { implementation?: string[] }>;
};
type Registry = { source_inventory: Source[]; interactions: Interaction[] };

const directory = mkdtempSync(join(tmpdir(), "cadence-marker-count-"));
const registryText = readFileSync("interaction-registry.json", "utf8");
afterAll(() => rmSync(directory, { recursive: true, force: true }));

function check(mutate: (registry: Registry) => void) {
  const registry = JSON.parse(registryText) as Registry;
  mutate(registry);
  const file = join(directory, "registry.json");
  writeFileSync(file, JSON.stringify(registry));
  const result = spawnSync(process.execPath, ["scripts/check-interactions.mjs", "--registry", file], {
    encoding: "utf8",
  });
  return { status: result.status, output: result.stdout + result.stderr };
}

function markerLine(output: string, path: string): string {
  return output.split("\n").find((line) => line.includes(`${path} interaction marker count changed`)) ?? "";
}

describe("interaction marker count failure", () => {
  it("lists the interaction ids tied to the file and asks for a text review", () => {
    const registry = JSON.parse(registryText) as Registry;
    const source = registry.source_inventory.find(
      (entry) => entry.interaction_ids.length > 0 && entry.interaction_ids.length <= 12,
    )!;
    const implementers = registry.interactions
      .filter((interaction) =>
        [
          ...(interaction.implementation ?? []),
          ...Object.values(interaction.platforms ?? {}).flatMap((platform) => platform.implementation ?? []),
        ].some((reference) => reference.split("#")[0] === source.path),
      )
      .map((interaction) => interaction.id);
    const expected = [...new Set([...source.interaction_ids, ...implementers])].sort();

    const result = check((copy) => {
      copy.source_inventory.find((entry) => entry.path === source.path)!.interaction_marker_count += 1;
    });
    expect(result.status).toBe(1);
    const line = markerLine(result.output, source.path);
    expect(line).toContain(`registry=${source.interaction_marker_count + 1}`);
    for (const id of expected.slice(0, 12)) expect(line).toContain(id);
    expect(line).toContain("review those entries' text");
  });

  it("caps the id list for a file tied to many interactions", () => {
    const registry = JSON.parse(registryText) as Registry;
    const source = registry.source_inventory.find((entry) => entry.interaction_ids.length > 0)!;
    const extra = registry.interactions.map((interaction) => interaction.id).filter((id) => !source.interaction_ids.includes(id));
    const result = check((copy) => {
      const entry = copy.source_inventory.find((item) => item.path === source.path)!;
      entry.interaction_marker_count += 1;
      // Point 20 more interactions' implementation at this file so the union exceeds the cap.
      for (const id of extra.slice(0, 20)) copy.interactions.find((interaction) => interaction.id === id)!.implementation!.push(source.path);
    });
    expect(result.status).toBe(1);
    const line = markerLine(result.output, source.path);
    expect(line).toMatch(/Interactions tied to this file: (?:INT-[A-Z0-9-]+, ){11}INT-[A-Z0-9-]+ and \d+ more\./);
  });
});
