import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { Temporal } from '@js-temporal/polyfill';
import { createBehavior, setBehaviorActive } from '@cadence/core/services/behavior.service';
import { createBehaviorStore } from '../lib/db/behavior-store.ts';
import { applyOccurrenceStatusTransitionRpc } from '../lib/db/occurrenceStatusEvents.repo.ts';
const TABLES = ['categories', 'behaviors', 'behavior_schedules', 'behavior_schedule_slots', 'occurrences', 'occurrence_status_events', 'behavior_definition_events', 'behavior_configuration_events', 'occurrence_time_sessions'];
const USERS = ['caefd1b8-ea46-485f-8869-119a715fb092', 'c05b0d9d-dbdc-4f49-80d2-c55e211ebe7b'];
const ORIGIN = 'https://qjodzutjxtmtzczbloxa.supabase.co';
const SOURCE = 'eb5afa5be5c49b43bbad3ffd5a25d6eddff30079';
const CATEGORY = { id: 'a29dd2d0-5425-4180-a29a-01a026ebb8c0', user_id: USERS[0], created_at: '2026-10-28T02:17:19.262435+00:00' };
const RUN = { runId: '4db9fe6e-a966-4cca-938b-aee5a1b955b7', startedAt: '2026-10-28T02:17:18.882Z', D: '2026-10-27', users: USERS, source: SOURCE };
const RESUME_D = '2026-10-28';
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
        assert(!existsSync(`${DIR}/resume-started.json`));
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
                            save('resume-creation-receipts', [...(existsSync(`${DIR}/resume-creation-receipts.json`) ? JSON.parse(readFileSync(`${DIR}/resume-creation-receipts.json`)) : []), ...rows.filter(r => r?.id).map(r => ({ path: u.pathname, id: r.id, user_id: r.user_id, created_at: r.created_at }))]);
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
            assert.equal(behaviors.length, 0);
            preflight.push({ userId: USERS[i], authenticated: true, timezone: profile.timezone, collisions: 0 });
        }
        save('resume-session-preflight', { timestamp: new Date().toISOString(), accounts: preflight });
        if (input.mode === 'preflight')
            return { result: 'preflight-passed', accounts: preflight, requests: calls };
        const start = RUN.startedAt, runId = RUN.runId;
        const fixtures = { a: { category: CATEGORY.id } }, rows = [];
        // Never replay a partially successful resume without a new reviewed manifest.
        writeFileSync(`${DIR}/resume-started.json`, JSON.stringify({ initialD: RUN.D, D: RESUME_D, resumedAt: now.toISOString(), runId, source: SOURCE }) + '\n', { mode: 0o600, flag: 'wx' });
        for (const [i, c] of clients.entries()) {
            const user = USERS[i], slot = i ? 'b' : 'a';
            stage = `${slot}-category`;
            const category = i === 0 ? CATEGORY : take(await c.from('categories').insert({ user_id: user, name: 'Review examples', sort_order: 8 }).select('id,user_id,created_at').single());
            const f = fixtures[slot] = { category: category.id };
            save('resume-fixture-ids', fixtures);
            const store = createBehaviorStore(c, user);
            for (const [field, title] of [['walk', 'Review walk'], ['reading', 'Review reading'], ['stretch', 'Review stretch']]) {
                stage = `${slot}-${field}`;
                const rule = field === 'reading' ? { frequency: 'weekly', interval: 1, daysOfWeek: ['monday', 'wednesday', 'friday'] } : { frequency: 'daily', interval: 1 };
                const time = field === 'reading' ? '19:00' : '09:00';
                const b = await createBehavior(store, { userId: user, timezone: 'America/New_York', recordedAt: new Date().toISOString(), values: { title, description: null, categoryId: category.id, recurrenceRule: rule, scheduledTime: time, browserReminderEnabled: false, emailReminderEnabled: false, reminderOffsetMinutes: 0, active: true, schedules: [{ id: null, recurrenceRule: rule, sortOrder: 0, timeEntries: [{ id: null, kind: 'exact', preset: null, startTime: time, endTime: null, sortOrder: 0 }] }] } });
                f[field] = b.id;
                save('resume-fixture-ids', fixtures);
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
                const created = take(await c.from('occurrences').insert(occurrences).select('id,user_id,created_at,local_date,scheduled_for'));
                if (field === 'walk') {
                    f.occurrence = created.find(o => o.local_date === today.subtract({ days: 1 }).toString()).id;
                    save('resume-fixture-ids', fixtures);
                    for (const [days, status] of [[3, 'completed'], [2, 'not_completed']]) {
                        const o = created.find(o => o.local_date === today.subtract({ days }).toString());
                        await applyOccurrenceStatusTransitionRpc(c, { occurrenceId: o.id, expectedStatus: 'unresolved', expectedLatestEventId: null, status, completedAt: status === 'completed' ? o.scheduled_for : null, statusMarkedAt: new Date().toISOString(), cancelPendingReminders: true, event: { statusSemantics: 'explicit_user_mark', recordedAt: new Date().toISOString(), effectiveAt: status === 'completed' ? o.scheduled_for : null, sourceCaptureMethod: 'manual_tap', sourceConfidence: 'high' } });
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
        save('resume-requests', requestReceipts);
        return { result: 'fixtures-created', D: today.toString(), counts: manifest.counts, requests: calls, manifestSha256: createHash('sha256').update(readFileSync(`${DIR}/manifest-initial.json`)).digest('hex') };
    }
    catch {
        save('resume-failure', { timestamp: new Date().toISOString(), stage, requests: calls, requestReceipts });
        return { result: 'stopped', stage, requests: calls, lastRequest: requestReceipts.at(-1) ?? null };
    }
}
