import { Temporal } from "@js-temporal/polyfill";
import { describe, expect, it } from "vitest";

import {
  isConnectorStatusEvent,
  resolveConnectorStatusEvent,
} from "../packages/core/src/resolvers/status.resolver";
import {
  resolveNoteUpdate,
  resolveStatusEvent,
  resolveStatusTransition,
  type StatusResolverOccurrence,
} from "../lib/resolvers/status.resolver";

const NOW = Temporal.Instant.from("2026-06-08T14:35:00Z");

function occurrence(
  overrides: Partial<StatusResolverOccurrence> = {},
): StatusResolverOccurrence {
  return {
    status: "unresolved",
    completedAt: null,
    statusMarkedAt: null,
    note: null,
    ...overrides,
  };
}

describe("resolveStatusTransition", () => {
  it("marks an unresolved occurrence Completed with status and completion timestamps", () => {
    const update = resolveStatusTransition({
      occurrence: occurrence(),
      nextStatus: "completed",
      now: NOW,
    });

    expect(update).toEqual({
      status: "completed",
      completedAt: "2026-06-08T14:35:00Z",
      statusMarkedAt: "2026-06-08T14:35:00Z",
    });
  });

  it("marks an unresolved occurrence Not Completed without a completion timestamp", () => {
    const update = resolveStatusTransition({
      occurrence: occurrence(),
      nextStatus: "not_completed",
      now: NOW,
    });

    expect(update).toEqual({
      status: "not_completed",
      completedAt: null,
      statusMarkedAt: "2026-06-08T14:35:00Z",
    });
  });

  it("lets a Completed occurrence be changed to Not Completed later", () => {
    const update = resolveStatusTransition({
      occurrence: occurrence({
        status: "completed",
        completedAt: "2026-06-07T12:00:00Z",
        statusMarkedAt: "2026-06-07T12:00:00Z",
      }),
      nextStatus: "not_completed",
      now: NOW,
    });

    expect(update).toEqual({
      status: "not_completed",
      completedAt: null,
      statusMarkedAt: "2026-06-08T14:35:00Z",
    });
  });

  it("lets a Not Completed occurrence be changed to Completed later", () => {
    const update = resolveStatusTransition({
      occurrence: occurrence({
        status: "not_completed",
        completedAt: null,
        statusMarkedAt: "2026-06-07T12:00:00Z",
      }),
      nextStatus: "completed",
      now: NOW,
    });

    expect(update).toEqual({
      status: "completed",
      completedAt: "2026-06-08T14:35:00Z",
      statusMarkedAt: "2026-06-08T14:35:00Z",
    });
  });

  it("keeps existing timestamps when reapplying the same resolved status", () => {
    const update = resolveStatusTransition({
      occurrence: occurrence({
        status: "completed",
        completedAt: "2026-06-07T12:00:00Z",
        statusMarkedAt: "2026-06-07T12:00:00Z",
      }),
      nextStatus: "completed",
      now: NOW,
    });

    expect(update).toEqual({
      status: "completed",
      completedAt: "2026-06-07T12:00:00Z",
      statusMarkedAt: "2026-06-07T12:00:00Z",
    });
  });

  it("can return an occurrence to unresolved without creating a missed state", () => {
    const update = resolveStatusTransition({
      occurrence: occurrence({
        status: "not_completed",
        completedAt: null,
        statusMarkedAt: "2026-06-07T12:00:00Z",
      }),
      nextStatus: "unresolved",
      now: NOW,
    });

    expect(update).toEqual({
      status: "unresolved",
      completedAt: null,
      statusMarkedAt: null,
    });
  });
});

describe("resolveStatusEvent", () => {
  it("plans an explicit mark event for the first resolved status", () => {
    const occurrenceBefore = occurrence();
    const update = resolveStatusTransition({
      occurrence: occurrenceBefore,
      nextStatus: "completed",
      now: NOW,
    });

    expect(
      resolveStatusEvent({
        occurrence: occurrenceBefore,
        nextStatus: "completed",
        now: NOW,
        update,
      }),
    ).toEqual({
      previousStatus: "unresolved",
      status: "completed",
      statusSemantics: "explicit_user_mark",
      recordedAt: "2026-06-08T14:35:00Z",
      effectiveAt: "2026-06-08T14:35:00Z",
      sourceCaptureMethod: "manual_tap",
      sourceConfidence: "high",
    });
  });

  it("plans an explicit correction event when a resolved status changes", () => {
    const occurrenceBefore = occurrence({
      status: "completed",
      completedAt: "2026-06-07T12:00:00Z",
      statusMarkedAt: "2026-06-07T12:00:00Z",
    });
    const update = resolveStatusTransition({
      occurrence: occurrenceBefore,
      nextStatus: "not_completed",
      now: NOW,
    });

    expect(
      resolveStatusEvent({
        occurrence: occurrenceBefore,
        nextStatus: "not_completed",
        now: NOW,
        update,
      }),
    ).toMatchObject({
      previousStatus: "completed",
      status: "not_completed",
      statusSemantics: "explicit_user_correction",
      recordedAt: "2026-06-08T14:35:00Z",
      effectiveAt: "2026-06-08T14:35:00Z",
    });
  });

  it("plans an explicit correction event when a resolved status is returned to unresolved", () => {
    const occurrenceBefore = occurrence({
      status: "completed",
      completedAt: "2026-06-07T12:00:00Z",
      statusMarkedAt: "2026-06-07T12:00:00Z",
    });
    const update = resolveStatusTransition({
      occurrence: occurrenceBefore,
      nextStatus: "unresolved",
      now: NOW,
    });

    expect(
      resolveStatusEvent({
        occurrence: occurrenceBefore,
        nextStatus: "unresolved",
        now: NOW,
        update,
      }),
    ).toMatchObject({
      previousStatus: "completed",
      status: "unresolved",
      statusSemantics: "explicit_user_correction",
      recordedAt: "2026-06-08T14:35:00Z",
      effectiveAt: null,
    });
  });

  it("plans a correction when resolving again after a prior status event", () => {
    const occurrenceBefore = occurrence();
    const update = resolveStatusTransition({
      occurrence: occurrenceBefore,
      nextStatus: "completed",
      now: NOW,
    });

    expect(
      resolveStatusEvent({
        occurrence: occurrenceBefore,
        nextStatus: "completed",
        now: NOW,
        hasPriorStatusEvent: true,
        update,
      }),
    ).toMatchObject({
      previousStatus: "unresolved",
      status: "completed",
      statusSemantics: "explicit_user_correction",
      recordedAt: "2026-06-08T14:35:00Z",
      effectiveAt: "2026-06-08T14:35:00Z",
    });
  });

  it("does not create an event when the resolved status is unchanged", () => {
    const occurrenceBefore = occurrence({
      status: "completed",
      completedAt: "2026-06-07T12:00:00Z",
      statusMarkedAt: "2026-06-07T12:00:00Z",
    });
    const update = resolveStatusTransition({
      occurrence: occurrenceBefore,
      nextStatus: "completed",
      now: NOW,
    });

    expect(
      resolveStatusEvent({
        occurrence: occurrenceBefore,
        nextStatus: "completed",
        now: NOW,
        update,
      }),
    ).toBeNull();
  });
});

describe("resolveNoteUpdate", () => {
  it("normalizes multiline occurrence notes", () => {
    expect(resolveNoteUpdate({ note: "  First line\r\nSecond line  " })).toEqual({
      note: "First line\nSecond line",
    });
  });

  it("stores blank occurrence notes as null", () => {
    expect(resolveNoteUpdate({ note: " \n\t " })).toEqual({
      note: null,
    });
  });
});

describe("resolveConnectorStatusEvent (Ticket 313, D28.7)", () => {
  it("plans a connector completion with connector provenance and the activity end", () => {
    const plan = resolveConnectorStatusEvent({
      source: "hevy",
      transition: "complete",
      now: NOW,
      activityEndAt: "2026-06-08T13:45:00Z",
    });
    expect(plan).toEqual({
      update: { status: "completed", completedAt: "2026-06-08T13:45:00Z", statusMarkedAt: "2026-06-08T14:35:00Z" },
      event: {
        previousStatus: "unresolved",
        status: "completed",
        statusSemantics: "system_rule_declared",
        recordedAt: "2026-06-08T14:35:00Z",
        effectiveAt: "2026-06-08T13:45:00Z",
        sourceCaptureMethod: "derived",
        sourceConfidence: "high",
        reasonCode: "connector:hevy",
      },
    });
    expect(isConnectorStatusEvent(plan.event)).toBe(true);
  });

  it("plans a revert to Unresolved without status timestamps", () => {
    const plan = resolveConnectorStatusEvent({ source: "hevy", transition: "revert", now: NOW });
    expect(plan.update).toEqual({ status: "unresolved", completedAt: null, statusMarkedAt: null });
    expect(plan.event).toMatchObject({ previousStatus: "completed", status: "unresolved", effectiveAt: null, reasonCode: "connector:hevy" });
  });

  it("rejects a future activity end, a missing end and a malformed source", () => {
    expect(() => resolveConnectorStatusEvent({ source: "hevy", transition: "complete", now: NOW, activityEndAt: "2026-06-08T15:00:00Z" }))
      .toThrow("cannot end after");
    expect(() => resolveConnectorStatusEvent({ source: "hevy", transition: "complete", now: NOW })).toThrow("activity end");
    expect(() => resolveConnectorStatusEvent({ source: "Hevy:x", transition: "revert", now: NOW })).toThrow("lowercase");
  });

  it("keeps manual plans unable to carry connector provenance", () => {
    const update = resolveStatusTransition({ occurrence: occurrence(), nextStatus: "completed", now: NOW });
    const event = resolveStatusEvent({ occurrence: occurrence(), nextStatus: "completed", now: NOW, update });
    expect(event).toMatchObject({ statusSemantics: "explicit_user_mark", sourceCaptureMethod: "manual_tap" });
    expect(event).not.toHaveProperty("reasonCode");
    expect(isConnectorStatusEvent({ ...event!, reasonCode: "connector:hevy" })).toBe(false);
  });
});
