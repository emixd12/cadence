import { describe, expect, it } from "vitest";
import type { ChatTravelUiCard } from "@cadence/core/types/chat-travel";
import { createLiveChatExecutor } from "@/lib/services/chat/chat-executor";
import {
  CHAT_CONFIRM_WRITES,
  CHAT_IMMEDIATE_WRITES,
  isChatWrite,
  isImmediateWrite,
} from "@/lib/services/chat/chat-tools";
import { applyChatEvent, EMPTY_CHAT_THREAD } from "@/lib/ui/chat";
import type { IntegrationContext } from "@/lib/integrations/request-context";

describe("Chat 7-day travel organizing & hybrid UI cards (L-001, Q1, Q5)", () => {
  it("emits exact travel_card payloads to UI while sending ZERO durations or leave-by times to LLM", async () => {
    const emittedCards: ChatTravelUiCard[] = [];
    const executor = createLiveChatExecutor({
      context: {} as IntegrationContext,
      sources: { notes: true, googleCalendar: true, outlookCalendar: false, icloudCalendar: false, hevy: false },
      today: () => "2026-11-25",
      timezone: "America/New_York",
      onTravelCards: (cards) => emittedCards.push(...cards),
      reads: {
        calendarEvents: async () => ({ events: [], sources: [] }),
        workouts: async () => ({ workouts: [], sources: [] }),
        travelHorizonData: async () => ({
          sources: [{ source: "googleCalendar", state: "read" }],
          trips: [
            {
              localDate: "2026-11-25",
              tripLabel: "Dentist",
              destinationLabel: "Downtown Clinic",
              mode: "driving",
              departureAt: "2026-11-25T14:15:00Z",
              arrivalAt: "2026-11-25T14:50:00Z",
              durationSeconds: 35 * 60,
              bufferMinutes: 10,
            },
          ],
          occurrences: [
            {
              occurrenceRef: "occ-1",
              behaviorId: "beh-1",
              localDate: "2026-11-25",
              startAt: "2026-11-25T14:30:00Z",
              endAt: "2026-11-25T15:00:00Z",
              durationMinutes: 30,
              flexible: true,
            },
          ],
        }),
      },
    });

    const result = await executor("plan_travel_horizon", { horizon_days: 7 }, { idempotencyKey: null });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // UI receives exact travel cards
    expect(emittedCards).toHaveLength(1);
    expect(result.uiTravelCards).toHaveLength(1);
    expect(emittedCards[0]?.tripLabel).toBe("Dentist");
    expect(emittedCards[0]?.durationMinutes).toBe(35);
    expect(emittedCards[0]?.leaveByLocalTime).toBe("09:15");

    // LLM receives ONLY deterministic modelSummary — zero durations, leave-by times, or addresses
    const serializedModelPayload = JSON.stringify(result.result);
    expect(serializedModelPayload).not.toContain("durationMinutes");
    expect(serializedModelPayload).not.toContain("leaveByLocalTime");
    expect(serializedModelPayload).not.toContain("arrivalLocalTime");
    expect(serializedModelPayload).not.toContain("Downtown Clinic");
    expect(serializedModelPayload).toContain("does_not_fit");
    expect(serializedModelPayload).toContain("crossDayCandidates");
  });

  it("folds travel_card stream events into ChatThreadState cleanly", () => {
    const started = applyChatEvent(
      EMPTY_CHAT_THREAD,
      { type: "start", conversationId: "c1", userMessageId: "u1", messageId: "m1", protocol: "1" },
      "cm-1",
    );
    const card: ChatTravelUiCard = {
      localDate: "2026-11-25",
      tripLabel: "Dentist",
      destinationLabel: "Downtown Clinic",
      mode: "driving",
      leaveByLocalTime: "09:15",
      durationMinutes: 35,
      arrivalLocalTime: "09:50",
      bufferMinutes: 10,
      conflictSummary: "Overlaps 1 scheduled Behavior.",
    };
    const withCard = applyChatEvent(started, { type: "travel_card", card }, "cm-1");
    expect(withCard.messages[0]?.parts).toEqual([{ type: "travel_card", card }]);
  });

  it("requires confirmation for cross-day moves and recurring remodeling while keeping T12 same-day writes immediate", () => {
    expect(CHAT_CONFIRM_WRITES).toContain("move_occurrence_to_date");
    expect(CHAT_CONFIRM_WRITES).toContain("update_behavior");
    expect(isChatWrite("move_occurrence_to_date")).toBe(true);
    expect(isImmediateWrite("move_occurrence_to_date")).toBe(false);
    expect(isImmediateWrite("update_behavior")).toBe(false);

    // T12 same-day single-record writes remain immediate with Undo
    expect(CHAT_IMMEDIATE_WRITES).toContain("move_occurrence_for_day");
    expect(CHAT_IMMEDIATE_WRITES).toContain("set_occurrence_status");
    expect(isImmediateWrite("move_occurrence_for_day")).toBe(true);
    expect(isImmediateWrite("set_occurrence_status")).toBe(true);
  });
});
