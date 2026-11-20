// Advisor plan Phase 4, workstream 4F (owner decision D2, 2026-11-19). The words for
// the one AI features question at first run and for Settings > AI features, shared
// by the web and the Mac. Each item says what it does and what turning it off loses.

export type AiFeatureCopyKey = "dailyBrief" | "tips" | "chat";
export type AiSourceCopyKey = "history" | "notes" | "reminderHistory" | "connected";

export const AI_FEATURES_TITLE = "AI features";

export const AI_FEATURES_INTRO =
  "Cadence uses AI to plan your day, give you tips and answer questions about your days. Everything below is on. You can turn any of it off in Settings at any time.";

export const AI_FEATURE_COPY: Readonly<Record<AiFeatureCopyKey, Readonly<{ title: string; does: string; without: string }>>> = {
  dailyBrief: {
    title: "Daily Brief",
    does: "Plans your day when you first open Timeline, and moves today’s items when you say Yes.",
    without: "No morning plan and no suggested moves.",
  },
  tips: {
    title: "Advisor tips",
    does: "Up to three short tips a day, built from your own records.",
    without: "No tips from the advisor.",
  },
  chat: {
    title: "Chat",
    does: "Ask about your days, and mark or move items by asking.",
    without: "No Chat page.",
  },
};

export const AI_SOURCES_HEADING = "What they use";

export const AI_SOURCE_COPY: Readonly<Record<AiSourceCopyKey, Readonly<{ title: string; does: string; without: string }>>> = {
  history: {
    title: "Behaviors and history",
    does: "Your Behaviors, their times and what you marked. Always used while a feature is on.",
    without: "",
  },
  notes: {
    title: "Notes",
    does: "Notes you wrote on items and days.",
    without: "Tips and Chat cannot see what got in the way.",
  },
  reminderHistory: {
    title: "Reminder history",
    does: "When reminders were sent, as counts. Never their text.",
    without: "Tips cannot tell whether reminders help you.",
  },
  connected: {
    title: "Connected calendars and Hevy",
    does: "Event times from your calendars, and event titles for Chat. Workout times from Hevy.",
    without: "Plans and moves ignore your meetings and workouts.",
  },
};

export const AI_PROVIDER_LINE =
  "Cadence sends what a feature needs to an AI model to write its replies.";

export const AI_APPROVE_LABEL = "Continue";
export const AI_DECLINE_LABEL = "Keep AI features off";
export const AI_DECLINE_NOTE = "You can turn them on later in Settings.";

export const AI_UNANSWERED_LINE =
  "You have not answered the AI features question yet. Every feature stays off until you do.";
export const AI_SETTINGS_APPROVE_LABEL = "Turn everything on";

export function aiOffLine(without: string): string {
  return `Off. ${without}`;
}
