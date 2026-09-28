import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_BRIEFING_CONFIG } from "@cadence/core/services/briefing-config";
import type { BriefingConfig } from "@cadence/core/types/briefing-config";
import type { DailyBriefGenerator } from "@/lib/services/daily-brief-consumer";
import { BRIEFING_BENCH_RETENTION_DAYS, createBriefingBenchStore, type BriefingBenchStore } from "@/lib/services/briefing-bench-store";

const origin = "http://127.0.0.1:4321";
const CASE = "case-0000-synthetic";
const BASE = "cand-baseline-0001";
const NEXT = "cand-candidate-0001";
const text = "Your walk overlaps a fixed commitment at noon.";

function config(tone: BriefingConfig["tone"] = "calm"): BriefingConfig {
  return structuredClone({ ...DEFAULT_BRIEFING_CONFIG, tone });
}
const candidate = (id: string, role: "baseline" | "candidate", extra: Partial<{ parentCandidateId: string | null; rationale: string }> = {}) =>
  ({ id, label: role === "baseline" ? "Current default" : "Warmer", role, parentCandidateId: null, proposalId: null, rationale: "", ...extra });

function post(url: string, body: unknown, signal?: AbortSignal) {
  return new Request(`${origin}${url}`, { method: "POST", signal, body: JSON.stringify(body),
    headers: { origin, "sec-fetch-site": "same-origin", "content-type": "application/json" } });
}
function get(url: string) {
  return new Request(`${origin}${url}`, { headers: { "sec-fetch-site": "same-origin" } });
}

let root: string;
let store: BriefingBenchStore;
beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv("NODE_ENV", "development");
  root = await mkdtemp(path.join(tmpdir(), "briefing-bench-"));
  store = createBriefingBenchStore(root);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

async function services() {
  const workbench = await import("@/lib/services/briefing-workbench.service");
  const review = await import("@/lib/services/briefing-review.service");
  return { compare: workbench.runBriefingComparison, read: review.readBriefingReviews, write: review.writeBriefingReview };
}

describe("saved briefing reviews", () => {
  it("saves the case, both candidates and every run, then returns them after a reload", async () => {
    const { compare, read } = await services();
    const generate = vi.fn<DailyBriefGenerator>()
      .mockResolvedValueOnce({ text, occurrenceRefs: [], suggestions: [] })
      .mockResolvedValueOnce({ not: "valid" });
    const response = await compare(post("/api/dev/briefing-comparison", { fixtureId: "sparse", configs: [config(), config("warm")],
      review: { caseId: CASE, candidates: [candidate(BASE, "baseline"), candidate(NEXT, "candidate")] } }), generate, store);
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.review).toMatchObject({ caseId: CASE, saved: true, candidateIds: [BASE, NEXT] });
    expect(body.review.runIds).toHaveLength(2);

    const detail = (await (await read(get(`/api/dev/briefing-reviews?source=synthetic&caseId=${CASE}`), store)).json()).detail;
    expect(detail.case).toMatchObject({ id: CASE, evidenceType: "synthetic", rerunnable: true, source: { mode: "synthetic", fixtureId: "sparse" } });
    expect(detail.candidates.map((item: { id: string; role: string }) => [item.id, item.role])).toEqual([[BASE, "baseline"], [NEXT, "candidate"]]);
    // Failures are saved too, so evaluation sees withheld output.
    expect(detail.runs.map((run: { state: string; candidateId: string }) => [run.candidateId, run.state])).toEqual([[BASE, "ready"], [NEXT, "error"]]);
    expect(detail.runs[0]).toMatchObject({ briefing: { text }, promptRevision: expect.stringMatching(/^[0-9a-f]{16}$/), model: expect.any(String) });

    const list = await (await read(get("/api/dev/briefing-reviews?source=synthetic"), store)).json();
    expect(list).toMatchObject({ retentionDays: BRIEFING_BENCH_RETENTION_DAYS, cases: [{ id: CASE, runs: 2, feedback: 0, rerunnable: true }] });
    const mode = (await stat(path.join(root, "synthetic", CASE, "runs.jsonl"))).mode & 0o777;
    expect(mode).toBe(0o600);
    expect((await stat(path.join(root, "synthetic", CASE))).mode & 0o777).toBe(0o700);
  });

  it("anchors prose feedback to runs, rejects quotations that are not in the output, and writes a review packet", async () => {
    const { compare, read, write } = await services();
    const generate = vi.fn<DailyBriefGenerator>().mockResolvedValue({ text, occurrenceRefs: [], suggestions: [] });
    const body = await (await compare(post("/api/dev/briefing-comparison", { fixtureId: "sparse", configs: [config(), config("warm")],
      review: { caseId: CASE, candidates: [candidate(BASE, "baseline"), candidate(NEXT, "candidate")] } }), generate, store)).json();
    const [runA, runB] = body.review.runIds;
    const comment = "B is clearer, but it still tells me the same thing twice. Keep the observation; explain it once.";
    const bad = await write(post("/api/dev/briefing-reviews", { source: "synthetic", action: "feedback", caseId: CASE, runIds: [runA, runB],
      preference: "prefer_b", comment, quote: { runId: runB, text: "words the model never wrote" }, replacement: null }), store);
    expect(bad.status).toBe(400);
    const saved = await write(post("/api/dev/briefing-reviews", { source: "synthetic", action: "feedback", caseId: CASE, runIds: [runA, runB],
      preference: "prefer_b", comment, quote: { runId: runB, text: "overlaps a fixed commitment" }, replacement: "Your walk overlaps the noon meeting." }), store);
    expect(saved.status).toBe(200);
    expect((await saved.json()).feedback).toMatchObject({ runIds: [runA, runB], candidateIds: [BASE, NEXT], comment, quote: { runId: runB } });

    const packet = await (await write(post("/api/dev/briefing-reviews", { source: "synthetic", action: "packet", caseId: CASE }), store)).json();
    const markdown = await readFile(path.join(root, "synthetic", CASE, "review-packet.md"), "utf8");
    expect(packet.proposalDirectory).toContain(path.join(CASE, "proposals"));
    expect(markdown).toContain(comment);
    expect(markdown).toContain("> Your walk overlaps the noon meeting.");
    expect(markdown).toContain("`tone`: \"calm\" → \"warm\"");
    expect(markdown).toContain(`Run \`${runB}\` — Warmer`);

    // An agent writes a proposal; the workbench validates and lists it, and records the owner's decision.
    const proposal = { schemaVersion: 1, kind: "proposal", id: "proposal-0001", caseId: CASE, createdAt: new Date().toISOString(),
      feedbackIds: [], interpretedProblem: "The overview repeats the tip.", owner: "configuration",
      change: { kind: "configuration", label: "Warmer, shorter", config: { ...config("warm"), length: { maxWords: 90 } }, parentCandidateId: NEXT },
      expectedEffect: "One statement of the observation.", possibleRegression: "Could drop the evidence line context.", rerunCaseIds: [CASE] };
    await writeFile(path.join(root, "synthetic", CASE, "proposals", "proposal-0001.json"), JSON.stringify(proposal));
    await writeFile(path.join(root, "synthetic", CASE, "proposals", "broken.json"), "{ not json");
    const detail = (await (await read(get(`/api/dev/briefing-reviews?source=synthetic&caseId=${CASE}`), store)).json()).detail;
    expect(detail.proposals.map((item: { id: string }) => item.id)).toEqual(["proposal-0001"]);
    expect(detail.invalidProposals).toEqual(["broken.json"]);
    expect((await write(post("/api/dev/briefing-reviews", { source: "synthetic", action: "disposition", caseId: CASE, proposalId: "proposal-0001", decision: "needs_correction", comment: "" }), store)).status).toBe(400);
    expect((await write(post("/api/dev/briefing-reviews", { source: "synthetic", action: "disposition", caseId: CASE, proposalId: "proposal-0001", decision: "accepted", comment: "" }), store)).status).toBe(200);
  });

  it("reruns only the candidate on the same saved case and clock, keeping the baseline run", async () => {
    const { compare, read } = await services();
    const generate = vi.fn<DailyBriefGenerator>().mockResolvedValue({ text, occurrenceRefs: [], suggestions: [] });
    await compare(post("/api/dev/briefing-comparison", { fixtureId: "sparse", configs: [config(), config("warm")],
      review: { caseId: CASE, candidates: [candidate(BASE, "baseline"), candidate(NEXT, "candidate")] } }), generate, store);
    const first = JSON.parse(generate.mock.calls[0]![0].facts);
    const NEXT2 = "cand-candidate-0002";
    const rerun = await compare(post("/api/dev/briefing-comparison", { mode: "saved", accountRef: null, configs: [config("matter_of_fact")],
      review: { caseId: CASE, candidates: [candidate(NEXT2, "candidate", { parentCandidateId: NEXT, rationale: "Less warmth" })] } }), generate, store);
    expect(rerun.status).toBe(200);
    expect((await rerun.json()).review).toMatchObject({ saved: true, candidateIds: [NEXT2] });
    expect(JSON.parse(generate.mock.calls[2]![0].facts).context).toEqual(first.context);
    const detail = (await (await read(get(`/api/dev/briefing-reviews?source=synthetic&caseId=${CASE}`), store)).json()).detail;
    expect(detail.runs.map((run: { candidateId: string }) => run.candidateId)).toEqual([BASE, NEXT, NEXT2]);
    expect(detail.candidates.at(-1)).toMatchObject({ id: NEXT2, parentCandidateId: NEXT, rationale: "Less warmth" });

    // Reusing a candidate ID with a different configuration is refused.
    const conflict = await compare(post("/api/dev/briefing-comparison", { mode: "saved", accountRef: null, configs: [config("warm")],
      review: { caseId: CASE, candidates: [candidate(NEXT2, "candidate")] } }), generate, store);
    expect(conflict.status).toBe(400);
  });

  it("records a cancelled run and keeps earlier completed runs when the request is aborted", async () => {
    const { compare, read } = await services();
    const controller = new AbortController();
    const generate = vi.fn<DailyBriefGenerator>()
      .mockResolvedValueOnce({ text, occurrenceRefs: [], suggestions: [] })
      .mockImplementationOnce(() => { controller.abort(); return new Promise(() => undefined); });
    const response = await compare(post("/api/dev/briefing-comparison", { fixtureId: "sparse", configs: [config(), config("warm")],
      review: { caseId: CASE, candidates: [candidate(BASE, "baseline"), candidate(NEXT, "candidate")] } }, controller.signal), generate, store);
    expect(response.status).toBe(400);
    const detail = (await (await read(get(`/api/dev/briefing-reviews?source=synthetic&caseId=${CASE}`), store)).json()).detail;
    expect(detail.runs.map((run: { state: string }) => run.state)).toEqual(["ready", "cancelled"]);
  });

  it("returns results marked not saved when storage fails", async () => {
    const { compare } = await services();
    const broken = { ...store, createCase: vi.fn().mockRejectedValue(new Error("disk full")) } as BriefingBenchStore;
    const generate = vi.fn<DailyBriefGenerator>().mockResolvedValue({ text, occurrenceRefs: [], suggestions: [] });
    const body = await (await compare(post("/api/dev/briefing-comparison", { fixtureId: "sparse", configs: [config(), config("warm")],
      review: { caseId: CASE, candidates: [candidate(BASE, "baseline"), candidate(NEXT, "candidate")] } }), generate, broken)).json();
    expect(body.results.map((item: { state: string }) => item.state)).toEqual(["ready", "ready"]);
    expect(body.review).toMatchObject({ saved: false, runIds: [] });
  });

  it("deletes a case, prunes expired cases, and rejects path-like case IDs", async () => {
    const { compare, read, write } = await services();
    const generate = vi.fn<DailyBriefGenerator>().mockResolvedValue({ text, occurrenceRefs: [], suggestions: [] });
    await compare(post("/api/dev/briefing-comparison", { fixtureId: "sparse", configs: [config(), config("warm")],
      review: { caseId: CASE, candidates: [candidate(BASE, "baseline"), candidate(NEXT, "candidate")] } }), generate, store);
    expect((await read(get("/api/dev/briefing-reviews?source=synthetic&caseId=..%2F..%2Fetc"), store)).status).toBe(400);
    expect(await store.pruneExpired("synthetic", new Date(Date.now() + (BRIEFING_BENCH_RETENTION_DAYS - 1) * 86_400_000))).toEqual([]);
    expect((await write(post("/api/dev/briefing-reviews", { source: "synthetic", action: "delete", caseId: CASE }), store)).status).toBe(200);
    expect((await read(get(`/api/dev/briefing-reviews?source=synthetic&caseId=${CASE}`), store)).status).toBe(404);

    await compare(post("/api/dev/briefing-comparison", { fixtureId: "sparse", configs: [config(), config("warm")],
      review: { caseId: "case-0000-expiring", candidates: [candidate(BASE, "baseline"), candidate(NEXT, "candidate")] } }), generate, store);
    expect(await store.pruneExpired("synthetic", new Date(Date.now() + (BRIEFING_BENCH_RETENTION_DAYS + 1) * 86_400_000))).toEqual(["case-0000-expiring"]);
  });

  it("refuses review routes outside development and from other origins", async () => {
    const { read, write } = await services();
    expect((await write(new Request(`${origin}/api/dev/briefing-reviews`, { method: "POST", body: "{}",
      headers: { origin: "https://example.com", "sec-fetch-site": "cross-site", "content-type": "application/json" } }), store)).status).toBe(403);
    vi.stubEnv("NODE_ENV", "production");
    expect((await read(get("/api/dev/briefing-reviews?source=synthetic"), store)).status).toBe(404);
  });
});
