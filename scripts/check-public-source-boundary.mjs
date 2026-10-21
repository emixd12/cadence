import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const PROJECT_ROOT = fileURLToPath(new URL("..", import.meta.url));

export const SERVER_ONLY_ENV_NAMES = [
  "AGENTMAIL_API_KEY",
  "CADENCE_ACCOUNT_DELETION_FAILURE_CANARY_USER_ID",
  "CRON_SECRET",
  "DATABASE_URL",
  "REMINDER_PROCESS_SECRET",
  "SEQUENZY_API_KEY",
  "SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET",
  "SUPABASE_SERVICE_ROLE_KEY",
  "VAPID_PRIVATE_KEY",
  "VERCEL_OIDC_TOKEN",
  "VERCEL_TOKEN",
];

const DIRECT_PATTERNS = [
  ["supabase", /\bsb_secret_[A-Za-z0-9_-]{20,}\b/g],
  ["google", /\bGOCSPX-[A-Za-z0-9_-]{16,}\b/g],
  ["vercel", /\bvercel_[A-Za-z0-9_-]{24,}\b/g],
  ["private_key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
  ["database", /postgres(?:ql)?:\/\/[^\s:'"/]+:([^\s@'"/]{12,})@/g],
  ["session", /\bsb-[a-z0-9]+-auth-token(?:\.\d+)?[=:][^\s'";]{20,}/gi],
];

const ASSIGNMENT_CATEGORIES = new Map([
  ["AGENTMAIL_API_KEY", "agentmail"],
  ["CADENCE_ACCOUNT_DELETION_FAILURE_CANARY_USER_ID", "supabase"],
  ["CRON_SECRET", "process"],
  ["DATABASE_URL", "database"],
  ["GOOGLE_CLIENT_SECRET", "google"],
  ["GOOGLE_OAUTH_CLIENT_SECRET", "google"],
  ["REMINDER_PROCESS_SECRET", "process"],
  ["SEQUENZY_API_KEY", "sequenzy"],
  ["SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET", "google"],
  ["SUPABASE_SERVICE_ROLE_KEY", "supabase"],
  ["VAPID_PRIVATE_KEY", "vapid"],
  ["VERCEL_OIDC_TOKEN", "vercel"],
  ["VERCEL_TOKEN", "vercel"],
]);

const ASSIGNMENT_PATTERN = new RegExp(
  `\\b(${[...ASSIGNMENT_CATEGORIES.keys()].join("|")})[ \\t]*(?:=|:)[ \\t]*[\"'\\x60]?([^\\s\"'\\x60,;]{12,})`,
  "gi",
);

const TEXT_EXTENSIONS = new Set([
  "",
  ".cjs",
  ".css",
  ".csv",
  ".html",
  ".js",
  ".json",
  ".jsonl",
  ".jsx",
  ".md",
  ".mjs",
  ".sql",
  ".svg",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".xml",
  ".yaml",
  ".yml",
]);

function isSyntheticCandidate(value) {
  const normalized = value
    .replace(/^[({[]+/, "")
    .replace(/[)}\]]+$/, "")
    .toLowerCase();

  return (
    normalized.startsWith("process.env.") ||
    normalized.startsWith("import.meta.env.") ||
    normalized.startsWith("$") ||
    normalized.startsWith("<") ||
    /(?:^|[-_])(canary|dummy|example|fake|fixture|placeholder|synthetic|test)(?:[-_]|$)/.test(
      normalized,
    ) ||
    /^[a-z_$][a-z0-9_$.[\]()]*$/i.test(normalized) ||
    /^(?:canary|dummy|example|fake|local|not-a-real|placeholder|redacted|service|synthetic|test)(?:[-_].*)?$/.test(
      normalized,
    )
  );
}

function isCredentialShapedCandidate(value) {
  const groups = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((pattern) =>
    pattern.test(value),
  ).length;
  return value.length >= 16 && groups >= 3;
}

function hasServiceRoleJwt(text) {
  const jwtPattern = /\beyJ[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/g;

  for (const match of text.matchAll(jwtPattern)) {
    try {
      const payload = JSON.parse(
        Buffer.from(match[0].split(".")[1], "base64url").toString("utf8"),
      );

      if (payload?.role === "service_role") {
        return true;
      }
    } catch {
      // Gitleaks covers malformed credential-like tokens. This pass only adds
      // the Cadence-specific Supabase role check.
    }
  }

  return false;
}

export function scanTextForProjectSecrets(text) {
  const findings = new Map();
  const add = (category) => findings.set(category, (findings.get(category) ?? 0) + 1);

  for (const [category, pattern] of DIRECT_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      const candidate = match[1] ?? match[0];
      if (!isSyntheticCandidate(candidate)) {
        add(category);
      }
    }
  }

  ASSIGNMENT_PATTERN.lastIndex = 0;
  for (const match of text.matchAll(ASSIGNMENT_PATTERN)) {
    if (
      !isSyntheticCandidate(match[2]) &&
      isCredentialShapedCandidate(match[2])
    ) {
      add(ASSIGNMENT_CATEGORIES.get(match[1].toUpperCase()));
    }
  }

  if (hasServiceRoleJwt(text)) {
    add("supabase");
  }

  return Object.fromEntries([...findings].sort(([left], [right]) => left.localeCompare(right)));
}

export function scanTextForProjectSecretsWithSyntheticFixtures(text) {
  return scanTextForProjectSecrets(
    text
      .replaceAll("credential-shaped-private-value", "test-private-value")
      .replaceAll("another-private-process-value", "test-process-value")
      .replaceAll("credential-shaped-oauth-value", "test-oauth-value")
      .replaceAll("GOCSPX-abcdefghijklmnopqrstuvwx", "GOCSPX-test-placeholder")
      // Docker-proxy fixture password published in 9508550 before it was renamed.
      .replaceAll("_admin:private@", "_admin:synthetic-fixture-password@"),
  );
}

function mergeFindings(target, source) {
  for (const [category, count] of Object.entries(source)) {
    target[category] = (target[category] ?? 0) + count;
  }
}

function trackedAndUnignoredFiles() {
  const result = spawnSync(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    { cwd: PROJECT_ROOT, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  );

  if (result.status !== 0 || result.error) {
    throw new Error("Unable to enumerate the tracked and unignored worktree.");
  }

  return result.stdout.split("\0").filter(Boolean);
}

function isTextFile(path) {
  if (!TEXT_EXTENSIONS.has(extname(path).toLowerCase())) {
    return false;
  }

  const content = readFileSync(path);
  return !content.subarray(0, 8_192).includes(0);
}

export function scanTrackedAndUnignoredWorktree() {
  const findings = {};
  let checkedFiles = 0;

  for (const path of trackedAndUnignoredFiles()) {
    const absolutePath = join(PROJECT_ROOT, path);
    if (!existsSync(absolutePath) || !statSync(absolutePath).isFile() || !isTextFile(absolutePath)) {
      continue;
    }

    checkedFiles += 1;
    mergeFindings(
      findings,
      scanTextForProjectSecretsWithSyntheticFixtures(
        readFileSync(absolutePath, "utf8"),
      ),
    );
  }

  return { checkedFiles, findings };
}

export function scanAllRefPatchHistory(projectRoot = PROJECT_ROOT) {
  const shallow = spawnSync(
    "git",
    ["rev-parse", "--is-shallow-repository"],
    { cwd: projectRoot, encoding: "utf8" },
  );

  if (shallow.status !== 0 || shallow.error) {
    throw new Error("Unable to verify complete Git history.");
  }

  if (shallow.stdout.trim() !== "false") {
    throw new Error("The public source audit requires complete Git history.");
  }

  const result = spawnSync(
    "git",
    ["log", "--all", "--full-history", "--text", "--no-ext-diff", "--format=fuller", "-p"],
    {
      cwd: projectRoot,
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
    },
  );

  if (result.status !== 0 || result.error) {
    throw new Error("Unable to scan all-ref Git patch history.");
  }

  return scanTextForProjectSecretsWithSyntheticFixtures(result.stdout);
}

function walkFiles(root) {
  if (!existsSync(root)) {
    throw new Error(`Required audit root is missing: ${relative(PROJECT_ROOT, root)}.`);
  }

  const files = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(path));
    } else if (entry.isFile() && isTextFile(path)) {
      files.push(path);
    }
  }
  return files;
}

export function scanClientSourceEnvironmentBoundary() {
  const violations = [];
  const appRoots = ["app", "components", "lib"].map((path) => join(PROJECT_ROOT, path));

  for (const root of appRoots) {
    for (const path of walkFiles(root)) {
      const content = readFileSync(path, "utf8");
      if (!/^\s*["']use client["'];/m.test(content)) {
        continue;
      }
      for (const name of SERVER_ONLY_ENV_NAMES) {
        if (content.includes(name)) {
          violations.push({ surface: "next_client", variable: name });
        }
      }
    }
  }

  for (const root of [join(PROJECT_ROOT, "apps", "marketing", "src"), join(PROJECT_ROOT, "apps", "marketing", "public")]) {
    for (const path of walkFiles(root)) {
      const content = readFileSync(path, "utf8");
      for (const name of SERVER_ONLY_ENV_NAMES) {
        if (content.includes(name)) {
          violations.push({ surface: "marketing", variable: name });
        }
      }
    }
  }

  return violations;
}

export function scanBrowserArtifacts({ roots, serverCanaries, publicCanaries }) {
  const rootFiles = new Map(
    Object.entries(roots).map(([name, root]) => [
      name,
      walkFiles(resolve(PROJECT_ROOT, root)).map((path) => readFileSync(path, "utf8")),
    ]),
  );
  const serverViolations = [];
  const publicViolations = [];
  const missingPublicCanaries = [];
  const publicPlacements = {};

  for (const canary of serverCanaries) {
    for (const [rootName, contents] of rootFiles) {
      if (contents.some((content) => content.includes(canary))) {
        serverViolations.push(rootName);
      }
    }
  }

  for (const { value, allowedRoot } of publicCanaries) {
    publicPlacements[allowedRoot] ??= 0;
    let allowedOccurrences = 0;
    for (const [rootName, contents] of rootFiles) {
      const occurrences = contents.filter((content) => content.includes(value)).length;
      if (rootName === allowedRoot) {
        publicPlacements[allowedRoot] += occurrences;
        allowedOccurrences += occurrences;
      } else if (occurrences > 0) {
        publicViolations.push({ allowedRoot, foundRoot: rootName });
      }
    }
    if (allowedOccurrences === 0) {
      missingPublicCanaries.push(allowedRoot);
    }
  }

  return {
    serverViolations,
    publicViolations,
    missingPublicCanaries,
    publicPlacements,
  };
}

function parseJsonEnvironment(name, fallback) {
  const value = process.env[name];
  if (!value) {
    return fallback;
  }
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(`${name} must contain valid JSON.`);
  }
}

function totalFindings(findings) {
  return Object.values(findings).reduce((total, count) => total + count, 0);
}

function runSourceAudit() {
  const worktree = scanTrackedAndUnignoredWorktree();
  const historyFindings = scanAllRefPatchHistory();
  const clientViolations = scanClientSourceEnvironmentBoundary();
  const summary = {
    tracked_text_files_checked: worktree.checkedFiles,
    worktree_pattern_findings: totalFindings(worktree.findings),
    history_pattern_findings: totalFindings(historyFindings),
    client_environment_violations: clientViolations.length,
  };

  console.log(JSON.stringify(summary));
  if (
    summary.worktree_pattern_findings > 0 ||
    summary.history_pattern_findings > 0 ||
    summary.client_environment_violations > 0
  ) {
    process.exitCode = 1;
  }
}

function runArtifactAudit() {
  const result = scanBrowserArtifacts({
    roots: {
      // Scan the complete immutable Next build output. This is a strict
      // superset of the static browser chunks and generated browser responses.
      next: ".next",
      marketing: "apps/marketing/dist",
    },
    serverCanaries: parseJsonEnvironment("CADENCE_TICKET_098_SERVER_CANARIES", []),
    publicCanaries: parseJsonEnvironment("CADENCE_TICKET_098_PUBLIC_CANARIES", []),
  });
  console.log(
    JSON.stringify({
      server_canary_violations: result.serverViolations.length,
      public_canary_violations: result.publicViolations.length,
      missing_public_canaries: result.missingPublicCanaries.length,
      public_canary_file_placements: result.publicPlacements,
    }),
  );
  if (
    result.serverViolations.length > 0 ||
    result.publicViolations.length > 0 ||
    result.missingPublicCanaries.length > 0
  ) {
    process.exitCode = 1;
  }
}

function main() {
  const mode = process.argv[2] ?? "source";
  if (mode === "source") {
    runSourceAudit();
    return;
  }
  if (mode === "artifacts") {
    runArtifactAudit();
    return;
  }
  throw new Error(`Unknown public-source boundary mode: ${mode}.`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main();
}
