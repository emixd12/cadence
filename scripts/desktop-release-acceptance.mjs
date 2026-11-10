import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import path from "node:path";

const arguments_ = process.argv.slice(2);
const sameSchema = arguments_[0] === "--same-schema";
if (sameSchema) arguments_.shift();
const [appPath, beforePath, afterPath, ...extraPaths] = arguments_;
if (!appPath || !beforePath || !afterPath) {
  throw new Error("Usage: desktop-release-acceptance.mjs [--same-schema] <Cadence.app> <protected-before.sqlite3> <after.sqlite3>");
}
const expectedSchemaVersion = Number(process.env.CADENCE_DESKTOP_RELEASE_EXPECTED_SCHEMA_VERSION);
if (!Number.isSafeInteger(expectedSchemaVersion) || expectedSchemaVersion < 1) {
  throw new Error("CADENCE_DESKTOP_RELEASE_EXPECTED_SCHEMA_VERSION must name the expected positive schema version.");
}
let secretCanaries;
try { secretCanaries = JSON.parse(process.env.CADENCE_DESKTOP_RELEASE_SECRET_CANARIES ?? ""); }
catch { throw new Error("CADENCE_DESKTOP_RELEASE_SECRET_CANARIES must be a JSON array."); }
if (!Array.isArray(secretCanaries) || !secretCanaries.length || secretCanaries.some((value) => typeof value !== "string" || value.length < 16)) {
  throw new Error("CADENCE_DESKTOP_RELEASE_SECRET_CANARIES must contain one or more exact secret canaries of at least 16 characters.");
}
const commandEnvironment = Object.fromEntries(Object.entries(process.env)
  .filter(([key]) => key !== "CADENCE_DESKTOP_RELEASE_SECRET_CANARIES"));

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const sql = (database, statement) => JSON.parse(execFileSync("sqlite3", ["-readonly", "-json", database, statement], { encoding: "utf8", env: commandEnvironment, maxBuffer: 128 * 1024 * 1024 }) || "[]");
const identifier = (value) => `"${value.replaceAll('"', '""')}"`;
const tables = [
  "profiles", "categories", "behaviors", "behavior_definition_events",
  "behavior_configuration_events", "behavior_revisions", "behavior_schedules",
  "behavior_schedule_slots", "occurrences", "occurrence_status_events",
  "imported_notes", "imported_interventions", "occurrence_time_sessions",
  "behaviorlog_import_runs", "behaviorlog_import_record_mappings", "mutation_outbox",
  "tombstones", "sync_cursors", "reminder_deliveries", "native_reminder_state",
  "native_reminder_coverage", "account_link_metadata", "account_sync_baselines",
  "account_first_link_attempts",
];

// Launch/reconnection bookkeeping may change. Identities and retained domain content may not.
const bookkeepingColumns = {
  account_link_metadata: ["email", "authenticated_at"],
  local_data_revision: ["revision"],
  native_reminder_state: ["status", "error", "verified_at", "updated_at"],
  native_reminder_coverage: ["status", "target_through", "scheduled_through", "first_unscheduled_at", "expected_count", "scheduled_count", "missing_ids", "reason", "verified_at", "updated_at", "dataset_revision"],
  occurrence_sync_state: ["last_successful_sync_at", "last_sync_behavior_count", "last_sync_created_count", "last_sync_deleted_count", "last_sync_updated_count", "last_synced_local_date", "stale", "stale_reason", "state_version", "synced_through_local_date", "updated_at"],
};
const reminderReceiptOperations = ["commitNativeReminderPlan", "recordNativeReminderCoverage"];
// A launch sync may rewrite these rows only. A before row that no longer matches exactly is accepted
// when it is `changeable`, and an unused after row that is `syncShaped` matches it with `columns` ignored.
const launchSyncRules = {
  // complete_account_sync (auth.rs) replaces the baseline; identity, choice, and backup path stay.
  account_sync_baselines: {
    columns: ["idempotency_key", "local_fingerprint", "hosted_fingerprint", "baseline_fingerprint", "baseline_json", "completed_at"],
    changeable: "1",
    syncShaped: `typeof(baseline_fingerprint)='text' AND length(baseline_fingerprint)=64
      AND local_fingerprint IS baseline_fingerprint AND hosted_fingerprint IS baseline_fingerprint
      AND typeof(idempotency_key)='text' AND length(idempotency_key)=64
      AND json_valid(baseline_json) AND typeof(completed_at)='text' AND length(completed_at)>0`,
  },
  // The same transaction advances only the account-sync cursor to the new baseline.
  sync_cursors: {
    columns: ["value", "updated_at"],
    requires: { account_sync_baselines: ["local_profile_id", "baseline_fingerprint", "completed_at"] },
    changeable: "name='account-sync'",
    syncShaped: `name='account-sync' AND EXISTS(SELECT 1 FROM account_sync_baselines baseline
      WHERE baseline.local_profile_id=sync_cursors.user_id
      AND baseline.baseline_fingerprint IS sync_cursors.value AND baseline.completed_at IS sync_cursors.updated_at)`,
  },
  // Hosted processing moves pending deliveries to sent, failed, or cancelled. Other rows are final here.
  reminder_deliveries: {
    columns: ["status", "error", "sent_at", "processing_started_at", "updated_at"],
    changeable: "status='pending'",
    syncShaped: "status IN ('pending','sent','failed','cancelled')",
  },
};

function databaseEvidence(database) {
  const schema = sql(database, "SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT GLOB 'sqlite_*' ORDER BY type,name");
  const names = new Set(schema.filter(({ type }) => type === "table").map(({ name }) => name));
  const checkedTables = sameSchema ? [...names].sort() : tables.filter((table) => names.has(table));
  const counts = Object.fromEntries(checkedTables.map((table) => [table, sql(database, `SELECT count(*) AS count FROM ${identifier(table)}`)[0].count]));
  const rowHashes = Object.create(null), preservedContent = Object.create(null);
  if (sameSchema) for (const table of checkedTables) {
    const allColumns = sql(database, `PRAGMA table_xinfo(${identifier(table)})`).map(({ name }) => name);
    const excludedColumns = allColumns.filter((column) => Object.hasOwn(bookkeepingColumns, table) && bookkeepingColumns[table].includes(column));
    const columns = allColumns.filter((column) => !excludedColumns.includes(column));
    // Native reconciliation replaces only these completed hash/revision receipts, never pending or domain mutations.
    const receiptPredicate = table === "mutation_outbox" && ["sequence", "mutation_id", "user_id", "operation", "request_json", "result_json", "created_at", "synced_at"].every((column) => allColumns.includes(column))
      ? `operation IN ('commitNativeReminderPlan','recordNativeReminderCoverage')
        AND typeof(sequence)='integer' AND sequence>0
        AND typeof(request_json)='text' AND length(request_json)=66
        AND request_json=json_quote(substr(request_json,2,64))
        AND substr(request_json,2,64) NOT GLOB '*[^0-9a-f]*'
        AND result_json=json_object('revision',sequence)
        AND typeof(created_at)='text' AND length(created_at)>0 AND synced_at=created_at`
      : undefined;
    const excludedReceipts = Object.fromEntries(reminderReceiptOperations.map((operation) => [operation, 0]));
    if (receiptPredicate) for (const { operation, count } of sql(database, `SELECT operation,count(*) AS count FROM mutation_outbox WHERE ${receiptPredicate} GROUP BY operation`)) excludedReceipts[operation] = count;
    const rule = Object.hasOwn(launchSyncRules, table) ? launchSyncRules[table] : undefined;
    const ruleApplies = rule && rule.columns.every((column) => columns.includes(column))
      && Object.entries(rule.requires ?? {}).every(([required, requiredColumns]) => names.has(required)
        && requiredColumns.every((column) => sql(database, `PRAGMA table_xinfo(${identifier(required)})`).some(({ name }) => name === column)));
    // Encode types, NUL-containing text, blobs, full-width integers, and exact floating-point values without printing data.
    const projection = columns.flatMap((column, index) => {
      const name = identifier(column);
      return [`typeof(${name}) AS type_${index}`, `CASE typeof(${name}) WHEN 'real' THEN printf('%!.26g',${name}) ELSE hex(CAST(${name} AS BLOB)) END AS value_${index}`];
    }).concat(ruleApplies ? [`coalesce((${rule.changeable}),0) AS rule_changeable`, `coalesce((${rule.syncShaped}),0) AS rule_sync_shaped`] : []).join(",");
    const ruleIndexes = ruleApplies ? rule.columns.map((column) => columns.indexOf(column)) : [];
    rowHashes[table] = sql(database, `SELECT ${projection} FROM ${identifier(table)}${receiptPredicate ? ` WHERE NOT coalesce((${receiptPredicate}),0)` : ""}`).map(({ rule_changeable, rule_sync_shaped, ...row }) => ({
      hash: sha256(JSON.stringify(row)),
      ...(ruleApplies ? {
        retainedHash: sha256(JSON.stringify(Object.fromEntries(Object.entries(row).filter(([key]) => !ruleIndexes.includes(Number(key.split("_")[1])))))),
        changeable: rule_changeable === 1, syncShaped: rule_sync_shaped === 1,
      } : {}),
    })).sort((left, right) => left.hash < right.hash ? -1 : left.hash > right.hash ? 1 : 0);
    preservedContent[table] = { columns, excludedColumns, sha256: sha256(JSON.stringify(rowHashes[table].map(({ hash }) => hash))),
      ...(table === "mutation_outbox" ? { excludedReceipts } : {}),
      ...(ruleApplies ? { launchSync: { columns: rule.columns,
        changeableRows: rowHashes[table].filter(({ changeable }) => changeable).length,
        syncShapedRows: rowHashes[table].filter(({ syncShaped }) => syncShaped).length } } : {}) };
  }
  const profileIds = sql(database, "SELECT id FROM profiles ORDER BY id").map(({ id }) => id);
  return { rowHashes, evidence: {
    path: realpathSync(database),
    mode: (lstatSync(database).mode & 0o777).toString(8).padStart(3, "0"),
    sha256: sha256(readFileSync(database)),
    integrity: sql(database, "PRAGMA integrity_check")[0].integrity_check,
    foreignKeyErrors: sql(database, "PRAGMA foreign_key_check").length,
    schemaVersion: sql(database, "SELECT coalesce(max(version),0) AS version FROM schema_migrations")[0].version,
    profileIdentitySha256: sha256(profileIds.join("\n")),
    counts,
    ...(sameSchema ? { schemaSha256: sha256(JSON.stringify(schema)), preservedContent } : {}),
  } };
}

function files(root) {
  const output = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const file = path.join(root, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) output.push(...files(file));
    else if (entry.isFile()) output.push(file);
  }
  return output;
}

function secretFindings(paths) {
  const findings = [];
  const jwt = /eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g;
  const serviceKey = /\b(?:sb_secret_|sbp_)[A-Za-z0-9_-]{16,}/g;
  for (const file of paths) {
    const buffers = [readFileSync(file)];
    if (file.endsWith(".zip")) buffers.push(execFileSync("unzip", ["-p", file], { maxBuffer: 128 * 1024 * 1024, env: commandEnvironment }));
    for (const buffer of buffers) {
      const text = buffer.toString("latin1");
      if (serviceKey.test(text)) findings.push({ file, role: "service_role_key" });
      serviceKey.lastIndex = 0;
      for (const token of text.match(jwt) ?? []) {
        try {
          const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
          if (["authenticated", "service_role"].includes(payload.role)) findings.push({ file, role: payload.role });
        } catch { /* Non-JWT binary coincidence. */ }
      }
      for (const canary of secretCanaries) {
        if (buffer.includes(Buffer.from(canary))) findings.push({ file, role: "exact_secret_canary" });
      }
    }
  }
  return findings;
}

const { evidence: before, rowHashes: beforeRows } = databaseEvidence(beforePath);
const { evidence: after, rowHashes: afterRows } = databaseEvidence(afterPath);
if (before.integrity !== "ok" || after.integrity !== "ok" || before.foreignKeyErrors || after.foreignKeyErrors) throw new Error("A database failed integrity validation.");
if (before.mode !== "600" || after.mode !== "600") throw new Error("Release databases must use owner-only mode 0600.");
if (sameSchema) {
  if (before.schemaVersion !== expectedSchemaVersion || after.schemaVersion !== expectedSchemaVersion || before.schemaSha256 !== after.schemaSha256) throw new Error("The same-schema release must preserve the expected schema version and schema.");
} else if (after.schemaVersion <= before.schemaVersion || after.schemaVersion !== expectedSchemaVersion) throw new Error("The release database did not advance to the expected schema version.");
if (before.profileIdentitySha256 !== after.profileIdentitySha256) throw new Error("The stable local profile changed across migration.");
const launchSyncChanges = Object.create(null);
for (const [table, count] of Object.entries(before.counts)) {
  if ((after.counts[table] ?? -1) < count) throw new Error(`${table} lost records across ${sameSchema ? "release" : "migration"}.`);
  if (sameSchema) {
    const remaining = new Map();
    for (const { hash } of afterRows[table]) remaining.set(hash, (remaining.get(hash) ?? 0) + 1);
    const changed = [];
    for (const row of beforeRows[table]) {
      if (remaining.get(row.hash)) remaining.set(row.hash, remaining.get(row.hash) - 1);
      else if (row.changeable) changed.push(row);
      else throw new Error(`${table} lost or changed retained content across release.`);
    }
    if (!changed.length) continue;
    // Rows with the same full hash are interchangeable, so the unused after rows are any `remaining` copies.
    const candidates = new Map();
    for (const row of afterRows[table]) {
      if (!remaining.get(row.hash)) continue;
      remaining.set(row.hash, remaining.get(row.hash) - 1);
      if (row.syncShaped) candidates.set(row.retainedHash, (candidates.get(row.retainedHash) ?? 0) + 1);
    }
    for (const { retainedHash } of changed) {
      if (!candidates.get(retainedHash)) throw new Error(`${table} lost or changed retained content across release.`);
      candidates.set(retainedHash, candidates.get(retainedHash) - 1);
    }
    launchSyncChanges[table] = changed.length;
  }
}
const additionalFiles = extraPaths.flatMap((entry) => !existsSync(entry) ? [] : lstatSync(entry).isDirectory() ? files(entry) : [entry]);
const scannedFiles = [...new Set([...files(appPath), beforePath, afterPath, ...additionalFiles].map((file) => realpathSync(file)))];
const secretScan = secretFindings(scannedFiles);
const findingsByFile = Object.values(secretScan.reduce((summary, finding) => {
  const key = `${finding.file}\0${finding.role}`;
  summary[key] ??= { file: finding.file, role: finding.role, count: 0 };
  summary[key].count += 1;
  return summary;
}, {}));
const scopeFiles = (entry) => !existsSync(entry) ? 0 : lstatSync(entry).isDirectory() ? files(entry).length : 1;
const scopePath = (entry) => existsSync(entry) ? realpathSync(entry) : path.resolve(entry);

const plist = path.join(appPath, "Contents", "Info.plist");
const plistValue = (key) => execFileSync("/usr/libexec/PlistBuddy", ["-c", `Print :${key}`, plist], { encoding: "utf8", env: commandEnvironment }).trim();
const exactSecretCanaryFindings = secretScan.filter(({ role }) => role === "exact_secret_canary").length;
process.stdout.write(`${JSON.stringify({
  capturedAt: new Date().toISOString(),
  acceptanceMode: sameSchema ? "same_schema" : "migration",
  system: { productVersion: execFileSync("sw_vers", ["-productVersion"], { encoding: "utf8", env: commandEnvironment }).trim(), buildVersion: execFileSync("sw_vers", ["-buildVersion"], { encoding: "utf8", env: commandEnvironment }).trim(), architecture: execFileSync("uname", ["-m"], { encoding: "utf8", env: commandEnvironment }).trim() },
  app: { path: realpathSync(appPath), identifier: plistValue("CFBundleIdentifier"), version: plistValue("CFBundleShortVersionString"), sha256: sha256(readFileSync(path.join(appPath, "Contents", "MacOS", plistValue("CFBundleExecutable")))) },
  before, after,
  ...(sameSchema ? { launchSyncChanges } : {}),
  secretScan: {
    scannedFiles: scannedFiles.length,
    scopes: [appPath, beforePath, afterPath, ...extraPaths].map((entry) => ({ path: scopePath(entry), files: scopeFiles(entry), exists: existsSync(entry) })),
    authenticatedSessionOrServiceRoleFindings: secretScan.length - exactSecretCanaryFindings,
    exactSecretCanaryFindings,
    totalFindings: secretScan.length,
    exactCanariesChecked: secretCanaries.length,
    findingsByFile,
  },
}, null, 2)}\n`);
if (secretScan.length) process.exitCode = 1;
