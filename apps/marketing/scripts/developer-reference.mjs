import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runnerImport } from "vite";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const output = new URL("../src/data/developer-reference.json", import.meta.url);
const { module: contract } = await runnerImport("./packages/core/src/integration/index.ts", { root, configFile: false });
const cell = (value) => String(value).replaceAll("|", "\\|").replaceAll("\n", " ");
const json = (value) => `\n\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\`\n`;

function fields(schema, prefix = "") {
  const rows = [];
  for (const [name, field] of Object.entries(schema.properties ?? {})) {
    const path = `${prefix}${name}`;
    const constraints = [field.description, ...["format", "minimum", "maximum", "minLength", "maxLength", "minItems", "maxItems", "pattern", "default", "uniqueItems"].filter((key) => field[key] !== undefined).map((key) => `${key}: ${JSON.stringify(field[key])}`)];
    if (field.enum) constraints.push(`Values: ${field.enum.map((v) => JSON.stringify(v)).join(", ")}`);
    if (field.const !== undefined) constraints.push(`Value: ${JSON.stringify(field.const)}`);
    rows.push(`| \`${path}\` | ${schema.required?.includes(name) ? "yes" : "no"} | ${cell(Array.isArray(field.type) ? field.type.join(" or ") : field.type ?? "variant")} | ${cell(constraints.filter(Boolean).join("; "))} |`);
    rows.push(...fields(field, `${path}.`));
    if (field.items) rows.push(...fields({ properties: { "[]": field.items }, required: ["[]"] }, path));
    for (const branch of field.oneOf ?? []) rows.push(...fields(branch, `${path}.`));
  }
  return rows;
}
function table(schema) {
  const rows = fields(schema);
  const alternatives = schema.anyOf?.flatMap((branch) => branch.required ?? []);
  return rows.length ? ["Required means required within the containing object. Variant fields apply only to that variant. Unknown fields are rejected.", "", "| Field | Required | Type | Meaning and constraints |", "|---|---|---|---|", ...rows, ...(alternatives ? ["", `Provide at least one of: ${alternatives.map((name) => `\`${name}\``).join(", ")}.`] : [])].join("\n") : "No fields. Send an empty object.";
}
const reference = contract.renderIntegrationContractReference();
const section = (heading, next) => reference.split(`## ${heading}\n`)[1].split(`## ${next}\n`)[0].trim();
const tools = contract.INTEGRATION_OPERATION_NAMES.map((name) => {
  const operation = contract.INTEGRATION_OPERATIONS[name];
  const fixture = JSON.parse(readFileSync(`${root}/tests/fixtures/integration/operations/${name}.json`, "utf8"));
  const input = fixture.valid_inputs[0].value;
  const result = fixture.valid_outputs[0].value;
  assert(contract.validateOperationInput(name, input).ok, `${name}: invalid example input`);
  assert(contract.validateOperationOutput(name, result).ok, `${name}: invalid example output`);
  const markdown = [
    `# ${name}`, "", operation.description, "", "## Permission and annotations", "",
    `Required scope: \`${operation.scope}\`. Contract ${contract.INTEGRATION_CONTRACT_VERSION}; available since ${operation.since}.`, "",
    ...Object.entries(operation.annotations).map(([key, value]) => `- \`${key}\`: ${JSON.stringify(value)}`), "", operation.annotationRationale,
    "", "## Input", "", table(operation.input.schema), "", "## Output", "", table(operation.output.schema),
    "", "## Example call", "", "Synthetic contract fixture. Replace identifiers and dates with records returned for your account. This is the SDK tools/call payload, not a complete HTTP request.", json({ name, arguments: input }),
    "## Example result", "", "Synthetic success data from a contract fixture, shown as structuredContent. Input and output examples validate independently; they are not a recorded transaction.", json(result),
    "## Errors", "", ...operation.errors.map((code) => { const error = contract.INTEGRATION_ERRORS.find((entry) => entry.code === code); return `- \`${code}\`: ${error.meaning}`; }),
    "", "Output size limits can also return `limit_exceeded`. See [error handling](/developers/errors), [limits](/developers/limits), and [safe retries](/developers/idempotency).",
  ].join("\n");
  assert(Buffer.byteLength(markdown) <= 100000, `${name}: documentation exceeds 100 KB`);
  return { slug: `tools/${name}`, title: name, description: operation.title + ": inputs, outputs, permissions, examples, and errors.", markdown };
});
const generated = JSON.stringify({ generatedFrom: "packages/core/src/integration/ and tests/fixtures/integration/operations/", version: contract.INTEGRATION_CONTRACT_VERSION, tools, errors: section("Error catalog", "Limits"), limits: section("Limits", "Data included and excluded"), data: section("Data included and excluded", "Versioning"), versioning: section("Versioning", "Tool reference") }, null, 2) + "\n";
if (process.argv.includes("--write")) {
  writeFileSync(output, generated);
  console.log(`Generated ${tools.length} developer tool references.`);
} else {
  assert.equal(readFileSync(output, "utf8"), generated, "Developer reference drifted. Run npm run developers:check -- --write");
  console.log(`Developer reference matches all ${tools.length} tools; examples validate.`);
}
