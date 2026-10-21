// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BriefingDays } from "@/app/design-system/BriefingDays";
import { RunDifferences, type ViewRun } from "@/app/design-system/BriefingReview";
import { DEFAULT_BRIEFING_CONFIG } from "@cadence/core/services/briefing-config";

let container: HTMLDivElement, root: Root;
let fetcher: ReturnType<typeof vi.fn<typeof fetch>>;
const onOpen = vi.fn(), onRefresh = vi.fn(), onAccountFailure = vi.fn();
const cases = [{ id: 'case-sample-0001', localDate: '2026-09-26', evidenceType: 'retrospective' as const, rerunnable: true,
  createdAt: '2026-09-28T12:00:00Z', source: { mode: 'account' as const, accountRef: 'account-reference', preferenceRevision: 1 }, runs: 0, feedback: 0, proposals: 0 }];
const props = { view: 'days' as const, mode: 'synthetic' as const, accountRef: null, blocked: false,
  configs: [DEFAULT_BRIEFING_CONFIG, DEFAULT_BRIEFING_CONFIG], labels: ['Baseline', 'Candidate'], fixtureId: 'sparse', analysisFixtureId: 'none',
  cases, onOpen, onRefresh, onAccountFailure };
const plan = { mode: 'daily', plannedCalls: 2, days: [], caseIds: [cases[0]!.id] };
const history = { days: [{ localDate: '2026-09-26', logicalAt: '2026-09-26T11:00:00Z', evidenceType: 'retrospective', state: 'unavailable',
  retainedCases: [], inspections: [], counts: null, coverage: [{ source: 'occurrences', state: 'unknown', startLocalDate: '2026-06-28',
    endLocalDateExclusive: '2026-09-26', limitations: ['Deleted records are unknown.'] }] }], savedCaseId: null };
beforeEach(async () => {
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  fetcher = vi.fn<typeof fetch>(); vi.stubGlobal('fetch', fetcher);
  await act(async () => root.render(<BriefingDays {...props} />));
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
const button = (name: string) => [...container.querySelectorAll('button')].find(node => node.textContent === name)!;
const click = async (node: HTMLElement) => { await act(async () => node.click()); };

it('shows pipeline changes and discloses unrecorded presentation provenance', async () => {
  const a: ViewRun = { id: null, candidateId: null, label: 'A', state: 'error', validation: 'withheld', latencyMs: 0,
    inspector: {}, config: DEFAULT_BRIEFING_CONFIG, pipelineVersion: '3.0' };
  await act(async () => root.render(<RunDifferences a={a} b={{ ...a, pipelineVersion: '3.1' }} />));
  expect(container.textContent).toContain('Pipeline: 3.0 → 3.1');
  expect(container.textContent).toContain('Older runs do not retain those hashes.');
});

it('inspects without generation and keeps missing history unavailable', async () => {
  fetcher.mockResolvedValue(Response.json(history));
  await click(button('Analyze days without a model'));
  expect(fetcher).toHaveBeenCalledOnce();
  expect(fetcher.mock.calls[0]![0]).toBe('/api/dev/briefing-history');
  expect(JSON.parse(fetcher.mock.calls[0]![1]!.body as string).logicalTime).toBe('07:00');
  expect(container.textContent).toContain('Deleted records are unknown.');
  expect(button('Save day for comparison').disabled).toBe(true);
});

it('preserves a selected day sequence across Compare and Days views', async () => {
  await click(container.querySelector('input[type=checkbox]')!);
  await act(async () => root.render(<BriefingDays {...props} view="compare" />));
  await act(async () => root.render(<BriefingDays {...props} view="days" />));
  expect(container.querySelector<HTMLInputElement>('input[type=checkbox]')!.checked).toBe(true);
  expect(button('Plan daily briefs').disabled).toBe(false);
});

it('requires a no-model plan, freezes its configs, and prevents dispatch after draft changes', async () => {
  fetcher.mockResolvedValue(Response.json(plan));
  await click(container.querySelector('input[type=checkbox]')!);
  await click(button('Plan daily briefs'));
  expect(JSON.parse(fetcher.mock.calls[0]![1]!.body as string)).toMatchObject({ action: 'simulate', warmup: [], callBudget: 100 });
  expect(container.textContent).toContain('Planned calls: 2');
  expect(button('Generate daily briefs').disabled).toBe(false);
  await act(async () => root.render(<BriefingDays {...props} configs={[DEFAULT_BRIEFING_CONFIG, { ...DEFAULT_BRIEFING_CONFIG, tone: 'warm' }]} />));
  expect(button('Generate daily briefs').disabled).toBe(true);
  expect(fetcher).toHaveBeenCalledOnce();
});

it('cancels queued work and keeps unsaved completed output visible', async () => {
  const result = { caseId: cases[0]!.id, localDate: '2026-09-26', side: 0, laneId: null, state: 'ready', saved: false,
    candidateId: 'candidate-0001', inspector: {}, validation: 'passed', latencyMs: 1,
    briefing: { text: 'A retained result.', localDate: '2026-09-26', timezone: 'America/New_York', generatedAt: '2026-09-26T11:00:00Z',
      expiresAt: '2026-09-26T11:05:00Z', coverage: 'complete', warnings: [] } };
  fetcher.mockResolvedValueOnce(Response.json(plan))
    .mockResolvedValueOnce(Response.json({ id: 'sequence-0001', state: 'running', dispatchedCalls: 1, results: [result] }))
    .mockResolvedValueOnce(Response.json({ id: 'sequence-0001', state: 'cancelled', dispatchedCalls: 1, results: [result] }));
  await click(container.querySelector('input[type=checkbox]')!);
  await click(button('Plan daily briefs')); await click(button('Generate daily briefs')); await click(button('Cancel queued work'));
  expect(fetcher.mock.calls[2]![1]!.method).toBe('DELETE');
  expect(container.textContent).toContain('cancelled · 1 dispatched calls');
  expect(container.textContent).toContain('Not saved');
  expect(container.textContent).toContain('A retained result.');
});

it('retains rejected attempts when the sequence exceeds its call budget', async () => {
  fetcher.mockResolvedValueOnce(Response.json(plan))
    .mockResolvedValueOnce(Response.json({ id: 'sequence-rejected', state: 'error', dispatchedCalls: 0,
      results: [{ caseId: cases[0]!.id, localDate: '2026-09-26', side: 0, laneId: null, state: 'error', saved: true, error: 'comparison_limit' }] }, { status: 429 }));
  await click(container.querySelector('input[type=checkbox]')!);
  await click(button('Plan daily briefs')); await click(button('Generate daily briefs'));
  expect(container.textContent).toContain('error · 0 dispatched calls');
  expect(container.textContent).toContain('comparison_limit');
  expect(button('Read saved output')).toBeDefined();
});

it.each(['cancel', 'report'] as const)('ignores an old %s failure after switching sources', async action => {
  await act(async () => root.render(<BriefingDays key="account" {...props} mode="account" accountRef="account-reference" />));
  await click(container.querySelector('section[aria-label="Consecutive day review"] input[type=checkbox]')!);
  if (action === 'cancel') {
    fetcher.mockResolvedValueOnce(Response.json(plan))
      .mockResolvedValueOnce(Response.json({ id: 'sequence-0001', state: 'running', dispatchedCalls: 0, results: [] }));
    await click(button('Plan daily briefs'));
    await click(button('Generate daily briefs'));
  }
  let rejectRequest!: (reason: Error) => void;
  fetcher.mockReturnValueOnce(new Promise<Response>((_, reject) => { rejectRequest = reject; }));
  await click(button(action === 'cancel' ? 'Cancel queued work' : 'Write local review report'));
  await act(async () => root.render(<BriefingDays key="synthetic" {...props} />));
  await act(async () => rejectRequest(new Error('context_changed')));
  expect(onAccountFailure).not.toHaveBeenCalled();
  expect(container.querySelector('[role="alert"]')).toBeNull();
});

it('requires a new plan after saving another selected day', async () => {
  fetcher.mockResolvedValueOnce(Response.json(plan));
  await click(container.querySelector('input[type=checkbox]')!);
  await click(button('Plan daily briefs'));
  const nextHistory = { ...history, days: [{ ...history.days[0], localDate: '2026-09-27',
    logicalAt: '2026-09-27T11:00:00Z', state: 'available' }] };
  fetcher.mockResolvedValueOnce(Response.json(nextHistory))
    .mockResolvedValueOnce(Response.json({ ...nextHistory, savedCaseId: 'case-sample-0002' }));
  await click(button('Analyze days without a model'));
  await click(button('Save day for comparison'));
  expect(button('Generate daily briefs')).toBeUndefined();
  fetcher.mockResolvedValueOnce(Response.json({ ...plan, plannedCalls: 4 }));
  await click(button('Plan daily briefs'));
  expect(JSON.parse(fetcher.mock.calls.at(-1)![1]!.body as string).caseIds).toEqual([cases[0]!.id, 'case-sample-0002']);
});
