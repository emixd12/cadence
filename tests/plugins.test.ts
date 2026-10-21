import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { INTEGRATION_OPERATION_NAMES, validateOperationInput } from "@cadence/core/integration";
import { checkPlugins, packageFiles, pluginNames, repositoryRoot, skillNames } from "../scripts/check-plugins.mjs";
import { pluginArchive } from "../scripts/package-plugins.mjs";

describe("Cadence plugin packages", () => {
  it("validates manifests, listing metadata, OAuth settings and packaged assets", () => {
    expect(checkPlugins()).toEqual({ version: "1.0.0" });
  });

  it("references only registry tools in every shared workflow", () => {
    for (const name of skillNames) {
      const source = fs.readFileSync(path.join(repositoryRoot, "integrations/skills", name, "SKILL.md"), "utf8");
      // Tool references use function notation; input fields use ordinary inline code.
      const tools = [...source.matchAll(/`([a-z][a-z0-9_]*)\(\)`/g)].map((match) => match[1]);
      expect(tools.length, name).toBeGreaterThan(0);
      for (const tool of tools) expect(INTEGRATION_OPERATION_NAMES, `${name}: ${tool}`).toContain(tool);
      for (const match of source.matchAll(/```json\n([\s\S]*?)\n\s*```/g)) {
        expect(validateOperationInput("create_behavior", JSON.parse(match[1])).ok, name).toBe(true);
      }
    }
  });

  it.each(pluginNames)("builds a reproducible, self-contained %s ZIP with only approved files", (plugin) => {
    const first = pluginArchive(plugin);
    expect(pluginArchive(plugin)).toEqual(first);
    const files = unzipSync(first);
    expect(Object.keys(files).sort()).toEqual(packageFiles(plugin));
    for (const [file, bytes] of Object.entries(files)) {
      expect(Buffer.from(bytes)).toEqual(fs.readFileSync(path.join(repositoryRoot, "integrations", plugin, file)));
    }
  });

  it("rejects invalid listing metadata, extra credential fields, and stale shared skills", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadence-plugins-test-"));
    try {
      fs.cpSync(path.join(repositoryRoot, "integrations"), path.join(root, "integrations"), {
        recursive: true, filter: (source) => !source.includes(".artifacts"),
      });
      fs.cpSync(path.join(repositoryRoot, ".claude-plugin"), path.join(root, ".claude-plugin"), { recursive: true });
      fs.copyFileSync(path.join(repositoryRoot, "LICENSE"), path.join(root, "LICENSE"));
      const manifestPath = path.join(root, "integrations/chatgpt-plugin/plugin.json");
      const original = fs.readFileSync(manifestPath, "utf8");
      const manifest = JSON.parse(original);
      manifest.extensions["com.openai"].interface.shortDescription = "x".repeat(31);
      fs.writeFileSync(manifestPath, JSON.stringify(manifest));
      expect(() => checkPlugins(root)).toThrow(/OpenAI listing/);
      fs.writeFileSync(manifestPath, original);
      const mcpPath = path.join(root, "integrations/chatgpt-plugin/mcp.json");
      const originalMcp = fs.readFileSync(mcpPath, "utf8");
      const mcp = JSON.parse(originalMcp);
      mcp.mcpServers.cadence.extensions["com.openai"].auth.clientSecret = "synthetic-not-a-secret";
      fs.writeFileSync(mcpPath, JSON.stringify(mcp));
      expect(() => checkPlugins(root)).toThrow(/OpenAI OAuth/);
      fs.writeFileSync(mcpPath, originalMcp);
      fs.appendFileSync(path.join(root, "integrations/claude-plugin/skills/daily-check-in/SKILL.md"), "\nChanged only in one package.\n");
      expect(() => checkPlugins(root)).toThrow(/copy differs/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
