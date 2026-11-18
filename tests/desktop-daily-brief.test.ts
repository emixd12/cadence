import { afterEach, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createDesktopDailyBriefClient } from "../apps/desktop/src/daily-brief";

afterEach(() => vi.unstubAllGlobals());

it("uses the linked session and hosted briefing without uploading local tracking data", async () => {
  const getSession = vi.fn().mockResolvedValue({ data: { session: { access_token: "synthetic-session" } } });
  const client = { auth: { getSession } } as unknown as SupabaseClient;
  const adapter = createDesktopDailyBriefClient(client, "https://cadence.invalid")!;
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ state: "already_attempted" }));
  vi.stubGlobal("fetch", fetcher);
  const signal = new AbortController().signal;
  const input = { installationId: "synthetic-installation", retry: false };
  expect(await adapter.requestBrief(input, signal)).toEqual({ state: "already_attempted" });
  expect(fetcher).toHaveBeenCalledExactlyOnceWith("https://cadence.invalid/api/advisor/brief", {
    method: "POST", body: JSON.stringify(input), signal: expect.any(AbortSignal), cache: "no-store", redirect: "error",
    headers: { Authorization: "Bearer synthetic-session", "Content-Type": "application/json" },
  });
  getSession.mockResolvedValue({ data: { session: null } });
  await expect(adapter.requestBrief(input)).rejects.toMatchObject({ code: "unauthenticated" });
  expect(fetcher).toHaveBeenCalledOnce();
  expect(createDesktopDailyBriefClient(client, null)).toBeNull();
});

it("surfaces hosted failures and offline errors without manufacturing a briefing", async () => {
  const client = { auth: { getSession: async () => ({ data: { session: { access_token: "synthetic-session" } } }) } } as unknown as SupabaseClient;
  const adapter = createDesktopDailyBriefClient(client, "https://cadence.invalid")!;
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ error: "context_expired" }, { status: 409 }))
    .mockRejectedValueOnce(new Error("offline"));
  vi.stubGlobal("fetch", fetcher);
  await expect(adapter.requestBrief({ installationId: "synthetic", retry: false })).rejects.toMatchObject({ code: "context_expired" });
  await expect(adapter.preferences()).rejects.toMatchObject({ code: "brief_unavailable" });
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it("keeps the client deadline when a caller signal is supplied, including a stalled session lookup", async () => {
  vi.useFakeTimers();
  try {
    const stalledSession = { auth: { getSession: () => new Promise(() => {}) } } as unknown as SupabaseClient;
    const adapter = createDesktopDailyBriefClient(stalledSession, "https://cadence.invalid")!;
    const fetcher = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetcher);
    const pending = adapter.requestBrief({ installationId: "synthetic", retry: false }, new AbortController().signal);
    const outcome = expect(pending).rejects.toMatchObject({ code: "timeout" });
    await vi.advanceTimersByTimeAsync(75_000);
    await outcome;
    expect(fetcher).not.toHaveBeenCalled();

    const session = { auth: { getSession: async () => ({ data: { session: { access_token: "synthetic-session" } } }) } } as unknown as SupabaseClient;
    const stalledBody = createDesktopDailyBriefClient(session, "https://cadence.invalid")!;
    fetcher.mockResolvedValue({ ok: true, json: () => new Promise(() => {}) } as Response);
    const body = stalledBody.preferences(new AbortController().signal);
    const bodyOutcome = expect(body).rejects.toMatchObject({ code: "timeout" });
    await vi.advanceTimersByTimeAsync(15_000);
    await bodyOutcome;
  } finally {
    vi.useRealTimers();
  }
});

it("sends brief move answers to the hosted API with the Mac session and syncs only after a change", async () => {
  const client = { auth: { getSession: async () => ({ data: { session: { access_token: "synthetic-session" } } }) } } as unknown as SupabaseClient;
  const onAccountWrite = vi.fn();
  const adapter = createDesktopDailyBriefClient(client, "https://cadence.invalid", null, onAccountWrite)!;
  const applied = { kind: "yes", results: [{ proposalId: "p1", outcome: "applied", line: null, refusal: null, occurrence: null, moveId: "m1" }], batchId: null, replayed: false, firstMove: false };
  const refused = { ...applied, results: [{ ...applied.results[0], outcome: "refused", moveId: null }] };
  const fetcher = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json(applied))
    .mockResolvedValueOnce(Response.json(refused))
    .mockResolvedValueOnce(Response.json({ ...applied, kind: "no" }))
    .mockResolvedValueOnce(Response.json({ error: "proposal_closed" }, { status: 409 }))
    .mockResolvedValueOnce(Response.json({ line: null, replacedProposalId: "p1" }))
    .mockResolvedValueOnce(Response.json({ behaviorId: "b1", neverSuggestMove: true, updatedAt: null }));
  vi.stubGlobal("fetch", fetcher);
  const context = { calendarBusy: [{ startAt: "2026-11-18T15:00:00Z", endAt: "2026-11-18T16:00:00Z" }], travelTimes: "signed" };
  const yes = { kind: "yes", idempotencyKey: "k1", proposalId: "p1", expectedRevision: "r1", context } as const;
  expect(await adapter.moves!.answer(yes)).toEqual(applied);
  expect(fetcher).toHaveBeenLastCalledWith("https://cadence.invalid/api/advisor/brief/answer", {
    method: "POST", body: JSON.stringify(yes), signal: expect.any(AbortSignal), cache: "no-store", redirect: "error",
    headers: { Authorization: "Bearer synthetic-session", "Content-Type": "application/json" },
  });
  expect(onAccountWrite).toHaveBeenCalledOnce();
  // A refused Yes and a No change nothing on the Timeline, so no sync.
  await adapter.moves!.answer(yes);
  await adapter.moves!.answer({ kind: "no", idempotencyKey: "k2", proposalId: "p1" });
  expect(onAccountWrite).toHaveBeenCalledOnce();
  await expect(adapter.moves!.answer(yes)).rejects.toMatchObject({ code: "proposal_closed" });
  expect(await adapter.moves!.replan({ proposalId: "p1", context })).toEqual({ line: null, replacedProposalId: "p1" });
  expect(fetcher).toHaveBeenLastCalledWith("https://cadence.invalid/api/advisor/brief/replan", expect.objectContaining({ method: "POST" }));
  await adapter.moves!.readPreference("b 1");
  expect(fetcher).toHaveBeenLastCalledWith("https://cadence.invalid/api/advisor/brief/move-preference?behaviorId=b%201", expect.not.objectContaining({ method: expect.anything() }));
  expect(onAccountWrite).toHaveBeenCalledOnce();
});
