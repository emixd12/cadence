import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { Temporal } from '@js-temporal/polyfill';
import { createBehavior, setBehaviorActive } from '@cadence/core/services/behavior.service';
import { resolveStatusTransition, resolveStatusEvent } from '@cadence/core/resolvers/status.resolver';
import { createBehaviorStore } from '../lib/db/behavior-store.ts';
import { applyOccurrenceStatusTransitionRpc } from '../lib/db/occurrenceStatusEvents.repo.ts';
const TABLES = ['categories', 'behaviors', 'behavior_schedules', 'behavior_schedule_slots', 'occurrences', 'occurrence_status_events', 'behavior_definition_events', 'behavior_configuration_events', 'occurrence_time_sessions'];
const USERS = ['caefd1b8-ea46-485f-8869-119a715fb092', 'c05b0d9d-dbdc-4f49-80d2-c55e211ebe7b'];
const ORIGIN = 'https://qjodzutjxtmtzczbloxa.supabase.co';
const SOURCE = 'eb5afa5be5c49b43bbad3ffd5a25d6eddff30079';
const CATEGORY = { id: 'a29dd2d0-5425-4180-a29a-01a026ebb8c0', user_id: USERS[0], created_at: '2026-10-28T02:17:19.262435+00:00' };
const RUN = { runId: '4db9fe6e-a966-4cca-938b-aee5a1b955b7', startedAt: '2026-10-28T02:17:18.882Z', D: '2026-10-27', users: USERS, source: SOURCE };
const RESUME_D = '2026-10-28';
export const PARTIAL_IDS = {
  "a": {
    "category": "a29dd2d0-5425-4180-a29a-01a026ebb8c0",
    "walk": "b2c5b6b1-457a-4e58-a14f-e4270c3d341e",
    "occurrence": "ffc483a5-46ab-4625-b47e-60892a219f0f"
  }
};
export const PARTIAL_ROWS = [
  {
    "id": "a29dd2d0-5425-4180-a29a-01a026ebb8c0",
    "user_id": "caefd1b8-ea46-485f-8869-119a715fb092",
    "created_at": "2026-10-28T02:17:19.262435+00:00",
    "table": "categories"
  },
  {
    "id": "b2c5b6b1-457a-4e58-a14f-e4270c3d341e",
    "user_id": "caefd1b8-ea46-485f-8869-119a715fb092",
    "created_at": "2026-10-28T18:11:34.184+00:00",
    "table": "behaviors"
  },
  {
    "id": "1002b09d-80f6-4c72-ae8e-cb5af0b1c65d",
    "user_id": "caefd1b8-ea46-485f-8869-119a715fb092",
    "created_at": "2026-10-28T18:11:34.346905+00:00",
    "table": "behavior_schedules"
  },
  {
    "id": "3a7ccc38-b313-476d-9cdc-d54ab895cbb7",
    "user_id": "caefd1b8-ea46-485f-8869-119a715fb092",
    "created_at": "2026-10-28T18:11:34.346905+00:00",
    "table": "behavior_schedule_slots"
  },
  {
    "id": "718384d7-c635-4db7-8abc-d84dad4d8639",
    "user_id": "caefd1b8-ea46-485f-8869-119a715fb092",
    "created_at": "2026-10-28T18:11:34.75603+00:00",
    "table": "occurrences"
  },
  {
    "id": "d6d46dec-789c-457c-8d16-28b7c1ba83cb",
    "user_id": "caefd1b8-ea46-485f-8869-119a715fb092",
    "created_at": "2026-10-28T18:11:34.75603+00:00",
    "table": "occurrences"
  },
  {
    "id": "3cdaf703-6d80-4e2d-b9e6-f37048c5c884",
    "user_id": "caefd1b8-ea46-485f-8869-119a715fb092",
    "created_at": "2026-10-28T18:11:34.75603+00:00",
    "table": "occurrences"
  },
  {
    "id": "8a68aaa8-9ea9-49aa-b1ac-553d8a9827d5",
    "user_id": "caefd1b8-ea46-485f-8869-119a715fb092",
    "created_at": "2026-10-28T18:11:34.75603+00:00",
    "table": "occurrences"
  },
  {
    "id": "a777d30e-7ca0-4949-8f1d-2ca60fe6cd15",
    "user_id": "caefd1b8-ea46-485f-8869-119a715fb092",
    "created_at": "2026-10-28T18:11:34.75603+00:00",
    "table": "occurrences"
  },
  {
    "id": "8b4d5d5e-d13b-4ab3-bbe4-66b86f337e7d",
    "user_id": "caefd1b8-ea46-485f-8869-119a715fb092",
    "created_at": "2026-10-28T18:11:34.75603+00:00",
    "table": "occurrences"
  },
  {
    "id": "ffc483a5-46ab-4625-b47e-60892a219f0f",
    "user_id": "caefd1b8-ea46-485f-8869-119a715fb092",
    "created_at": "2026-10-28T18:11:34.75603+00:00",
    "table": "occurrences"
  },
  {
    "id": "7af74aa8-ec6d-4b2e-a2f8-353ed03b7834",
    "user_id": "caefd1b8-ea46-485f-8869-119a715fb092",
    "created_at": "2026-10-28T18:11:34.75603+00:00",
    "table": "occurrences"
  },
  {
    "id": "73b2a3e0-1f43-4148-a11a-42290ad9f410",
    "user_id": "caefd1b8-ea46-485f-8869-119a715fb092",
    "created_at": "2026-10-28T18:11:34.895198+00:00",
    "table": "occurrence_status_events"
  },
  {
    "id": "d420f929-4f0a-4305-b083-f1ab66af82d1",
    "user_id": "caefd1b8-ea46-485f-8869-119a715fb092",
    "created_at": "2026-10-28T18:11:34.346905+00:00",
    "table": "behavior_definition_events"
  },
  {
    "id": "61c637ba-eb01-4dbd-92bd-539a11e08d86",
    "user_id": "caefd1b8-ea46-485f-8869-119a715fb092",
    "created_at": "2026-10-28T18:11:34.346905+00:00",
    "table": "behavior_configuration_events"
  }
];
export const PARTIAL_STATUSES = [
  {
    "id": "718384d7-c635-4db7-8abc-d84dad4d8639",
    "user_id": "caefd1b8-ea46-485f-8869-119a715fb092",
    "behavior_id": "b2c5b6b1-457a-4e58-a14f-e4270c3d341e",
    "local_date": "2026-10-21",
    "status": "unresolved"
  },
  {
    "id": "d6d46dec-789c-457c-8d16-28b7c1ba83cb",
    "user_id": "caefd1b8-ea46-485f-8869-119a715fb092",
    "behavior_id": "b2c5b6b1-457a-4e58-a14f-e4270c3d341e",
    "local_date": "2026-10-22",
    "status": "unresolved"
  },
  {
    "id": "3cdaf703-6d80-4e2d-b9e6-f37048c5c884",
    "user_id": "caefd1b8-ea46-485f-8869-119a715fb092",
    "behavior_id": "b2c5b6b1-457a-4e58-a14f-e4270c3d341e",
    "local_date": "2026-10-23",
    "status": "unresolved"
  },
  {
    "id": "8a68aaa8-9ea9-49aa-b1ac-553d8a9827d5",
    "user_id": "caefd1b8-ea46-485f-8869-119a715fb092",
    "behavior_id": "b2c5b6b1-457a-4e58-a14f-e4270c3d341e",
    "local_date": "2026-10-24",
    "status": "unresolved"
  },
  {
    "id": "a777d30e-7ca0-4949-8f1d-2ca60fe6cd15",
    "user_id": "caefd1b8-ea46-485f-8869-119a715fb092",
    "behavior_id": "b2c5b6b1-457a-4e58-a14f-e4270c3d341e",
    "local_date": "2026-10-25",
    "status": "completed"
  },
  {
    "id": "8b4d5d5e-d13b-4ab3-bbe4-66b86f337e7d",
    "user_id": "caefd1b8-ea46-485f-8869-119a715fb092",
    "behavior_id": "b2c5b6b1-457a-4e58-a14f-e4270c3d341e",
    "local_date": "2026-10-26",
    "status": "unresolved"
  },
  {
    "id": "ffc483a5-46ab-4625-b47e-60892a219f0f",
    "user_id": "caefd1b8-ea46-485f-8869-119a715fb092",
    "behavior_id": "b2c5b6b1-457a-4e58-a14f-e4270c3d341e",
    "local_date": "2026-10-27",
    "status": "unresolved"
  },
  {
    "id": "7af74aa8-ec6d-4b2e-a2f8-353ed03b7834",
    "user_id": "caefd1b8-ea46-485f-8869-119a715fb092",
    "behavior_id": "b2c5b6b1-457a-4e58-a14f-e4270c3d341e",
    "local_date": "2026-10-28",
    "status": "unresolved"
  }
];
export const PRIOR_RESUME = {
  "initialD": "2026-10-27",
  "D": "2026-10-28",
  "resumedAt": "2026-10-28T18:11:32.044Z",
  "runId": "4db9fe6e-a966-4cca-938b-aee5a1b955b7",
  "source": "eb5afa5be5c49b43bbad3ffd5a25d6eddff30079"
};

export async function runFixtures(input, { directory = '.intent/artifacts/trust232/activation-execution', fetcher = fetch, now = new Date() } = {}) {
    const DIR = directory;
    const take = (r) => { if (r.error)
        throw Error('operation-denied'); return r.data; };
    const save = (name, value) => writeFileSync(`${DIR}/${name}.json`, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
    let stage = 'input', calls = 0;
    const requestReceipts = [];
    try {
        assert.equal(process.versions.node.split('.')[0], '24');
        assert.equal(import.meta.fixtureSource, SOURCE);
        assert.equal(input.allowHostedProject, 'qjodzutjxtmtzczbloxa');
        assert(['preflight', 'resume'].includes(input.mode));
        assert.equal(input.sessions.length, 2);
        assert.deepEqual(JSON.parse(readFileSync(`${DIR}/execution.json`)), RUN);
        assert.deepEqual(JSON.parse(readFileSync(`${DIR}/fixture-ids.json`)), { a: { category: CATEGORY.id } });
        assert.deepEqual(JSON.parse(readFileSync(`${DIR}/creation-receipts.json`)), [{ path: '/rest/v1/categories', ...CATEGORY }]);
        assert.deepEqual(JSON.parse(readFileSync(`${DIR}/resume-started.json`)), PRIOR_RESUME);
        assert.deepEqual(JSON.parse(readFileSync(`${DIR}/resume-fixture-ids.json`)), PARTIAL_IDS);
        assert(!existsSync(`${DIR}/completion-started.json`));
        const today = Temporal.Instant.from(now.toISOString()).toZonedDateTimeISO('America/New_York').toPlainDate();
        assert.equal(today.toString(), RESUME_D);
        assert(/^sb_publishable_[A-Za-z0-9_-]+$/.test(input.publishableKey));
        const clients = input.sessions.map((session, index) => {
            assert.equal(session.userId, USERS[index]);
            const payload = JSON.parse(Buffer.from(session.accessToken.split('.')[1], 'base64url').toString());
            assert.equal(payload.sub, USERS[index]);
            assert.equal(payload.role, 'authenticated');
            assert(payload.exp * 1000 > Date.now() + 120000);
            return createClient(ORIGIN, input.publishableKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { headers: { Authorization: `Bearer ${session.accessToken}` }, fetch: async (url, options) => {
                        const u = new URL(url);
                        assert.equal(u.origin, ORIGIN);
                        assert(++calls <= 200);
                        assert(u.pathname.startsWith('/auth/v1/user') || u.pathname.startsWith('/rest/v1/'));
                        const response = await fetcher(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(8000) });
                        requestReceipts.push({ path: u.pathname, method: options?.method ?? 'GET', status: response.status });
                        if (!response.ok) {
                            await response.body?.cancel();
                            throw Error('operation-denied');
                        }
                        if (options?.method === 'POST' && ['/rest/v1/categories', '/rest/v1/occurrences', '/rest/v1/occurrence_time_sessions', '/rest/v1/rpc/create_behavior_with_schedule_graph'].includes(u.pathname)) {
                            const body = await response.clone().json();
                            const rows = Array.isArray(body) ? body : [body];
                            save('completion-creation-receipts', [...(existsSync(`${DIR}/completion-creation-receipts.json`) ? JSON.parse(readFileSync(`${DIR}/completion-creation-receipts.json`)) : []), ...rows.filter(r => r?.id).map(r => ({ path: u.pathname, id: r.id, user_id: r.user_id, created_at: r.created_at }))]);
                        }
                        return response;
                    } } });
        });
        stage = 'session-and-fixture-preflight';
        const preflight = [];
        for (const [i, c] of clients.entries()) {
            const u = take(await c.auth.getUser(input.sessions[i].accessToken));
            assert.equal(u.user.id, USERS[i]);
            const profile = take(await c.from('profiles').select('id,timezone').eq('id', USERS[i]).single());
            assert.equal(profile.timezone, 'America/New_York');
            const categories = take(await c.from('categories').select('id,user_id,name,created_at,updated_at').eq('user_id', USERS[i]).eq('name', 'Review examples'));
            const behaviors = take(await c.from('behaviors').select('id').eq('user_id', USERS[i]).in('title', ['Review walk', 'Review reading', 'Review stretch', 'Review practice']));
            if (i === 0)
                assert.deepEqual(categories, [{ ...CATEGORY, name: 'Review examples', updated_at: CATEGORY.created_at }]);
            else
                assert.equal(categories.length, 0);
            assert.deepEqual(behaviors, i === 0 ? [{ id: PARTIAL_IDS.a.walk }] : []);
            preflight.push({ userId: USERS[i], authenticated: true, timezone: profile.timezone, collisions: 0 });
        }
        const partial = await readPartial(clients[0], take);
        assertPartialGraph(partial);
        save('completion-session-preflight', { timestamp: new Date().toISOString(), accounts: preflight });
        if (input.mode === 'preflight')
            return { result: 'preflight-passed', accounts: preflight, requests: calls };
        const start = RUN.startedAt, runId = RUN.runId;
        const fixtures = structuredClone(PARTIAL_IDS), rows = [];
        // Never replay a partially successful resume without a new reviewed manifest.
        writeFileSync(`${DIR}/completion-started.json`, JSON.stringify({ initialD: RUN.D, D: RESUME_D, resumedAt: now.toISOString(), runId, source: SOURCE, priorResume: PRIOR_RESUME.resumedAt }) + '\n', { mode: 0o600, flag: 'wx' });
        for (const [i, c] of clients.entries()) {
            const user = USERS[i], slot = i ? 'b' : 'a';
            stage = `${slot}-category`;
            const category = i === 0 ? CATEGORY : take(await c.from('categories').insert({ user_id: user, name: 'Review examples', sort_order: 8 }).select('id,user_id,created_at').single());
            const f = fixtures[slot] = i === 0 ? structuredClone(PARTIAL_IDS.a) : { category: category.id };
            save('completion-fixture-ids', fixtures);
            const store = createBehaviorStore(c, user);
            for (const [field, title] of [['walk', 'Review walk'], ['reading', 'Review reading'], ['stretch', 'Review stretch']]) {
                stage = `${slot}-${field}`;
                const rule = field === 'reading' ? { frequency: 'weekly', interval: 1, daysOfWeek: ['monday', 'wednesday', 'friday'] } : { frequency: 'daily', interval: 1 };
                const time = field === 'reading' ? '19:00' : '09:00';
                const reuseWalk = i === 0 && field === 'walk';
                const b = reuseWalk ? partial.behaviors[0] : await createBehavior(store, { userId: user, timezone: 'America/New_York', recordedAt: new Date().toISOString(), values: { title, description: null, categoryId: category.id, recurrenceRule: rule, scheduledTime: time, browserReminderEnabled: false, emailReminderEnabled: false, reminderOffsetMinutes: 0, active: true, schedules: [{ id: null, recurrenceRule: rule, sortOrder: 0, timeEntries: [{ id: null, kind: 'exact', preset: null, startTime: time, endTime: null, sortOrder: 0 }] }] } });
                f[field] = b.id;
                save('completion-fixture-ids', fixtures);
                if (field === 'stretch') {
                    await setBehaviorActive(store, { behaviorId: b.id, active: false, recordedAt: new Date().toISOString(), newArchiveNoteId: randomUUID(), archiveNote: 'Old demo schedule' });
                    continue;
                }
                const occurrences = [];
                for (let delta = 7; delta >= 0; delta--) {
                    const date = today.subtract({ days: delta });
                    if (field === 'reading' && ![1, 3, 5].includes(date.dayOfWeek))
                        continue;
                    const instant = date.toZonedDateTime({ timeZone: 'America/New_York', plainTime: Temporal.PlainTime.from(time) }).toInstant().toString();
                    occurrences.push({ id: randomUUID(), user_id: user, behavior_id: b.id, local_date: date.toString(), scheduled_for: instant, schedule_kind: 'exact', schedule_start_time: time + ':00', status: 'unresolved', note: field === 'walk' && delta === 1 ? 'Review sample note' : null });
                }
                const created = reuseWalk ? partial.occurrences : take(await c.from('occurrences').insert(occurrences).select('id,user_id,created_at,local_date,scheduled_for'));
                if (field === 'walk') {
                    f.occurrence = created.find(o => o.local_date === today.subtract({ days: 1 }).toString()).id;
                    save('completion-fixture-ids', fixtures);
                    for (const [days, status] of [[3, 'completed'], [2, 'not_completed']]) {
                        const o = created.find(o => o.local_date === today.subtract({ days }).toString());
                        if (reuseWalk && days === 3) continue;
                        const occurrence = { status: 'unresolved', completedAt: null, statusMarkedAt: null, note: null };
                        const clock = Temporal.Now.instant();
                        const update = resolveStatusTransition({ occurrence, nextStatus: status, now: clock });
                        const event = resolveStatusEvent({ occurrence, nextStatus: status, now: clock, update, hasPriorStatusEvent: false });
                        await applyOccurrenceStatusTransitionRpc(c, { occurrenceId: o.id, expectedStatus: 'unresolved', expectedLatestEventId: null, ...update, cancelPendingReminders: true, event });
                    }
                    const o = created.find(o => o.local_date === today.subtract({ days: 3 }).toString());
                    take(await c.from('occurrence_time_sessions').insert({ id: randomUUID(), user_id: user, behavior_id: b.id, occurrence_id: o.id, started_at: o.scheduled_for, stopped_at: Temporal.Instant.from(o.scheduled_for).add({ minutes: 10 }).toString() }).select('id,user_id,created_at').single());
                }
            }
            stage = `${slot}-capture`;
            const ids = [f.walk, f.reading, f.stretch];
            for (const table of TABLES) {
                const found = take(await c.from(table).select('id,user_id,created_at').eq('user_id', user).in(table === 'categories' || table === 'behaviors' ? 'id' : 'behavior_id', table === 'categories' ? [f.category] : ids).order('id').limit(500));
                rows.push(...found.map(r => ({ ...r, table, run_id: runId })));
                save('captured-rows', rows);
            }
        }
        const manifest = { version: 1, project: 'qjodzutjxtmtzczbloxa', users: USERS, runId, startedAt: start, capturedAt: new Date().toISOString(), rows, counts: Object.fromEntries(TABLES.map(t => [t, rows.filter(r => r.table === t).length])) };
        save('manifest-initial', manifest);
        save('completion-requests', requestReceipts);
        return { result: 'fixtures-created', D: today.toString(), counts: manifest.counts, requests: calls, manifestSha256: createHash('sha256').update(readFileSync(`${DIR}/manifest-initial.json`)).digest('hex') };
    }
    catch {
        save('completion-failure', { timestamp: new Date().toISOString(), stage, requests: calls, requestReceipts });
        return { result: 'stopped', stage, requests: calls, lastRequest: requestReceipts.at(-1) ?? null };
    }
}

async function readPartial(client, take) {
    const graph = {};
    for (const table of TABLES) {
        graph[table] = take(await client.from(table).select('*').eq('user_id', USERS[0])
            .eq(table === 'categories' || table === 'behaviors' ? 'id' : 'behavior_id', table === 'categories' ? CATEGORY.id : PARTIAL_IDS.a.walk).order('id').limit(500));
    }
    return graph;
}

export function assertPartialGraph(graph) {
    const order = rows => [...rows].sort((a, b) => a.id.localeCompare(b.id));
    for (const table of TABLES) {
        const expected = PARTIAL_ROWS.filter(row => row.table === table).map(({ table: _, ...row }) => row);
        const actual = graph[table].map(({ id, user_id, created_at }) => ({ id, user_id, created_at }));
        assert.deepEqual(order(actual), order(expected), 'partial-state-mismatch');
    }
    const b = graph.behaviors[0];
    assert(b.title === 'Review walk' && b.category_id === CATEGORY.id && b.timezone === 'America/New_York' && b.active === true && b.archived_at === null && b.description === null && b.browser_reminder_enabled === false && b.email_reminder_enabled === false, 'partial-behavior-mismatch');
    assert.deepEqual(b.recurrence_rule, { frequency: 'daily', interval: 1 }, 'partial-recurrence-mismatch');
    assert(b.scheduled_time === '09:00:00' && b.reminder_offset_minutes === 0 && b.location_text === null && b.where_kind === null && b.default_duration_minutes === null && b.end_date === null && b.auto_archived_at === null && Array.isArray(b.archive_notes) && b.archive_notes.length === 0, 'partial-behavior-fields-mismatch');
    const schedule = graph.behavior_schedules[0], slot = graph.behavior_schedule_slots[0];
    assert(schedule.behavior_id === b.id && schedule.sort_order === 0 && schedule.recurrence_rule.frequency === 'daily' && schedule.recurrence_rule.interval === 1, 'partial-schedule-mismatch');
    assert(slot.behavior_id === b.id && slot.behavior_schedule_id === schedule.id && slot.kind === 'exact' && slot.start_time === '09:00:00' && slot.end_time === null && slot.preset === null && slot.sort_order === 0, 'partial-slot-mismatch');
    for (const o of graph.occurrences) {
        const expected = PARTIAL_STATUSES.find(row => row.id === o.id);
        assert(expected && o.behavior_id === b.id && o.local_date === expected.local_date && o.status === expected.status, 'partial-status-mismatch');
        const scheduled = Temporal.PlainDate.from(o.local_date).toZonedDateTime({ timeZone: 'America/New_York', plainTime: '09:00' }).toInstant();
        assert(Temporal.Instant.compare(o.scheduled_for, scheduled) === 0 && o.schedule_kind === 'exact' && o.schedule_start_time === '09:00:00', 'partial-date-mismatch');
        assert(o.note === (o.local_date === '2026-10-27' ? 'Review sample note' : null), 'partial-note-mismatch');
        if (o.status === 'completed') assert(Temporal.Instant.compare(o.completed_at, scheduled) === 0 && o.status_marked_at !== null, 'partial-completed-mismatch');
        else assert(o.completed_at === null && o.status_marked_at === null, 'partial-unresolved-mismatch');
    }
    const definition = graph.behavior_definition_events[0], configuration = graph.behavior_configuration_events[0];
    assert(definition.behavior_id === b.id && definition.previous_title === null && definition.next_title === 'Review walk' && definition.previous_description === null && definition.next_description === null && definition.source === 'manual' && definition.reason === null, 'partial-definition-mismatch');
    assert.deepEqual(definition.changed_fields, ['title'], 'partial-definition-fields-mismatch');
    assert(configuration.behavior_id === b.id && configuration.event_kind === 'baseline' && configuration.previous_configuration === null && configuration.source === 'manual' && configuration.reason_code === 'behavior_created' && configuration.timezone === 'America/New_York' && configuration.effective_local_date === '2026-10-28', 'partial-configuration-mismatch');
    assert.deepEqual(configuration.next_configuration, {
        category_id: CATEGORY.id, location_text: null, where_kind: null,
        schedule_graph: [{ recurrence_rule: { frequency: 'daily', interval: 1 }, sort_order: 0, time_entries: [{ kind: 'exact', preset: null, start_time: '09:00:00', end_time: null, sort_order: 0 }] }],
        browser_reminder_enabled: false, email_reminder_enabled: false, reminder_offset_minutes: 0, active: true, timezone: 'America/New_York',
    }, 'partial-configuration-snapshot-mismatch');
    const event = graph.occurrence_status_events[0], completed = graph.occurrences.find(o => o.status === 'completed');
    assert(event.occurrence_id === completed.id && event.behavior_id === b.id && event.previous_status === 'unresolved' && event.status === 'completed' && event.status_semantics === 'explicit_user_mark' && event.source_capture_method === 'manual_tap' && event.source_confidence === 'high' && Temporal.Instant.compare(event.recorded_at, completed.status_marked_at) === 0 && Temporal.Instant.compare(event.effective_at, completed.completed_at) === 0, 'partial-event-mismatch');
}
