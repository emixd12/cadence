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
type Result = { state: "ready" | "error"; briefing?: ReturnType<typeof briefing>; error?: string; inspector: unknown; latencyMs: number; validation: string };
const ready = (text: string): Result => ({ state: "ready", briefing: briefing(text), inspector: { fact: "FACTS_IN_INSPECTOR" }, latencyMs: 1, validation: "passed" });

type Candidate = { id: string; label: string; role: "baseline" | "candidate"; parentCandidateId: string | null; proposalId: string | null; rationale: string };
type Detail = { case: Record<string, unknown>; candidates: (Candidate & { config: unknown })[]; runs: Record<string, unknown>[]; feedback: Record<string, unknown>[]; proposals: unknown[]; invalidProposals: string[]; dispositions: unknown[] };

/** A small in-memory stand-in for the development routes. */
const server = {
  cases: new Map<string, Detail>(),
  results: null as Result[] | null,
  save: true,
  mode: "synthetic" as "synthetic" | "account",
  comparison: null as null | ((body: Record<string, unknown>) => Promise<Response> | Response),
  account: (() => Response.json(accountMetadata())) as () => Response | Promise<Response>,
  posts: [] as Record<string, unknown>[],
};

function compareResponse(body: Record<string, unknown>) {
  const review = body.review as { caseId: string; candidates: Candidate[] };
  const configs = body.configs as unknown[];
  const results = server.results ?? configs.map((_, index) => ready(`Generated ${review.candidates[index]!.role} ${server.cases.get(review.caseId)?.runs.length ?? index}`));
  const account = body.mode === "account" || server.mode === "account";
  if (server.save) {
    const detail: Detail = server.cases.get(review.caseId) ?? { case: { id: review.caseId, source: account ? { mode: "account" } : { mode: "synthetic", fixtureId: "sparse" },
      capturedAt: "2026-11-01T12:00:00Z", timezone: "America/New_York", rerunnable: true, behaviorTitles: [] }, candidates: [], runs: [], feedback: [], proposals: [], invalidProposals: [], dispositions: [] };
    review.candidates.forEach((candidate, index) => {
      if (!detail.candidates.some((item) => item.id === candidate.id)) detail.candidates.push({ ...candidate, config: configs[index] });
      detail.runs.push({ id: `run-${detail.runs.length}`, candidateId: candidate.id, createdAt: new Date().toISOString(), model: "synthetic-model", promptRevision: "prompt-a", ...results[index] });
    });
    server.cases.set(review.caseId, detail);
  }
  const runs = server.cases.get(review.caseId)?.runs.slice(-configs.length) ?? [];
  return { mode: body.mode === "saved" ? "saved" : account ? "account" : "synthetic", model: "synthetic-model", fixtureVersion: "synthetic-fixture", usage: "unavailable", results,
    ...(account ? { accountRef: "account_owner", preferenceRevision: 4, capturedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString() } : {}),
    review: { caseId: review.caseId, saved: server.save, runIds: server.save ? runs.map((run) => run.id) : [], candidateIds: review.candidates.map((item) => item.id) } };
}

async function route(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(String(input), "http://127.0.0.1:4321");
  const body = init?.body ? JSON.parse(init.body as string) as Record<string, unknown> : null;
  if (url.pathname === "/api/dev/briefing-comparison") {
    if (init?.method !== "POST") return server.account();
    server.posts.push(body!);
    return server.comparison ? server.comparison(body!) : Response.json(compareResponse(body!));
  }
  if (url.pathname === "/api/dev/briefing-reviews") {
    if (init?.method !== "POST") {
      const caseId = url.searchParams.get("caseId");
      if (caseId) return server.cases.has(caseId) ? Response.json({ detail: server.cases.get(caseId) }) : Response.json({ error: "case_not_found" }, { status: 404 });
      return Response.json({ retentionDays: 30, cases: [...server.cases.values()].map((detail) => ({ id: detail.case.id, createdAt: "2026-11-01T12:00:00Z",
        source: detail.case.source, evidenceType: "synthetic", localDate: "2026-11-01", rerunnable: true, runs: detail.runs.length, feedback: detail.feedback.length, proposals: detail.proposals.length })) });
    }
    const detail = server.cases.get(body!.caseId as string)!;
    if (body!.action === "feedback") { const record = { id: `feedback-${detail.feedback.length}`, createdAt: new Date().toISOString(), candidateIds: [null, null], ...body }; detail.feedback.push(record); return Response.json({ feedback: record }); }
    if (body!.action === "delete") { server.cases.delete(body!.caseId as string); return Response.json({ deleted: body!.caseId }); }
    if (body!.action === "packet") return Response.json({ path: `.local/briefing-bench/v1/synthetic/${detail.case.id}/review-packet.md` });
    if (body!.action === "disposition") { detail.dispositions.push({ id: "disposition-0", ...body }); return Response.json({ disposition: body }); }
  }
  throw new Error(`Unexpected request ${url}`);
}

function button(label: string, index = 0) {
  const matches = [...container.querySelectorAll<HTMLButtonElement>("button")].filter((element) => element.textContent?.trim() === label);
  if (!matches[index]) throw new Error(`Missing button: ${label}`);
  return matches[index];
}
const maybeButton = (label: string) => [...container.querySelectorAll<HTMLButtonElement>("button")].find((element) => element.textContent?.trim() === label) ?? null;
const output = (side: "A" | "B") => container.querySelector(`[aria-label="Output ${side}"]`)!;
const reviewPosts = () => fetcher.mock.calls.filter(([url, init]) => String(url).startsWith("/api/dev/briefing-reviews") && init?.method === "POST").map(([, init]) => JSON.parse(init!.body as string));

function change(element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, value: string) {
  const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype
    : element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(element, value);
  element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  if (!(element instanceof HTMLSelectElement)) element.dispatchEvent(new Event("change", { bubbles: true }));
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  localStorage.clear();
  Object.assign(server, { cases: new Map(), results: null, save: true, mode: "synthetic", comparison: null, account: () => Response.json(accountMetadata()), posts: [] });
  fetcher = vi.fn<typeof fetch>(route);
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

describe("Daily Brief workbench: Compare", () => {
  it("opens on Compare and exposes the evaluation matrix without generating on fixture selection", async () => {
    expect(button("Compare").getAttribute("aria-pressed")).toBe("true");
    const select = [...container.querySelectorAll("select")].find(element => element.parentElement?.textContent?.startsWith("Synthetic snapshot"))!;
    expect([...select.options].map(option => option.value)).toEqual([...BRIEFING_FIXTURE_IDS]);
    for (const id of BRIEFING_FIXTURE_IDS) await act(() => change(select, id));
    expect(select.value).toBe(BRIEFING_FIXTURE_IDS.at(-1));
    expect(button("Rerun candidate on this case").disabled).toBe(true);
    const configurations = [...container.querySelectorAll('details')].filter(element => element.querySelector('summary')?.textContent?.startsWith('Configure '));
    expect(configurations.every(element => !element.open)).toBe(true);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("shows the server recovery instructions when comparison context is incomplete", async () => {
    server.comparison = () => Response.json({ error: "context_incomplete", recovery: "Open Settings and choose Save timezone." }, { status: 409 });
    await act(() => button("Run new comparison").click());
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("context_incomplete. Open Settings and choose Save timezone.");
  });

  it("does not generate on mount, configuration edits, preset loads, or JSON loads", async () => {
    await act(() => change(container.querySelector<HTMLSelectElement>('select[aria-label="tone 1"]')!, "warm"));
    await act(() => change(container.querySelector<HTMLSelectElement>('select[aria-label="Preset 1"]')!, "cadence-default"));
    await act(() => button("Edit JSON").click());
    await act(() => button("Load into configuration 1").click());
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("shows the loaded preset and returns to Choose preset after a custom edit", async () => {
    const preset = container.querySelector<HTMLSelectElement>('select[aria-label="Preset 1"]')!;
    expect(preset.value).toBe("cadence-default");
    await act(() => change(preset, "warm-priorities"));
    expect(preset.value).toBe("warm-priorities");
    expect(container.querySelector<HTMLSelectElement>('select[aria-label="tone 1"]')!.value).toBe("warm");
    expect(container.querySelector<HTMLInputElement>('input[aria-label="Maximum words 1"]')!.value).toBe("80");
    await act(() => change(container.querySelector<HTMLSelectElement>('select[aria-label="tone 1"]')!, "calm"));
    expect(preset.value).toBe("");
  });

  it("sends two validated configurations with a saved-review request, then reads the saved case", async () => {
    await act(() => button("Run new comparison").click());
    await vi.waitFor(() => expect(output("B").textContent).toContain("Generated candidate"));
    const body = server.posts[0]!;
    expect(Object.keys(body).sort()).toEqual(["configs", "fixtureId", "review"]);
    expect(body.fixtureId).toBe("sparse");
    expect(body.configs).toHaveLength(2);
    const review = body.review as { caseId: string; candidates: Candidate[] };
    expect(review.caseId).toMatch(/^case-[a-z0-9-]+$/);
    expect(review.candidates.map((item) => [item.role, item.label])).toEqual([["baseline", "Baseline"], ["candidate", "Candidate"]]);
    expect(fetcher.mock.calls.some(([url]) => String(url) === `/api/dev/briefing-reviews?source=synthetic&caseId=${review.caseId}`)).toBe(true);
    expect(output("A").textContent).toContain("Generated baseline");
    expect(output("A").querySelector('[aria-label="Reading review"]')?.textContent).toMatch(/\d+ visible words · target 80–120/);
    expect(container.textContent).toContain("saved");
  });

  it("renders withheld failures alongside valid bubbles and exposes inspector versions", async () => {
    const inspector = { recipe: { id: "daily_brief", version: "1.0" }, policyVersion: "3.0", configurationRevision: "reviewed-config" };
    server.results = [{ state: "error", error: "advisor_unavailable", validation: "withheld", latencyMs: 1, inspector }, { ...ready("Generated comparison 2"), inspector }];
    await act(() => button("Run new comparison").click());
    await vi.waitFor(() => expect(container.textContent).toContain("withheld; 1 ms"));
    expect(output("A").textContent).toContain("advisor_unavailable");
    expect(output("B").textContent).toContain("Generated comparison 2");
    const inspectors = [...container.querySelectorAll("details")].filter(element => element.querySelector("summary")?.textContent?.includes("versions and planner inspector"));
    expect(inspectors).toHaveLength(2);
    for (const details of inspectors) expect(JSON.parse(details.querySelector("pre")!.textContent!)).toEqual(inspector);
  });

  it("keeps completed results after a configuration edit and marks the changed draft", async () => {
    await act(() => button("Run new comparison").click());
    await vi.waitFor(() => expect(output("B").textContent).toContain("Generated candidate"));
    await act(() => change(container.querySelector<HTMLSelectElement>('select[aria-label="tone 2"]')!, "calm"));
    expect(output("B").textContent).toContain("Generated candidate");
    expect(output("B").textContent).toContain("the draft has changed since this run");
    expect(output("A").textContent).not.toContain("the draft has changed");
  });

  it("cancels a pending comparison, ignores its late response and reloads runs that finished first", async () => {
    const pending = deferred<Response>();
    server.comparison = (body) => {
      const review = body.review as { caseId: string; candidates: Candidate[] };
      server.results = [ready("Finished before cancel"), ready("unused")];
      compareResponse({ ...body, configs: [(body.configs as unknown[])[0]], review: { ...review, candidates: [review.candidates[0]!] } });
      return pending.promise;
    };
    await act(() => button("Run new comparison").click());
    await act(() => button("Cancel comparison").click());
    await act(() => pending.resolve(Response.json({ results: [ready("Discard cancelled")] })));
    expect(container.textContent).not.toContain("Discard cancelled");
    expect(output("A").textContent).toContain("Finished before cancel");
    expect(container.textContent).toContain("Cancelled. Completed results were kept.");
  });

  it("shows unsaved results as Not saved and does not offer feedback for them", async () => {
    server.save = false;
    await act(() => button("Run new comparison").click());
    await vi.waitFor(() => expect(output("B").textContent).toContain("Generated candidate"));
    expect(container.textContent).toContain("Not saved.");
    expect(container.querySelector('textarea[aria-label="Feedback comment"]')).toBeNull();
    const before = output("B").querySelector('[aria-label="Reading review"]')!.textContent;
    server.results = [ready("Short"), ready("A considerably longer alternative to count despite identical timing metadata")];
    await act(() => button("Run new comparison").click());
    expect(output("B").querySelector('[aria-label="Reading review"]')!.textContent).not.toBe(before);
  });

  it("saves anchored prose feedback with the compared runs and an in-output quotation", async () => {
    await act(() => button("Run new comparison").click());
    await vi.waitFor(() => expect(output("B").textContent).toContain("Generated candidate"));
    await act(() => [...container.querySelectorAll<HTMLInputElement>('input[name="briefing-preference"]')].find((input) => input.parentElement?.textContent === "Prefer B")!.click());
    await act(() => change(container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Feedback comment"]')!, "B is clearer, but it repeats itself."));
    const paragraph = [...output("B").querySelectorAll("p")].find((element) => element.textContent?.startsWith("Generated candidate"))!;
    const range = document.createRange(); range.selectNodeContents(paragraph);
    window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range);
    await act(() => button("Quote selected text").click());
    await act(() => change(container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Replacement wording"]')!, "Say it once."));
    await act(() => button("Save feedback").click());
    await vi.waitFor(() => expect(container.querySelector('[aria-label="Saved feedback"]')?.textContent).toContain("B is clearer, but it repeats itself."));
    const [post] = reviewPosts();
    expect(post).toMatchObject({ source: "synthetic", action: "feedback", runIds: ["run-0", "run-1"], preference: "prefer_b",
      quote: { runId: "run-1", text: expect.stringContaining("Generated candidate") }, replacement: "Say it once." });
    expect(container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Feedback comment"]')!.value).toBe("");
  });

  it("keeps a feedback draft while switching views", async () => {
    await act(() => button("Run new comparison").click());
    await vi.waitFor(() => expect(output("B").textContent).toContain("Generated candidate"));
    await act(() => change(container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Feedback comment"]')!, "Half-written note"));
    await act(() => button("Saved reviews").click());
    await act(() => button("Compare").click());
    expect(container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Feedback comment"]')!.value).toBe("Half-written note");
  });

  it("keeps feedback attached to its exact run pair and preserves the selected run after saving", async () => {
    const comment = () => container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Feedback comment"]')!;
    await act(() => button("Run new comparison").click());
    await act(() => change(comment(), "About the original candidate"));
    await act(() => button("Rerun candidate on this case").click());
    expect(comment().value).toBe("");
    await act(() => change(container.querySelector<HTMLSelectElement>('select[aria-label="Candidate run"]')!, "run-1"));
    expect(comment().value).toBe("About the original candidate");
    await act(() => button("Save feedback").click());
    expect(reviewPosts().at(-1).runIds).toEqual(["run-0", "run-1"]);
    expect(container.querySelector<HTMLSelectElement>('select[aria-label="Candidate run"]')!.value).toBe("run-1");
    await act(() => change(comment(), "Do not carry to another case"));
    await act(() => button("Run new comparison").click());
    expect(comment().value).toBe("");
  });

  it("keeps edits made while feedback is saving", async () => {
    await act(() => button("Run new comparison").click());
    const comment = () => container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Feedback comment"]')!;
    await act(() => change(comment(), "First comment"));
    const pending = deferred<Response>();
    fetcher.mockImplementation((input, init) => init?.method === "POST" && String(input).startsWith("/api/dev/briefing-reviews") ? pending.promise : route(input, init));
    await act(() => button("Save feedback").click());
    await act(() => change(comment(), "New thought while saving"));
    await act(() => pending.resolve(Response.json({})));
    expect(comment().value).toBe("New thought while saving");
  });

  it("keeps an unsaved rerun visible beside its baseline without attaching feedback to an older run", async () => {
    await act(() => button("Run new comparison").click());
    server.save = false;
    server.results = [ready("Unsaved revised candidate")];
    await act(() => button("Rerun candidate on this case").click());
    expect(output("A").textContent).toContain("Generated baseline");
    expect(output("B").textContent).toContain("Unsaved revised candidate");
    expect(container.textContent).toContain("Not saved.");
    expect(container.querySelector('textarea[aria-label="Feedback comment"]')).toBeNull();
  });

  it("creates a new candidate when its rationale changes", async () => {
    await act(() => button("Run new comparison").click());
    const original = (server.posts[0]!.review as { candidates: Candidate[] }).candidates[1]!;
    await act(() => change(container.querySelector<HTMLInputElement>('input[aria-label="Candidate rationale"]')!, "Clarify the observation"));
    await act(() => button("Rerun candidate on this case").click());
    const revised = (server.posts[1]!.review as { candidates: Candidate[] }).candidates[0]!;
    expect(revised.id).not.toBe(original.id);
    expect(revised.rationale).toBe("Clarify the observation");
  });

  it("reruns only the candidate on the open case and keeps the pinned baseline output", async () => {
    await act(() => button("Run new comparison").click());
    await vi.waitFor(() => expect(output("B").textContent).toContain("Generated candidate"));
    const caseId = (server.posts[0]!.review as { caseId: string }).caseId;
    await act(() => change(container.querySelector<HTMLInputElement>('input[aria-label="Candidate name"]')!, "Shorter"));
    await act(() => change(container.querySelector<HTMLInputElement>('input[aria-label="Maximum words 2"]')!, "90"));
    await act(() => button("Rerun candidate on this case").click());
    await vi.waitFor(() => expect(output("B").textContent).toContain("Shorter"));
    const rerun = server.posts[1]!;
    expect(rerun).toMatchObject({ mode: "saved", accountRef: null, review: { caseId, candidates: [{ role: "candidate", label: "Shorter" }] } });
    expect(rerun.configs).toHaveLength(1);
    expect(output("A").textContent).toContain("Generated baseline");
    expect(container.querySelector<HTMLSelectElement>('select[aria-label="Candidate run"]')!.options).toHaveLength(2);
    expect(container.querySelector('[aria-label="Output B"]')!.parentElement!.parentElement!.textContent).toContain("Differences between A and B");
  });

  it("writes a review packet, loads a configuration proposal into B and records a decision", async () => {
    await act(() => button("Run new comparison").click());
    await vi.waitFor(() => expect(output("B").textContent).toContain("Generated candidate"));
    const caseId = (server.posts[0]!.review as { caseId: string }).caseId;
    await act(() => button("Write review packet").click());
    await vi.waitFor(() => expect(container.textContent).toContain(`${caseId}/review-packet.md`));
    const { DEFAULT_BRIEFING_CONFIG } = await import("@cadence/core/services/briefing-config");
    server.cases.get(caseId)!.proposals.push({ schemaVersion: 1, kind: "proposal", id: "proposal-0001", caseId, createdAt: "2026-11-01T12:00:00Z", feedbackIds: [],
      interpretedProblem: "The overview repeats the tip.", owner: "configuration", expectedEffect: "One statement.", possibleRegression: "Less context.", rerunCaseIds: [caseId],
      change: { kind: "configuration", label: "Explain once", config: { ...DEFAULT_BRIEFING_CONFIG, length: { maxWords: 90 } }, parentCandidateId: null } });
    await act(() => button("Check for proposals").click());
    await vi.waitFor(() => expect(container.textContent).toContain("The overview repeats the tip."));
    await act(() => button("Load into candidate B").click());
    expect(container.querySelector<HTMLInputElement>('input[aria-label="Candidate name"]')!.value).toBe("Explain once");
    expect(container.querySelector<HTMLInputElement>('input[aria-label="Maximum words 2"]')!.value).toBe("90");
    await act(() => button("Accept").click());
    await vi.waitFor(() => expect(reviewPosts().at(-1)).toMatchObject({ action: "disposition", proposalId: "proposal-0001", decision: "accepted" }));
  });

  it("lists saved reviews, reopens one with its feedback after a remount, and deletes after confirmation", async () => {
    await act(() => button("Run new comparison").click());
    await vi.waitFor(() => expect(output("B").textContent).toContain("Generated candidate"));
    await act(() => change(container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Feedback comment"]')!, "Keep this."));
    await act(() => button("Save feedback").click());
    await vi.waitFor(() => expect(container.querySelector('[aria-label="Saved feedback"]')).not.toBeNull());
    await act(() => root.unmount());
    root = createRoot(container);
    await act(() => root.render(<DailyBriefWorkbench />));
    await act(() => change(container.querySelector<HTMLSelectElement>('select[aria-label="tone 2"]')!, "calm"));
    await act(() => button("Saved reviews").click());
    await vi.waitFor(() => expect(container.textContent).toContain("1 feedback"));
    await act(() => button("Open").click());
    await vi.waitFor(() => expect(container.querySelector('[aria-label="Saved feedback"]')?.textContent).toContain("Keep this."));
    expect(output("B").textContent).toContain("Generated candidate");
    // Opening a case continues from its saved configurations.
    expect(output("B").textContent).not.toContain("the draft has changed");
    await act(() => button("Saved reviews").click());
    await act(() => button("Delete").click());
    await act(() => button("Confirm delete").click());
    await vi.waitFor(() => expect(container.textContent).toContain("No saved reviews yet."));
    expect(server.cases.size).toBe(0);
  });

  it("stores only validated configuration in browser storage, never output or feedback", async () => {
    await act(() => button("Run new comparison").click());
    await vi.waitFor(() => expect(output("B").textContent).toContain("Generated candidate"));
    await act(() => button("Save draft").click());
    expect(localStorage.length).toBe(1);
    const stored = localStorage.getItem("cadence.briefing-workbench.config.v1")!;
    expect(JSON.parse(stored)).toMatchObject({ version: "1.3", recipe: { id: "daily_brief", version: "1.0" }, scope: { historyDays: 90 } });
    expect(stored).not.toMatch(/Generated|FACTS_IN_INSPECTOR|snapshotId|accountRef|caseId/);
  });

  it("rejects invalid imported configuration without changing the current configuration", async () => {
    const history = container.querySelector<HTMLInputElement>('input[aria-label="History days 1"]')!;
    await act(() => button("Edit JSON").click());
    await act(() => change(container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Configuration JSON editor"]')!, JSON.stringify({ version: "1.0", prompt: "arbitrary prompt" })));
    await act(() => button("Load into configuration 1").click());
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Invalid configuration JSON");
    expect(history.value).toBe("90");
    expect(fetcher).not.toHaveBeenCalled();
  });
});

function accountMetadata(accountRef = "account_owner") {
  return {
    settings: { accountRef, available: true, enabled: true, includeCalendar: false, revision: 4, localDate: "2026-11-01", timezone: "America/New_York" },
    behaviors: [{ ref: "behavior_owned", title: "PRIVATE_ACCOUNT_BEHAVIOR" }],
  };
}
async function selectAccount() {
  server.mode = "account";
  await act(() => change(container.querySelector<HTMLSelectElement>('select[aria-label="Context source"]')!, "account"));
}

describe("Daily Brief workbench: My account", () => {
  it("shows account sign-in requirements without generating or persisting anything", async () => {
    server.account = () => Response.json({ error: "unauthenticated" }, { status: 401 });
    await selectAccount();
    expect(fetcher).toHaveBeenCalledOnce(); expect(fetcher.mock.calls[0][1]?.method).toBeUndefined();
    expect(container.querySelector('a[href^="/login?next="]')?.textContent).toBe("Sign in to My account");
    expect(button("Run new comparison").disabled).toBe(true); expect(localStorage.length).toBe(0);
  });

  it("explains a rejected development port without suggesting sign-in", async () => {
    server.account = () => Response.json({ error: "access_denied", recovery: "Open this development workbench on localhost port 4321–4330." }, { status: 403 });
    await selectAccount();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("localhost port 4321–4330");
    expect(container.querySelector('a[href^="/login?next="]')).toBeNull();
    expect(button("Run new comparison").disabled).toBe(true);
  });

  it("runs account comparison only on click, binds the expected owner, and saves the review in the account partition", async () => {
    await selectAccount();
    expect(fetcher).toHaveBeenCalledOnce(); expect(container.textContent).toContain("PRIVATE_ACCOUNT_BEHAVIOR");
    const calendar = [...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find(input => input.parentElement?.textContent === "Include available Calendar context")!;
    expect(calendar.disabled).toBe(true); expect(calendar.checked).toBe(false);
    expect(button("Save draft").disabled).toBe(true); expect(button("Export configuration").disabled).toBe(true);
    await act(() => button("Run new comparison").click());
    await vi.waitFor(() => expect(output("B").textContent).toContain("Generated candidate"));
    expect(server.posts[0]).toMatchObject({ mode: "account", accountRef: "account_owner", preferenceRevision: 4, configs: expect.any(Array), review: { caseId: expect.any(String) } });
    expect(server.posts[0]).not.toHaveProperty("fixtureId");
    expect(fetcher.mock.calls.some(([url]) => String(url).startsWith("/api/dev/briefing-reviews?source=account&caseId="))).toBe(true);
    // Saved account reviews survive focus changes and hidden tabs.
    await act(() => window.dispatchEvent(new Event("focus")));
    vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    await act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(output("B").textContent).toContain("Generated candidate");
    expect(localStorage.length).toBe(0);
  });

  it.each(["account", "consent", "unavailable"] as const)("closes the open account case on %s changes", async (reason) => {
    await selectAccount(); await act(() => button("Run new comparison").click());
    await vi.waitFor(() => expect(output("B").textContent).toContain("Generated candidate"));
    const metadata = accountMetadata(reason === "account" ? "account_other" : "account_owner");
    if (reason === "consent") { metadata.settings.enabled = false; metadata.settings.revision++; metadata.behaviors = []; }
    server.account = () => reason === "unavailable" ? Response.json({ error: "unauthenticated" }, { status: 401 }) : Response.json(metadata);
    await act(() => window.dispatchEvent(new Event("focus")));
    await vi.waitFor(() => expect(output("B").textContent).not.toContain("Generated candidate"));
    expect(container.textContent).not.toContain("FACTS_IN_INSPECTOR");
  });

  it("withholds results when the signed-in account changes before delivery", async () => {
    let calls = 0;
    server.account = () => Response.json(accountMetadata(calls++ === 0 ? "account_owner" : "account_other"));
    await selectAccount(); await act(() => button("Run new comparison").click());
    await vi.waitFor(() => expect(container.querySelector('[role="alert"]')?.textContent).toContain("context_changed"));
    expect(output("B").textContent).not.toContain("Generated candidate");
    expect(container.textContent).not.toContain("PRIVATE_ACCOUNT_BEHAVIOR");
  });

  it.each(["context_changed", "access_denied", "unauthenticated"])("clears previous private results when a new request reports %s", async (error) => {
    await selectAccount();
    await act(() => button("Run new comparison").click());
    await act(() => change(container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Feedback comment"]')!, "PRIVATE_DRAFT"));
    server.comparison = () => Response.json({ error }, { status: 403 });
    await act(() => button("Run new comparison").click());
    expect(output("B").textContent).not.toContain("Generated candidate");
    expect(container.textContent).not.toMatch(/PRIVATE_DRAFT|PRIVATE_ACCOUNT_BEHAVIOR|FACTS_IN_INSPECTOR/);
  });

  it.each(["Save feedback", "Write review packet", "Check for proposals", "Saved reviews"])("clears private results after %s loses authorization", async (action) => {
    await selectAccount();
    await act(() => button("Run new comparison").click());
    await act(() => change(container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Feedback comment"]')!, "PRIVATE_DRAFT"));
    await act(() => change(container.querySelector<HTMLInputElement>('input[aria-label="Candidate name"]')!, "PRIVATE_NAME"));
    fetcher.mockImplementation((input, init) => String(input).startsWith("/api/dev/briefing-reviews")
      ? Promise.resolve(Response.json({ error: "unauthenticated" }, { status: 401 })) : route(input, init));
    await act(() => button(action).click());
    expect(container.textContent).not.toMatch(/Generated candidate|PRIVATE_ACCOUNT_BEHAVIOR|FACTS_IN_INSPECTOR/);
    expect(container.querySelector('textarea[aria-label="Feedback comment"]')).toBeNull();
    expect(container.querySelector<HTMLInputElement>('input[aria-label="Candidate name"]')?.value).not.toBe("PRIVATE_NAME");
    expect(container.textContent).toContain("unauthenticated");
  });

  it("ignores an account refresh that arrives after a review authorization failure", async () => {
    await selectAccount();
    await act(() => button("Run new comparison").click());
    const pending = deferred<Response>();
    server.account = () => pending.promise;
    await act(() => window.dispatchEvent(new Event("focus")));
    fetcher.mockImplementation((input, init) => String(input).startsWith("/api/dev/briefing-reviews")
      ? Promise.resolve(Response.json({ error: "unauthenticated" }, { status: 401 })) : route(input, init));
    await act(() => button("Write review packet").click());
    await act(() => pending.resolve(Response.json(accountMetadata())));
    expect(container.textContent).not.toMatch(/Generated candidate|PRIVATE_ACCOUNT_BEHAVIOR|FACTS_IN_INSPECTOR/);
    expect(button("Run new comparison").disabled).toBe(true);
  });

  it("aborts a pending account comparison on mode change and ignores its late response", async () => {
    const pending = deferred<Response>();
    server.comparison = () => pending.promise;
    await selectAccount(); await act(() => button("Run new comparison").click());
    const postSignal = fetcher.mock.calls.find(([, init]) => init?.method === "POST")![1]!.signal;
    await act(() => change(container.querySelector<HTMLSelectElement>('select[aria-label="Context source"]')!, "synthetic"));
    expect(postSignal?.aborted).toBe(true);
    await act(() => pending.resolve(Response.json({ results: [ready("PRIVATE_LATE"), ready("PRIVATE_LATE")] })));
    expect(container.textContent).not.toContain("PRIVATE_LATE");
    expect(container.textContent).not.toContain("PRIVATE_ACCOUNT_BEHAVIOR");
  });

  it.each(["case", "list"] as const)("ignores late saved-account %s reads after changing source", async (kind) => {
    await selectAccount();
    await act(() => button("Run new comparison").click());
    await act(() => button("Saved reviews").click());
    const pending = deferred<Response>();
    let response!: Response;
    fetcher.mockImplementation(async (input, init) => {
      if (String(input).startsWith("/api/dev/briefing-reviews?source=account")) {
        response = await route(input, init);
        return pending.promise;
      }
      return route(input, init);
    });
    await act(() => button(kind === "case" ? "Open" : "Refresh list").click());
    server.cases.clear();
    await act(() => change(container.querySelector<HTMLSelectElement>('select[aria-label="Context source"]')!, "synthetic"));
    await act(() => pending.resolve(response));
    if (kind === "list") expect(container.textContent).not.toContain("2 runs");
    await act(() => button("Compare").click());
    expect(output("B").textContent).not.toContain("Generated candidate");
  });
});

it("keeps context controls independent and marks finish times unavailable", async () => {
  const checkbox = (name: string) => container.querySelector<HTMLInputElement>(`input[aria-label="${name} 1"]`)!;
  expect(container.textContent).toContain("Recipe: Daily Brief");
  await act(async () => { checkbox("Historical completion times").click(); });
  expect(checkbox("Completion history").checked).toBe(false);
  expect(checkbox("Historical average duration").checked).toBe(true);
  await act(() => checkbox("Recorded elapsed durations").click());
  expect(checkbox("Recorded elapsed durations").checked).toBe(true);
  expect(fetcher).not.toHaveBeenCalled();
  await act(() => button("Run new comparison").click());
  await vi.waitFor(() => expect(server.posts).toHaveLength(1));
  expect((server.posts[0]!.configs as { context: unknown }[])[0]!.context).toMatchObject({ includeCompletionHistory: false, includeRecordedElapsedDurations: true, includeHistoricalCompletionTimes: true });
});

it("migrates legacy saved drafts and rejects unsupported recipe imports without running a comparison", async () => {
  const { DEFAULT_BRIEFING_CONFIG } = await import("@cadence/core/services/briefing-config");
  const legacy = { ...DEFAULT_BRIEFING_CONFIG, version: "1.0" } as Record<string, unknown>;
  delete legacy.recipe; delete legacy.context; delete legacy.analysis;
  localStorage.setItem("cadence.briefing-workbench.config.v1", JSON.stringify(legacy));
  await act(() => button("Load saved draft").click());
  await act(() => button("Edit JSON").click());
  const editor = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Configuration JSON editor"]')!;
  expect(JSON.parse(editor.value)).toMatchObject({ version: "1.3", recipe: { id: "daily_brief", version: "1.0" } });
  await act(() => change(editor, JSON.stringify({ ...DEFAULT_BRIEFING_CONFIG, recipe: { id: "other_recipe", version: "1.0" } })));
  await act(() => button("Load into configuration 1").click());
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("Invalid configuration JSON");
  expect(fetcher).not.toHaveBeenCalled();
  expect(maybeButton("Cancel comparison")).toBeNull();
});
