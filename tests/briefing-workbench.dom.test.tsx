// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DailyBriefWorkbench } from "@/app/design-system/DailyBriefBench";
import { BRIEFING_FIXTURE_IDS } from "@/lib/services/briefing-fixtures";

let container: HTMLDivElement;
let root: Root;
let fetcher: ReturnType<typeof vi.fn<typeof fetch>>;

const briefing = (text: string) => ({
  text,
  localDate: "2026-11-01",
  timezone: "America/New_York",
  generatedAt: "2026-11-01T12:00:00Z",
  expiresAt: "2026-11-01T12:04:00Z",
  coverage: "complete",
  warnings: [],
  suggestions: [],
  references: [],
  versions: { configuration: "config", references: "references", planner: "planner", pipeline: "pipeline" },
});

function comparison(text = "Generated comparison") {
  return {
    model: "synthetic-model",
    fixtureVersion: "synthetic-fixture",
    usage: "unavailable",
    results: [0, 1].map((index) => ({ state: "ready", briefing: briefing(`${text} ${index + 1}`), inspector: { fact: "FACTS_STAY_IN_MEMORY" }, latencyMs: 1, validation: "passed" })),
  };
}

function button(label: string, index = 0) {
  const matches = [...container.querySelectorAll<HTMLButtonElement>("button")].filter((element) => element.textContent?.trim() === label);
  if (!matches[index]) throw new Error(`Missing button: ${label}`);
  return matches[index];
}

function change(element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, value: string) {
  const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype
    : element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(element, value);
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

it('shows the server recovery instructions when comparison context is incomplete', async () => {
  fetcher.mockResolvedValueOnce(Response.json({ error: 'context_incomplete', recovery: 'Open Settings and choose Save timezone.' }, { status: 409 }));
  await act(() => button('Run comparison').click());
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('context_incomplete. Open Settings and choose Save timezone.');
  expect(fetcher).toHaveBeenCalledTimes(1);
});

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  localStorage.clear();
  fetcher = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", fetcher);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(() => root.render(<DailyBriefWorkbench />));
});

afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Daily Brief workbench", () => {
  it("exposes the evaluation matrix without generating on fixture selection", async () => {
    const select = [...container.querySelectorAll("select")].find(element => element.parentElement?.textContent?.startsWith("Synthetic snapshot"))!;
    expect([...select.options].map(option => option.value)).toEqual([...BRIEFING_FIXTURE_IDS]);
    for (const id of BRIEFING_FIXTURE_IDS) await act(() => change(select, id));
    expect(select.value).toBe(BRIEFING_FIXTURE_IDS.at(-1));
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("renders withheld failures alongside valid bubbles and exposes inspector versions", async () => {
    const body = comparison();
    const inspector = { recipe: { id: "daily_brief", version: "1.0" }, policyVersion: "3.0", configurationRevision: "reviewed-config" };
    fetcher.mockResolvedValue(Response.json({ ...body, results: [
      { state: "error", error: "advisor_unavailable", validation: "withheld", latencyMs: 1, inspector },
      { ...body.results[1], inspector },
    ] }));
    await act(() => button("Run comparison").click());
    expect(container.textContent).toContain("withheld; 1 ms");
    expect(container.textContent).toContain("advisor_unavailable");
    expect(container.textContent).toContain("Generated comparison 2");
    expect(container.textContent).not.toContain("Generated comparison 1");
    const inspectors = [...container.querySelectorAll("details")].filter(element => element.querySelector("summary")?.textContent?.includes("versions and planner inspector"));
    expect(inspectors).toHaveLength(2);
    for (const details of inspectors) {
      await act(() => details.querySelector("summary")!.click());
      expect(details.open).toBe(true);
      expect(JSON.parse(details.querySelector("pre")!.textContent!)).toEqual(inspector);
    }
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("does not generate on mount, configuration edits, preset loads, or JSON loads", async () => {
    expect(fetcher).not.toHaveBeenCalled();
    await act(() => change(container.querySelector<HTMLSelectElement>('select[aria-label="tone 1"]')!, "warm"));
    const preset = container.querySelector<HTMLSelectElement>('select[aria-label="Preset 1"]')!;
    await act(() => change(preset, "cadence-default"));
    await act(() => button("Edit JSON").click());
    await act(() => button("Load into configuration 1").click());
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("sends exactly two validated configurations only after an explicit run", async () => {
    fetcher.mockResolvedValue(Response.json(comparison()));
    await act(() => button("Run comparison").click());
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe("/api/dev/briefing-comparison");
    expect(init).toMatchObject({ method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" } });
    const body = JSON.parse(init!.body as string);
    expect(Object.keys(body).sort()).toEqual(["configs", "fixtureId"]);
    expect(body.fixtureId).toBe("sparse");
    expect(body.configs).toHaveLength(2);
    expect(body.configs.every((value: unknown) => value && typeof value === "object")).toBe(true);
    await vi.waitFor(() => expect(container.textContent).toContain("Generated comparison 2"));
  });

  it("discards late results after an edit and after cancellation", async () => {
    const edited = deferred<Response>();
    const cancelled = deferred<Response>();
    fetcher.mockImplementationOnce(() => edited.promise).mockImplementationOnce(() => cancelled.promise);
    await act(() => button("Run comparison").click());
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    await act(() => change(container.querySelector<HTMLSelectElement>('select[aria-label="tone 1"]')!, "warm"));
    await act(() => edited.resolve(Response.json(comparison("Discard edited"))));
    expect(container.textContent).not.toContain("Discard edited");

    await act(() => button("Run comparison").click());
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    await act(() => button("Cancel comparison").click());
    await act(() => cancelled.resolve(Response.json(comparison("Discard cancelled"))));
    expect(container.textContent).not.toContain("Discard cancelled");
    expect(container.textContent).toContain("Static long-text fixture (not model-generated)");
  });

  it("persists only validated configuration, never generated facts, output, or review notes", async () => {
    fetcher.mockResolvedValue(Response.json(comparison("MODEL_OUTPUT_STAYS_IN_MEMORY")));
    await act(() => button("Run comparison").click());
    await vi.waitFor(() => expect(container.textContent).toContain("MODEL_OUTPUT_STAYS_IN_MEMORY"));
    const notes = [...container.querySelectorAll<HTMLTextAreaElement>("textarea")].find((element) => element.parentElement?.textContent?.includes("Qualitative review notes"))!;
    await act(() => change(notes, "REVIEW_NOTES_STAY_IN_MEMORY"));
    await act(() => button("Save draft").click());

    expect(localStorage.length).toBe(1);
    expect(localStorage.key(0)).toBe("cadence.briefing-workbench.config.v1");
    const stored = localStorage.getItem("cadence.briefing-workbench.config.v1")!;
    expect(JSON.parse(stored)).toMatchObject({ version: "1.3", recipe: { id: "daily_brief", version: "1.0" }, scope: { historyDays: 90 } });
    expect(stored).not.toMatch(/MODEL_OUTPUT|FACTS_STAY|REVIEW_NOTES|snapshotId|accountRef/);
  });

  it("rejects invalid imported configuration without changing the current configuration", async () => {
    const history = container.querySelector<HTMLInputElement>('input[aria-label="History days 1"]')!;
    expect(history.value).toBe("90");
    await act(() => button("Edit JSON").click());
    const editor = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Configuration JSON editor"]')!;
    await act(() => change(editor, JSON.stringify({ version: "1.0", prompt: "arbitrary prompt" })));
    await act(() => button("Load into configuration 1").click());
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Invalid configuration JSON");
    expect(history.value).toBe("90");
    expect(fetcher).not.toHaveBeenCalled();
  });
});

const accountMetadata = (accountRef = 'account_owner') => ({
  settings: { accountRef, available: true, enabled: true, includeCalendar: false, revision: 4, localDate: '2026-11-01', timezone: 'America/New_York' },
  behaviors: [{ ref: 'behavior_owned', title: 'PRIVATE_ACCOUNT_BEHAVIOR' }],
});
function accountComparison() {
  return { ...comparison('PRIVATE_ACCOUNT_RESULT'), mode: 'account', accountRef: 'account_owner', preferenceRevision: 4,
    capturedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString() };
}
async function selectAccount() {
  await act(() => change(container.querySelector<HTMLSelectElement>('select[aria-label="Context source"]')!, 'account'));
}

it('shows account sign-in requirements without generating or persisting anything', async () => {
  fetcher.mockResolvedValue(Response.json({ error: 'unauthenticated' }, { status: 401 }));
  await selectAccount();
  expect(fetcher).toHaveBeenCalledOnce(); expect(fetcher.mock.calls[0][1]?.method).toBeUndefined();
  expect(container.querySelector('a[href^="/login?next="]')?.textContent).toBe('Sign in to My account');
  expect(button('Run comparison').disabled).toBe(true); expect(localStorage.length).toBe(0);
});

it('runs account comparison only on click, binds the expected owner, and keeps private scopes in memory', async () => {
  fetcher.mockImplementation(async (_url, init) => Response.json(init?.method === 'POST' ? accountComparison() : accountMetadata()));
  await selectAccount();
  expect(fetcher).toHaveBeenCalledOnce(); expect(container.textContent).toContain('PRIVATE_ACCOUNT_BEHAVIOR');
  expect(button('Run comparison').disabled).toBe(false);
  const calendar = [...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find(input => input.parentElement?.textContent === 'Include available Calendar context')!;
  expect(calendar.disabled).toBe(true); expect(calendar.checked).toBe(false);
  expect(button('Save draft').disabled).toBe(true); expect(button('Export configuration').disabled).toBe(true);
  await act(() => button('Run comparison').click());
  expect(fetcher).toHaveBeenCalledTimes(3);
  const post = fetcher.mock.calls.find(([, init]) => init?.method === 'POST')![1]!;
  expect(JSON.parse(post.body as string)).toMatchObject({ mode: 'account', accountRef: 'account_owner', preferenceRevision: 4, configs: expect.any(Array) });
  expect(JSON.parse(post.body as string)).not.toHaveProperty('fixtureId');
  expect(container.textContent).toContain('PRIVATE_ACCOUNT_RESULT'); expect(localStorage.length).toBe(0);
  await act(() => window.dispatchEvent(new Event('blur')));
  expect(container.textContent).toContain('PRIVATE_ACCOUNT_RESULT');
  await act(() => window.dispatchEvent(new Event('focus')));
  expect(container.textContent).toContain('PRIVATE_ACCOUNT_RESULT');
  expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
  await act(() => window.dispatchEvent(new Event('pagehide')));
  expect(container.textContent).not.toContain('PRIVATE_ACCOUNT_RESULT'); expect(container.textContent).not.toContain('PRIVATE_ACCOUNT_BEHAVIOR');
});

it.each(['account', 'consent', 'unavailable', 'hidden'] as const)('clears private inspection on %s changes', async (reason) => {
  fetcher.mockImplementation(async (_url, init) => Response.json(init?.method === 'POST' ? accountComparison() : accountMetadata()));
  await selectAccount(); await act(() => button('Run comparison').click());
  expect(container.textContent).toContain('PRIVATE_ACCOUNT_RESULT');
  if (reason === 'hidden') {
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    await act(() => document.dispatchEvent(new Event('visibilitychange')));
  } else {
    const metadata = accountMetadata(reason === 'account' ? 'account_other' : 'account_owner');
    if (reason === 'consent') { metadata.settings.enabled = false; metadata.settings.revision++; metadata.behaviors = []; }
    fetcher.mockImplementation(async () => reason === 'unavailable'
      ? Response.json({ error: 'unauthenticated' }, { status: 401 }) : Response.json(metadata));
    await act(() => window.dispatchEvent(new Event('focus')));
  }
  expect(container.textContent).not.toContain('PRIVATE_ACCOUNT_RESULT');
  expect(container.textContent).not.toContain('FACTS_STAY_IN_MEMORY');
  expect(localStorage.length).toBe(0);
});

it('withholds private results when the signed-in account changes before delivery', async () => {
  fetcher.mockResolvedValueOnce(Response.json(accountMetadata()))
    .mockResolvedValueOnce(Response.json(accountComparison()))
    .mockResolvedValueOnce(Response.json(accountMetadata('account_other')));
  await selectAccount(); await act(() => button('Run comparison').click());
  expect(container.textContent).not.toContain('PRIVATE_ACCOUNT_RESULT'); expect(container.textContent).not.toContain('PRIVATE_ACCOUNT_BEHAVIOR');
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('context_changed');
});

it('discards a late private comparison on mode change but retains delivered results after snapshot expiry', async () => {
  const pending = deferred<Response>();
  fetcher.mockImplementation(async (_url, init) => init?.method === 'POST' ? pending.promise : Response.json(accountMetadata()));
  await selectAccount(); await act(() => button('Run comparison').click());
  const postSignal = fetcher.mock.calls.find(([, init]) => init?.method === 'POST')![1]!.signal;
  await act(() => change(container.querySelector<HTMLSelectElement>('select[aria-label="Context source"]')!, 'synthetic'));
  expect(postSignal?.aborted).toBe(true);
  await act(() => pending.resolve(Response.json(accountComparison())));
  expect(container.textContent).not.toContain('PRIVATE_ACCOUNT_RESULT');
  expect(container.textContent).not.toContain('PRIVATE_ACCOUNT_BEHAVIOR');

  // The bench rejects a response whose snapshot already expired at delivery, so keep a margin for slow CI runners.
  fetcher.mockImplementation(async (_url, init) => Response.json(init?.method === 'POST' ? { ...accountComparison(), expiresAt: new Date(Date.now() + 1_000).toISOString() } : accountMetadata()));
  await selectAccount(); await act(() => button('Run comparison').click());
  expect(container.textContent).toContain('PRIVATE_ACCOUNT_RESULT');
  await act(() => new Promise(resolve => setTimeout(resolve, 1_100)));
  expect(container.textContent).toContain('PRIVATE_ACCOUNT_RESULT');
  expect(container.textContent).toContain('FACTS_STAY_IN_MEMORY');
  expect(container.textContent).toContain('Snapshot expired. These results remain available for inspection.');
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(localStorage.length).toBe(0);
});


it('keeps context controls independent, marks finish times unavailable, and withdraws pending output after a duration edit', async () => {
  const checkbox = (name: string) => container.querySelector<HTMLInputElement>(`input[aria-label="${name} 1"]`)!;
  expect(container.textContent).toContain('Recipe: Daily Brief');
  expect(checkbox('Historical completion times').disabled).toBe(false);
  await act(async () => { checkbox('Historical completion times').click(); });
  expect(checkbox('Completion history').checked).toBe(false);
  expect(checkbox('Historical average duration').checked).toBe(true);
  await act(() => checkbox('Recorded elapsed durations').click());
  expect(checkbox('Recorded elapsed durations').checked).toBe(true);
  expect(checkbox('Completion history').checked).toBe(false);
  expect(fetcher).not.toHaveBeenCalled();
  const pending = deferred<Response>();
  fetcher.mockImplementationOnce(() => pending.promise);
  await act(() => button('Run comparison').click());
  const payload = JSON.parse(fetcher.mock.calls[0][1]!.body as string);
  expect(payload.configs[0].context).toMatchObject({ includeCompletionHistory: false, includeRecordedElapsedDurations: true, includeHistoricalCompletionTimes: true });
  await act(() => change(container.querySelector<HTMLSelectElement>('select[aria-label="Preferred duration source 1"]')!, 'historical_average'));
  expect(fetcher.mock.calls[0][1]!.signal?.aborted).toBe(true);
  await act(() => pending.resolve(Response.json(comparison('Withdrawn duration result'))));
  expect(container.textContent).not.toContain('Withdrawn duration result');
  expect(fetcher).toHaveBeenCalledOnce();
});

it('migrates legacy saved drafts and rejects unsupported recipe imports without running a comparison', async () => {
  const { DEFAULT_BRIEFING_CONFIG } = await import('@cadence/core/services/briefing-config');
  const legacy = { ...DEFAULT_BRIEFING_CONFIG, version: '1.0' } as Record<string, unknown>;
  delete legacy.recipe; delete legacy.context; delete legacy.analysis;
  localStorage.setItem('cadence.briefing-workbench.config.v1', JSON.stringify(legacy));
  await act(() => button('Load saved draft').click());
  await act(() => button('Edit JSON').click());
  const editor = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Configuration JSON editor"]')!;
  expect(JSON.parse(editor.value)).toMatchObject({ version: '1.3', recipe: { id: 'daily_brief', version: '1.0' } });
  await act(() => change(editor, JSON.stringify({ ...DEFAULT_BRIEFING_CONFIG, recipe: { id: 'other_recipe', version: '1.0' } })));
  await act(() => button('Load into configuration 1').click());
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('Invalid configuration JSON');
  expect(fetcher).not.toHaveBeenCalled();
});
