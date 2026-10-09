import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Temporal } from '@js-temporal/polyfill';
import { DEFAULT_BRIEFING_CONFIG } from '@cadence/core/services/briefing-config';
import { briefingFixture } from '@/lib/services/briefing-fixtures';
import type { BriefingConfig } from '@cadence/core/types/briefing-config';

const mocks = vi.hoisted(() => ({ authenticate: vi.fn(), preferences: vi.fn(), settings: vi.fn(), labels: vi.fn(), capture: vi.fn(), current: vi.fn(), begin: vi.fn(), finish: vi.fn() }));
vi.mock('@/lib/services/google-calendar-request', () => ({ authenticateCalendarRequest: mocks.authenticate,
  calendarResponse: (_request: Request, body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } }),
  calendarPreflight: vi.fn(), readCalendarRequestBody: vi.fn() }));
vi.mock('@/lib/db/daily-brief.repo', () => ({ readDailyBriefPreferences: mocks.preferences, listBriefingWorkbenchBehaviors: mocks.labels,
  beginDailyBrief: mocks.begin, finishDailyBrief: mocks.finish, DailyBriefStorageError: class extends Error {} }));
vi.mock('@/lib/services/daily-brief.service', () => ({ getDailyBriefSettings: mocks.settings }));
vi.mock('@/lib/services/briefing-account-context.service', () => ({ prepareAccountBriefingContexts: mocks.capture,
  briefingAccountRef: (userId: string) => `account_${userId}`, workbenchBehaviorRef: (_userId: string, id: string) => `behavior_${id}` }));

const origin = 'http://127.0.0.1:4321';
const caller = { user: { id: 'owner' }, client: {} };
const preferences = { enabled: true, includeCalendar: true, revision: 4, calendarConnectionGeneration: 1, calendarSelectionRevision: 1 };
const settings = { accountRef: 'account_owner', enabled: true, includeCalendar: true, revision: 4, available: true, localDate: '2026-11-01', timezone: 'America/New_York' };
function config(historyDays = 90): BriefingConfig { return structuredClone({ ...DEFAULT_BRIEFING_CONFIG, context: { ...DEFAULT_BRIEFING_CONFIG.context, includeCompletionHistory: true }, scope: { ...DEFAULT_BRIEFING_CONFIG.scope, historyDays } }); }
function request(overrides = {}, signal?: AbortSignal) { return new Request(`${origin}/api/dev/briefing-comparison`, {
  method: 'POST', headers: { origin, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' }, signal,
  body: JSON.stringify({ mode: 'account', accountRef: 'account_owner', preferenceRevision: 4, configs: [config(), config(30)], ...overrides }),
}); }
const output = { text: 'Review your supplied context.', occurrenceRefs: [], suggestions: [] };

beforeEach(() => {
  vi.resetModules(); Reflect.deleteProperty(globalThis, Symbol.for("cadence.briefingBenchBudget")); vi.resetAllMocks(); vi.stubEnv('NODE_ENV', 'development');
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-11-01T12:00:00Z'));
  mocks.authenticate.mockResolvedValue(caller); mocks.preferences.mockResolvedValue(preferences); mocks.settings.mockResolvedValue(settings);
  mocks.labels.mockResolvedValue([{ id: 'owned', title: 'Private Behavior' }]);
  mocks.current.mockResolvedValue(undefined);
  mocks.capture.mockImplementation(async (_caller, input) => ({ preferences,
    contexts: input.historyDays.map((days: number) => briefingFixture('sparse', config(days))),
    configurationRefs: { behavior_owned: 'behavior_fixture' }, assertCurrent: mocks.current }));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

it('explains why a signed-in account cannot use port 3000', async () => {
  const { readBriefingWorkbenchAccount } = await import('@/lib/services/briefing-workbench.service');
  const response = await readBriefingWorkbenchAccount(new Request('http://127.0.0.1:3000/api/dev/briefing-comparison', {
    headers: { 'sec-fetch-site': 'same-origin' },
  }));
  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({ error: 'access_denied', recovery: 'Open this development workbench on localhost port 4321–4330.' });
  expect(mocks.authenticate).not.toHaveBeenCalled();
});

it('captures once, freezes planning, narrows each scope and never consumes daily admission', async () => {
  const { runBriefingComparison } = await import('@/lib/services/briefing-workbench.service');
  const narrow = { ...config(30), scope: { ...config(30).scope, includeCalendar: false, behaviorRefs: [] } };
  const generate = vi.fn(async () => { vi.setSystemTime(Date.now() + 1000); return output; });
  const response = await runBriefingComparison(request({ configs: [config(), narrow] }), generate);
  expect(response.status).toBe(200); expect(mocks.capture).toHaveBeenCalledOnce();
  expect(mocks.capture.mock.calls[0][1]).toMatchObject({ historyDays: [90, 30], includeCalendar: true, includeRecordedElapsedDurations: false });
  const calls = generate.mock.calls as unknown as [{ facts: string }][];
  const facts = calls.map(([input]) => JSON.parse(input.facts));
  expect(facts.map(value => value.context.snapshotId)).toEqual([facts[0].context.snapshotId, facts[0].context.snapshotId]);
  expect(facts.map(value => value.plan.generatedAt)).toEqual(['2026-11-01T12:00:00Z', '2026-11-01T12:00:00Z']);
  expect(facts[1].context.cadence.history.lookbackDays).toBe(30);
  expect(facts[1].context.cadence.occurrences).toEqual([]); expect(facts[1].context.cadence.history.behaviors).toEqual([]);
  expect(facts[1].context).not.toHaveProperty('connectors');
  expect(mocks.current).toHaveBeenCalledTimes(7);
  expect(mocks.begin).not.toHaveBeenCalled(); expect(mocks.finish).not.toHaveBeenCalled();
  expect(response.headers.get('cache-control')).toContain('no-store');
});

it('maps only authorized Behavior handles and intersects Calendar consent', async () => {
  const { runBriefingComparison } = await import('@/lib/services/briefing-workbench.service');
  mocks.preferences.mockResolvedValue({ ...preferences, includeCalendar: false });
  mocks.capture.mockImplementation(async (_caller, input) => ({ preferences: { ...preferences, includeCalendar: false },
    contexts: input.historyDays.map((days: number) => briefingFixture('sparse', config(days))), configurationRefs: { behavior_owned: 'behavior_fixture' }, assertCurrent: mocks.current }));
  const scoped = { ...config(), scope: { ...config().scope, behaviorRefs: ['behavior_owned'] } };
  const generate = vi.fn<(input: { facts: string }) => Promise<typeof output>>().mockResolvedValue(output);
  expect((await runBriefingComparison(request({ configs: [scoped, scoped] }), generate)).status).toBe(200);
  for (const [input] of generate.mock.calls) {
    const facts = JSON.parse(input.facts).context;
    expect(facts.cadence.occurrences[0].behaviorRef).toBe('behavior_fixture');
    expect(facts).not.toHaveProperty('connectors');
  }
  const unauthorized = { ...scoped, scope: { ...scoped.scope, behaviorRefs: ['behavior_other_owner'] } }; generate.mockClear();
  expect((await runBriefingComparison(request({ configs: [unauthorized, unauthorized] }), generate)).status).toBe(400);
  expect(generate).not.toHaveBeenCalled();
});

it('rejects a different owner, disabled consent and stale consent before model submission', async () => {
  const { runBriefingComparison } = await import('@/lib/services/briefing-workbench.service');
  const generate = vi.fn(async () => output);
  expect((await runBriefingComparison(request({ accountRef: 'account_other' }), generate)).status).toBe(409);
  mocks.preferences.mockResolvedValue({ ...preferences, enabled: false });
  expect((await runBriefingComparison(request(), generate)).status).toBe(403);
  mocks.preferences.mockResolvedValue({ ...preferences, revision: 5 });
  expect((await runBriefingComparison(request(), generate)).status).toBe(403);
  expect(mocks.capture).not.toHaveBeenCalled(); expect(generate).not.toHaveBeenCalled();
});

it('withholds both results if consent or source changes after the first generation', async () => {
  const { runBriefingComparison } = await import('@/lib/services/briefing-workbench.service');
  const { DailyBriefError } = await import('@/lib/services/daily-brief-consumer');
  mocks.current.mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockRejectedValueOnce(new DailyBriefError('context_changed'));
  const generate = vi.fn(async () => ({ ...output, text: 'PRIVATE_GENERATED_TEXT' }));
  const response = await runBriefingComparison(request(), generate);
  expect(response.status).toBe(409); expect(await response.text()).not.toMatch(/PRIVATE_GENERATED_TEXT|inspector|cadence/);
  expect(generate).toHaveBeenCalledOnce();
});

it('withholds expired contexts and aborts before sending the second configuration', async () => {
  const { runBriefingComparison } = await import('@/lib/services/briefing-workbench.service');
  const { assertBriefContextFresh } = await import('@/lib/services/daily-brief-consumer');
  mocks.current.mockImplementation(async () => assertBriefContextFresh(briefingFixture('sparse', config()), Temporal.Now.instant()));
  const generate = vi.fn(async () => { vi.setSystemTime(new Date('2026-11-01T12:05:00Z')); return output; });
  const response = await runBriefingComparison(request(), generate);
  expect(response.status).toBe(409); expect(await response.text()).not.toContain('inspector');
  expect(generate).toHaveBeenCalledOnce();
});

it('loads account labels without capture or generation and hides them when consent is off', async () => {
  const { readBriefingWorkbenchAccount } = await import('@/lib/services/briefing-workbench.service');
  const read = () => readBriefingWorkbenchAccount(new Request(`${origin}/api/dev/briefing-comparison`, { headers: { 'sec-fetch-site': 'same-origin' } }));
  const response = await read(); expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ behaviors: [{ ref: 'behavior_owned', title: 'Private Behavior' }] });
  expect(mocks.labels).toHaveBeenCalledWith(caller.client, 'owner'); expect(mocks.capture).not.toHaveBeenCalled();
  mocks.labels.mockClear(); mocks.settings.mockResolvedValue({ ...settings, enabled: false });
  expect(await (await read()).json()).toMatchObject({ behaviors: [] }); expect(mocks.labels).not.toHaveBeenCalled();
});

it('rejects unauthenticated, production and cross-origin account requests', async () => {
  const { runBriefingComparison, readBriefingWorkbenchAccount } = await import('@/lib/services/briefing-workbench.service');
  const { CalendarConnectionError } = await import('@/lib/services/google-calendar-oauth');
  mocks.authenticate.mockRejectedValue(new CalendarConnectionError('unauthenticated'));
  const generate = vi.fn(async () => output);
  expect((await runBriefingComparison(request(), generate)).status).toBe(401);
  expect((await readBriefingWorkbenchAccount(new Request(`${origin}/api/dev/briefing-comparison`))).status).toBe(403);
  vi.stubEnv('NODE_ENV', 'production'); expect((await runBriefingComparison(request(), generate)).status).toBe(404);
  expect(generate).not.toHaveBeenCalled(); expect(mocks.capture).not.toHaveBeenCalled();
});

it('returns safe synchronization recovery guidance before model submission', async () => {
  const { runBriefingComparison } = await import('@/lib/services/briefing-workbench.service');
  const { AdvisorDayContextServiceError } = await import('@/lib/services/advisor-day-context.service');
  const recovery = 'Open Settings, confirm your current timezone, and choose Save timezone to retry schedule synchronization.';
  mocks.capture.mockRejectedValue(new AdvisorDayContextServiceError('context_incomplete', true, null, recovery));
  const generate = vi.fn(async () => output);
  const response = await runBriefingComparison(request(), generate);
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ error: 'context_incomplete', recovery });
  expect(generate).not.toHaveBeenCalled();
  expect(mocks.begin).not.toHaveBeenCalled();
});


it('requests raw elapsed capture only when at least one comparison configuration selects it', async () => {
  const { runBriefingComparison } = await import('@/lib/services/briefing-workbench.service');
  const selected = { ...config(), context: { ...config().context, includeRecordedElapsedDurations: true } };
  const generate = vi.fn(async () => output);
  expect((await runBriefingComparison(request({ configs: [config(), selected] }), generate)).status).toBe(200);
  expect(mocks.capture).toHaveBeenCalledOnce();
  expect(mocks.capture.mock.calls[0][1].includeRecordedElapsedDurations).toBe(true);
});

it('captures requested historical timing once and excludes it independently from the other comparison', async () => {
  const { runBriefingComparison } = await import('@/lib/services/briefing-workbench.service');
  const first = { ...config(), context: { ...config().context, includeHistoricalCompletionTimes: true } };
  mocks.capture.mockResolvedValue({ contexts: [briefingFixture('sparse', first), briefingFixture('sparse', first)],
    assertCurrent: mocks.current, configurationRefs: {}, preferences });
  const generate = vi.fn(async () => output);
  const response = await runBriefingComparison(request({ configs: [first, config()] }), generate);
  const body = await response.json();
  expect(response.status).toBe(200);
  expect(mocks.capture).toHaveBeenCalledTimes(1);
  expect(mocks.capture.mock.calls[0][1].includeHistoricalCompletionTimes).toBe(true);
  expect(body.results[0].inspector.facts.cadence.historicalCompletionTimes.behaviors[0].typicalMarkedTime).toBe('08:15');
  expect(body.results[1].inspector.facts.cadence).not.toHaveProperty('historicalCompletionTimes');
  expect(mocks.begin).not.toHaveBeenCalled();
  expect(mocks.finish).not.toHaveBeenCalled();
});
