import { expect, it } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildFixtureBundle, FIXTURE_SOURCE } from '../scripts/build-mcp-hosted-fixtures.mjs';

const enabled = process.env.CADENCE_MCP_FIXTURE_REHEARSAL === '1';
const USERS = ['caefd1b8-ea46-485f-8869-119a715fb092', 'c05b0d9d-dbdc-4f49-80d2-c55e211ebe7b'];
const TABLES = ['categories', 'behaviors', 'behavior_schedules', 'behavior_schedule_slots', 'occurrences', 'occurrence_status_events', 'behavior_definition_events', 'behavior_configuration_events', 'occurrence_time_sessions'];
const ORIGINAL = { runId: '4db9fe6e-a966-4cca-938b-aee5a1b955b7', startedAt: '2026-10-28T02:17:18.882Z', D: '2026-10-27', users: USERS, source: FIXTURE_SOURCE };
const CATEGORY = { id: 'a29dd2d0-5425-4180-a29a-01a026ebb8c0', user_id: USERS[0], created_at: '2026-10-28T02:17:19.262435+00:00' };
const sqlLiteral = value => `'${JSON.stringify(value).replaceAll("'", "''")}'`;
const sql = query => {
  const r = spawnSync('docker', ['exec', '-i', 'supabase_db_cadence-mcp-232', 'psql', '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=sqlstate', '-v', 'SHOW_CONTEXT=never', '-U', 'postgres', '-d', 'postgres'], { input: query, encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024 });
  if (r.status !== 0) throw Error(`local-sql-${r.stderr.match(/ERROR:\s+([A-Z0-9]{5})/)?.[1] ?? 'failed'}`);
  return r.stdout.trim();
};
const take = r => { if (r.error) throw Error(`local-api-${r.status ?? 'failed'}`); return r.data; };

it.skipIf(!enabled)('rehearses every remaining fixture operation from the captured A graph on frozen SQL', async () => {
  expect(process.versions.node.split('.')[0]).toBe('24');
  expect(process.env.CADENCE_LOCAL_SUPABASE_URL).toBe('http://127.0.0.1:56121');
  expect(execFileSync('/opt/homebrew/bin/supabase', ['--version'], { encoding: 'utf8' }).trim()).toBe('2.109.1');
  const migrationVersions = sql('select json_agg(version order by version) from supabase_migrations.schema_migrations;');
  const expectedVersions = execFileSync('git', ['ls-tree', '-r', '--name-only', FIXTURE_SOURCE, 'supabase/migrations'], { encoding: 'utf8' }).trim().split('\n').map(p => p.split('/').at(-1).split('_')[0]).sort();
  expect(JSON.parse(migrationVersions)).toEqual(expectedVersions); expect(expectedVersions).toHaveLength(94);
  const origin = process.env.CADENCE_LOCAL_SUPABASE_URL, publishable = process.env.CADENCE_LOCAL_SUPABASE_PUBLISHABLE_KEY;
  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  const admin = createClient(origin, process.env.CADENCE_LOCAL_SUPABASE_SERVICE_KEY, options).auth.admin;
  const users = [], clients = [], sessions = [], statuses = [], writes = [];
  mkdirSync('.intent/artifacts', { recursive: true });
  const root = mkdtempSync('.intent/artifacts/fixture-rehearsal-');
  const oldRoot = join(root, 'old'), directory = join(root, 'receipts');
  mkdirSync(join(oldRoot, 'scripts'), { recursive: true }); mkdirSync(directory);
  const save = (name, value) => writeFileSync(join(directory, `${name}.json`), JSON.stringify(value) + '\n', { mode: 0o600 });
  try {
    for (const name of ['build-mcp-hosted-fixtures.mjs', 'mcp-hosted-fixtures.entry.mjs']) {
      const bytes = execFileSync('git', ['show', `2c8dde41202eb516a301c9c52c69ba832306abea:scripts/${name}`], { encoding: 'utf8' });
      // Historical builder runs under a test subdirectory; keep git paths repository-relative.
      writeFileSync(join(oldRoot, 'scripts', name), name.startsWith('build-') ? bytes.replace('cwd: ROOT', `cwd: ${JSON.stringify(process.cwd())}`) : bytes);
    }
    // Resolve installed dependencies without copying secrets or a workspace implementation.
    const { symlinkSync } = await import('node:fs'); symlinkSync(resolve('node_modules'), join(oldRoot, 'node_modules'));
    const oldBuilder = await import(pathToFileURL(resolve(oldRoot, 'scripts/build-mcp-hosted-fixtures.mjs')).href);
    oldBuilder.buildFixtureBundle(join(oldRoot, 'old.mjs'));
    const old = await import(pathToFileURL(resolve(oldRoot, 'old.mjs')).href);
    const receipt = buildFixtureBundle(join(root, 'fixed.mjs'));
    const fixed = await import(pathToFileURL(resolve(root, 'fixed.mjs')).href);
    for (const [i, id] of USERS.entries()) {
      const email = `fixture-${randomUUID()}@example.invalid`, password = `Qa-${randomUUID()}-aA1!`;
      take(await admin.createUser({ id, email, password, email_confirm: true })); users.push(id);
      const client = createClient(origin, publishable, options);
      const session = take(await client.auth.signInWithPassword({ email, password })).session;
      expect(session.user.id).toBe(id); clients.push(client);
      sessions.push({ userId: id, accessToken: session.access_token });
      take(await client.from('profiles').update({ timezone: 'America/New_York' }).eq('id', id));
      expect(i).toBeLessThan(2);
    }
    sql(`insert into public.categories(id,user_id,name,created_at,updated_at) values ('${CATEGORY.id}','${USERS[0]}','Review examples','${CATEGORY.created_at}','${CATEGORY.created_at}');`);
    save('execution', ORIGINAL); save('fixture-ids', { a: { category: CATEGORY.id } }); save('creation-receipts', [{ path: '/rest/v1/categories', ...CATEGORY }]);
    const originalBytes = ['execution', 'fixture-ids', 'creation-receipts'].map(n => readFileSync(join(directory, `${n}.json`), 'utf8'));
    const input = { mode: 'resume', allowHostedProject: 'qjodzutjxtmtzczbloxa', publishableKey: publishable, sessions };
    const fetcher = async (url, init) => {
      const u = new URL(url); expect(u.origin).toBe('https://qjodzutjxtmtzczbloxa.supabase.co');
      const response = await fetch(`${origin}${u.pathname}${u.search}`, init);
      if (init.method === 'POST') {
        writes.push({ path: u.pathname, status: response.status });
        if (u.pathname.endsWith('/apply_occurrence_status_transition')) {
          const body = await response.clone().json();
          statuses.push({ status: response.status, ...(response.ok ? {} : { code: /^[A-Z0-9]{5}$/.test(body.code) ? body.code : 'unavailable' }) });
        }
      }
      return response;
    };
    // Same old builder and real current time reproduce the hosted timestamp-contract failure.
    const red = await old.runFixtures(input, { directory, fetcher });
    expect(red).toMatchObject({ result: 'stopped', stage: 'a-walk', lastRequest: { status: 400 } });
    expect(statuses).toEqual([{ status: 200 }, { status: 400, code: '22023' }]);
    const graph = {};
    for (const table of TABLES) {
      let query = clients[0].from(table).select('*').eq('user_id', USERS[0]);
      if (table === 'categories') query = query.eq('id', CATEGORY.id);
      graph[table] = take(await query);
    }
    expect(graph.occurrences).toHaveLength(8); expect(graph.occurrence_status_events).toHaveLength(1);
    // Local-only replica: map generated IDs and creation timestamps to the captured hosted metadata.
    const mapping = {};
    for (const table of TABLES) {
      expect(graph[table].length, table).toBe(fixed.PARTIAL_ROWS.filter(r => r.table === table).length);
      for (const row of graph[table]) {
      const retained = table === 'occurrences' ? fixed.PARTIAL_ROWS.find(r => r.id === fixed.PARTIAL_STATUSES.find(s => s.local_date === row.local_date).id) : fixed.PARTIAL_ROWS.find(r => r.table === table);
      mapping[row.id] = retained.id; row.created_at = retained.created_at;
      if (row.updated_at) row.updated_at = retained.created_at;
    }}
    const replica = JSON.parse(JSON.stringify(graph), (_, v) => typeof v === 'string' && mapping[v] ? mapping[v] : v);
    const columns = Object.fromEntries(TABLES.map(t => [t, JSON.parse(sql(`select json_agg(attname order by attnum) from pg_attribute where attrelid='public.${t}'::regclass and attnum>0 and not attisdropped and attgenerated='';`)).map(n => `"${n}"`).join(',')]));
    const seed = g => sql('begin; set local session_replication_role=replica;\n' + [...TABLES].reverse().map(t => t === 'categories' ? `delete from public.categories where id='${CATEGORY.id}';` : `delete from public.${t} where user_id in ('${USERS[0]}','${USERS[1]}');`).join('\n') + '\n' + TABLES.map(t => `insert into public.${t} (${columns[t]}) overriding system value select ${columns[t]} from json_populate_recordset(null::public.${t},${sqlLiteral(g[t])});`).join('\n') + '\ncommit;');
    seed(replica);
    save('resume-started', fixed.PRIOR_RESUME); save('resume-fixture-ids', fixed.PARTIAL_IDS);
    fixed.assertPartialGraph(replica);
    const readGraph = async () => {
      const result = {};
      for (const table of TABLES) {
        let query = clients[0].from(table).select('*').eq('user_id', USERS[0]).order('id');
        if (table === 'categories') query = query.eq('id', CATEGORY.id);
        result[table] = take(await query);
      }
      return result;
    };
    const before = await readGraph();
    expect(before.occurrence_status_events[0].id).toBe('73b2a3e0-1f43-4148-a11a-42290ad9f410');
    const mismatch = structuredClone(replica); mismatch.occurrences[0].note = 'Changed local replica'; seed(mismatch);
    writes.length = 0;
    const rejected = await fixed.runFixtures(input, { directory, fetcher });
    expect(rejected).toMatchObject({ result: 'stopped', stage: 'session-and-fixture-preflight' }); expect(writes).toHaveLength(0);
    seed(replica); statuses.length = 0; writes.length = 0;
    const green = await fixed.runFixtures(input, { directory, fetcher });
    expect(green.result).toBe('fixtures-created');
    expect(green.D).toBe('2026-10-28');
    expect(green.counts).toEqual({ categories: 2, behaviors: 6, behavior_schedules: 6, behavior_schedule_slots: 6, occurrences: 24, occurrence_status_events: 4, behavior_definition_events: 6, behavior_configuration_events: 8, occurrence_time_sessions: 2 });
    expect(statuses).toEqual([{ status: 200 }, { status: 200 }, { status: 200 }]);
    const ids = JSON.parse(readFileSync(join(directory, 'completion-fixture-ids.json')));
    expect(ids.a.walk).toBe(fixed.PARTIAL_IDS.a.walk); expect(ids.a.category).toBe(CATEGORY.id);
    for (const [index, client] of clients.entries()) {
      const f = ids[index ? 'b' : 'a'];
      const occurrences = take(await client.from('occurrences').select('*').eq('behavior_id', f.walk).order('local_date'));
      expect(occurrences.map(o => o.local_date)).toEqual(Array.from({ length: 8 }, (_, i) => `2026-10-${21 + i}`));
      expect(occurrences.map(o => o.status)).toEqual(['unresolved','unresolved','unresolved','unresolved','completed','not_completed','unresolved','unresolved']);
      expect(occurrences.filter(o => o.note !== null).map(o => o.note)).toEqual(['Review sample note']);
      const time = take(await client.from('occurrence_time_sessions').select('*').eq('behavior_id', f.walk));
      expect(time).toHaveLength(1); expect(Date.parse(time[0].stopped_at) - Date.parse(time[0].started_at)).toBe(600000);
      const stretch = take(await client.from('behaviors').select('active,archived_at').eq('id', f.stretch).single());
      expect(stretch.active).toBe(false); expect(stretch.archived_at).not.toBeNull();
      const reading = take(await client.from('occurrences').select('local_date').eq('behavior_id', f.reading).order('local_date'));
      expect(reading.map(o => o.local_date)).toEqual(['2026-10-21','2026-10-23','2026-10-26','2026-10-28']);
    }
    const retainedEvent = take(await clients[0].from('occurrence_status_events').select('*').eq('id', before.occurrence_status_events[0].id).single());
    expect(retainedEvent).toEqual(before.occurrence_status_events[0]);
    for (const [i,n] of ['execution','fixture-ids','creation-receipts'].entries()) expect(readFileSync(join(directory,`${n}.json`),'utf8')).toBe(originalBytes[i]);
    const callsBefore = writes.length;
    expect(await fixed.runFixtures(input, { directory, fetcher })).toMatchObject({ result:'stopped',stage:'input',requests:0 });
    expect(writes).toHaveLength(callsBefore);
    const evidence = process.env.CADENCE_LOCAL_REHEARSAL_RECEIPT;
    if (evidence) writeFileSync(evidence, JSON.stringify({ timestamp:new Date().toISOString(),node:process.versions.node,cli:'2.109.1',source:FIXTURE_SOURCE,migrations:94,red:{http:400,sqlstate:'22023'},partial:{occurrences:8,statusEvents:1},green,remainingStatusResults:statuses,replicaMismatchRefused:true,replayRefused:true,originalBytesPreserved:true,bundleSha256:receipt.bundleSha256 },null,2)+'\n');
  } finally {
    for (const id of users) take(await admin.deleteUser(id));
    rmSync(root, { recursive:true, force:true });
  }
},60000);
