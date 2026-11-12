import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Temporal } from "@js-temporal/polyfill";
import { BRIEFING_PRESETS, DEFAULT_BRIEFING_CONFIG } from "@cadence/core/services/briefing-config";
import type { CalendarCaller } from "@/lib/services/google-calendar.service";
import fixture from "./fixtures/advisor-day-context.valid.json";
import { dailyBriefPreferences } from "./helpers/daily-brief-preferences";

// Ticket 298: device-model prepare and complete. Authored model output only; no provider is called.
const mocks = vi.hoisted(() => ({
  auth: vi.fn(), read: vi.fn(), begin: vi.fn(), finish: vi.fn(), tipHistory: vi.fn(), recordTip: vi.fn(), save: vi.fn(),
  prepare: vi.fn(), current: vi.fn(), fence: vi.fn(), config: vi.fn(), timezone: vi.fn(),
  openaiBrief: vi.fn(), openaiEstimates: vi.fn(), calendar: vi.fn(), outlook: vi.fn(), icloud: vi.fn(), hevy: vi.fn(),
}));
vi.mock("@/lib/services/google-calendar-request", async (original) => ({ ...await original<typeof import("@/lib/services/google-calendar-request")>(), authenticateCalendarRequest: mocks.auth }));
vi.mock("@/lib/db/daily-brief.repo", async (original) => ({ ...await original<typeof import("@/lib/db/daily-brief.repo")>(),
  readDailyBriefPreferences: mocks.read, saveDailyBriefPreferences: mocks.save, beginDailyBrief: mocks.begin, finishDailyBrief: mocks.finish,
  readDailyBriefTipHistory: mocks.tipHistory, recordDailyBriefTip: mocks.recordTip }));
vi.mock("@/lib/services/briefing-pipeline", async (original) => {
  const actual = await original<typeof import("@/lib/services/briefing-pipeline")>();
  const active = () => mocks.config() ?? actual.activeBriefingConfig();
  return { ...actual, activeBriefingConfig: active, briefingConfigurationRevision: (value?: unknown) => actual.briefingConfigurationRevision(value ?? active()) };
});
vi.mock("@/lib/services/briefing-account-context.service", () => ({
  briefingAccountRef: (userId: string) => `account-${userId}`,
  prepareAccountBriefingContexts: mocks.prepare,
  readBriefingContextFence: mocks.fence,
}));
vi.mock("@/lib/services/daily-brief-openai", () => ({ generateOpenAIDailyBrief: mocks.openaiBrief, generateOpenAIDurationEstimates: mocks.openaiEstimates }));
vi.mock("@/lib/db/advisor-context.repo", () => ({ readAdvisorProfileTimezone: mocks.timezone }));
vi.mock("@/lib/services/google-calendar.service", () => ({ getCalendarConnection: mocks.calendar }));
vi.mock("@/lib/services/outlook-calendar.service", () => ({ getOutlookCalendarConnection: mocks.outlook }));
vi.mock("@/lib/services/icloud-calendar.service", () => ({ getIcloudCalendarConnection: mocks.icloud }));
vi.mock("@/lib/services/hevy.service", () => ({ getHevyConnection: mocks.hevy }));

import { completeDeviceDailyBrief, prepareDeviceDailyBrief } from "@/lib/services/daily-brief-device.service";
import { issueDailyBriefEnvelope, verifyDailyBriefEnvelope } from "@/lib/services/daily-brief-device-envelope";
import { getDailyBriefSettings, updateDailyBriefSettings } from "@/lib/services/daily-brief.service";
import { POST as preparePOST } from "@/app/api/advisor/brief/device/prepare/route";
import { POST as completePOST } from "@/app/api/advisor/brief/device/complete/route";

const SECRET = "test-only-envelope-secret-0123456789abcdef";
const OTHER_SECRET = "test-only-other-envelope-secret-0123456789";
const owner = { client: {}, user: { id: "owner" } } as CalendarCaller;
const stranger = { client: {}, user: { id: "stranger" } } as CalendarCaller;
const installationId = "11111111-1111-4111-8111-111111111111";
const otherInstallation = "22222222-2222-4222-8222-222222222222";
const capturedAt = Temporal.Instant.from(fixture.capturedAt);
const at = (seconds: number) => () => capturedAt.add({ seconds });
const ref = fixture.cadence.occurrences[0]!.ref;
const output = { suggestions: [], text: "Take time for your walk.", occurrenceRefs: [ref] };
const fenceSpec = { localDate: fixture.localDate, connectorSources: { calendars: true, recordedActivity: true }, analysis: null, travelConclusions: false };
let currentLease = "lease-1";

beforeEach(() => {
  vi.resetAllMocks();
  vi.unstubAllEnvs();
  vi.stubEnv("OPENAI_API_KEY", "");
  vi.stubEnv("CADENCE_DAILY_BRIEF_DEVICE_MODEL", "1");
  vi.stubEnv("CADENCE_DAILY_BRIEF_ENVELOPE_SECRET", SECRET);
  currentLease = "lease-1";
  mocks.auth.mockResolvedValue(owner);
  mocks.read.mockResolvedValue(dailyBriefPreferences({ revision: 1 }));
  mocks.begin.mockImplementation(async () => ({ state: "acquired", leaseToken: currentLease, localDate: fixture.localDate }));
  // The database finishes only the current lease.
  mocks.finish.mockImplementation(async (_client, input: { leaseToken: string }) => input.leaseToken === currentLease);
  mocks.current.mockResolvedValue(undefined);
  mocks.fence.mockResolvedValue("fence-1");
  mocks.timezone.mockResolvedValue(fixture.timezone);
  mocks.prepare.mockImplementation(async (_caller, options) => ({
    contexts: [fixture], assertCurrent: mocks.current, configurationRefs: {}, preferences: options.preferences,
    analysisSource: null, tipFingerprint: () => "fingerprint", descriptions: null, fenceSpec,
  }));
  mocks.tipHistory.mockResolvedValue([]);
  mocks.recordTip.mockResolvedValue(true);
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

async function prepared(now = at(0)) {
  const result = await prepareDeviceDailyBrief(owner, { installationId, retry: false }, { now });
  if (result.state !== "prepared") throw new Error(`Expected a prepared brief, got ${result.state}.`);
  return result;
}

function payloadOf(envelope: string) {
  const verified = verifyDailyBriefEnvelope(envelope, { secrets: { current: SECRET, previous: null }, now: capturedAt });
  if (!verified.ok) throw new Error("Expected a valid envelope.");
  return verified.payload;
}

describe("device prepare", () => {
  it("returns the model request and a signed envelope bound to the user, installation, lease and revisions", async () => {
    const result = await prepared();
    expect(result.request.instructions).toEqual(expect.any(String));
    expect(JSON.parse(result.request.facts)).toMatchObject({ recipe: { id: "daily_brief", version: "1.0" } });
    const payload = payloadOf(result.envelope);
    expect(payload).toMatchObject({ v: 1, acct: "account-owner", inst: installationId, lease: "lease-1", prefRev: 1, ctxRev: "fence-1", fence: fenceSpec });
    expect(payload.validation.context.localDate).toBe(fixture.localDate);
    // The envelope never outlives the 75-second lease, counted from just before admission.
    expect(result.expiresAt).toBe(capturedAt.add({ seconds: 75 }).toString());
    expect(payload.exp).toBe(result.expiresAt);
    expect(mocks.begin).toHaveBeenCalledWith(owner.client, { installationId, retry: false, expectedRevision: 1 }, expect.any(AbortSignal));
    expect(mocks.fence).toHaveBeenCalledWith(owner, fenceSpec, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(mocks.current).toHaveBeenCalledTimes(1);
    // The lease stays open for complete.
    expect(mocks.finish).not.toHaveBeenCalled();
  });

  it("ends the envelope at the context expiry when that comes first", async () => {
    const result = await prepared(at(200));
    expect(result.expiresAt).toBe(fixture.expiresAt);
  });

  it("never calls the server model adapter or any network", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("no network in device mode"));
    const result = await prepared();
    await completeDeviceDailyBrief(owner, { installationId, envelope: result.envelope, output }, { now: at(10) });
    expect(mocks.openaiBrief).not.toHaveBeenCalled();
    expect(mocks.openaiEstimates).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("does not require OPENAI_API_KEY", async () => {
    expect(process.env.OPENAI_API_KEY).toBe("");
    await expect(prepared()).resolves.toMatchObject({ state: "prepared" });
  });

  it("rejects recipes other than 1.0 before admission", async () => {
    const v11 = BRIEFING_PRESETS.find((preset) => preset.config.recipe.version === "1.1")!.config;
    mocks.config.mockReturnValue(v11);
    await expect(prepareDeviceDailyBrief(owner, { installationId, retry: false }, { now: at(0) })).rejects.toMatchObject({ code: "device_recipe_unsupported" });
    expect(mocks.begin).not.toHaveBeenCalled();
  });

  it("passes pending and already-attempted admissions through without preparing", async () => {
    mocks.begin.mockResolvedValue({ state: "pending", retryAfterSeconds: 12 });
    expect(await prepareDeviceDailyBrief(owner, { installationId, retry: false }, { now: at(0) })).toEqual({ state: "pending", retryAfterSeconds: 12 });
    mocks.begin.mockResolvedValue({ state: "already_attempted" });
    expect(await prepareDeviceDailyBrief(owner, { installationId, retry: false }, { now: at(0) })).toEqual({ state: "already_attempted" });
    expect(mocks.prepare).not.toHaveBeenCalled();
  });

  it("ends the attempt when the context changes during prepare", async () => {
    mocks.current.mockRejectedValue(Object.assign(new Error("context_changed"), { code: "context_changed" }));
    await expect(prepareDeviceDailyBrief(owner, { installationId, retry: false }, { now: at(0) })).rejects.toMatchObject({ code: "context_changed" });
    expect(mocks.finish).toHaveBeenCalledWith(owner.client, expect.objectContaining({ leaseToken: "lease-1", success: false }));
  });

  it("rejects a malformed body and a disabled brief", async () => {
    await expect(prepareDeviceDailyBrief(owner, { installationId: "not-a-uuid", retry: false })).rejects.toMatchObject({ code: "invalid_request" });
    mocks.read.mockResolvedValue(dailyBriefPreferences({ revision: 1, enabled: false }));
    await expect(prepareDeviceDailyBrief(owner, { installationId, retry: false }, { now: at(0) })).rejects.toMatchObject({ code: "access_denied" });
    expect(mocks.begin).not.toHaveBeenCalled();
  });
});

describe("device complete", () => {
  it("completes a round trip: validates, finishes the lease and returns the briefing", async () => {
    const result = await prepared();
    const response = await completeDeviceDailyBrief(owner, { installationId, envelope: result.envelope, output }, { now: at(10) });
    expect(response).toMatchObject({ state: "ready", briefing: { text: "Take time for your walk.", localDate: fixture.localDate } });
    expect(mocks.finish).toHaveBeenCalledTimes(1);
    expect(mocks.finish).toHaveBeenCalledWith(owner.client, { installationId, leaseToken: "lease-1", success: true, expectedRevision: 1 }, expect.any(AbortSignal));
    expect(mocks.fence).toHaveBeenCalledTimes(2);
  });

  it("rejects a forged signature, an altered body and a key it does not hold", async () => {
    const { envelope } = await prepared();
    const [body, signature] = envelope.split(".") as [string, string];
    const flipped = `${signature.slice(0, -1)}${signature.endsWith("A") ? "B" : "A"}`;
    const payload = payloadOf(envelope);
    const forgedElsewhere = issueDailyBriefEnvelope({ ...payload, lease: "lease-other" }, OTHER_SECRET)!;
    for (const candidate of [`${body}.${flipped}`, `${body.slice(0, -2)}AA.${signature}`, forgedElsewhere, "not-an-envelope", ""]) {
      await expect(completeDeviceDailyBrief(owner, { installationId, envelope: candidate, output }, { now: at(10) })).rejects.toMatchObject({ code: "brief_envelope_invalid" });
    }
    expect(mocks.finish).not.toHaveBeenCalled();
  });

  it("verifies under the previous secret during rotation only", async () => {
    const { envelope } = await prepared();
    vi.stubEnv("CADENCE_DAILY_BRIEF_ENVELOPE_SECRET", OTHER_SECRET);
    vi.stubEnv("CADENCE_DAILY_BRIEF_ENVELOPE_SECRET_PREVIOUS", SECRET);
    await expect(completeDeviceDailyBrief(owner, { installationId, envelope, output }, { now: at(10) })).resolves.toMatchObject({ state: "ready" });
  });

  it("rejects an expired envelope and one issued too far in the future", async () => {
    const { envelope } = await prepared();
    await expect(completeDeviceDailyBrief(owner, { installationId, envelope, output }, { now: at(75) })).rejects.toMatchObject({ code: "context_expired" });
    const future = issueDailyBriefEnvelope({ ...payloadOf(envelope), iat: capturedAt.add({ seconds: 600 }).toString(), exp: capturedAt.add({ seconds: 660 }).toString() }, SECRET)!;
    await expect(completeDeviceDailyBrief(owner, { installationId, envelope: future, output }, { now: at(10) })).rejects.toMatchObject({ code: "brief_envelope_invalid" });
    const tooLong = issueDailyBriefEnvelope({ ...payloadOf(envelope), exp: capturedAt.add({ seconds: 3600 }).toString() }, SECRET)!;
    await expect(completeDeviceDailyBrief(owner, { installationId, envelope: tooLong, output }, { now: at(10) })).rejects.toMatchObject({ code: "brief_envelope_invalid" });
    expect(mocks.finish).not.toHaveBeenCalled();
  });

  it("rejects an envelope for another user or another installation", async () => {
    const { envelope } = await prepared();
    await expect(completeDeviceDailyBrief(stranger, { installationId, envelope, output }, { now: at(10) })).rejects.toMatchObject({ code: "brief_envelope_invalid" });
    await expect(completeDeviceDailyBrief(owner, { installationId: otherInstallation, envelope, output }, { now: at(10) })).rejects.toMatchObject({ code: "brief_envelope_invalid" });
    expect(mocks.finish).not.toHaveBeenCalled();
  });

  it("rejects a superseded lease and returns no text", async () => {
    const first = await prepared();
    currentLease = "lease-2";
    await prepared();
    await expect(completeDeviceDailyBrief(owner, { installationId, envelope: first.envelope, output }, { now: at(10) })).rejects.toMatchObject({ code: "context_changed" });
    expect(mocks.finish).toHaveBeenCalledWith(owner.client, expect.objectContaining({ leaseToken: "lease-1", success: true }), expect.any(AbortSignal));
  });

  it("rejects mismatched preferences, configuration and context revisions", async () => {
    const { envelope } = await prepared();
    mocks.read.mockResolvedValueOnce(dailyBriefPreferences({ revision: 2 }));
    await expect(completeDeviceDailyBrief(owner, { installationId, envelope, output }, { now: at(10) })).rejects.toMatchObject({ code: "context_changed" });
    mocks.config.mockReturnValueOnce({ ...DEFAULT_BRIEFING_CONFIG, alternatives: DEFAULT_BRIEFING_CONFIG.alternatives === 1 ? 2 : 1 });
    await expect(completeDeviceDailyBrief(owner, { installationId, envelope, output }, { now: at(10) })).rejects.toMatchObject({ code: "context_changed" });
    const altered = issueDailyBriefEnvelope({ ...payloadOf(envelope), cfgRev: "other-configuration" }, SECRET)!;
    await expect(completeDeviceDailyBrief(owner, { installationId, envelope: altered, output }, { now: at(10) })).rejects.toMatchObject({ code: "context_changed" });
    mocks.fence.mockResolvedValueOnce("fence-2");
    await expect(completeDeviceDailyBrief(owner, { installationId, envelope, output }, { now: at(10) })).rejects.toMatchObject({ code: "context_changed" });
  });

  it("rejects output with unknown refs and releases the lease", async () => {
    const { envelope } = await prepared();
    await expect(completeDeviceDailyBrief(owner, { installationId, envelope, output: { ...output, occurrenceRefs: ["occ_unknown"] } }, { now: at(10) }))
      .rejects.toMatchObject({ code: "advisor_unavailable", reason: "validation_unknown_ref" });
    expect(mocks.finish).toHaveBeenCalledWith(owner.client, expect.objectContaining({ leaseToken: "lease-1", success: false }));
    expect(mocks.finish).not.toHaveBeenCalledWith(owner.client, expect.objectContaining({ success: true }), expect.anything());
  });

  it("rejects a malformed complete body", async () => {
    const { envelope } = await prepared();
    await expect(completeDeviceDailyBrief(owner, { installationId, envelope }, { now: at(10) })).rejects.toMatchObject({ code: "invalid_request" });
    await expect(completeDeviceDailyBrief(owner, { installationId, envelope, output, extra: 1 }, { now: at(10) })).rejects.toMatchObject({ code: "invalid_request" });
  });
});

describe("device performance spans", () => {
  it("carry span names, durations and codes, never the prompt, facts, envelope or output", async () => {
    vi.stubEnv("CADENCE_PERF_LOG", "1");
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const result = await prepared();
    await completeDeviceDailyBrief(owner, { installationId, envelope: result.envelope, output }, { now: at(10) });
    await expect(completeDeviceDailyBrief(owner, { installationId, envelope: result.envelope, output: { ...output, occurrenceRefs: ["occ_unknown"] } }, { now: at(10) })).rejects.toBeTruthy();
    const events = info.mock.calls.map(([line]) => JSON.parse(String(line)) as Record<string, unknown>);
    expect(events.map((event) => event.span)).toEqual(expect.arrayContaining([
      "daily_brief.device.admission", "daily_brief.device.context", "daily_brief.device.prepare", "daily_brief.device.fence",
      "daily_brief.device.prepare_request", "daily_brief.device.validate", "daily_brief.device.finish", "daily_brief.device.complete_request",
    ]));
    const serialized = JSON.stringify(events);
    for (const secret of [result.request.instructions.slice(0, 40), "walk", ref, result.envelope.slice(0, 40), result.envelope.split(".")[1]!, "lease-1", installationId, SECRET]) {
      expect(serialized).not.toContain(secret);
    }
  });
});

describe("device mode flag", () => {
  it("returns not configured from both routes when the flag is off", async () => {
    vi.stubEnv("CADENCE_DAILY_BRIEF_DEVICE_MODEL", "");
    vi.stubEnv("OPENAI_API_KEY", "synthetic-key");
    const prepare = await preparePOST(new Request("https://cadence.example/api/advisor/brief/device/prepare", { method: "POST", body: JSON.stringify({ installationId, retry: false }) }));
    expect(prepare.status).toBe(503);
    expect(await prepare.json()).toEqual({ error: "not_configured" });
    const complete = await completePOST(new Request("https://cadence.example/api/advisor/brief/device/complete", { method: "POST", body: JSON.stringify({ installationId, envelope: "x.y", output }) }));
    expect(complete.status).toBe(503);
    expect(await complete.json()).toEqual({ error: "not_configured" });
    expect(mocks.begin).not.toHaveBeenCalled();
    expect(mocks.finish).not.toHaveBeenCalled();
  });

  it("stays off when the flag is on but the envelope secret is missing or short", async () => {
    vi.stubEnv("CADENCE_DAILY_BRIEF_ENVELOPE_SECRET", "short");
    await expect(prepareDeviceDailyBrief(owner, { installationId, retry: false })).rejects.toMatchObject({ code: "not_configured" });
    await expect(completeDeviceDailyBrief(owner, { installationId, envelope: "x.y", output })).rejects.toMatchObject({ code: "not_configured" });
  });

  it("maps envelope and recipe errors to route statuses", async () => {
    const complete = await completePOST(new Request("https://cadence.example/api/advisor/brief/device/complete", { method: "POST", body: JSON.stringify({ installationId, envelope: "x.y", output }) }));
    expect(complete.status).toBe(400);
    expect(await complete.json()).toEqual({ error: "brief_envelope_invalid" });
    mocks.config.mockReturnValue(BRIEFING_PRESETS.find((preset) => preset.config.recipe.version === "1.1")!.config);
    const prepare = await preparePOST(new Request("https://cadence.example/api/advisor/brief/device/prepare", { method: "POST", body: JSON.stringify({ installationId, retry: false }) }));
    expect(prepare.status).toBe(503);
    expect(await prepare.json()).toEqual({ error: "device_recipe_unsupported" });
  });

  it("round-trips through both routes and returns no source context", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date(fixture.capturedAt));
      const response = await preparePOST(new Request("https://cadence.example/api/advisor/brief/device/prepare", { method: "POST", body: JSON.stringify({ installationId, retry: false }) }));
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      const body = await response.json() as { envelope: string };
      expect(Object.keys(body).sort()).toEqual(["envelope", "expiresAt", "request", "state"]);
      vi.setSystemTime(new Date(capturedAt.add({ seconds: 10 }).epochMilliseconds));
      const complete = await completePOST(new Request("https://cadence.example/api/advisor/brief/device/complete", { method: "POST", body: JSON.stringify({ installationId, envelope: body.envelope, output }) }));
      expect(complete.status).toBe(200);
      expect(await complete.json()).toMatchObject({ state: "ready", briefing: { text: "Take time for your walk." } });
    } finally { vi.useRealTimers(); }
  });

  it("Settings report device-model availability without OPENAI_API_KEY", async () => {
    for (const source of [mocks.calendar, mocks.outlook, mocks.icloud, mocks.hevy]) source.mockRejectedValue(new Error("not connected"));
    expect(await getDailyBriefSettings(owner)).toMatchObject({ available: false, deviceModelAvailable: true });
    vi.stubEnv("CADENCE_DAILY_BRIEF_DEVICE_MODEL", "");
    expect(await getDailyBriefSettings(owner)).toMatchObject({ available: false, deviceModelAvailable: false });
  });

  it("lets a device-only server turn the brief on, and refuses when neither path is configured", async () => {
    for (const source of [mocks.calendar, mocks.outlook, mocks.icloud, mocks.hevy]) source.mockRejectedValue(new Error("not connected"));
    const choice = { enabled: true, useConnectedSources: false, excludedSources: { googleCalendar: false, outlookCalendar: false, icloudCalendar: false, hevy: false },
      includeReminderHistory: false, includeNotes: false };
    await expect(updateDailyBriefSettings(owner, choice)).resolves.toMatchObject({ deviceModelAvailable: true });
    vi.stubEnv("CADENCE_DAILY_BRIEF_DEVICE_MODEL", "");
    await expect(updateDailyBriefSettings(owner, choice)).rejects.toMatchObject({ code: "not_configured" });
  });
});
