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
