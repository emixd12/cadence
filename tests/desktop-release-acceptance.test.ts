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

  const fingerprint = (character: string) => character.repeat(64);

  // Real desktop column sets (migrations 0001 and 0008) without unrelated constraints.
  function prepareLaunchSync() {
    createDatabase(after, 9);
    for (const database of [before, after]) execFileSync("sqlite3", [database, `
      CREATE TABLE occurrences(id TEXT PRIMARY KEY, note TEXT, status TEXT);
      INSERT INTO occurrences VALUES('occurrence-one','Preserved private Note','completed'),('occurrence-two',NULL,'unresolved');
      CREATE TABLE account_link_metadata(local_profile_id TEXT PRIMARY KEY,hosted_user_id TEXT,email TEXT,authenticated_at TEXT);
      INSERT INTO account_link_metadata VALUES('stable-profile','same-account','owner@example.test','before');
      CREATE TABLE account_sync_baselines(local_profile_id TEXT PRIMARY KEY REFERENCES profiles(id),hosted_user_id TEXT NOT NULL UNIQUE,choice TEXT NOT NULL,idempotency_key TEXT NOT NULL UNIQUE,local_fingerprint TEXT NOT NULL,hosted_fingerprint TEXT NOT NULL,baseline_fingerprint TEXT NOT NULL,baseline_json TEXT NOT NULL,backup_path TEXT,completed_at TEXT NOT NULL);
      INSERT INTO account_sync_baselines VALUES('stable-profile','same-account','import','${fingerprint("1")}','${fingerprint("a")}','${fingerprint("a")}','${fingerprint("a")}','{"note":"Preserved baseline Note"}',NULL,'before');
      CREATE TABLE sync_cursors(user_id TEXT NOT NULL,name TEXT NOT NULL,value TEXT,updated_at TEXT NOT NULL,PRIMARY KEY(user_id,name));
      INSERT INTO sync_cursors VALUES('stable-profile','account-sync','${fingerprint("a")}','before'),('stable-profile','other-cursor','other','before');
      CREATE TABLE reminder_deliveries(channel TEXT NOT NULL,created_at TEXT NOT NULL,error TEXT,id TEXT PRIMARY KEY NOT NULL,import_run_id TEXT,imported_intervention_id TEXT,occurrence_id TEXT NOT NULL,processing_started_at TEXT,scheduled_send_at TEXT NOT NULL,sent_at TEXT,status TEXT NOT NULL,updated_at TEXT NOT NULL,user_id TEXT NOT NULL);
      INSERT INTO reminder_deliveries VALUES
        ('browser_push','before',NULL,'pending-one',NULL,NULL,'occurrence-two',NULL,'yesterday',NULL,'pending','before','stable-profile'),
        ('browser_push','before',NULL,'sent-one',NULL,NULL,'occurrence-one','before','earlier','earlier','sent','before','stable-profile'),
        ('email','before','Provider failure','failed-one',NULL,NULL,'occurrence-one','before','earlier',NULL,'failed','before','stable-profile'),
        ('browser_push','before',NULL,'cancelled-one',NULL,NULL,'occurrence-one',NULL,'earlier',NULL,'cancelled','before','stable-profile');
    `]);
  }

  // What one signed-in launch writes: a restored session, a new baseline and cursor, and hosted reminder processing.
  function runLaunchSync() {
    execFileSync("sqlite3", [after, `
      UPDATE account_link_metadata SET authenticated_at='after';
      UPDATE account_sync_baselines SET idempotency_key='${fingerprint("2")}',local_fingerprint='${fingerprint("b")}',hosted_fingerprint='${fingerprint("b")}',baseline_fingerprint='${fingerprint("b")}',baseline_json='{"note":"Synced baseline Note"}',completed_at='after';
      UPDATE sync_cursors SET value='${fingerprint("b")}',updated_at='after' WHERE name='account-sync';
      UPDATE reminder_deliveries SET status='failed',error='No active browser push subscription is available.',processing_started_at='after',updated_at='after' WHERE id='pending-one';
      INSERT INTO reminder_deliveries VALUES('browser_push','after',NULL,'pending-two',NULL,NULL,'occurrence-two',NULL,'tomorrow',NULL,'pending','after','stable-profile');
    `]);
  }

  it("accepts a post-launch-sync snapshot and reports the classified rows without private content", () => {
    prepareLaunchSync();
    const unchanged = sameSchema();
    expect(unchanged.status, unchanged.stderr).toBe(0);
    expect(JSON.parse(unchanged.stdout).launchSyncChanges).toEqual({});
    runLaunchSync();
    const accepted = sameSchema();
    expect(accepted.status, accepted.stderr).toBe(0);
    const evidence = JSON.parse(accepted.stdout);
    expect(evidence.launchSyncChanges).toEqual({ account_sync_baselines: 1, sync_cursors: 1, reminder_deliveries: 1 });
    expect(evidence.after.counts.reminder_deliveries).toBe(5);
    expect(evidence.before.preservedContent.reminder_deliveries.launchSync).toEqual({
      columns: ["status", "error", "sent_at", "processing_started_at", "updated_at"], changeableRows: 1, syncShapedRows: 4,
    });
    expect(evidence.after.preservedContent.sync_cursors.launchSync).toMatchObject({ changeableRows: 1, syncShapedRows: 1 });
    expect(evidence.after.preservedContent.account_sync_baselines.launchSync).toMatchObject({ changeableRows: 1, syncShapedRows: 1 });
    for (const text of ["Preserved private Note", "Preserved baseline Note", "Synced baseline Note", "owner@example.test", "No active browser push"]) {
      expect(accepted.stdout).not.toContain(text);
    }
  });

  it("accepts a pending reminder that hosted processing sent or cancelled", () => {
    prepareLaunchSync();
    execFileSync("sqlite3", [after, "UPDATE reminder_deliveries SET status='sent',sent_at='after',processing_started_at='after',updated_at='after' WHERE id='pending-one';"]);
    expect(sameSchema().status).toBe(0);
    execFileSync("sqlite3", [after, "UPDATE reminder_deliveries SET status='cancelled',sent_at=NULL,updated_at='later' WHERE id='pending-one';"]);
    expect(sameSchema().status).toBe(0);
  });

  it.each([
    ["a changed baseline account", "UPDATE account_sync_baselines SET hosted_user_id='other-account';", "account_sync_baselines lost or changed retained content"],
    ["a changed baseline choice", "UPDATE account_sync_baselines SET choice='hydrate';", "account_sync_baselines lost or changed retained content"],
    ["a changed baseline backup path", "UPDATE account_sync_baselines SET backup_path='/elsewhere';", "account_sync_baselines lost or changed retained content"],
    ["unequal baseline fingerprints", `UPDATE account_sync_baselines SET local_fingerprint='${"c".repeat(64)}';`, "account_sync_baselines lost or changed retained content"],
    ["a short idempotency key", "UPDATE account_sync_baselines SET idempotency_key='short';", "account_sync_baselines lost or changed retained content"],
    ["an invalid baseline document", "UPDATE account_sync_baselines SET baseline_json='not json';", "account_sync_baselines lost or changed retained content"],
    ["a removed baseline", "DELETE FROM account_sync_baselines;", "account_sync_baselines lost records"],
    ["a cursor ahead of the baseline", `UPDATE sync_cursors SET value='${"c".repeat(64)}' WHERE name='account-sync';`, "sync_cursors lost or changed retained content"],
    ["a cursor time unlike the baseline", "UPDATE sync_cursors SET updated_at='later' WHERE name='account-sync';", "sync_cursors lost or changed retained content"],
    ["a changed other cursor", "UPDATE sync_cursors SET value='changed' WHERE name='other-cursor';", "sync_cursors lost or changed retained content"],
    ["a renamed cursor", "UPDATE sync_cursors SET name='renamed' WHERE name='account-sync';", "sync_cursors lost or changed retained content"],
    ["a sent reminder changed", "UPDATE reminder_deliveries SET status='failed' WHERE id='sent-one';", "reminder_deliveries lost or changed retained content"],
    ["a failed reminder returned to pending", "UPDATE reminder_deliveries SET status='pending',error=NULL WHERE id='failed-one';", "reminder_deliveries lost or changed retained content"],
    ["a cancelled reminder reactivated", "UPDATE reminder_deliveries SET status='pending' WHERE id='cancelled-one';", "reminder_deliveries lost or changed retained content"],
    ["a pending reminder moved to another Occurrence", "UPDATE reminder_deliveries SET occurrence_id='occurrence-one' WHERE id='pending-one';", "reminder_deliveries lost or changed retained content"],
    ["a pending reminder rescheduled", "UPDATE reminder_deliveries SET scheduled_send_at='later' WHERE id='pending-one';", "reminder_deliveries lost or changed retained content"],
    ["a pending reminder replaced", "DELETE FROM reminder_deliveries WHERE id='pending-one'; INSERT INTO reminder_deliveries VALUES('browser_push','after',NULL,'replacement',NULL,NULL,'occurrence-two',NULL,'yesterday',NULL,'failed','after','stable-profile');", "reminder_deliveries lost or changed retained content"],
    ["a removed reminder", "DELETE FROM reminder_deliveries WHERE id IN ('pending-two','sent-one');", "reminder_deliveries lost records"],
    ["a removed pending reminder", "DELETE FROM reminder_deliveries WHERE id='pending-one';", "reminder_deliveries lost or changed retained content"],
    ["a changed Occurrence Note", "UPDATE occurrences SET note='changed' WHERE id='occurrence-one';", "occurrences lost or changed retained content"],
    ["a removed Occurrence", "DELETE FROM occurrences WHERE id='occurrence-two';", "occurrences lost records"],
    ["a changed account identity", "UPDATE account_link_metadata SET hosted_user_id='other-account';", "account_link_metadata lost or changed retained content"],
    ["a changed profile", "INSERT INTO profiles VALUES('second-profile');", "stable local profile changed"],
  ])("rejects %s alongside a launch sync", (_name, change, message) => {
    prepareLaunchSync();
    runLaunchSync();
    execFileSync("sqlite3", [after, change]);
    expect(sameSchema().stderr).toContain(message);
  });

  it("rejects integrity errors and secrets alongside a launch sync", () => {
    prepareLaunchSync();
    runLaunchSync();
    execFileSync("sqlite3", [after, "PRAGMA foreign_keys=OFF; UPDATE account_sync_baselines SET local_profile_id='missing-profile';"]);
    expect(sameSchema().stderr).toContain("failed integrity validation");
    execFileSync("sqlite3", [after, "UPDATE account_sync_baselines SET local_profile_id='stable-profile';"]);
    expect(sameSchema().status).toBe(0);
    execFileSync("sqlite3", [after, `UPDATE account_sync_baselines SET baseline_json=json_object('token','${canary}');`]);
    const leaked = sameSchema();
    expect(leaked.status).toBe(1);
    expect(leaked.stdout).not.toContain(canary);
    expect(JSON.parse(leaked.stdout).secretScan).toMatchObject({ exactSecretCanaryFindings: 1, totalFindings: 1 });
  });

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
