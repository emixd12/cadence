import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";

export const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
export const skillNames = ["daily-check-in", "routine-setup", "weekly-review"];
export const pluginNames = ["claude-plugin", "chatgpt-plugin"];
const skillFiles = ["SKILL.md", "agents/openai.yaml"];
const endpoint = "https://app.cadence-me.com/mcp";
const text = (maxLength) => ({ type: "string", minLength: 1, maxLength });
const line = (maxLength) => ({ ...text(maxLength), pattern: "^[^\\r\\n]+$" });
const url = { ...line(1024), format: "https-url" };
const object = (properties) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
const version = { type: "string", pattern: "^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)$" };
const author = object({ name: line(80), url });
const identity = {
  name: { const: "cadence" }, version, description: text(4000), author,
  homepage: url, repository: url, license: { const: "MIT" },
  keywords: { type: "array", items: line(64), uniqueItems: true },
};
// These strict schemas cover Cadence's documented fields, not every vendor option.
const claudeSchema = object(identity);
const interfaceSchema = object({
  displayName: line(30), shortDescription: line(30), longDescription: text(4000),
  developerName: line(80), category: { const: "Productivity" },
  capabilities: { type: "array", maxItems: 20, items: line(120), uniqueItems: true },
  websiteURL: url, privacyPolicyURL: url, termsOfServiceURL: url, supportURL: url,
  defaultPrompt: { type: "array", minItems: 1, maxItems: 3, uniqueItems: true, items: { ...line(128), pattern: "^[^@\\r\\n]+$" } },
  composerIcon: { const: "./assets/logo.png" }, logo: { const: "./assets/logo.png" },
});
const openaiSchema = object({
  ...identity,
  $schema: { const: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json" },
  extensions: object({ "com.openai": object({ interface: interfaceSchema }) }),
});
const authSchema = object({
  "com.openai": object({ auth: object({
    type: { const: "oauth" }, client: object({ mode: { const: "cimd" } }),
    resource: { const: endpoint }, baseScopes: { const: ["cadence.read"] },
    defaultScopes: { const: ["cadence.read", "cadence.occurrences.write", "cadence.behaviors.write"] },
  }) }),
});

export function packageFiles(plugin) {
  return [
    ...(plugin === "claude-plugin" ? [".claude-plugin/plugin.json", ".mcp.json"] : ["plugin.json", "mcp.json", "assets/logo.png"]),
    "LICENSE", ...skillNames.flatMap((name) => skillFiles.map((file) => `skills/${name}/${file}`)),
  ].sort();
}

export function checkPlugins(root = repositoryRoot) {
  root = fs.realpathSync(root);
  const read = (file) => fs.readFileSync(path.join(root, file));
  const json = (file) => JSON.parse(read(file).toString());
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  ajv.addFormat("https-url", (value) => {
    try {
      const parsed = new URL(value);
      return parsed.protocol === "https:" && !parsed.username && !parsed.password && !parsed.hash;
    } catch { return false; }
  });
  const validate = (schema, value, label) => {
    const check = ajv.compile(schema);
    assert(check(value), `${label}: ${ajv.errorsText(check.errors)}`);
  };
  const claude = json("integrations/claude-plugin/.claude-plugin/plugin.json");
  const openai = json("integrations/chatgpt-plugin/plugin.json");
  validate(claudeSchema, claude, "Claude manifest");
  validate(json("integrations/schemas/agent-plugin.schema.json"), openai, "Agent Plugins manifest");
  validate(openaiSchema, openai, "OpenAI listing");
  assert.equal(claude.version, openai.version, "Package versions differ");
  const claudeMcp = json("integrations/claude-plugin/.mcp.json");
  validate(object({ mcpServers: object({ cadence: object({ type: { const: "http" }, url: { const: endpoint } }) }) }), claudeMcp, "Claude MCP");
  const mcp = json("integrations/chatgpt-plugin/mcp.json");
  const extensions = mcp.mcpServers?.cadence?.extensions;
  validate(authSchema, extensions, "OpenAI OAuth extension");
  // OpenAI documents this extension; upstream 1.0.0 MCP schema has no extension slot.
  const portableMcp = structuredClone(mcp);
  delete portableMcp.mcpServers.cadence.extensions;
  validate(json("integrations/schemas/agent-mcp.schema.json"), portableMcp, "Portable MCP fields");
  assert.deepEqual(Object.keys(mcp.mcpServers), ["cadence"]);
  assert.equal(mcp.mcpServers.cadence.type, "streamable-http");
  assert.equal(mcp.mcpServers.cadence.url, endpoint);
  assert.deepEqual(Object.keys(mcp.mcpServers.cadence).sort(), ["extensions", "type", "url"]);
  validate(object({
    name: { const: "cadence-plugins" }, description: text(4000), owner: object({ name: line(80) }),
    plugins: { type: "array", minItems: 1, maxItems: 1, items: object({ name: { const: "cadence" }, source: { const: "./integrations/claude-plugin" }, description: text(4000) }) },
  }), json(".claude-plugin/marketplace.json"), "Claude marketplace");
  for (const plugin of pluginNames) {
    const prefix = `integrations/${plugin}`;
    for (const file of packageFiles(plugin)) {
      const full = path.join(root, prefix, file);
      assert(fs.lstatSync(full).isFile(), `${prefix}/${file} must be a regular file`);
      assert.equal(fs.realpathSync(full), full, `${prefix}/${file} must not traverse symlinks`);
    }
    for (const name of skillNames) {
      const source = read(`integrations/skills/${name}/SKILL.md`).toString();
      assert(source.startsWith(`---\nname: ${name}\ndescription: `), `${name}: missing skill metadata`);
      for (const file of skillFiles) {
        assert.deepEqual(read(`${prefix}/skills/${name}/${file}`), read(`integrations/skills/${name}/${file}`), `${plugin}/${name}: copy differs from shared skill`);
      }
    }
    assert.deepEqual(read(`${prefix}/LICENSE`), read("LICENSE"), `${plugin}: license differs`);
  }
  const logo = read("integrations/chatgpt-plugin/assets/logo.png");
  assert(logo.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), "Logo must be PNG");
  const width = logo.readUInt32BE(16);
  assert(width >= 48 && width <= 4096 && width === logo.readUInt32BE(20), "Logo must be square, 48–4096px");
  assert(logo.length <= 5 * 1024 * 1024, "Logo exceeds 5 MiB");
  return { version: openai.version };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  checkPlugins();
  console.log("Plugin manifests, OAuth config, marketplace, assets and shared skills pass.");
}
