import { readFile } from "node:fs/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CalendarCaller } from "@/lib/services/google-calendar.service";
import { dailyBriefPreferences } from "./helpers/daily-brief-preferences";

// Advisor plan Phase 4, workstream 4F: the one AI features approval and the shared settings helper.

const mocks = vi.hoisted(() => ({ readAi: vi.fn(), saveAi: vi.fn(), read: vi.fn(), save: vi.fn(), timezone: vi.fn(), calendar: vi.fn(), outlook: vi.fn(), icloud: vi.fn(), hevy: vi.fn() }));
vi.mock("@/lib/db/ai-settings.repo", async (original) => ({ ...(await original<typeof import("@/lib/db/ai-settings.repo")>()),
  readStoredAiSettings: mocks.readAi, saveStoredAiSettings: mocks.saveAi }));
vi.mock("@/lib/db/daily-brief.repo", async (original) => ({ ...(await original<typeof import("@/lib/db/daily-brief.repo")>()),
  readDailyBriefPreferences: mocks.read, saveDailyBriefPreferences: mocks.save }));
vi.mock("@/lib/db/advisor-context.repo", () => ({ readAdvisorProfileTimezone: mocks.timezone }));
vi.mock("@/lib/services/google-calendar.service", () => ({ getCalendarConnection: mocks.calendar }));
vi.mock("@/lib/services/outlook-calendar.service", () => ({ getOutlookCalendarConnection: mocks.outlook }));
vi.mock("@/lib/services/icloud-calendar.service", () => ({ getIcloudCalendarConnection: mocks.icloud }));
vi.mock("@/lib/services/hevy.service", () => ({ getHevyConnection: mocks.hevy }));

import { parseAiSettings, type StoredAiSettings } from "@/lib/db/ai-settings.repo";
import { aiFeatureOn, aiSettingsFromStored, aiSourceAllowed, AI_FEATURES, AI_SOURCES, readAiSettings } from "@/lib/services/ai-settings.service";
import { getDailyBriefSettings, updateDailyBriefSettings } from "@/lib/services/daily-brief.service";

const none = { googleCalendar: false, outlookCalendar: false, icloudCalendar: false, hevy: false };
const unanswered: StoredAiSettings = { approvedAt: null, revision: 0, dailyBriefEnabled: false, tipsEnabled: false, chatEnabled: false,
  includeNotes: false, includeReminderHistory: false, useConnectedSources: false, excludedSources: none };
const allOn: StoredAiSettings = { approvedAt: "2026-11-20T09:00:00Z", revision: 1, dailyBriefEnabled: true, tipsEnabled: true, chatEnabled: true,
  includeNotes: true, includeReminderHistory: true, useConnectedSources: true, excludedSources: none };
const caller = { client: {}, user: { id: "owner" } } as CalendarCaller;

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("OPENAI_API_KEY", "synthetic-key");
  mocks.read.mockResolvedValue(dailyBriefPreferences({ enabled: false, revision: 4 }));
  mocks.readAi.mockResolvedValue(unanswered);
  mocks.saveAi.mockImplementation(async () => allOn);
  mocks.timezone.mockResolvedValue("America/New_York");
});

describe("AI settings helper", () => {
  it("reads every feature off and no approval for an account that has not answered", () => {
    const settings = aiSettingsFromStored(unanswered);
    expect(settings.approved).toBe(false);
    for (const feature of AI_FEATURES) expect(aiFeatureOn(settings, feature)).toBe(false);
  });

  it("allows every source to every feature once everything is approved", () => {
    const settings = aiSettingsFromStored(allOn);
    expect(settings.approved).toBe(true);
    for (const feature of AI_FEATURES) for (const source of AI_SOURCES) expect(aiSourceAllowed(settings, feature, source)).toBe(true);
  });

  it("stops one source for every feature, and every source for a feature that is off", () => {
    const settings = aiSettingsFromStored({ ...allOn, chatEnabled: false, includeNotes: false, excludedSources: { ...none, outlookCalendar: true } });
    expect(aiSourceAllowed(settings, "tips", "notes")).toBe(false);
    expect(aiSourceAllowed(settings, "dailyBrief", "notes")).toBe(false);
    expect(aiSourceAllowed(settings, "tips", "outlookCalendar")).toBe(false);
    expect(aiSourceAllowed(settings, "tips", "googleCalendar")).toBe(true);
    for (const source of AI_SOURCES) expect(aiSourceAllowed(settings, "chat", source)).toBe(false);
    // Turning the connected-sources choice off stops every calendar and Hevy.
    const disconnected = aiSettingsFromStored({ ...allOn, useConnectedSources: false });
    expect(["googleCalendar", "outlookCalendar", "icloudCalendar", "hevy"].map((source) => disconnected.sources[source as "hevy"])).toEqual([false, false, false, false]);
    expect(disconnected.sources.notes).toBe(true);
  });

  it("reads through the repository with the caller's client", async () => {
    mocks.readAi.mockResolvedValue(allOn);
    const client = {} as never;
    await expect(readAiSettings(client)).resolves.toMatchObject({ approved: true, features: { chat: true } });
    expect(mocks.readAi).toHaveBeenCalledWith(client, undefined);
  });

  it("parses the database shape and refuses anything else", () => {
    const row = { approved_at: null, revision: 0, daily_brief_enabled: false, tips_enabled: false, chat_enabled: true, include_notes: true,
      include_reminder_history: false, use_connected_sources: true,
      excluded_sources: { google_calendar: false, outlook_calendar: true, icloud_calendar: false, hevy: false } };
    expect(parseAiSettings(row)).toMatchObject({ approvedAt: null, chatEnabled: true, includeNotes: true, excludedSources: { outlookCalendar: true, hevy: false } });
    expect(() => parseAiSettings({ ...row, chat_enabled: "yes" })).toThrow();
    expect(() => parseAiSettings({ ...row, excluded_sources: { hevy: false } })).toThrow();
    expect(() => parseAiSettings(null)).toThrow();
  });
});

describe("saving the AI features answer and Settings", () => {
  it("approves every feature and source with one Continue", async () => {
    await updateDailyBriefSettings(caller, { approval: "all_on" });
    expect(mocks.saveAi).toHaveBeenCalledWith(caller.client, { dailyBriefEnabled: true, tipsEnabled: true, chatEnabled: true,
      includeNotes: true, includeReminderHistory: true, useConnectedSources: true, excludedSources: none }, 4);
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("turns every feature off and keeps the stored source choices when the person keeps AI off", async () => {
    mocks.readAi.mockResolvedValue({ ...unanswered, includeNotes: true });
    await updateDailyBriefSettings(caller, { approval: "all_off" });
    expect(mocks.saveAi).toHaveBeenCalledWith(caller.client, expect.objectContaining({ dailyBriefEnabled: false, tipsEnabled: false, chatEnabled: false, includeNotes: true }), 4);
  });

  it("saves a Settings change to one feature and keeps sources on while Daily Brief is off", async () => {
    const body = { enabled: false, tipsEnabled: true, chatEnabled: false, useConnectedSources: true, excludedSources: { ...none, hevy: true },
      includeReminderHistory: true, includeNotes: false };
    await updateDailyBriefSettings(caller, body);
    expect(mocks.saveAi).toHaveBeenCalledWith(caller.client, { dailyBriefEnabled: false, tipsEnabled: true, chatEnabled: false,
      useConnectedSources: true, excludedSources: { ...none, hevy: true }, includeReminderHistory: true, includeNotes: false }, 4);
  });

  it("refuses an unknown answer, a partial body or extra keys", async () => {
    for (const body of [{ approval: "maybe" }, { approval: "all_on", prompt: "x" },
      { enabled: true, tipsEnabled: true, chatEnabled: "yes", useConnectedSources: true, excludedSources: none, includeReminderHistory: true, includeNotes: true },
      { enabled: true, tipsEnabled: true, chatEnabled: true, useConnectedSources: true, excludedSources: { hevy: false }, includeReminderHistory: true, includeNotes: true }]) {
      await expect(updateDailyBriefSettings(caller, body)).rejects.toMatchObject({ code: "invalid_request" });
    }
    expect(mocks.saveAi).not.toHaveBeenCalled();
  });

  it("reports the approval and the other features' switches with the settings", async () => {
    mocks.readAi.mockResolvedValue({ ...allOn, chatEnabled: false });
    await expect(getDailyBriefSettings(caller)).resolves.toMatchObject({ ai: { approved: true, tipsEnabled: true, chatEnabled: false } });
    mocks.readAi.mockRejectedValue(new Error("function read_ai_settings does not exist"));
    expect((await getDailyBriefSettings(caller)).ai).toBeUndefined();
  });
});

describe("AI features migration", () => {
  it("keeps the new row private, lets agents read and only the person's session save", async () => {
    const sql = await readFile(new URL("../supabase/migrations/20261120100000_ai_features_approval.sql", import.meta.url), "utf8");
    expect(sql).toContain("drop constraint daily_brief_preferences_optional_sources_need_enablement");
    expect(sql).toContain("drop constraint daily_brief_preferences_source_choice_needs_enablement");
    expect(sql).toContain("force row level security");
    expect(sql).toMatch(/read_ai_settings\(\)[\s\S]*actor_id uuid := \(select auth\.uid\(\)\)/);
    expect(sql).toMatch(/save_ai_settings\([\s\S]*actor_id uuid := cadence_advisor_private\.current_daily_brief_user\(\)/);
    expect(sql).toContain("grant execute on function public.read_ai_settings() to authenticated");
    expect(sql).not.toMatch(/grant [^;]* to (anon|service_role)/);
  });
});
