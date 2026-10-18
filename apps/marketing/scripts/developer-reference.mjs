import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runnerImport } from "vite";

const cell = (value) => String(value).replaceAll("|", "\\|").replaceAll("\n", " ");
const json = (value) => `\n\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\`\n`;

function code(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  const delimiter = "`".repeat(1 + Math.max(0, ...[...text.matchAll(/`+/g)].map(([run]) => run.length)));
  return `${delimiter} ${text} ${delimiter}`;
}
function schemaType(schema) {
  if (schema.anyOf) return schema.anyOf.map(schemaType).join(" or ");
  if (schema.oneOf) return "one of several shapes";
  return Array.isArray(schema.type) ? schema.type.join(" or ") : schema.type ?? "variant";
}
function constraints(field) {
  return [field.description,
    ...["format", "minimum", "maximum", "minLength", "maxLength", "minItems", "maxItems", "pattern", "default", "uniqueItems"].filter((key) => field[key] !== undefined).map((key) => `${key}: ${code(field[key])}`),
    ...(field.enum ? [`Values: ${field.enum.map(code).join(", ")}`] : []),
    ...(field.const !== undefined ? [`Value: ${code(field.const)}`] : []),
    ...(field.anyOf ?? []).flatMap(constraints),
  ].filter(Boolean);
}
function nestedFields(schema, path) {
  return [
    ...fields(schema, `${path}.`),
    ...(schema.items ? fields({ properties: { "[]": schema.items }, required: ["[]"] }, path) : []),
    ...[...(schema.oneOf ?? []), ...(schema.anyOf ?? [])].flatMap((branch) => nestedFields(branch, path)),
  ];
}
function fields(schema, prefix = "") {
  const rows = [];
  for (const [name, field] of Object.entries(schema.properties ?? {})) {
    const path = `${prefix}${name}`;
    rows.push(`| ${cell(code(path))} | ${schema.required?.includes(name) ? "yes" : "no"} | ${cell(schemaType(field))} | ${cell(constraints(field).join("; "))} |`);
    rows.push(...nestedFields(field, path));
  }
  return rows;
}
export function table(schema) {
  const rows = fields(schema);
  const alternatives = schema.anyOf?.flatMap((branch) => branch.required ?? []);
  return rows.length ? ["Required means required within the containing object. Variant fields apply only to that variant; children of nullable values apply when non-null. Unknown fields are rejected.", "", "| Field | Required | Type | Meaning and constraints |", "|---|---|---|---|", ...rows, ...(alternatives?.length ? ["", `Provide at least one of: ${alternatives.map(code).join(", ")}.`] : [])].join("\n") : "No fields. Send an empty object.";
}
async function main() {
  const root = fileURLToPath(new URL("../../..", import.meta.url));
  const output = new URL("../src/data/developer-reference.json", import.meta.url);
  const { module: contract } = await runnerImport("./packages/core/src/integration/index.ts", { root, configFile: false });
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
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
