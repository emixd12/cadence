import { describe, expect, it } from 'vitest';
import { listGrants, checkpointGrant, revokeCaptured, checkpointCreation, captureCreations, extendManifest, captureBaseline, validateBaseline, restoreBaseline, runRecorded, createRest, noteHash, USERS } from '../scripts/mcp-acceptance-cleanup.mjs';

const SINCE = '2026-10-29T20:43:30.000Z';
const RUN = '4db9fe6e-a966-4cca-938b-aee5a1b955b7';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const G1 = id(901), G2 = id(902), OLD = id(903), GOTHER = id(905);
const grant = (grant_id, created_at, client_id = `client-${grant_id.slice(-3)}`) => ({ grant_id, client_id, client_name: 'Client', client_uri: null, logo_uri: null, verified_client: null, scopes: ['cadence.read'], created_at, last_used_at: null });

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
  const grants = { A: [grant(OLD, '2026-10-20T00:00:00Z'), grant(G1, '2026-10-29T20:50:00Z', 'claude-web'), grant(GOTHER, '2026-10-29T20:52:00Z', 'unrelated')], B: [grant(G2, '2026-10-29T21:00:00Z', 'inspector')] };
  const occ = { [id(4)]: { id: id(4), status: 'unresolved', note: 'Review sample note' }, [id(5)]: { id: id(5), status: 'completed', note: null } };
  const behaviors = { A: o.newBehaviors?.A ?? [{ id: id(10), user_id: USERS.A, title: 'Review practice (Claude web)', created_at: '2026-10-29T20:55:00Z' }], B: o.newBehaviors?.B ?? [] };
  const activity = o.activity ?? [{ activity_id: 7, grant_id: G1, client_name: 'Client', operation: 'create_behavior', outcome: 'success', error_code: null, occurred_at: '2026-10-29T20:55:01Z' }];
  const derived = o.derived ?? { [`behavior_schedules/${id(10)}`]: [{ id: id(11), user_id: USERS.A, created_at: '2026-10-29T20:55:00Z' }], [`occurrences/${id(10)}`]: [{ id: id(12), user_id: USERS.A, created_at: '2026-10-29T20:55:00Z' }], [`occurrence_status_events/${id(2)}`]: [{ id: id(13), user_id: USERS.A, created_at: '2026-10-29T20:56:00Z' }] };
  const rest = async (slot, method, path, body, headers) => {
    calls.push({ slot, method, path, body, headers });
    if (path === '/rest/v1/rpc/oauth_list_grants') return o.grantsFail ? { status: 500, json: null } : { status: 200, json: o.grantRows ?? grants[slot] };
    if (path === '/rest/v1/rpc/oauth_list_activity') return { status: 200, json: activity };
    if (path === '/rest/v1/rpc/oauth_revoke_grant') {
      if (o.failGrant === body.p_grant_id) return { status: 500, json: null };
      if (!o.revokeNoop) grants[slot] = grants[slot].filter((g) => g.grant_id !== body.p_grant_id);
      return { status: o.revokeAmbiguous ? 0 : 200, json: true };
    }
    const m = path.match(/^\/rest\/v1\/([a-z_]+)\?(.*)$/);
    if (m && m[1] === 'behaviors' && method === 'GET') return { status: 200, json: behaviors[slot] };
    if (m && m[1] === 'occurrences' && method === 'GET' && !path.includes('behavior_id=')) {
      const one = path.match(/[?&]id=eq\.([0-9a-f-]+)/);
      if (one) return { status: 200, json: o.substituteRead ? [{ id: id(777), status: 'unresolved', note: null }] : occ[one[1]] ? [{ ...occ[one[1]] }] : [] };
      const ins = path.match(/id=in\.\(([^)]*)\)/)[1].split(',');
      if (o.substitute) return { status: 200, json: ins.map(() => ({ id: id(777), status: 'unresolved', note: null })) };
      return { status: 200, json: ins.filter((x) => occ[x] && o.dropOcc !== x).map((x) => ({ ...occ[x] })) };
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
  it('fails closed on unreadable or malformed grant rows on every read', async () => {
    await expect(listGrants({ rest: world({ grantsFail: true }).rest, slot: 'A' })).rejects.toThrow('grants-A-unreadable');
    for (const bad of [[{}], [{ ...grant(G1, 'not-a-date') }], [{ ...grant(G1, '2026-10-29T20:50:00Z'), client_id: '' }], [{ ...grant(G1, '2026-10-29T20:50:00Z'), scopes: 'x' }], [grant(G1, '2026-10-29T20:50:00Z'), grant(G1, '2026-10-29T20:50:00Z')]]) {
      await expect(listGrants({ rest: world({ grantRows: bad }).rest, slot: 'A' })).rejects.toThrow(/grants-A-(shape|duplicate)/);
    }
  });
  it('checkpoints exactly one new grant per consent, or the exact gate client', async () => {
    const w = world();
    await expect(checkpointGrant({ rest: w.rest, slot: 'A', label: 'claude-web', known: [OLD], since: SINCE })).rejects.toThrow('expected-one-new-grant');
    expect(await checkpointGrant({ rest: w.rest, slot: 'A', label: 'claude-web', known: [OLD, GOTHER], since: SINCE })).toMatchObject({ grantId: G1, clientId: 'claude-web' });
    expect(await checkpointGrant({ rest: w.rest, slot: 'A', label: 'gate', known: [], expectClientId: 'unrelated', since: SINCE })).toMatchObject({ grantId: GOTHER });
    await expect(checkpointGrant({ rest: w.rest, slot: 'A', label: 'gate', known: [], expectClientId: 'missing-client', since: SINCE })).rejects.toThrow('expected-one-new-grant');
    await expect(checkpointGrant({ rest: w.rest, slot: 'A', label: 'old', known: [G1, GOTHER], since: SINCE })).rejects.toThrow('grant-too-old');
  });
  it('revokes only checkpointed grants, as their user, never an unrelated new grant', async () => {
    const w = world();
    const records = [];
    const r = await revokeCaptured({ rest: w.rest, captured: [{ slot: 'A', grantId: G1 }, { slot: 'B', grantId: G2 }, { slot: 'A', grantId: id(904) }], record: (x) => records.push(x) });
    expect(r.map((x) => [x.grantId, x.outcome])).toEqual([[G1, 'revoked'], [G2, 'revoked'], [id(904), 'already-revoked']]);
    expect(w.calls.filter((c) => c.path.endsWith('oauth_revoke_grant')).map((c) => [c.slot, c.body.p_grant_id])).toEqual([['A', G1], ['B', G2]]);
    expect(w.grants.A.map((g) => g.grant_id).sort()).toEqual([GOTHER, OLD].sort());
    expect(records.map((x) => x.outcome)).toEqual(['attempting', 'revoked', 'attempting', 'revoked', 'already-revoked']);
  });
  it('does not treat a malformed list as absence', async () => {
    const w = world({ grantRows: [{}] });
    await expect(revokeCaptured({ rest: w.rest, captured: [{ slot: 'A', grantId: G1 }] })).rejects.toThrow('grants-A-shape');
    expect(w.calls.filter((c) => c.path.endsWith('oauth_revoke_grant'))).toHaveLength(0);
  });
  it('lets the readback decide an ambiguous revoke and stops on a failed one, keeping earlier outcomes', async () => {
    expect((await revokeCaptured({ rest: world({ revokeAmbiguous: true }).rest, captured: [{ slot: 'A', grantId: G1 }] }))[0]).toMatchObject({ outcome: 'revoked', requestStatus: 0 });
    const w = world({ failGrant: G2 });
    const records = [];
    await expect(revokeCaptured({ rest: w.rest, captured: [{ slot: 'A', grantId: G1 }, { slot: 'B', grantId: G2 }], record: (x) => records.push(x) })).rejects.toThrow('revoke-failed');
    expect(records.filter((x) => x.outcome !== 'attempting').map((x) => [x.grantId, x.outcome])).toEqual([[G1, 'revoked'], [G2, 'revoke-failed']]);
    expect(w.calls.filter((c) => c.path.endsWith('oauth_revoke_grant') && c.body.p_grant_id === G2)).toHaveLength(1);
  });
});

describe('Ticket 232 client-creation capture', () => {
  it('checkpoints one new Review practice Behavior with corroborating activity by that grant', async () => {
    const w = world();
    const now = () => new Date('2026-10-29T20:57:00Z');
    expect(await checkpointCreation({ rest: w.rest, slot: 'A', label: 'claude-web-create', grantId: G1, windowStart: '2026-10-29T20:54:00Z', recorded: [], now })).toMatchObject({ behaviorId: id(10), activityIds: [7] });
    await expect(checkpointCreation({ rest: w.rest, slot: 'A', label: 'x', grantId: G2, windowStart: '2026-10-29T20:54:00Z', recorded: [], now })).rejects.toThrow('no-activity');
    await expect(checkpointCreation({ rest: world({ activity: [{ activity_id: 8, grant_id: G1, operation: 'create_behavior', outcome: 'denied', occurred_at: '2026-10-29T20:55:01Z' }] }).rest, slot: 'A', label: 'x', grantId: G1, windowStart: '2026-10-29T20:54:00Z', recorded: [], now })).rejects.toThrow('no-activity');
    await expect(checkpointCreation({ rest: world({ newBehaviors: { A: [{ id: id(20), user_id: USERS.A, title: 'Other', created_at: '2026-10-29T20:55:00Z' }] } }).rest, slot: 'A', label: 'x', grantId: G1, windowStart: '2026-10-29T20:54:00Z', recorded: [], now })).rejects.toThrow('behavior-refused');
    await expect(checkpointCreation({ rest: w.rest, slot: 'A', label: 'x', grantId: G1, windowStart: '2026-10-29T20:54:00Z', recorded: [id(10)], now })).rejects.toThrow('expected-one-new-behavior');
  });
  it('captures only checkpointed Behaviors with derived rows and new rows on fixture Behaviors', async () => {
    const w = world();
    const m = manifest();
    const c = await captureCreations({ rest: w.rest, since: SINCE, manifest: m, creations: [{ slot: 'A', behaviorId: id(10) }] });
    expect(c.added.map((r) => `${r.table}/${r.id}`).sort()).toEqual([`behavior_schedules/${id(11)}`, `behaviors/${id(10)}`, `occurrence_status_events/${id(13)}`, `occurrences/${id(12)}`].sort());
    expect(c.added.every((r) => r.run_id === RUN)).toBe(true);
    expect(extendManifest(m, c.added, '2026-10-29T21:30:00.000Z').counts.behaviors).toBe(3);
    expect(w.calls.find((x) => x.path.includes(`behavior_id=eq.${id(2)}`) && x.path.startsWith('/rest/v1/occurrence_status_events')).path).toContain('created_at=gte.');
  });
  it('refuses an unbound new Behavior, a missing checkpointed one, a wrong-user row or an old row', async () => {
    await expect(captureCreations({ rest: world().rest, since: SINCE, manifest: manifest(), creations: [] })).rejects.toThrow('unexpected-new-behavior');
    await expect(captureCreations({ rest: world().rest, since: SINCE, manifest: manifest(), creations: [{ slot: 'B', behaviorId: id(10) }] })).rejects.toThrow('unexpected-new-behavior');
    await expect(captureCreations({ rest: world({ newBehaviors: { A: [] } }).rest, since: SINCE, manifest: manifest(), creations: [{ slot: 'A', behaviorId: id(10) }] })).rejects.toThrow('checkpointed-behavior-missing');
    await expect(captureCreations({ rest: world({ derived: { [`occurrences/${id(10)}`]: [{ id: id(21), user_id: USERS.B, created_at: '2026-10-29T21:00:00Z' }] } }).rest, since: SINCE, manifest: manifest(), creations: [{ slot: 'A', behaviorId: id(10) }] })).rejects.toThrow('occurrences-row-refused');
    await expect(captureCreations({ rest: world({ derived: { [`occurrences/${id(10)}`]: [{ id: id(22), user_id: USERS.A, created_at: '2026-10-01T00:00:00Z' }] } }).rest, since: SINCE, manifest: manifest(), creations: [{ slot: 'A', behaviorId: id(10) }] })).rejects.toThrow('occurrences-row-refused');
  });
  it('validates the extended manifest with the reviewed generator', () => {
    expect(() => extendManifest(manifest(), [{ table: 'grants', id: id(40), user_id: USERS.A, created_at: '2026-10-29T21:00:00Z', run_id: RUN }], '2026-10-29T21:30:00.000Z')).toThrow();
  });
});

describe('Ticket 232 baseline restoration', () => {
  it('captures status and note hash only, for exactly the requested IDs', async () => {
    const b = await captureBaseline({ rest: world().rest, manifest: manifest() });
    expect(b).toEqual([{ slot: 'A', occurrenceId: id(4), status: 'unresolved', noteHash: noteHash('Review sample note') }, { slot: 'B', occurrenceId: id(5), status: 'completed', noteHash: null }]);
    expect(JSON.stringify(b)).not.toContain('Review sample note');
    await expect(captureBaseline({ rest: world({ dropOcc: id(5) }).rest, manifest: manifest() })).rejects.toThrow('baseline-identity');
    await expect(captureBaseline({ rest: world({ substitute: true }).rest, manifest: manifest() })).rejects.toThrow('baseline-identity');
  });
  it('validates restore input against the manifest before any write', async () => {
    const m = manifest();
    const good = await captureBaseline({ rest: world().rest, manifest: m });
    expect(() => validateBaseline(good, m)).not.toThrow();
    for (const bad of [[good[0]], [...good, good[0]], [{ ...good[0], slot: 'B' }, good[1]], [{ ...good[0], status: 'missed' }, good[1]], [{ ...good[0], noteHash: 'x' }, good[1]], [{ ...good[0], occurrenceId: id(777) }, good[1]]]) {
      expect(() => validateBaseline(bad, m)).toThrow('baseline-invalid');
      const w = world();
      await expect(restoreBaseline({ rest: w.rest, baseline: bad, manifest: m })).rejects.toThrow('baseline-invalid');
      expect(w.calls).toHaveLength(0);
    }
  });
  it('restores a changed note by compare-and-set and a changed status back to Unresolved', async () => {
    const w = world();
    const m = manifest();
    const baseline = await captureBaseline({ rest: w.rest, manifest: m });
    w.occ[id(4)].note = 'MCP Claude web check';
    w.occ[id(4)].status = 'completed';
    const records = [];
    const r = await restoreBaseline({ rest: w.rest, baseline, manifest: m, now: () => new Date('2026-10-29T21:40:00Z'), record: (x) => records.push(x) });
    expect(r).toEqual([expect.objectContaining({ occurrenceId: id(4), restored: true, noteRestored: true })]);
    expect(w.occ[id(4)]).toEqual({ id: id(4), status: 'unresolved', note: 'Review sample note' });
    expect(w.calls.find((c) => c.method === 'PATCH').path).toContain('note=eq.MCP%20Claude%20web%20check');
    expect(w.calls.find((c) => c.path.endsWith('apply_occurrence_status_transition')).body).toMatchObject({ expected_status: 'completed', expected_latest_event_id: id(99), planned_status: 'unresolved', planned_completed_at: null, planned_event_semantics: 'explicit_user_correction' });
    expect(records.map((x) => x.step ?? 'done')).toEqual(['note-attempting', 'status-attempting', 'done']);
    expect(JSON.stringify(records)).not.toContain('MCP Claude web check');
  });
  it('checks the note outcome before the manual-status branch and reports manual status distinctly', async () => {
    const m = manifest();
    const w = world({ patchNoop: true });
    const baseline = await captureBaseline({ rest: w.rest, manifest: m });
    w.occ[id(5)].status = 'unresolved';
    w.occ[id(5)].note = 'changed';
    await expect(restoreBaseline({ rest: w.rest, baseline, manifest: m })).rejects.toThrow('restore-failed');
    const w2 = world();
    const b2 = await captureBaseline({ rest: w2.rest, manifest: m });
    w2.occ[id(5)].status = 'unresolved';
    expect(await restoreBaseline({ rest: w2.rest, baseline: b2, manifest: m })).toEqual([expect.objectContaining({ occurrenceId: id(5), status: 'manual-restore-needed', restored: false, noteRestored: true })]);
  });
  it('stops when a status restore does not stick', async () => {
    const m = manifest();
    const w = world({ rpcNoop: true });
    const baseline = await captureBaseline({ rest: w.rest, manifest: m });
    w.occ[id(4)].status = 'completed';
    await expect(restoreBaseline({ rest: w.rest, baseline, manifest: m })).rejects.toThrow('restore-failed');
  });
  it('requires restore reads to match the requested ID', async () => {
    const m = manifest();
    const baseline = await captureBaseline({ rest: world().rest, manifest: m });
    await expect(restoreBaseline({ rest: world({ substituteRead: true }).rest, baseline, manifest: m })).rejects.toThrow('restore-read-identity');
  });
  it('refuses a note baseline outside the allowed synthetic values', async () => {
    const m = manifest();
    const w = world();
    const baseline = (await captureBaseline({ rest: w.rest, manifest: m })).map((b) => (b.occurrenceId === id(4) ? { ...b, noteHash: noteHash('something private') } : b));
    w.occ[id(4)].note = 'changed';
    await expect(restoreBaseline({ rest: w.rest, baseline, manifest: m })).rejects.toThrow('restore-note-baseline-unknown');
  });
});

describe('Ticket 232 recorded runs', () => {
  it('writes nothing when the receipt already exists', async () => {
    let ran = false;
    const reserve = () => { throw Object.assign(new Error('EEXIST'), { code: 'EEXIST' }); };
    await expect(runRecorded({ at: 'x', reserve, update: () => {}, operation: async () => { ran = true; } })).rejects.toThrow('EEXIST');
    expect(ran).toBe(false);
  });
  it('keeps earlier outcomes and the stop reason when a later item fails', async () => {
    const saved = [];
    const w = world({ failGrant: G2 });
    await expect(runRecorded({ at: 'x', reserve: (v) => saved.push(JSON.stringify(v)), update: (v) => saved.push(JSON.stringify(v)),
      operation: (record) => revokeCaptured({ rest: w.rest, captured: [{ slot: 'A', grantId: G1 }, { slot: 'B', grantId: G2 }], record }) })).rejects.toThrow('revoke-failed');
    const last = JSON.parse(saved.at(-1));
    expect(last.stopped).toBe('revoke-failed');
    expect(last.results.filter((x) => x.outcome !== 'attempting').map((x) => x.outcome)).toEqual(['revoked', 'revoke-failed']);
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
