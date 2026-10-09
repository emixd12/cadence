import fs from "node:fs";
import path from "node:path";

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
        if (["node_modules", ".git", ".next", ".supabase"].includes(child)) continue;
        stack.push(path.join(current, child));
      }
    } else {
      results.push(path.relative(root, current));
    }
  }
  return results.sort();
}

const resolverRegistry = [
  { domain: "historical completion timing", resolver: "packages/core/src/resolvers/completion-timing.resolver.ts", test: "tests/completion-timing.resolver.test.ts", source: "docs/DATETIME_STRATEGY.md" },
  { domain: "briefing planner", resolver: "packages/core/src/resolvers/briefing-plan.resolver.ts", test: "tests/briefing-plan.resolver.test.ts", source: "docs/TICKETS.md" },
  { domain: "briefing analysis lanes", resolver: "packages/core/src/resolvers/briefing-analysis.resolver.ts", test: "tests/briefing-analysis.resolver.test.ts", source: "docs/TICKETS.md" },
  {
    domain: "day-progress layout",
    resolver: "packages/core/src/resolvers/day-progress.resolver.ts",
    test: "tests/day-progress.resolver.test.ts",
    source: "docs/UI_SPEC.md",
  },
  {
    domain: "timeline duration and external context",
    resolver: "packages/core/src/resolvers/timeline-context.resolver.ts",
    test: "tests/timeline-context.resolver.test.ts",
    source: "docs/PRODUCT_SPEC.md",
  },
  {
    domain: "travel itinerary and occupancy",
    resolver: "packages/core/src/resolvers/travel.resolver.ts",
    test: "tests/travel.resolver.test.ts",
    source: "docs/TICKETS.md",
  },
  {
    domain: "Note shortcuts",
    resolver: "packages/core/src/resolvers/note-suggestion.resolver.ts",
    test: "tests/note-suggestion.resolver.test.ts",
    source: "docs/PRODUCT_SPEC.md",
  },
  {
    domain: "recurrence",
    resolver: "packages/core/src/resolvers/recurrence.resolver.ts",
    compatibility: "lib/resolvers/recurrence.resolver.ts",
    test: "tests/recurrence.resolver.test.ts",
    source: "docs/RECURRENCE_RULES.md",
  },
  {
    domain: "occurrence",
    resolver: "packages/core/src/resolvers/occurrence.resolver.ts",
    compatibility: "lib/resolvers/occurrence.resolver.ts",
    test: "tests/occurrence.resolver.test.ts",
    source: "docs/DATA_MODEL.md",
  },
  {
    domain: "behavior definition history",
    resolver: "packages/core/src/resolvers/behavior-definition.resolver.ts",
    compatibility: "lib/resolvers/behavior-definition.resolver.ts",
    test: "tests/behavior-definition.resolver.test.ts",
    source: "docs/DATA_MODEL.md",
  },
  {
    domain: "timeline",
    resolver: "packages/core/src/resolvers/timeline.resolver.ts",
    compatibility: "lib/resolvers/timeline.resolver.ts",
    test: "tests/timeline.resolver.test.ts",
    source: "docs/UI_SPEC.md",
  },
  {
    domain: "behavior configuration history",
    resolver: "packages/core/src/resolvers/behavior-configuration.resolver.ts",
    compatibility: "lib/resolvers/behavior-configuration.resolver.ts",
    test: "tests/behavior-configuration.resolver.test.ts",
    source: "docs/DATA_MODEL.md",
  },
  {
    domain: "optimistic timeline status",
    resolver: "packages/core/src/resolvers/timeline-optimistic-status.resolver.ts",
    compatibility: "lib/resolvers/timeline-optimistic-status.resolver.ts",
    test: "tests/timeline-optimistic-status.test.ts",
    source: "docs/UI_SPEC.md",
  },
  {
    domain: "occurrence time tracking",
    resolver: "packages/core/src/resolvers/time-tracking.resolver.ts",
    compatibility: "lib/resolvers/time-tracking.resolver.ts",
    test: "tests/time-tracking.resolver.test.ts",
    source: "docs/DATA_MODEL.md",
  },
  {
    domain: "status",
    resolver: "packages/core/src/resolvers/status.resolver.ts",
    compatibility: "lib/resolvers/status.resolver.ts",
    test: "tests/status.resolver.test.ts",
    source: "docs/USER_FLOWS.md",
  },
  {
    domain: "reminder",
    resolver: "packages/core/src/resolvers/reminder.resolver.ts",
    compatibility: "lib/resolvers/reminder.resolver.ts",
    test: "tests/reminder.resolver.test.ts",
    source: "docs/NOTIFICATION_SPEC.md",
  },
  {
    domain: "native reminder coverage",
    resolver: "packages/core/src/resolvers/native-reminder.resolver.ts",
    compatibility: "lib/resolvers/native-reminder.resolver.ts",
    test: "tests/native-reminder.resolver.test.ts",
    source: "docs/DESKTOP_BUILD.md",
  },
  {
    domain: "archive notes",
    resolver: "packages/core/src/resolvers/archive-note.resolver.ts",
    test: "tests/archive-note.resolver.test.ts",
    source: "docs/DATA_MODEL.md",
  },
  {
    domain: "desktop account synchronization",
    resolver: "packages/core/src/resolvers/account-sync.resolver.ts",
    test: "tests/account-sync.resolver.test.ts",
    source: "docs/DESKTOP_BUILD.md",
  },
  {
    domain: "analytics",
    resolver: "packages/core/src/resolvers/analytics.resolver.ts",
    compatibility: "lib/resolvers/analytics.resolver.ts",
    test: "tests/analytics.resolver.test.ts",
    source: "docs/UI_SPEC.md",
  },
  {
    domain: "export",
    resolver: "packages/core/src/resolvers/export.resolver.ts",
    compatibility: "lib/resolvers/export.resolver.ts",
    test: "tests/export.resolver.test.ts",
    source: "docs/EXPORT_FORMATS.md",
  },
  {
    domain: "behaviorlog import",
    resolver: "packages/core/src/resolvers/behaviorlog-import.resolver.ts",
    compatibility: "lib/resolvers/behaviorlog-import.resolver.ts",
    test: "tests/behaviorlog-import.resolver.test.ts",
    source: "docs/EXPORT_FORMATS.md",
  },
  {
    domain: "behaviorlog restore preview",
    resolver: "packages/core/src/resolvers/behaviorlog-restore.resolver.ts",
    compatibility: "lib/resolvers/behaviorlog-restore.resolver.ts",
    test: "tests/behaviorlog-restore.resolver.test.ts",
    source: "docs/EXPORT_FORMATS.md",
  },
  {
    domain: "imported intervention promotion",
    resolver: "packages/core/src/resolvers/imported-intervention-promotion.resolver.ts",
    compatibility: "lib/resolvers/imported-intervention-promotion.resolver.ts",
    test: "tests/imported-intervention-promotion.test.ts",
    source: "docs/NOTIFICATION_SPEC.md",
  },
  {
    domain: "public trust evidence",
    resolver: "lib/resolvers/public-trust-evidence.resolver.ts",
    test: "tests/public-trust-evidence.resolver.test.ts",
    source: "schemas/public-trust-evidence.schema.json",
  },
];

const guide = read("docs/AGENT_RESOLVERS.md");
for (const snippet of ["Owner resolver", "Allowed callers", "Forbidden bypasses", "Required test", "Drift check", "npm run resolvers:check"]) {
  assert(guide.includes(snippet), `docs/AGENT_RESOLVERS.md is missing registry column/section: ${snippet}`);
}

for (const entry of resolverRegistry) {
  assert(guide.includes(entry.resolver), `Resolver registry must mention ${entry.resolver}.`);
  assert(guide.includes(entry.test), `Resolver registry must mention ${entry.test}.`);
  assert(guide.includes(entry.source), `Resolver registry must mention ${entry.source}.`);
  if (entry.compatibility) {
    const moduleName = path.basename(entry.resolver, ".ts");
    assert(
      read(entry.compatibility).trim() === `export * from "@cadence/core/resolvers/${moduleName}";`,
      `${entry.compatibility} must remain a compatibility export for ${entry.resolver}.`,
    );
  }

  if (exists(entry.resolver)) {
    assert(exists(entry.test), `${entry.resolver} exists but paired test is missing: ${entry.test}`);
    const content = read(entry.resolver);
    const forbiddenPatterns = [
      [/@supabase\/supabase-js/, "direct Supabase client import"],
      [/from ["']react["']|from ["']next\//, "React or Next import"],
      [/\b(window|document|navigator|localStorage|Notification)\b/, "browser global"],
      [/\bfetch\s*\(/, "network fetch"],
      [/\b(sequenzy|web-push|nodemailer)\b/i, "email/push provider"],
      [/process\.env/, "environment access"],
    ];
    for (const [pattern, label] of forbiddenPatterns) {
      assert(!pattern.test(content), `${entry.resolver} must not use ${label}; move orchestration to services/repositories.`);
    }
  } else {
    failures.push(`Missing required resolver implementation: ${entry.resolver}.`);
  }
}

for (const file of walk("packages/core/src/resolvers")) {
  assert(resolverRegistry.some((entry) => entry.resolver === file), `${file} needs a registry entry and paired test.`);
}

const occurrenceResolver = read("packages/core/src/resolvers/occurrence.resolver.ts");
const occurrenceService = read("lib/services/occurrence.service.ts");
assert(
  occurrenceResolver.includes("export function normalizeOccurrenceScheduleGraph"),
  "Occurrence resolver must own typed schedule-graph normalization.",
);
assert(
  occurrenceResolver.includes("export function planOccurrenceRepair"),
  "Occurrence resolver must own explicit missing-occurrence repair planning.",
);
assert(
  occurrenceService.includes('normalization.status !== "valid"'),
  "Occurrence service must reject non-valid active schedule graphs.",
);
assert(
  !occurrenceService.includes(
    ".filter((schedule) => schedule.timeEntries.length > 0)",
  ),
  "Occurrence service must not filter empty schedules into a successful no-op.",
);

for (const file of walk("app")) {
  if (!file.endsWith(".ts") && !file.endsWith(".tsx")) continue;
  assert(!file.includes("dashboard"), `Forbidden dashboard route/file exists: ${file}`);
}
assert(!read("lib/navigation.ts").includes("/dashboard"), "Navigation must not include /dashboard.");

const uiAndRouteFiles = [...walk("app"), ...walk("components")].filter(
  (file) => file.endsWith(".ts") || file.endsWith(".tsx"),
);
const directSupabaseWritePattern = /\.(?:rpc|upsert)\s*\(/;

for (const file of uiAndRouteFiles) {
  assert(
    !directSupabaseWritePattern.test(read(file)),
    `${file} calls Supabase .rpc() or .upsert() directly; UI and route callers must use a service/repository boundary.`,
  );
}

for (const fixture of [
  "tests/fixtures/governance/resolver-direct-rpc.txt",
  "tests/fixtures/governance/resolver-direct-upsert.txt",
]) {
  assert(
    directSupabaseWritePattern.test(read(fixture)),
    `${fixture} must remain a negative fixture for direct Supabase caller bypasses.`,
  );
}
const suspiciousBusinessTerms = [
  "intervalDays",
  "dayOfMonth",
  "reminder_offset_minutes",
  "scheduled_send_at",
  "status === \"unresolved\"",
];
for (const file of uiAndRouteFiles) {
  const content = read(file);
  for (const term of suspiciousBusinessTerms) {
    if (content.includes(term)) {
      failures.push(`${file} contains business-logic term '${term}'. If intentional, move calculation to a resolver/service and keep UI/API thin.`);
    }
  }
}

if (exists("app/api")) {
  for (const file of walk("app/api")) {
    if (!file.endsWith("route.ts") && !file.endsWith("route.tsx")) continue;
    const content = read(file);
    const doesNontrivialWork = /insert\(|update\(|delete\(|select\(|\.rpc\s*\(|\.upsert\s*\(|transactional\.send|webpush|for \(|while \(/.test(content);
    if (doesNontrivialWork) {
      assert(/from ["']@?\/?lib\/services|from ["']@\/lib\/services/.test(content), `${file} appears to perform orchestration; API routes must call services.`);
    }
  }
}

const dateStrategy = read("docs/DATETIME_STRATEGY.md");
for (const snippet of ["Temporal", "America/New_York", "local_date", "timestamptz", "now is injected"]) {
  assert(dateStrategy.includes(snippet), `docs/DATETIME_STRATEGY.md must lock ${snippet}.`);
}

if (failures.length > 0) {
  console.error(`resolvers:check failed with ${failures.length} issue(s):`);
  for (const failure of failures) console.error(`- ${failure}`);
  if (notes.length > 0) {
    console.error("Notes:");
    for (const note of notes) console.error(`- ${note}`);
  }
  process.exit(1);
}

console.log("resolvers:check passed (resolver modules and caller boundaries checked).");
for (const note of notes) console.log(`note: ${note}`);
