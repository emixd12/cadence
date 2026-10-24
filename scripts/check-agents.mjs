import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const failures = [];
const notes = [];

function assert(condition, message) {
  if (!condition) failures.push(message);
}

function filePath(relativePath) {
  return path.join(root, relativePath);
}

function exists(relativePath) {
  return fs.existsSync(filePath(relativePath));
}

function read(relativePath) {
  const absolutePath = filePath(relativePath);
  if (!fs.existsSync(absolutePath)) return "";
  return fs.readFileSync(absolutePath, "utf8");
}

function readJson(relativePath) {
  return JSON.parse(read(relativePath));
}

function walk(relativePath) {
  const start = filePath(relativePath);
  if (!fs.existsSync(start)) return [];
  const results = [];
  const stack = [start];

  while (stack.length > 0) {
    const current = stack.pop();
    const stat = fs.statSync(current);

    if (stat.isDirectory()) {
      for (const child of fs.readdirSync(current)) {
        if (["node_modules", ".git", ".next", ".supabase", "dist", "coverage", "target"].includes(child)) {
          continue;
        }
        stack.push(path.join(current, child));
      }
      continue;
    }

    results.push(path.relative(root, current));
  }

  return results.sort();
}

function sourceEnvironmentVariables() {
  const sourceFiles = ["app", "components", "lib", "apps", "scripts"]
    .flatMap(walk)
    .filter((file) => /\.(?:astro|[cm]?[jt]sx?)$/.test(file));
  const names = new Set();
  const pattern =
    /(?:process\.env\.|import\.meta\.env\.|\b(?:env|mergedEnv)\.)([A-Z][A-Z0-9_]*)/g;

  for (const sourceFile of sourceFiles) {
    for (const match of read(sourceFile).matchAll(pattern)) {
      names.add(match[1]);
    }
  }

  return [...names].sort();
}

function documentedEnvironmentVariables(content) {
  return new Set(
    [...content.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map((match) => match[1]),
  );
}

function migrationRequiresExplicitTransaction(content) {
  return (
    /\bset\s+not\s+null\b/i.test(content) ||
    /^\s*--[^\n]*\bbackfill\b/im.test(content) ||
    /^\s*update\s+(?:public\.)?[a-z_][a-z0-9_]*\b/im.test(content) ||
    /\binsert\s+into\b[\s\S]*?\bselect\b/i.test(content)
  );
}

function hasExplicitTransaction(content) {
  const withoutComments = content
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*--.*$/gm, "")
    .trim();

  return /^begin\s*;/i.test(withoutComments) && /commit\s*;\s*$/i.test(withoutComments);
}

const requiredFiles = [
  "AGENTS.md",
  "STATUS.md",
  "README.md",
  ".env.example",
  "package.json",
  "docs/OPERATIONS.md",
  "docs/SUPABASE_WORKFLOW.md",
  "docs/SEQUENZY_WORKFLOW.md",
  "docs/DATETIME_STRATEGY.md",
  "docs/ROUTE_MAP.md",
  "docs/AGENT_RESOLVERS.md",
  "docs/INTERACTION_REGISTRY.md",
  "docs/LOAD_TESTING_PLAN.md",
  "docs/LOAD_TESTING_RUNBOOK.md",
  "docs/PERFORMANCE_SPEED_LOG.md",
  "docs/TICKETS.md",
  "docs/DECISIONS.md",
  "docs/NOTIFICATION_SPEC.md",
  "docs/DATA_MODEL.md",
  ".agents/skills/impeccable/SKILL.md",
  "interaction-registry.json",
  "interaction-registry.schema.json",
  "scripts/check-interactions.mjs",
  "scripts/check-load-test-interactions.mjs",
  "scripts/check-load-test-mutation-evidence.mjs",
  "scripts/load-test-cleanup.mjs",
  "scripts/load-test-fixtures.mjs",
  "scripts/load-test-integrity.mjs",
  "scripts/load-test-fake-sequenzy.mjs",
  "scripts/load-test-hosted-preflight.mjs",
  "scripts/launch-cost-preflight.mjs",
  "scripts/launch-surge-drill.mjs",
  "scripts/load-test-local-runtime.mjs",
  "scripts/load-test-mutation-report.mjs",
  "scripts/load-test-mutation-suite.mjs",
  "scripts/load-test-provision.mjs",
  "scripts/load-test-read-report.mjs",
  "scripts/load-test-read-suite.mjs",
  "scripts/load-test-seed.mjs",
  "load-tests/read_locustfile.py",
  "load-tests/mutation_locustfile.py",
  "load-tests/cadence_load/actions.py",
  "load-tests/cadence_load/integrity.py",
  "load-tests/cadence_load/mutation_shapes.py",
  "load-tests/cadence_load/users/contention.py",
  "load-tests/cadence_load/users/daily.py",
  "load-tests/cadence_load/users/exporter.py",
  "load-tests/cadence_load/users/maintainer.py",
  "load-tests/cadence_load/users/operator.py",
  "load-tests/cadence_load/users/reviewer.py",
  "load-tests/cadence_load/users/timezone.py",
  "load-tests/scenarios/interaction-map.json",
  "load-tests/scenarios/mutation-profiles.json",
  "load-tests/scenarios/profiles.json",
  "load-tests/requirements.txt",
];

for (const file of requiredFiles) {
  assert(exists(file), `Required agent/source-of-truth file is missing: ${file}`);
}

const packageJson = readJson("package.json");
const requiredScripts = [
  "lint",
  "typecheck",
  "test",
  "build",
  "agents:check",
  "interactions:check",
  "resolvers:check",
  "core:check",
  "load:install",
  "load:manifest:check",
  "load:python:test",
  "load:web",
  "load:protocol:smoke",
  "load:provision",
  "load:seed",
  "load:integrity",
  "load:cleanup",
  "load:read:smoke",
  "load:read:baseline",
  "load:read:ramp",
  "load:read:full",
  "load:mutation:smoke",
  "load:mutation:baseline",
  "load:mutation:ramp",
  "load:mutation:spike",
  "load:mutation:soak",
  "load:mutation:breakpoint",
  "load:mutation:timezone",
  "load:mutation:contention",
  "load:mutation:operator",
  "load:mutation:full",
  "load:mutation:evidence:check",
  "load:hosted:preflight",
  "launch:cost:preflight",
  "launch:surge:drill",
  "smoke:launch-rate-limit:local",
  "supabase",
  "sequenzy",
];

for (const script of requiredScripts) {
  assert(Boolean(packageJson.scripts?.[script]), `package.json is missing script: ${script}`);
}

assert(
  Boolean(packageJson.devDependencies?.supabase),
  "Supabase CLI must be installed as a devDependency named `supabase`.",
);
assert(
  !packageJson.devDependencies?.["@sequenzy/cli"],
  "Sequenzy CLI must stay isolated from the application dependency graph.",
);
assert(
  packageJson.scripts?.sequenzy ===
    "npm exec --yes --package=@sequenzy/cli@0.0.34 -- sequenzy",
  "The Sequenzy script must use the reviewed isolated CLI version.",
);

const docsToScan = [
  "AGENTS.md",
  "STATUS.md",
  "README.md",
  ".env.example",
  "package.json",
  ...fs.readdirSync(filePath("docs")).filter((file) => file.endsWith(".md")).map((file) => `docs/${file}`),
];

for (const file of docsToScan) {
  const content = read(file);
  assert(!/resend/i.test(content), `Retired email provider reference remains in ${file}. Use Sequenzy instead.`);
}

assert(
  !read("README.md").includes("CODEX_FIRST_PROMPT"),
  "README.md must not reference the removed CODEX_FIRST_PROMPT.md bootstrap file.",
);

const agents = read("AGENTS.md");
for (const snippet of [
  "STATUS.md",
  "docs/OPERATIONS.md",
  "docs/SUPABASE_WORKFLOW.md",
  "docs/SEQUENZY_WORKFLOW.md",
  "docs/DATETIME_STRATEGY.md",
  "docs/ROUTE_MAP.md",
  "interaction-registry.json",
  "npm run agents:check",
  "npm run interactions:check",
  "npm run resolvers:check",
  "Sequenzy",
  "Supabase CLI",
]) {
  assert(agents.includes(snippet), `AGENTS.md must mention ${snippet}.`);
}

const envExample = read(".env.example");
const documentedEnvNames = documentedEnvironmentVariables(envExample);
for (const name of sourceEnvironmentVariables()) {
  assert(
    documentedEnvNames.has(name),
    `.env.example is missing ${name}, which repository source reads.`,
  );
}

const missingEnvFixture = read("tests/fixtures/governance/env-source-missing.txt");
const missingEnvFixtureNames = new Set(
  [...missingEnvFixture.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)].map(
    (match) => match[1],
  ),
);
assert(
  [...missingEnvFixtureNames].some((name) => !documentedEnvironmentVariables("").has(name)),
  "The missing-environment negative fixture must remain absent from its fixture env contract.",
);

for (const [index, line] of envExample.split(/\r?\n/).entries()) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
  const [key, ...valueParts] = trimmed.split("=");
  const value = valueParts.join("=").trim();
  const allowedLiteralValues = new Set([
    "http://localhost:3000",
    "https://api.sequenzy.com",
    "https://sequenzy.com",
  ]);
  const looksSensitive = /(key|secret|token|password)/i.test(key);
  if (looksSensitive && value && !allowedLiteralValues.has(value) && !/^your[_-]/i.test(value)) {
    failures.push(`.env.example line ${index + 1} appears to contain a real secret for ${key}; use an empty placeholder.`);
  }
}

const migrationTransactionBoundary =
  "20260825075255_fix_settings_timezone_conflict_errors.sql";
for (const migration of fs
  .readdirSync(filePath("supabase/migrations"))
  .filter((file) => file.endsWith(".sql") && file > migrationTransactionBoundary)
  .sort()) {
  const sql = read(`supabase/migrations/${migration}`);
  if (migrationRequiresExplicitTransaction(sql)) {
    assert(
      hasExplicitTransaction(sql),
      `${migration} contains a backfill or SET NOT NULL and must start with BEGIN; and end with COMMIT;.`,
    );
  }
}

const unsafeMigrationFixture = read(
  "tests/fixtures/governance/migration-backfill-without-transaction.sql.txt",
);
assert(
  migrationRequiresExplicitTransaction(unsafeMigrationFixture) &&
    !hasExplicitTransaction(unsafeMigrationFixture),
  "The migration transaction negative fixture must remain an unsafe backfill without BEGIN/COMMIT.",
);

const requiredAppRoutes = [
  "app/(app)/timeline/page.tsx",
  "app/(app)/behaviors/page.tsx",
  "app/(app)/analytics/page.tsx",
  "app/(app)/export/page.tsx",
  "app/(app)/settings/page.tsx",
];

for (const route of requiredAppRoutes) {
  assert(exists(route), `Required app route is missing: ${route}`);
}

const forbiddenDashboardPaths = [
  "app/dashboard/page.tsx",
  "app/(app)/dashboard/page.tsx",
];
for (const route of forbiddenDashboardPaths) {
  assert(!exists(route), `Forbidden dashboard route exists: ${route}`);
}
assert(!read("lib/navigation.ts").includes("/dashboard"), "Navigation must not include /dashboard.");

const docsMustMentionChecks = [
  ["docs/SUPABASE_WORKFLOW.md", "supabase db push"],
  ["docs/SUPABASE_WORKFLOW.md", "supabase db reset"],
  ["docs/SUPABASE_WORKFLOW.md", "never change the hosted database directly"],
  ["docs/SEQUENZY_WORKFLOW.md", "npm run sequenzy -- login"],
  ["docs/SEQUENZY_WORKFLOW.md", "npm run sequenzy -- whoami"],
  ["docs/DATETIME_STRATEGY.md", "Temporal"],
  ["docs/ROUTE_MAP.md", "/timeline"],
  ["docs/OPERATIONS.md", "npm run agents:check"],
  ["docs/OPERATIONS.md", "npm run interactions:check"],
];
for (const [file, snippet] of docsMustMentionChecks) {
  assert(read(file).toLowerCase().includes(snippet.toLowerCase()), `${file} must mention ${snippet}.`);
}

const interactionCheck = spawnSync(
  process.execPath,
  [filePath("scripts/check-interactions.mjs")],
  {
    cwd: root,
    encoding: "utf8",
  },
);
assert(
  interactionCheck.status === 0,
  `Interaction registry validation failed:\n${(
    interactionCheck.stderr || interactionCheck.stdout || "Unknown error"
  ).trim()}`,
);

const coreCheck = spawnSync(process.execPath, [filePath("scripts/check-core-portability.mjs")], {
  cwd: root, encoding: "utf8",
});
assert(coreCheck.status === 0, `Core portability validation failed:\n${(
  coreCheck.stderr || coreCheck.stdout || "Unknown error"
).trim()}`);

const desktopDependencies = spawnSync(process.execPath, [filePath("scripts/check-desktop-dependencies.mjs")], {
  cwd: root, encoding: "utf8",
});
assert(desktopDependencies.status === 0, `Desktop dependency validation failed:\n${(
  desktopDependencies.stderr || desktopDependencies.stdout || "Unknown error"
).trim()}`);

const loadInteractionCheck = spawnSync(
  process.execPath,
  [filePath("scripts/check-load-test-interactions.mjs")],
  {
    cwd: root,
    encoding: "utf8",
  },
);
assert(
  loadInteractionCheck.status === 0,
  `Load interaction manifest validation failed:\n${(
    loadInteractionCheck.stderr ||
    loadInteractionCheck.stdout ||
    "Unknown error"
  ).trim()}`,
);

if (!exists("supabase/config.toml")) {
  notes.push("Supabase project has not been initialized yet; run `npm run supabase -- init` during the Supabase ticket before creating migrations.");
}

if (failures.length > 0) {
  console.error(`agents:check failed with ${failures.length} issue(s):`);
  for (const failure of failures) console.error(`- ${failure}`);
  if (notes.length > 0) {
    console.error("Notes:");
    for (const note of notes) console.error(`- ${note}`);
  }
  process.exit(1);
}

console.log("agents:check passed (repository contracts checked).");
for (const note of notes) console.log(`note: ${note}`);
