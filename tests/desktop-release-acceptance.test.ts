import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe.skipIf(process.platform !== "darwin")("desktop release acceptance", () => {
  let directory: string;
  let app: string;
  let before: string;
  let after: string;
  const canary = "cadence-release-secret-canary-123";

  beforeEach(() => {
    directory = mkdtempSync(path.join(tmpdir(), "cadence-release-acceptance-"));
    app = path.join(directory, "Cadence.app");
    before = path.join(directory, "before.sqlite3");
    after = path.join(directory, "after.sqlite3");
    mkdirSync(path.join(app, "Contents", "MacOS"), { recursive: true });
    writeFileSync(path.join(app, "Contents", "Info.plist"), '<?xml version="1.0"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>app.cadence.desktop</string><key>CFBundleShortVersionString</key><string>0.1.1-preview.19</string><key>CFBundleExecutable</key><string>cadence</string></dict></plist>');
    writeFileSync(path.join(app, "Contents", "MacOS", "cadence"), "synthetic executable", { mode: 0o755 });
    createDatabase(before, 9);
    createDatabase(after, 10);
  });

  afterEach(() => rmSync(directory, { recursive: true, force: true }));

  function run(overrides: Record<string, string | undefined> = {}, flags: string[] = []) {
    return spawnSync(process.execPath, ["scripts/desktop-release-acceptance.mjs", ...flags, app, before, after], {
      cwd: process.cwd(),
      env: { ...process.env, CADENCE_DESKTOP_RELEASE_EXPECTED_SCHEMA_VERSION: "10", CADENCE_DESKTOP_RELEASE_SECRET_CANARIES: JSON.stringify([canary]), ...overrides },
      encoding: "utf8",
    });
  }

  function sameSchema() {
    return run({ CADENCE_DESKTOP_RELEASE_EXPECTED_SCHEMA_VERSION: "9" }, ["--same-schema"]);
  }

  function preparePreservation() {
    createDatabase(after, 9);
    for (const database of [before, after]) execFileSync("sqlite3", [database, `
      CREATE TABLE occurrences(id TEXT PRIMARY KEY, note TEXT, status TEXT);
      INSERT INTO occurrences VALUES('occurrence-one','Preserved private Note','completed');
      CREATE TABLE account_link_metadata(local_profile_id TEXT PRIMARY KEY,hosted_user_id TEXT,email TEXT,authenticated_at TEXT);
      INSERT INTO account_link_metadata VALUES('stable-profile','same-account','owner@example.test','before');
      CREATE TABLE native_reminder_state(id TEXT PRIMARY KEY,user_id TEXT,occurrence_id TEXT,request_id TEXT,fire_at TEXT,title TEXT,body TEXT,status TEXT,error TEXT,verified_at TEXT,created_at TEXT,updated_at TEXT);
      INSERT INTO native_reminder_state VALUES('reminder-one','stable-profile','occurrence-one','request-one','tomorrow','Behavior','Reminder','planned',NULL,NULL,'before','before');
      CREATE TABLE native_reminder_coverage(user_id TEXT PRIMARY KEY,status TEXT,scheduled_count INTEGER,updated_at TEXT);
      INSERT INTO native_reminder_coverage VALUES('stable-profile','unverified',0,'before');
      CREATE TABLE occurrence_sync_state(user_id TEXT PRIMARY KEY,timezone TEXT,created_at TEXT,state_version INTEGER,updated_at TEXT);
      INSERT INTO occurrence_sync_state VALUES('stable-profile','America/New_York','before',1,'before');
      CREATE TABLE local_data_revision(user_id TEXT PRIMARY KEY,revision INTEGER);
      INSERT INTO local_data_revision VALUES('stable-profile',1);
      ${["mutation_outbox", "sync_cursors", "account_sync_baselines", "account_first_link_attempts", "occurrence_time_sessions", "occurrence_status_events", "behavior_definition_events", "behavior_configuration_events", "imported_notes", "behaviorlog_import_record_mappings", "travel_settings", "note_shortcut_states"].map((table) => `CREATE TABLE ${table}(id TEXT PRIMARY KEY,content TEXT); INSERT INTO ${table} VALUES('retained','original');`).join("\n")}
    `]);
  }

  function prepareReminderReceipts() {
    preparePreservation();
    for (const database of [before, after]) execFileSync("sqlite3", [database, `
      DROP TABLE mutation_outbox;
      CREATE TABLE mutation_outbox(sequence INTEGER PRIMARY KEY AUTOINCREMENT,mutation_id TEXT UNIQUE,user_id TEXT,operation TEXT,request_json TEXT,result_json TEXT,created_at TEXT,synced_at TEXT);
      INSERT INTO mutation_outbox VALUES
        (1,'domain','stable-profile','createBehaviorGraph',json_quote('${"a".repeat(64)}'),json_object('revision',1),'before','before'),
        (2,'unknown','stable-profile','unknownOperation',json_quote('${"a".repeat(64)}'),json_object('revision',2),'before','before'),
        (3,'plan','stable-profile','commitNativeReminderPlan',json_quote('${"a".repeat(64)}'),json_object('revision',3),'before','before'),
        (4,'coverage','stable-profile','recordNativeReminderCoverage',json_quote('${"a".repeat(64)}'),json_object('revision',4),'before','before');
    `]);
  }

  it("requires an advancing expected schema, owner-only databases, and exact secret canaries", () => {
    const accepted = run();
    expect(accepted.status, accepted.stderr).toBe(0);
    expect(JSON.parse(accepted.stdout).secretScan).toMatchObject({ exactCanariesChecked: 1, authenticatedSessionOrServiceRoleFindings: 0,
      exactSecretCanaryFindings: 0, totalFindings: 0 });
    expect(JSON.parse(accepted.stdout).acceptanceMode).toBe("migration");

    const missingCanaries = run({ CADENCE_DESKTOP_RELEASE_SECRET_CANARIES: "" });
    expect(missingCanaries.status).toBe(1);
    expect(missingCanaries.stderr).toContain("CADENCE_DESKTOP_RELEASE_SECRET_CANARIES");

    createDatabase(after, 9);
    const unchanged = run();
    expect(unchanged.status).toBe(1);
    expect(unchanged.stderr).toContain("did not advance to the expected schema version");

    createDatabase(after, 11);
    const unexpectedFinal = run();
    expect(unexpectedFinal.status).toBe(1);
    expect(unexpectedFinal.stderr).toContain("did not advance to the expected schema version");

    createDatabase(after, 10);
    chmodSync(after, 0o644);
    const exposed = run();
    expect(exposed.status).toBe(1);
    expect(exposed.stderr).toContain("owner-only mode 0600");
  }, 15_000);

  it("requires explicit same-schema mode and the exact expected schema", () => {
    createDatabase(after, 9);
    const accepted = sameSchema();
    expect(accepted.status, accepted.stderr).toBe(0);
    expect(JSON.parse(accepted.stdout)).toMatchObject({ acceptanceMode: "same_schema", system: { buildVersion: expect.any(String) } });
    expect(run({ CADENCE_DESKTOP_RELEASE_EXPECTED_SCHEMA_VERSION: "9" }).stderr).toContain("did not advance");
    expect(run({}, ["--same-schema"]).stderr).toContain("preserve the expected schema version and schema");
    createDatabase(after, 10);
    expect(sameSchema().stderr).toContain("preserve the expected schema version and schema");
    createDatabase(after, 8);
    expect(sameSchema().stderr).toContain("preserve the expected schema version and schema");
    createDatabase(after, 9);
    execFileSync("sqlite3", [after, "ALTER TABLE profiles ADD COLUMN unexpected TEXT;"]);
    expect(sameSchema().stderr).toContain("preserve the expected schema version and schema");
    createDatabase(after, 9);
    execFileSync("sqlite3", [after, "CREATE TABLE unexpected(id TEXT);"]);
    expect(sameSchema().stderr).toContain("preserve the expected schema version and schema");
  });

  it("allows new rows and named bookkeeping changes while reporting exclusions without private content", () => {
    preparePreservation();
    execFileSync("sqlite3", [after, `
      INSERT INTO occurrences VALUES('occurrence-two',NULL,'unresolved');
      UPDATE account_link_metadata SET email='updated@example.test',authenticated_at='after';
      UPDATE native_reminder_state SET status='scheduled',error=NULL,verified_at='after',updated_at='after';
      UPDATE native_reminder_coverage SET status='complete',scheduled_count=1,updated_at='after';
      UPDATE occurrence_sync_state SET state_version=2,updated_at='after';
      UPDATE local_data_revision SET revision=2;
    `]);
    const accepted = sameSchema();
    expect(accepted.status, accepted.stderr).toBe(0);
    const evidence = JSON.parse(accepted.stdout);
    expect(evidence.after.counts.occurrences).toBe(2);
    expect(evidence.after.preservedContent.account_link_metadata).toMatchObject({
      columns: ["local_profile_id", "hosted_user_id"], excludedColumns: ["email", "authenticated_at"],
    });
    expect(evidence.before.preservedContent.native_reminder_state.sha256).toBe(evidence.after.preservedContent.native_reminder_state.sha256);
    expect(evidence.after.preservedContent.mutation_outbox).toMatchObject({ columns: ["id", "content"],
      excludedReceipts: { commitNativeReminderPlan: 0, recordNativeReminderCoverage: 0 } });
    expect(accepted.stdout).not.toContain("Preserved private Note");
    expect(accepted.stdout).not.toContain("owner@example.test");
  });

  it("allows completed native receipt replacement and reports exact excluded operation counts", () => {
    prepareReminderReceipts();
    const unchanged = sameSchema();
    expect(unchanged.status, unchanged.stderr).toBe(0);
    const unchangedEvidence = JSON.parse(unchanged.stdout);
    expect(unchangedEvidence.before.counts.mutation_outbox).toBe(4);
    expect(unchangedEvidence.before.preservedContent.mutation_outbox).toEqual(unchangedEvidence.after.preservedContent.mutation_outbox);
    execFileSync("sqlite3", [after, `
      DELETE FROM mutation_outbox WHERE operation IN ('commitNativeReminderPlan','recordNativeReminderCoverage');
      INSERT INTO mutation_outbox VALUES
        (5,'new-plan','stable-profile','commitNativeReminderPlan',json_quote('${"b".repeat(64)}'),json_object('revision',5),'after','after'),
        (6,'new-coverage','stable-profile','recordNativeReminderCoverage',json_quote('${"c".repeat(64)}'),json_object('revision',6),'after','after');
    `]);
    const accepted = sameSchema();
    expect(accepted.status, accepted.stderr).toBe(0);
    const evidence = JSON.parse(accepted.stdout);
    for (const snapshot of [evidence.before, evidence.after]) {
      expect(snapshot.counts.mutation_outbox).toBe(4);
      expect(snapshot.preservedContent.mutation_outbox.excludedReceipts).toEqual({ commitNativeReminderPlan: 1, recordNativeReminderCoverage: 1 });
      expect(snapshot.preservedContent.mutation_outbox.excludedColumns).toEqual([]);
    }
    expect(evidence.before.preservedContent.mutation_outbox.sha256).toBe(evidence.after.preservedContent.mutation_outbox.sha256);
  });

  it.each([
    "UPDATE mutation_outbox SET mutation_id='changed' WHERE sequence=3;",
    "UPDATE mutation_outbox SET synced_at=created_at WHERE sequence=3;",
    "DELETE FROM mutation_outbox WHERE sequence=3; INSERT INTO mutation_outbox SELECT 5,'new-domain',user_id,operation,request_json,result_json,created_at,synced_at FROM mutation_outbox WHERE sequence=1;",
  ])("rejects pending native receipt loss or change (%s)", (change) => {
    prepareReminderReceipts();
    for (const database of [before, after]) execFileSync("sqlite3", [database, "UPDATE mutation_outbox SET synced_at=NULL WHERE sequence=3;"]);
    execFileSync("sqlite3", [after, change]);
    expect(sameSchema().stderr).toContain("mutation_outbox lost or changed retained content");
  });

  it.each([
    "synced_at='different'",
    "created_at='',synced_at=''",
    "request_json='{}'",
    "request_json=json_quote('G' || substr(request_json,2,63))",
    "request_json=request_json || char(0) || 'domain'",
    "result_json=json_object('revision',99)",
    "result_json=json_object('revision',3,'domain','retained')",
  ])("retains malformed matched-operation receipts (%s)", (malformed) => {
    prepareReminderReceipts();
    for (const database of [before, after]) execFileSync("sqlite3", [database, `UPDATE mutation_outbox SET ${malformed} WHERE sequence=3;`]);
    execFileSync("sqlite3", [after, "UPDATE mutation_outbox SET mutation_id='changed' WHERE sequence=3;"]);
    expect(sameSchema().stderr).toContain("mutation_outbox lost or changed retained content");
  });

  it.each([1, 2])("rejects domain or unknown receipt loss masked by new housekeeping receipts (%s)", (sequence) => {
    prepareReminderReceipts();
    execFileSync("sqlite3", [after, `
      DELETE FROM mutation_outbox WHERE sequence=${sequence};
      INSERT INTO mutation_outbox VALUES(5,'additional-plan','stable-profile','commitNativeReminderPlan',json_quote('${"b".repeat(64)}'),json_object('revision',5),'after','after');
    `]);
    expect(sameSchema().stderr).toContain("mutation_outbox lost or changed retained content");
  });

  it("rejects record loss and replacement even when table counts match", () => {
    preparePreservation();
    execFileSync("sqlite3", [after, "DELETE FROM occurrences;"]);
    expect(sameSchema().stderr).toContain("occurrences lost records across release");
    execFileSync("sqlite3", [after, "INSERT INTO occurrences VALUES('replacement','Preserved private Note','completed');"]);
    expect(sameSchema().stderr).toContain("occurrences lost or changed retained content");
  });

  it.each(["note", "status"])("rejects changed Occurrence %s without record loss", (column) => {
    preparePreservation();
    execFileSync("sqlite3", [after, `UPDATE occurrences SET ${column}='changed';`]);
    expect(sameSchema().stderr).toContain("occurrences lost or changed retained content");
  });

  it.each(["mutation_outbox", "sync_cursors", "account_sync_baselines", "account_first_link_attempts", "occurrence_time_sessions", "occurrence_status_events", "behavior_definition_events", "behavior_configuration_events", "imported_notes", "behaviorlog_import_record_mappings", "travel_settings", "note_shortcut_states"])("rejects changed retained %s content", (table) => {
    preparePreservation();
    execFileSync("sqlite3", [after, `UPDATE ${table} SET content='changed';`]);
    expect(sameSchema().stderr).toContain(`${table} lost or changed retained content`);
  });

  it.each([
    ["account_link_metadata", "hosted_user_id"],
    ["native_reminder_state", "request_id"],
    ["native_reminder_state", "body"],
    ["native_reminder_coverage", "user_id"],
    ["occurrence_sync_state", "timezone"],
    ["local_data_revision", "user_id"],
  ])("rejects changed %s.%s outside the bookkeeping allowance", (table, column) => {
    preparePreservation();
    execFileSync("sqlite3", [after, `UPDATE ${table} SET ${column}='changed';`]);
    expect(sameSchema().stderr).toContain(`${table} lost or changed retained content`);
  });

  it("rejects deleted bookkeeping rows", () => {
    preparePreservation();
    execFileSync("sqlite3", [after, "DELETE FROM native_reminder_coverage;"]);
    expect(sameSchema().stderr).toContain("native_reminder_coverage lost records across release");
  });

  it("preserves duplicate rows and exact typed values", () => {
    createDatabase(after, 9);
    for (const database of [before, after]) execFileSync("sqlite3", [database, `
      CREATE TABLE exact_values(value);
      INSERT INTO exact_values VALUES(9223372036854775806),(9223372036854775807),('note' || char(0) || 'suffix'),(x'00ff'),(NULL),(1.0000000000000002),('duplicate'),('duplicate');
    `]);
    expect(sameSchema().status).toBe(0);
    execFileSync("sqlite3", [after, "UPDATE exact_values SET value='replacement' WHERE rowid=(SELECT max(rowid) FROM exact_values WHERE value='duplicate');"]);
    expect(sameSchema().stderr).toContain("exact_values lost or changed retained content");
  });

  it.each([
    ["9223372036854775806", "9223372036854775807"],
    ["'note' || char(0) || 'before'", "'note' || char(0) || 'after'"],
    ["1.0000000000000002", "1.0000000000000004"],
    ["x'00ff'", "x'00fe'"],
    ["NULL", "''"],
    ["1", "'1'"],
  ])("rejects changed exact typed content (%s)", (previous, next) => {
    createDatabase(after, 9);
    for (const database of [before, after]) execFileSync("sqlite3", [database, `CREATE TABLE exact_values(value); INSERT INTO exact_values VALUES(${previous});`]);
    execFileSync("sqlite3", [after, `UPDATE exact_values SET value=${next};`]);
    expect(sameSchema().stderr).toContain("exact_values lost or changed retained content");
  });

  it("fails without printing an exact secret canary found in the release scope", () => {
    writeFileSync(path.join(app, "Contents", "MacOS", "cadence"), `synthetic executable ${canary}`, { mode: 0o755 });
    const result = run();
    expect(result.status).toBe(1);
    expect(result.stdout).not.toContain(canary);
    expect(result.stdout).toContain("exact_secret_canary");
    expect(JSON.parse(result.stdout).secretScan).toMatchObject({ authenticatedSessionOrServiceRoleFindings: 0,
      exactSecretCanaryFindings: 1, totalFindings: 1 });
  });
});

function createDatabase(file: string, version: number) {
  rmSync(file, { force: true });
  execFileSync("sqlite3", [file, `CREATE TABLE schema_migrations(version INTEGER NOT NULL); INSERT INTO schema_migrations VALUES(${version}); CREATE TABLE profiles(id TEXT PRIMARY KEY); INSERT INTO profiles VALUES('stable-profile');`]);
  chmodSync(file, 0o600);
}
