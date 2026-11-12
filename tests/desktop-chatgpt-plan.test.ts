import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createDesktopDailyBriefClient, type DesktopDailyBriefPlan } from "../apps/desktop/src/daily-brief";
import { chatGptPlanSwitchOn } from "../apps/desktop/src/chatgpt/plan-switch";
import type { ChatGptConnectionState } from "../apps/desktop/src/chatgpt/connection";

// Ticket 299 (D27): the Mac's Daily Brief on the user's ChatGPT plan. Every network call is a fake.
const ORIGIN = "https://cadence.invalid";
const TOKEN = "at-SYNTHETIC-access-token";
const input = { installationId: "11111111-1111-4111-8111-111111111111", retry: false };
const briefing = { text: "Take time for your walk.", localDate: "2026-11-12" };
const output = { text: "Take time for your walk.", occurrenceRefs: [], suggestions: [], tip: null };
const session = { auth: { getSession: async () => ({ data: { session: { access_token: "synthetic-session" } } }) } } as unknown as SupabaseClient;

afterEach(() => vi.unstubAllGlobals());

function sse(value: unknown) {
  const event = { type: "response.completed", response: { status: "completed", output: [
    { type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: JSON.stringify(value) }] }] } };
  return new Response(`event: response.completed\ndata: ${JSON.stringify(event)}\n\n`, { status: 200 });
}

/** Cadence's hosted routes. `calls` records each path and body. */
function hosted(options: { deviceModelAvailable?: boolean; prepare?: unknown } = {}) {
  const calls: { path: string; body: unknown }[] = [];
  const fetcher = vi.fn(async (url: string, init: RequestInit = {}) => {
    const path = url.slice(ORIGIN.length);
    calls.push({ path, body: init.body ? JSON.parse(String(init.body)) : null });
    if (path === "/api/advisor/preferences") return Response.json({ accountRef: "a", available: true, enabled: true, revision: 1, localDate: "2026-11-12", deviceModelAvailable: options.deviceModelAvailable ?? true });
    if (path === "/api/advisor/brief") return Response.json({ state: "ready", briefing: { ...briefing, text: "Hosted brief." } });
    if (path === "/api/advisor/brief/device/prepare") return Response.json(options.prepare ?? { state: "prepared", request: { instructions: "Synthetic.", facts: "{}" }, envelope: "body.signature", expiresAt: new Date(Date.now() + 60_000).toISOString() });
    if (path === "/api/advisor/brief/device/complete") return Response.json({ state: "ready", briefing });
    if (path === "/api/advisor/brief/device/release") return Response.json({ state: "released" });
    return Response.json({ error: "not_found" }, { status: 404 });
  });
  vi.stubGlobal("fetch", fetcher);
  return { calls, fetcher };
}

/** The user's ChatGPT plan at api.openai.com. */
function openai(reply: () => Response = () => sse(output)) {
  const seen: { url: string; authorization: string | null }[] = [];
  const fetch = vi.fn(async (url: string, init: RequestInit = {}) => {
    seen.push({ url, authorization: new Headers(init.headers).get("Authorization") });
    if (url.endsWith("/models")) return Response.json({ models: [{ slug: "gpt-6.1-sol", visibility: "list" }] });
    return reply();
  }) as unknown as typeof globalThis.fetch;
  return { fetch, seen };
}

function plan(state: ChatGptConnectionState, fetch?: typeof globalThis.fetch, accessToken = vi.fn(async () => TOKEN)): DesktopDailyBriefPlan {
  return { connection: { status: async () => ({ state, email: "person@example.test" }), accessToken }, connect: async () => undefined, openUsage: () => undefined, ...(fetch ? { fetch } : {}) };
}

describe("ChatGPT plan switch", () => {
  it("is off unless the build sets exactly 1", () => {
    expect(chatGptPlanSwitchOn(undefined)).toBe(false);
    for (const value of ["", "0", "true", "yes", " 1"]) expect(chatGptPlanSwitchOn(value)).toBe(false);
    expect(chatGptPlanSwitchOn("1")).toBe(true);
  });

  it("with the switch off, the brief keeps today's hosted path and offers no plan controls", async () => {
    const { calls } = hosted();
    const client = createDesktopDailyBriefClient(session, ORIGIN, null)!;
    expect(client.plan).toBeUndefined();
    await client.preferences();
    await expect(client.requestBrief(input)).resolves.toMatchObject({ state: "ready", briefing: { text: "Hosted brief." } });
    expect(calls.map((call) => call.path)).toEqual(["/api/advisor/preferences", "/api/advisor/brief"]);
    // The app creates no ChatGPT connection and no plan client when the switch is off.
    const product = readFileSync("apps/desktop/src/product.tsx", "utf8");
    expect(product).toContain("const chatGptPlan = chatGptPlanSwitchOn() && isTauri() ? createChatGptConnection() : null;");
    expect(product).toContain("chatGptPlanControls={chatGptPlan && dailyBriefClient ?");
  });
});

describe("Daily Brief on the ChatGPT plan", () => {
  it("runs prepare, the model call on the plan with the in-memory token, then complete", async () => {
    const { calls } = hosted();
    const model = openai();
    const client = createDesktopDailyBriefClient(session, ORIGIN, plan("connectedWithPlanUsage", model.fetch))!;
    await client.preferences();
    const response = await client.requestBrief(input);
    expect(response).toEqual({ state: "ready", briefing });
    expect(calls.map((call) => call.path)).toEqual(["/api/advisor/preferences", "/api/advisor/brief/device/prepare", "/api/advisor/brief/device/complete"]);
    expect(calls[2]!.body).toEqual({ installationId: input.installationId, envelope: "body.signature", output });
    expect(model.seen.map((call) => call.url)).toEqual(["https://api.openai.com/v1/models", "https://api.openai.com/v1/responses"]);
    expect(model.seen.every((call) => call.authorization === `Bearer ${TOKEN}`)).toBe(true);
    // The ChatGPT token never reaches Cadence's server.
    expect(JSON.stringify(calls)).not.toContain(TOKEN);
    if (response.state === "ready") expect(client.plan!.usage(response.briefing)).toBe("plan");
  });

  it("releases the attempt and shows the mapped state when the model call fails, with no hosted fallback", async () => {
    for (const [reply, code] of [
      [() => Response.json({ error: { code: "subscription_sharing_usage_limit_exceeded" } }, { status: 429 }), "chatgpt_usage_limit"],
      [() => Response.json({ error: { code: "subscription_sharing_user_not_eligible" } }, { status: 403 }), "chatgpt_not_eligible"],
      [() => Response.json({ error: { code: "token_expired" } }, { status: 401 }), "chatgpt_reconnect"],
      [() => Response.json({}, { status: 503 }), "chatgpt_retry_later"],
    ] as const) {
      const { calls } = hosted();
      const client = createDesktopDailyBriefClient(session, ORIGIN, plan("connectedWithPlanUsage", openai(reply).fetch))!;
      await client.preferences();
      await expect(client.requestBrief(input)).rejects.toMatchObject({ code });
      expect(calls.map((call) => call.path)).toEqual(["/api/advisor/preferences", "/api/advisor/brief/device/prepare", "/api/advisor/brief/device/release"]);
      expect(calls[2]!.body).toEqual({ installationId: input.installationId, envelope: "body.signature" });
    }
  });

  it("passes pending and already-attempted prepares through without a model call", async () => {
    hosted({ prepare: { state: "already_attempted" } });
    const model = openai();
    const client = createDesktopDailyBriefClient(session, ORIGIN, plan("connectedWithPlanUsage", model.fetch))!;
    await client.preferences();
    await expect(client.requestBrief(input)).resolves.toEqual({ state: "already_attempted" });
    expect(model.fetch).not.toHaveBeenCalled();
  });

  it("keeps the hosted path when ChatGPT is not connected, and marks a brief without plan usage", async () => {
    for (const state of ["disconnected", "connectedWithoutPlanUsage"] as const) {
      const { calls } = hosted();
      const accessToken = vi.fn(async () => TOKEN);
      const client = createDesktopDailyBriefClient(session, ORIGIN, plan(state, openai().fetch, accessToken))!;
      await client.preferences();
      const response = await client.requestBrief(input);
      expect(calls.map((call) => call.path)).toEqual(["/api/advisor/preferences", "/api/advisor/brief"]);
      expect(accessToken).not.toHaveBeenCalled();
      if (response.state === "ready") expect(client.plan!.usage(response.briefing)).toBe(state === "disconnected" ? null : "plan_off");
    }
  });

  it("never falls back to Cadence's key for a connected plan that cannot run", async () => {
    let { calls } = hosted();
    let client = createDesktopDailyBriefClient(session, ORIGIN, plan("needsReconnect", openai().fetch))!;
    await client.preferences();
    await expect(client.requestBrief(input)).rejects.toMatchObject({ code: "chatgpt_reconnect" });
    expect(calls.map((call) => call.path)).toEqual(["/api/advisor/preferences"]);

    ({ calls } = hosted({ deviceModelAvailable: false }));
    client = createDesktopDailyBriefClient(session, ORIGIN, plan("connectedWithPlanUsage", openai().fetch))!;
    await client.preferences();
    await expect(client.requestBrief(input)).rejects.toMatchObject({ code: "chatgpt_unavailable" });
    expect(calls.map((call) => call.path)).toEqual(["/api/advisor/preferences"]);

    // A token Rust cannot refresh means reconnect, before any attempt is spent.
    ({ calls } = hosted());
    client = createDesktopDailyBriefClient(session, ORIGIN, plan("connectedWithPlanUsage", openai().fetch, vi.fn(async () => { throw new Error("Reconnect ChatGPT to continue."); })))!;
    await client.preferences();
    await expect(client.requestBrief(input)).rejects.toMatchObject({ code: "chatgpt_reconnect" });
    expect(calls.map((call) => call.path)).toEqual(["/api/advisor/preferences"]);
  });

  it("keeps the token out of storage and logs", () => {
    const source = readFileSync("apps/desktop/src/daily-brief.ts", "utf8");
    for (const forbidden of ["localStorage", "sessionStorage", "indexedDB", "console.", "localCommand", "invoke("]) expect(source).not.toContain(forbidden);
  });
});
