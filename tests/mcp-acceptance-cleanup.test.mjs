import { describe, expect, it } from 'vitest';
import { captureGrants, revokeCaptured, captureCreations, extendManifest, captureBaseline, restoreBaseline, createRest, noteHash, USERS } from '../scripts/mcp-acceptance-cleanup.mjs';

const SINCE = '2026-10-29T20:43:30.000Z';
const RUN = '4db9fe6e-a966-4cca-938b-aee5a1b955b7';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const G1 = id(901), G2 = id(902), OLD = id(903);

function manifest() {
  const rows = [
    { table: 'categories', id: id(1), user_id: USERS.A, created_at: '2026-10-28T02:17:19.262Z', run_id: RUN },
    { table: 'behaviors', id: id(2), user_id: USERS.A, created_at: '2026-10-28T02:17:20.000Z', run_id: RUN },
    { table: 'categories', id: id(6), user_id: USERS.B, created_at: '2026-10-29T18:39:59.000Z', run_id: RUN },
    { table: 'behaviors', id: id(3), user_id: USERS.B, created_at: '2026-10-29T18:40:00.000Z', run_id: RUN },
    { table: 'occurrences', id: id(4), user_id: USERS.A, created_at: '2026-10-28T02:17:21.000Z', run_id: RUN },
    { table: 'occurrences', id: id(5), user_id: USERS.B, created_at: '2026-10-29T18:40:01.000Z', run_id: RUN },
  ];
  const tables = ['categories', 'behaviors', 'behavior_schedules', 'behavior_schedule_slots', 'occurrences', 'occurrence_status_events', 'behavior_definition_events', 'behavior_configuration_events', 'occurrence_time_sessions'];
  return { version: 1, runId: RUN, project: 'qjodzutjxtmtzczbloxa', users: [USERS.A, USERS.B], startedAt: '2026-10-28T02:17:18.882Z', capturedAt: '2026-10-29T18:41:00.000Z',
    rows, counts: Object.fromEntries(tables.map((t) => [t, rows.filter((r) => r.table === t).length])) };
}

function world(o = {}) {
  const calls = [];
  const grants = { A: [{ grant_id: G1, client_id: 'c1', client_name: 'Claude', scopes: ['cadence.read'], created_at: '2026-10-29T20:50:00Z' }, { grant_id: OLD, client_id: 'c0', client_name: 'Old', scopes: [], created_at: '2026-10-20T00:00:00Z' }], B: [{ grant_id: G2, client_id: 'c2', client_name: 'Inspector', scopes: ['cadence.read'], created_at: '2026-10-29T21:00:00Z' }] };
  const occ = { [id(4)]: { id: id(4), status: 'unresolved', note: 'Review sample note' }, [id(5)]: { id: id(5), status: 'completed', note: null } };
  const behaviors = { A: o.newBehaviors?.A ?? [{ id: id(10), user_id: USERS.A, title: 'Review practice (Claude web)', created_at: '2026-10-29T20:55:00Z' }], B: o.newBehaviors?.B ?? [] };
  const derived = o.derived ?? { [`behavior_schedules/${id(10)}`]: [{ id: id(11), user_id: USERS.A, created_at: '2026-10-29T20:55:00Z' }], [`occurrences/${id(10)}`]: [{ id: id(12), user_id: USERS.A, created_at: '2026-10-29T20:55:00Z' }], [`occurrence_status_events/${id(2)}`]: [{ id: id(13), user_id: USERS.A, created_at: '2026-10-29T20:56:00Z' }] };
  const rest = async (slot, method, path, body, headers) => {
    calls.push({ slot, method, path, body, headers });
    if (path === '/rest/v1/rpc/oauth_list_grants') return o.grantsFail ? { status: 500, json: null } : { status: 200, json: o.badGrant ? [{ grant_id: 'not-a-uuid', created_at: '2026-10-29T21:00:00Z' }] : grants[slot] };
    if (path === '/rest/v1/rpc/oauth_revoke_grant') { if (o.revokeNoop) return { status: 200, json: true }; grants[slot] = grants[slot].filter((g) => g.grant_id !== body.p_grant_id); return { status: o.revokeAmbiguous ? 0 : 200, json: true }; }
    const m = path.match(/^\/rest\/v1\/([a-z_]+)\?(.*)$/);
    if (m && m[1] === 'behaviors' && method === 'GET') return { status: 200, json: behaviors[slot] };
    if (m && m[1] === 'occurrences' && method === 'GET' && !path.includes('behavior_id=')) {
      const one = path.match(/[?&]id=eq\.([0-9a-f-]+)/);
      if (one) return { status: 200, json: occ[one[1]] ? [{ ...occ[one[1]] }] : [] };
      const ins = path.match(/id=in\.\(([^)]*)\)/)[1].split(',');
      return { status: 200, json: ins.filter((x) => occ[x] && !(o.dropOcc === x)).map((x) => ({ ...occ[x] })) };
    }
    if (m && m[1] === 'occurrences' && method === 'PATCH') {
      const target = path.match(/[?&]id=eq\.([0-9a-f-]+)/)[1];
      const guard = path.includes('note=is.null') ? null : decodeURIComponent(path.match(/note=eq\.([^&]*)/)[1]);
      if (occ[target].note !== guard) return { status: 200, json: [] };
      if (!o.patchNoop) occ[target].note = body.note;
      return { status: 200, json: [occ[target]] };
    }
    if (m && m[1] === 'occurrence_status_events' && method === 'GET' && path.includes('occurrence_id=')) return { status: 200, json: [{ id: id(99), recorded_at: '2026-10-29T20:56:00Z' }] };
    if (path === '/rest/v1/rpc/apply_occurrence_status_transition') { if (!o.rpcNoop) occ[body.target_occurrence_id].status = body.planned_status; return { status: 200, json: {} }; }
    if (m && method === 'GET') { const b = path.match(/behavior_id=eq\.([0-9a-f-]+)/)[1]; return { status: 200, json: derived[`${m[1]}/${b}`] ?? [] }; }
    return { status: 404, json: null };
  };
  return { rest, calls, occ, grants };
}

describe('Ticket 232 acceptance grants', () => {
  it('captures only grants created by this run for A and B', async () => {
    const w = world();
    expect((await captureGrants({ rest: w.rest, since: SINCE })).map((g) => [g.slot, g.grantId])).toEqual([['A', G1], ['B', G2]]);
  });
  it('fails closed on an unreadable grant list or a malformed grant row', async () => {
    await expect(captureGrants({ rest: world({ grantsFail: true }).rest, since: SINCE })).rejects.toThrow('grants-A-unreadable');
    await expect(captureGrants({ rest: world({ badGrant: true }).rest, since: SINCE })).rejects.toThrow('grants-A-shape');
  });
  it('revokes each captured grant once, as its user, with readback, and accepts already-revoked', async () => {
    const w = world();
    const captured = [{ slot: 'A', grantId: G1 }, { slot: 'B', grantId: G2 }, { slot: 'A', grantId: id(904) }];
    const r = await revokeCaptured({ rest: w.rest, captured });
    expect(r.map((x) => [x.grantId, x.outcome])).toEqual([[G1, 'revoked'], [G2, 'revoked'], [id(904), 'already-revoked']]);
    expect(w.calls.filter((c) => c.path.endsWith('oauth_revoke_grant')).map((c) => [c.slot, c.body.p_grant_id])).toEqual([['A', G1], ['B', G2]]);
    expect(w.grants.A.map((g) => g.grant_id)).toEqual([OLD]);
  });
  it('lets the readback decide an ambiguous revoke and stops on a failed one without retrying', async () => {
    const amb = world({ revokeAmbiguous: true });
    expect((await revokeCaptured({ rest: amb.rest, captured: [{ slot: 'A', grantId: G1 }] }))[0]).toMatchObject({ outcome: 'revoked', requestStatus: 0 });
    const noop = world({ revokeNoop: true });
    await expect(revokeCaptured({ rest: noop.rest, captured: [{ slot: 'A', grantId: G1 }] })).rejects.toThrow('revoke-failed');
    expect(noop.calls.filter((c) => c.path.endsWith('oauth_revoke_grant'))).toHaveLength(1);
  });
});

describe('Ticket 232 client-creation capture', () => {
  it('captures new Review practice Behaviors with derived rows and new rows on fixture Behaviors', async () => {
    const w = world();
    const m = manifest();
    const c = await captureCreations({ rest: w.rest, since: SINCE, manifest: m });
    expect(c.newBehaviors).toEqual([id(10)]);
    expect(c.added.map((r) => `${r.table}/${r.id}`).sort()).toEqual([`behavior_schedules/${id(11)}`, `behaviors/${id(10)}`, `occurrence_status_events/${id(13)}`, `occurrences/${id(12)}`].sort());
    expect(c.added.every((r) => r.run_id === RUN)).toBe(true);
    const next = extendManifest(m, c.added, '2026-10-29T21:30:00.000Z');
    expect(next.counts.behaviors).toBe(3);
    expect(next.rows).toHaveLength(10);
    const fixtureRead = w.calls.find((x) => x.path.includes(`behavior_id=eq.${id(2)}`) && x.path.startsWith('/rest/v1/occurrence_status_events'));
    expect(fixtureRead.path).toContain('created_at=gte.');
  });
  it('refuses any other new Behavior, a row from the wrong user, or an old row', async () => {
    await expect(captureCreations({ rest: world({ newBehaviors: { A: [{ id: id(20), user_id: USERS.A, title: 'Something else', created_at: '2026-10-29T21:00:00Z' }] } }).rest, since: SINCE, manifest: manifest() })).rejects.toThrow('unexpected-new-behavior');
    await expect(captureCreations({ rest: world({ derived: { [`occurrences/${id(10)}`]: [{ id: id(21), user_id: USERS.B, created_at: '2026-10-29T21:00:00Z' }] } }).rest, since: SINCE, manifest: manifest() })).rejects.toThrow('occurrences-row-refused');
    await expect(captureCreations({ rest: world({ derived: { [`occurrences/${id(10)}`]: [{ id: id(22), user_id: USERS.A, created_at: '2026-10-01T00:00:00Z' }] } }).rest, since: SINCE, manifest: manifest() })).rejects.toThrow('occurrences-row-refused');
    const many = Array.from({ length: 5 }, (_, i) => ({ id: id(30 + i), user_id: USERS.A, title: 'Review practice', created_at: '2026-10-29T21:00:00Z' }));
    await expect(captureCreations({ rest: world({ newBehaviors: { A: many }, derived: {} }).rest, since: SINCE, manifest: manifest() })).rejects.toThrow('too-many-new-behaviors');
  });
  it('validates the extended manifest with the reviewed generator', () => {
    expect(() => extendManifest(manifest(), [{ table: 'grants', id: id(40), user_id: USERS.A, created_at: '2026-10-29T21:00:00Z', run_id: RUN }], '2026-10-29T21:30:00.000Z')).toThrow();
  });
});

describe('Ticket 232 baseline restoration', () => {
  it('captures status and note hash only', async () => {
    const w = world();
    const b = await captureBaseline({ rest: w.rest, manifest: manifest() });
    expect(b).toEqual([{ slot: 'A', occurrenceId: id(4), status: 'unresolved', noteHash: noteHash('Review sample note') }, { slot: 'B', occurrenceId: id(5), status: 'completed', noteHash: null }]);
    expect(JSON.stringify(b)).not.toContain('Review sample note');
    await expect(captureBaseline({ rest: world({ dropOcc: id(5) }).rest, manifest: manifest() })).rejects.toThrow('baseline-incomplete');
  });
  it('restores a changed note by compare-and-set and a changed status back to Unresolved', async () => {
    const w = world();
    const baseline = await captureBaseline({ rest: w.rest, manifest: manifest() });
    w.occ[id(4)].note = 'MCP Claude web check';
    w.occ[id(4)].status = 'completed';
    const r = await restoreBaseline({ rest: w.rest, baseline, now: () => new Date('2026-10-29T21:40:00Z') });
    expect(r).toEqual([expect.objectContaining({ occurrenceId: id(4), restored: true })]);
    expect(w.occ[id(4)]).toEqual({ id: id(4), status: 'unresolved', note: 'Review sample note' });
    const patch = w.calls.find((c) => c.method === 'PATCH');
    expect(patch.path).toContain('note=eq.MCP%20Claude%20web%20check');
    const rpc = w.calls.find((c) => c.path.endsWith('apply_occurrence_status_transition'));
    expect(rpc.body).toMatchObject({ expected_status: 'completed', expected_latest_event_id: id(99), planned_status: 'unresolved', planned_completed_at: null, planned_event_semantics: 'explicit_user_correction' });
  });
  it('reports a non-Unresolved status baseline instead of guessing, and stops when a restore does not stick', async () => {
    const w = world();
    const baseline = await captureBaseline({ rest: w.rest, manifest: manifest() });
    w.occ[id(5)].status = 'unresolved';
    expect(await restoreBaseline({ rest: w.rest, baseline })).toEqual([expect.objectContaining({ occurrenceId: id(5), status: 'manual-restore-needed' })]);
    const stuck = world({ patchNoop: true });
    const b2 = await captureBaseline({ rest: stuck.rest, manifest: manifest() });
    stuck.occ[id(4)].note = 'changed';
    await expect(restoreBaseline({ rest: stuck.rest, baseline: b2 })).rejects.toThrow('restore-failed');
  });
  it('refuses a note baseline outside the allowed synthetic values', async () => {
    const w = world();
    await expect(restoreBaseline({ rest: w.rest, baseline: [{ slot: 'A', occurrenceId: id(4), status: 'unresolved', noteHash: noteHash('something private') }] })).rejects.toThrow('restore-note-baseline-unknown');
  });
});

describe('Ticket 232 cleanup REST adapter', () => {
  it('makes one attempt with the slot token and never follows redirects', async () => {
    const seen = [];
    const rest = createRest({ origin: 'https://x.test', publishableKey: 'sb_publishable_k', tokenFor: async (s) => `tok-${s}`, fetchImpl: async (u, i) => { seen.push({ u, i }); throw new TypeError('reset'); } });
    expect(await rest('A', 'POST', '/rest/v1/rpc/oauth_revoke_grant', { p_grant_id: G1 })).toEqual({ status: 0, json: null });
    expect(seen).toHaveLength(1);
    expect(seen[0].i).toMatchObject({ method: 'POST', redirect: 'error' });
    expect(seen[0].i.headers).toMatchObject({ apikey: 'sb_publishable_k', Authorization: 'Bearer tok-A' });
    const called = [];
    const none = createRest({ origin: 'https://x.test', publishableKey: 'k', tokenFor: async () => null, fetchImpl: async (u) => { called.push(u); return new Response('[]', { status: 200 }); } });
    expect(await none('B', 'GET', '/x')).toEqual({ status: 0, json: null });
    expect(called).toEqual([]);
  });
});
