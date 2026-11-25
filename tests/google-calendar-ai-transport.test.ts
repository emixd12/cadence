import { describe, expect, it } from "vitest";

import {
  dailyBriefReadsGoogleCalendar,
  googleCalendarUsesAgentMcp,
} from "@cadence/core/services/daily-brief-sources";
import {
  GOOGLE_CALENDAR_AI_TRANSPORT_ENV,
  isGoogleCalendarAiTransportEnabled,
  readGoogleCalendarAiTransportMode,
} from "@/lib/services/google-calendar-ai-transport";

describe("Google Calendar AI transport gate", () => {
  it("defaults safely to disabled when unset, blank, or invalid", () => {
    for (const value of [undefined, "", "   ", "disabled", "timeline", "rest", "true", "1", "AGENT_MCP", "unknown"]) {
      const env = { [GOOGLE_CALENDAR_AI_TRANSPORT_ENV]: value };
      expect(readGoogleCalendarAiTransportMode(env)).toBe("disabled");
      expect(isGoogleCalendarAiTransportEnabled(env)).toBe(false);
    }
  });

  it("enables only when explicitly set to agent_mcp", () => {
    expect(readGoogleCalendarAiTransportMode({ [GOOGLE_CALENDAR_AI_TRANSPORT_ENV]: "agent_mcp" })).toBe("agent_mcp");
    expect(isGoogleCalendarAiTransportEnabled({ [GOOGLE_CALENDAR_AI_TRANSPORT_ENV]: "agent_mcp" })).toBe(true);
    expect(readGoogleCalendarAiTransportMode({ [GOOGLE_CALENDAR_AI_TRANSPORT_ENV]: "  agent_mcp  " })).toBe("agent_mcp");
    expect(isGoogleCalendarAiTransportEnabled({ [GOOGLE_CALENDAR_AI_TRANSPORT_ENV]: "  agent_mcp  " })).toBe(true);
  });
});

describe("daily-brief-sources Google Calendar helpers", () => {
  it("accepts both agent_mcp and timeline for dailyBriefReadsGoogleCalendar during rollout", () => {
    expect(dailyBriefReadsGoogleCalendar({ googleCalendarSource: "agent_mcp" })).toBe(true);
    expect(dailyBriefReadsGoogleCalendar({ googleCalendarSource: "timeline" })).toBe(true);
    expect(dailyBriefReadsGoogleCalendar({ googleCalendarSource: null })).toBe(false);
  });

  it("reports googleCalendarUsesAgentMcp only for agent_mcp", () => {
    expect(googleCalendarUsesAgentMcp({ googleCalendarSource: "agent_mcp" })).toBe(true);
    expect(googleCalendarUsesAgentMcp({ googleCalendarSource: "timeline" })).toBe(false);
    expect(googleCalendarUsesAgentMcp({ googleCalendarSource: null })).toBe(false);
  });
});
