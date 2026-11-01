import { expect, it } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { randomUUID } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Temporal } from '@js-temporal/polyfill';
import { buildFixtureBundle, FIXTURE_SOURCE } from '../scripts/build-mcp-hosted-fixtures.mjs';
import { buildCleanupSql, QA_USERS as USERS, TABLES } from '../scripts/mcp-fixture-cleanup.mjs';
import { runHostedIsolation } from '../scripts/mcp-hosted-isolation.mjs';
import { partialGraph, addGeneratedOccurrences } from './helpers/mcp-fixture-partial.mjs';

const enabled = process.env.CADENCE_MCP_FIXTURE_REHEARSAL === '1';
const ORIGINAL = { runId: '4db9fe6e-a966-4cca-938b-aee5a1b955b7', startedAt: '2026-10-28T02:17:18.882Z', D: '2026-10-27', users: USERS, source: FIXTURE_SOURCE };
const CATEGORY = { id: 'a29dd2d0-5425-4180-a29a-01a026ebb8c0', user_id: USERS[0], created_at: '2026-10-28T02:17:19.262435+00:00' };
const literal = value => `'${JSON.stringify(value).replaceAll("'", "''")}'`;
const execute = query => {
  const r = spawnSync('docker', ['exec', '-i', 'supabase_db_cadence-mcp-232', 'psql', '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=sqlstate', '-v', 'SHOW_CONTEXT=never', '-U', 'postgres', '-d', 'postgres'],
    { input: query, encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024 });
  return { ok: r.status === 0, output: r.stdout.trim(), state: r.stderr.match(/(?:ERROR|FATAL):\s+([A-Z0-9]{5})/)?.[1] ?? `exit-${r.status}-signal-${r.signal}-code-${r.error?.code ?? 'none'}` };
};
const sql = query => { const r = execute(query); if (!r.ok) throw Error(`local-sql-${r.state ?? 'failed'}`); return r.output; };
const take = r => { if (r.error) throw Error(`local-api-${r.status ?? 'failed'}`); return r.data; };

it.skipIf(!enabled)('rehearses resumed fixtures, session refresh, isolation, descendant capture and archive on frozen SQL', async () => {
  expect(process.versions.node.split('.')[0]).toBe('24');
  const origin = process.env.CADENCE_LOCAL_SUPABASE_URL;
  expect(origin).toBe('http://127.0.0.1:56121');
  expect(execFileSync('/opt/homebrew/bin/supabase', ['--version'], { encoding: 'utf8' }).trim()).toBe('2.109.1');
  const versions = execFileSync('git', ['ls-tree', '-r', '--name-only', FIXTURE_SOURCE, 'supabase/migrations'], { encoding: 'utf8' }).trim().split('\n').map(p => p.split('/').at(-1).split('_')[0]).sort();
  expect(versions).toHaveLength(94);
  expect(JSON.parse(sql('select json_agg(version order by version) from supabase_migrations.schema_migrations;'))).toEqual(versions);
  const publishable = process.env.CADENCE_LOCAL_SUPABASE_PUBLISHABLE_KEY;
  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  const admin = createClient(origin, process.env.CADENCE_LOCAL_SUPABASE_SERVICE_KEY, options).auth.admin;
  const users = [], clients = [], sessions = [], writes = [], refreshes = [];
  const root = mkdtempSync('.intent/artifacts/fixture-rehearsal-'), directory = join(root, 'receipts'); mkdirSync(directory);
  const save = (name, value) => writeFileSync(join(directory, `${name}.json`), JSON.stringify(value) + '\n', { mode: 0o600 });
  const insert = (table, row) => {
    const columns = Object.keys(row).filter(k => k !== 'schedule_range_identity').map(k => `"${k}"`).join(',');
    sql(`insert into public.${table} (${columns}) select ${columns} from json_populate_record(null::public.${table},${literal(row)});`);
  };
  try {
    const build = buildFixtureBundle(join(root, 'fixed.mjs'));
    const fixed = await import(pathToFileURL(resolve(root, 'fixed.mjs')).href);
    for (const id of USERS) {
      const email = `fixture-${randomUUID()}@example.invalid`, password = `Qa-${randomUUID()}-aA1!`;
      take(await admin.createUser({ id, email, password, email_confirm: true })); users.push(id);
      const client = createClient(origin, publishable, options);
      const session = take(await client.auth.signInWithPassword({ email, password })).session;
      expect(session.user.id).toBe(id); clients.push(client);
      sessions.push({ userId: id, accessToken: session.access_token });
      take(await client.from('profiles').update({ timezone: 'America/New_York' }).eq('id', id));
    }
    const graph = partialGraph(fixed); addGeneratedOccurrences(graph, fixed);
    graph.occurrence_status_events[0].local_date = '2026-10-25';
    graph.behavior_definition_events[0].recorded_at = graph.behaviors[0].created_at;
    Object.assign(graph.behavior_configuration_events[0], { recorded_at: graph.behaviors[0].created_at, effective_at: graph.behaviors[0].created_at,
      changed_fields: ['category_id', 'location_text', 'where_kind', 'schedule_graph', 'browser_reminder_enabled', 'email_reminder_enabled', 'reminder_offset_minutes', 'active', 'timezone'] });
    for (const table of TABLES) for (const row of graph[table]) insert(table, row);
    const preserved = [];
    for (let i = 0; i < 3; i++) {
      const b = { ...graph.behaviors[0], id: randomUUID(), category_id: null, title: `Preserved ${i}`, created_at: '2026-09-18T00:00:00Z' };
      insert('behaviors', b); preserved.push(b.id);
      for (let j = 0; j < 32; j++) {
        const day = Temporal.PlainDate.from('2026-09-01').add({ days: j });
        insert('occurrences', { id: randomUUID(), user_id: USERS[0], behavior_id: b.id, status: 'unresolved', schedule_kind: 'exact', schedule_start_time: '09:00:00',
          local_date: day.toString(), scheduled_for: day.toZonedDateTime({ timeZone: 'America/New_York', plainTime: '09:00' }).toInstant().toString(), created_at: '2026-09-18T00:00:00Z' });
      }
    }
    const preservedSnapshot = () => sql(`select json_build_object('behaviors',(select json_agg(t order by id) from public.behaviors t where id in (${preserved.map(id => `'${id}'`).join(',')})),'occurrences',(select json_agg(t order by id) from public.occurrences t where behavior_id in (${preserved.map(id => `'${id}'`).join(',')})));`);
    const preservedBefore = preservedSnapshot();
    sql(`insert into public.occurrence_sync_state(user_id,stale) values ('${USERS[0]}',true) on conflict(user_id) do update set stale=true;`);
    save('execution', ORIGINAL); save('fixture-ids', { a: { category: CATEGORY.id } }); save('creation-receipts', [{ path: '/rest/v1/categories', ...CATEGORY }]);
    save('resume-started', fixed.PRIOR_RESUME); save('resume-fixture-ids', fixed.PARTIAL_IDS);
    const originalBytes = ['execution', 'fixture-ids', 'creation-receipts'].map(n => readFileSync(join(directory, `${n}.json`), 'utf8'));
    const executionDate = Temporal.Now.plainDateISO('America/New_York').toString();
    const input = { mode: 'resume', executionDate, allowHostedProject: 'qjodzutjxtmtzczbloxa', publishableKey: publishable, sessions };
    const fetcher = async (url, init) => {
      const u = new URL(url); expect(u.origin).toBe('https://qjodzutjxtmtzczbloxa.supabase.co');
      const response = await fetch(`${origin}${u.pathname}${u.search}`, init);
      if (init.method !== 'GET') writes.push({ path: u.pathname, status: response.status });
      return response;
    };
    const checkGraph = {};
    for (const table of TABLES) checkGraph[table] = take(await clients[0].from(table).select('*').eq('user_id', USERS[0]).eq(table === 'categories' || table === 'behaviors' ? 'id' : 'behavior_id', table === 'categories' ? CATEGORY.id : fixed.PARTIAL_IDS.a.walk));
    fixed.assertPartialGraph(checkGraph);
    const captured = graph.occurrences.find(o => o.id === fixed.KNOWN_GENERATED_ROWS.at(-1).id);
    const replacementId = randomUUID();
    sql(`delete from public.occurrences where id='${captured.id}';`);
    const deleted = await fixed.runFixtures(input, { directory, fetcher });
    expect(deleted).toMatchObject({ result: 'stopped', stage: 'session-and-fixture-preflight' });
    expect(writes).toHaveLength(0);
    insert('occurrences', { ...captured, id: replacementId });
    const replaced = await fixed.runFixtures(input, { directory, fetcher });
    expect(replaced).toMatchObject({ result: 'stopped', stage: 'session-and-fixture-preflight' });
    expect(writes).toHaveLength(0);
    sql(`delete from public.occurrences where id='${replacementId}';`);
    insert('occurrences', captured);
    const green = await fixed.runFixtures(input, { directory, fetcher });
    expect(green).toMatchObject({ result: 'fixtures-created' }); expect(green.D).toBe(executionDate);
    expect(green.counts).toMatchObject({ categories: 2, behaviors: 6, occurrence_status_events: 4, occurrence_time_sessions: 2 });
    const ids = JSON.parse(readFileSync(join(directory, 'completion-fixture-ids.json')));
    expect(ids.a.walk).toBe(fixed.PARTIAL_IDS.a.walk); expect(ids.a.occurrence).toBe(fixed.PARTIAL_IDS.a.occurrence);
    expect(JSON.parse(readFileSync(join(directory, 'completion-app-generated.json'))).rows).toHaveLength(30);
    for (const [i, client] of clients.entries()) {
      const f = ids[i ? 'b' : 'a'];
      const occurrences = take(await client.from('occurrences').select('*').eq('behavior_id', f.walk));
      expect(occurrences.length).toBe(i ? 8 : 38);
      expect(occurrences.filter(o => o.status === 'completed')).toHaveLength(1);
      expect(occurrences.filter(o => o.status === 'not_completed')).toHaveLength(1);
      expect(occurrences.filter(o => o.note !== null)).toHaveLength(1);
      const time = take(await client.from('occurrence_time_sessions').select('*').eq('behavior_id', f.walk));
      expect(time).toHaveLength(1); expect(Date.parse(time[0].stopped_at) - Date.parse(time[0].started_at)).toBe(600000);
      const session = take(await client.auth.getSession()).session;
      // Simulate an expired cached session; use the real refresh endpoint and the app's getClaims cookie path.
      const name = 'sb-127-auth-token', jar = new Map([[name, 'base64-' + Buffer.from(JSON.stringify({ ...session, expires_at: 1 })).toString('base64url')]]);
      let refreshCalls = 0, cookieWrites = 0;
      const server = createServerClient(origin, publishable, { cookieOptions: { name }, cookies: {
        getAll: () => [...jar].map(([name, value]) => ({ name, value })),
        setAll: values => { cookieWrites++; values.forEach(v => jar.set(v.name, v.value)); },
      }, global: { fetch: async (url, init) => {
        expect(new URL(url).origin).toBe(origin);
        if (new URL(url).pathname === '/auth/v1/token') refreshCalls++;
        return fetch(url, init);
      } } });
      const claims = await server.auth.getClaims();
      expect(claims.error === null).toBe(true); expect(claims.data?.claims.sub).toBe(USERS[i]);
      expect(claims.data?.claims.exp > Date.now() / 1000 + 1800).toBe(true);
      expect(refreshCalls).toBe(1); expect(cookieWrites > 0).toBe(true);
      const fresh = take(await server.auth.getSession()).session;
      expect(fresh.expires_at > session.expires_at).toBe(true);
      expect(fresh.access_token !== session.access_token).toBe(true);
      expect(take(await client.auth.getUser(session.access_token)).user.id).toBe(USERS[i]);
      expect((await client.auth.setSession({ access_token: fresh.access_token, refresh_token: fresh.refresh_token })).error === null).toBe(true);
      refreshes.push({ userId: USERS[i], refreshCalls, cookieWrites, subjectMatch: true, unexpired: true, expiryAdvanced: true, priorSessionStillValid: true });
    }
    const isolation = await runHostedIsolation(['--allow-hosted-project', 'qjodzutjxtmtzczbloxa', '--qa-a', USERS[0], '--qa-b', USERS[1], '--fixtures', 'local-only.json'],
      { NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publishable, CADENCE_INTEGRATION_JWT_SIGNING_KEY: process.env.CADENCE_LOCAL_INTEGRATION_SIGNING_KEY }, ids, fetcher);
    expect(isolation.result).toBe('passed');
    const readGraph = async () => {
      const result = Object.fromEntries(TABLES.map(t => [t, []]));
      for (const [i, client] of clients.entries()) for (const table of TABLES) {
        const f = ids[i ? 'b' : 'a'];
        const rows = take(await client.from(table).select('*').eq('user_id', USERS[i]).in(table === 'categories' || table === 'behaviors' ? 'id' : 'behavior_id', table === 'categories' ? [f.category] : [f.walk, f.reading, f.stretch]).order('id'));
        result[table].push(...rows);
      }
      return result;
    };
    const beforeRefresh = await readGraph(), baseline = fixed.graphReceipt(beforeRefresh, new Date().toISOString());
    const extraDay = Temporal.PlainDate.from('2026-11-28');
    const generated = { ...beforeRefresh.occurrences.find(o => o.behavior_id === ids.a.walk && o.note === null && o.status === 'unresolved'), id: randomUUID(), local_date: extraDay.toString(),
      scheduled_for: extraDay.toZonedDateTime({ timeZone: 'America/New_York', plainTime: '09:00' }).toInstant().toString(), created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
    generated.updated_at = generated.created_at;
    insert('occurrences', generated);
    const afterRefresh = await readGraph();
    const refreshed = fixed.refreshGraphReceipt(baseline, afterRefresh);
    expect(refreshed.appGenerated).toHaveLength(1);
    const changed = structuredClone(afterRefresh); changed.occurrences[0].note = 'changed';
    expect(() => fixed.refreshGraphReceipt(baseline, changed)).toThrowError('captured-row-changed');
    const rows = TABLES.flatMap(table => afterRefresh[table].map(({ id, user_id, created_at }) => ({ table, id, user_id, created_at, run_id: ORIGINAL.runId })));
    const manifest = { version: 1, project: 'qjodzutjxtmtzczbloxa', users: USERS, runId: ORIGINAL.runId, startedAt: ORIGINAL.startedAt, capturedAt: new Date().toISOString(), rows, counts: Object.fromEntries(TABLES.map(t => [t, afterRefresh[t].length])) };
    const missing = structuredClone(manifest); missing.rows = missing.rows.filter(r => r.id !== generated.id); missing.counts.occurrences--;
    expect(execute(buildCleanupSql(missing)).ok).toBe(false);
    const cleanup = buildCleanupSql(manifest);
    expect(execute(cleanup.replace('stamp timestamptz := clock_timestamp()', "stamp timestamptz := '2026-11-04T02:17:18.883Z'::timestamptz")).ok).toBe(false);
    expect(await readGraph()).toEqual(afterRefresh);
    expect(execute(cleanup.replace('archived_count <> expected_count', 'true OR archived_count <> expected_count')).ok).toBe(false);
    expect(await readGraph()).toEqual(afterRefresh);
    expect(execute(cleanup).ok).toBe(true);
    const archived = await readGraph(); expect(archived.behaviors.every(b => !b.active && b.archived_at)).toBe(true);
    for (const table of TABLES.filter(t => !['behaviors', 'behavior_configuration_events'].includes(t))) expect(archived[table]).toEqual(afterRefresh[table]);
    expect(archived.behavior_configuration_events.length).toBe(afterRefresh.behavior_configuration_events.length + 4);
    expect(preservedSnapshot()).toBe(preservedBefore);
    expect(sql(`select stale from public.occurrence_sync_state where user_id='${USERS[0]}';`)).toBe('t');
    for (const [i,n] of ['execution','fixture-ids','creation-receipts'].entries()) expect(readFileSync(join(directory,`${n}.json`),'utf8')).toBe(originalBytes[i]);
    expect(await fixed.runFixtures(input, { directory, fetcher })).toMatchObject({ result: 'stopped', stage: 'input', requests: 0 });
    if (process.env.CADENCE_LOCAL_REHEARSAL_RECEIPT) writeFileSync(process.env.CADENCE_LOCAL_REHEARSAL_RECEIPT, JSON.stringify({ timestamp: new Date().toISOString(), node: process.versions.node, source: FIXTURE_SOURCE, migrations: 94, cli: '2.109.1', executionDate, seed: { originalOccurrences: 8, appGenerated: 30 }, capturedRowGuards: { deletionRefused: true, replacementRefused: true, writesBeforeRefusal: 0 }, fixtures: green, refreshes, isolation, manifestRefresh: { appGenerated: 1, counts: manifest.counts }, archive: { activeArchived: 4, alreadyArchived: 2, allRowsRetained: true, preservedBehaviors: 3, preservedOccurrences: 96, syncStateRetained: true }, rollback: true, originalBytesPreserved: true, bundleSha256: build.bundleSha256 }, null, 2) + '\n');
  } finally {
    for (const id of users) take(await admin.deleteUser(id));
    rmSync(root, { recursive: true, force: true });
  }
}, 60000);
