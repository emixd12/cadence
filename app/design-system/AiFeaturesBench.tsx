"use client";

import { useState } from "react";
import type { DailyBriefSettings } from "@cadence/core/types/daily-brief";

import { DailyBriefSettingsPanel } from "@/components/briefing/DailyBriefSettingsPanel";
import { AiFeaturesApproval } from "@/components/onboarding/AiFeaturesApproval";
import type { DailyBriefClient, DailyBriefSettingsUpdate } from "@/lib/ui/daily-brief";

// Advisor 4F bench: the AI features question and Settings > AI features on a fixture
// account. Changes stay on this page; nothing is saved.

export function createAiFeaturesBenchClient({ approved }: Readonly<{ approved: boolean }>): DailyBriefClient {
  let settings: DailyBriefSettings = {
    accountRef: "bench-account", available: true, revision: 1, localDate: "2026-11-20", timezone: "America/New_York",
    enabled: approved, useConnectedSources: approved, includeReminderHistory: approved, includeNotes: approved,
    excludedSources: { googleCalendar: false, outlookCalendar: false, icloudCalendar: false, hevy: approved },
    sourceStatus: { googleCalendar: "ready", outlookCalendar: "no_calendars", icloudCalendar: "not_connected", hevy: "ready" },
    optionalSources: { reminders: true, notes: true },
    includeCalendar: approved, includeOutlookCalendar: false, includeIcloudCalendar: false, includeHevy: false,
    ai: { approved, tipsEnabled: approved, chatEnabled: approved },
  };
  const apply = (input: DailyBriefSettingsUpdate): DailyBriefSettings => {
    if ("approval" in input) {
      const on = input.approval === "all_on";
      return { ...settings, enabled: on, ai: { approved: true, tipsEnabled: on, chatEnabled: on },
        ...(on ? { useConnectedSources: true, includeNotes: true, includeReminderHistory: true,
          excludedSources: { googleCalendar: false, outlookCalendar: false, icloudCalendar: false, hevy: false } } : {}) };
    }
    const ai = "tipsEnabled" in input ? { approved: true, tipsEnabled: input.tipsEnabled, chatEnabled: input.chatEnabled } : settings.ai;
    const { enabled, useConnectedSources, excludedSources, includeNotes, includeReminderHistory } = input;
    return { ...settings, enabled, useConnectedSources, excludedSources, includeNotes, includeReminderHistory, ai };
  };
  return {
    preferences: async () => settings,
    updatePreferences: async (input) => {
      settings = { ...apply(input), revision: settings.revision + 1 };
      return settings;
    },
    requestBrief: async () => ({ state: "already_attempted" }),
  };
}

export function AiFeaturesApprovalBench() {
  const [client] = useState(() => createAiFeaturesBenchClient({ approved: false }));
  return <AiFeaturesApproval client={client}>
    <p className="text-sm text-muted-readable">Answered. The first-run setup pop-up shows here next.</p>
  </AiFeaturesApproval>;
}

export function AiFeaturesSettingsBench({ approved }: Readonly<{ approved: boolean }>) {
  const [client] = useState(() => createAiFeaturesBenchClient({ approved }));
  return <DailyBriefSettingsPanel client={client} />;
}

/** `/design-system?preview=ai-features&state=approval|settings|settings-unanswered`. */
export function AiFeaturesPreview({ state }: Readonly<{ state: string }>) {
  return <main className="min-h-dvh bg-background text-foreground">
    <div className="mx-auto grid max-w-xl gap-6 px-4 py-6">
      <a href="/design-system" className="w-fit text-sm underline underline-offset-4">Back to the design-system bench</a>
      {state === "approval" ? <>
        <h1 className="text-2xl">Timeline</h1>
        <p className="text-sm text-muted-readable">Fixture page. The AI features question shows in the first-run pop-up’s place.</p>
        <AiFeaturesApprovalBench />
      </> : <>
        <h2 className="border-b border-line pb-2 text-2xl">Planning</h2>
        <AiFeaturesSettingsBench approved={state !== "settings-unanswered"} />
      </>}
    </div>
  </main>;
}
