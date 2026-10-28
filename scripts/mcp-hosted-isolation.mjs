import { generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { Temporal } from "@js-temporal/polyfill";
import { mintIntegrationAccessToken, parseIntegrationSigningKey } from "../lib/supabase/integration-token.ts";

// Separate, explicitly authorized hosted path. Never relax the local suites' URL guards.
export const PROJECT = "qjodzutjxtmtzczbloxa";
const ORIGIN = `https://${PROJECT}.supabase.co`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NOTE = "Review sample note";
const PROBE_NOTE = "Review confirmed";
const FIELDS = ["category", "walk", "reading", "stretch", "occurrence"];

function requireCheck(ok, code) {
  if (!ok) throw new Error(code);
}

export function readConfig(args, env, fixtures) {
  const { values } = parseArgs({ args, strict: true, allowPositionals: false, options: {
    "allow-hosted-project": { type: "string" }, "qa-a": { type: "string" },
    "qa-b": { type: "string" }, fixtures: { type: "string" },
  } });
  requireCheck(values["allow-hosted-project"] === PROJECT, "hosted-opt-in-required");
  const users = [values["qa-a"], values["qa-b"]];
  requireCheck(users.every((id) => typeof id === "string" && UUID.test(id)), "qa-identities-required");
  requireCheck(users[0] !== users[1], "distinct-qa-identities-required");
  requireCheck(typeof values.fixtures === "string" && values.fixtures.length > 0, "fixture-file-required");
  requireCheck(fixtures && Object.keys(fixtures).sort().join() === "a,b", "invalid-fixtures");
  const ids = [...users];
  for (const slot of ["a", "b"]) {
    const row = fixtures[slot];
    requireCheck(row && Object.keys(row).sort().join() === [...FIELDS].sort().join(), "invalid-fixtures");
    for (const field of FIELDS) {
      requireCheck(typeof row[field] === "string" && UUID.test(row[field]), "invalid-fixture-id");
      ids.push(row[field]);
    }
  }
  requireCheck(new Set(ids.map((id) => id.toLowerCase())).size === ids.length, "duplicate-fixture-id");
  requireCheck(/^sb_publishable_[A-Za-z0-9_-]+$/.test(env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? ""), "publishable-key-required");
  return { users, fixtures, publishableKey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    signingKey: parseIntegrationSigningKey(env.CADENCE_INTEGRATION_JWT_SIGNING_KEY ?? "") };
}

export async function runHostedIsolation(args, env, fixtures, fetcher = fetch, now = new Date()) {
  const config = readConfig(args, env, fixtures);
  const start = Date.now();
  let requests = 0;
  let writeAttempted = false;
  let restoring = false;
  let originalNote;
  const today = Temporal.Instant.from(now.toISOString()).toZonedDateTimeISO("America/New_York").toPlainDate();
  const earliest = today.subtract({ days: 7 }).toString();
  const token = (userId, key = config.signingKey, clock = now) => mintIntegrationAccessToken(key, {
    userId, channel: "mcp", grantId: "ticket-232-hosted-qa", clientId: "ticket-232-hosted-qa", now: clock,
  }).token;
  const [tokenA, tokenB] = config.users.map((user) => token(user));

  async function request(auth, table, id, select, patch, noteFilter) {
    requireCheck(["profiles", "categories", "behaviors", "occurrences"].includes(table) && UUID.test(id), "request-scope");
    // Reserve 30 seconds for bounded cleanup after the 90-second test budget.
    requireCheck(++requests <= 60 && Date.now() - start < (restoring ? 120_000 : 90_000), "request-budget");
    const query = new URLSearchParams({ id: `eq.${id}`, select, limit: "2" });
    if (noteFilter !== undefined) query.set("note", noteFilter === null ? "is.null" : `eq.${noteFilter}`);
    const response = await fetcher(`${ORIGIN}/rest/v1/${table}?${query}`, {
      method: patch ? "PATCH" : "GET", redirect: "error", signal: AbortSignal.timeout(4000),
      headers: { apikey: config.publishableKey, Authorization: `Bearer ${auth}`,
        "Content-Type": "application/json", Prefer: "return=representation" },
      ...(patch ? { body: JSON.stringify(patch) } : {}),
    });
    // Error payloads may contain SQL details or note text. Never consume them.
    if (!response.ok) { await response.body?.cancel(); return { status: response.status, rows: null }; }
    const reader = response.body?.getReader();
    requireCheck(reader, "missing-body");
    let size = 0;
    const chunks = [];
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        requireCheck(size <= 16_384, "response-budget");
        chunks.push(value);
      }
    } finally { await reader.cancel(); }
    const rows = JSON.parse(Buffer.concat(chunks).toString());
    requireCheck(Array.isArray(rows) && rows.length <= 1, "unexpected-row-count");
    return { status: response.status, rows };
  }
  const own = (result, id) => {
    requireCheck(result.status === 200 && result.rows?.length === 1 && result.rows[0].id === id, "own-row-unavailable");
    return result.rows[0];
  };

  // Validate both complete, explicit fixture sets before any mutation.
  const sets = [];
  for (const [index, slot] of ["a", "b"].entries()) {
    const user = config.users[index], auth = index === 0 ? tokenA : tokenB, fixture = fixtures[slot];
    const records = [];
    const profile = own(await request(auth, "profiles", user, "id,timezone"), user);
    requireCheck(profile.timezone === "America/New_York", "fixture-timezone");
    records.push({ table: "profiles", id: user, patch: { timezone: profile.timezone } });
    const category = own(await request(auth, "categories", fixture.category, "id,user_id,name"), fixture.category);
    requireCheck(category.user_id === user && category.name === "Review examples", "fixture-category");
    records.push({ table: "categories", id: fixture.category, patch: { name: category.name } });
    for (const [field, title] of [["walk", "Review walk"], ["reading", "Review reading"], ["stretch", "Review stretch"]]) {
      const behavior = own(await request(auth, "behaviors", fixture[field], "id,user_id,title,category_id,browser_reminder_enabled,email_reminder_enabled,active,archived_at"), fixture[field]);
      requireCheck(behavior.user_id === user && behavior.title === title && behavior.category_id === fixture.category
        && behavior.browser_reminder_enabled === false && behavior.email_reminder_enabled === false
        && behavior.active === (field !== "stretch") && (field === "stretch" ? Boolean(behavior.archived_at) : behavior.archived_at === null), "fixture-behavior");
      records.push({ table: "behaviors", id: fixture[field], patch: { title } });
    }
    const occurrence = own(await request(auth, "occurrences", fixture.occurrence, "id,user_id,behavior_id,local_date,note"), fixture.occurrence);
    requireCheck(occurrence.user_id === user && occurrence.behavior_id === fixture.walk
      && /^\d{4}-\d{2}-\d{2}$/.test(occurrence.local_date)
      && occurrence.local_date >= earliest && occurrence.local_date <= today.toString()
      && (occurrence.note === null || occurrence.note === NOTE), "fixture-occurrence");
    records.push({ table: "occurrences", id: fixture.occurrence, patch: { note: occurrence.note } });
    sets.push(records);
  }

  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const untrustedKey = { kid: config.signingKey.kid, privateKey };
  for (const invalid of [token(config.users[0], config.signingKey, new Date(now.getTime() - 600_000)), token(config.users[0], untrustedKey)]) {
    requireCheck((await request(invalid, "profiles", config.users[0], "id")).status === 401, "invalid-token-accepted");
  }
  for (const record of sets[1]) {
    const read = await request(tokenA, record.table, record.id, "id");
    requireCheck(read.status === 200 && read.rows?.length === 0, "cross-account-read");
    // Same-value writes expose RLS bypass without changing B's synthetic content.
    const write = await request(tokenA, record.table, record.id, "id", record.patch);
    requireCheck((write.status === 200 && write.rows?.length === 0) || write.status === 403, "cross-account-write");
  }
  for (const record of sets[0].slice(0, -1)) {
    own(await request(tokenA, record.table, record.id, "id", record.patch), record.id);
  }
  const aId = fixtures.a.occurrence, bId = fixtures.b.occurrence;
  originalNote = sets[0].at(-1).patch.note;
  try {
    writeAttempted = true;
    own(await request(tokenA, "occurrences", aId, "id", { note: PROBE_NOTE }, originalNote), aId);
    const read = own(await request(tokenA, "occurrences", aId, "id,note"), aId);
    requireCheck(read.note === PROBE_NOTE, "own-write-readback");
  } finally {
    if (writeAttempted) {
      restoring = true;
      // A timeout has unknown outcome. Read once; never blindly retry a mutation.
      const read = own(await request(tokenA, "occurrences", aId, "id,note"), aId);
      if (read.note === PROBE_NOTE) {
        own(await request(tokenA, "occurrences", aId, "id", { note: originalNote }, PROBE_NOTE), aId);
      } else requireCheck(read.note === originalNote, "cleanup-conflict");
      const restored = own(await request(tokenA, "occurrences", aId, "id,note"), aId);
      requireCheck(restored.note === originalNote, "cleanup-unverified");
    }
  }
  restoring = false;
  const b = own(await request(tokenB, "occurrences", bId, "id,note"), bId);
  requireCheck(b.note === sets[1].at(-1).patch.note, "b-fixture-changed");
  return { result: "passed", requests, checks: ["own-fixtures", "cross-account-denied", "expired-denied", "untrusted-key-denied", "note-restored"] };
}

export async function main(args = process.argv.slice(2), env = process.env) {
  try {
    const pathIndex = args.indexOf("--fixtures");
    const fixtures = pathIndex >= 0 ? JSON.parse(readFileSync(args[pathIndex + 1], "utf8")) : null;
    console.log(JSON.stringify(await runHostedIsolation(args, env, fixtures)));
    return 0;
  } catch {
    // Even parser, transport, and signing errors may carry sensitive input.
    console.error("Hosted isolation did not pass; verify only the named fixture IDs before any retry. Cleanup may be unverified.");
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await main();
