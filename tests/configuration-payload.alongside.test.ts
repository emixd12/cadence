import { describe, expect, it } from "vitest";
import { planBehaviorConfigurationChangeEvent, planInitialBehaviorConfigurationEvent } from "@cadence/core/resolvers/behavior-configuration.resolver";
import { toBehaviorConfigurationEventPlanPayload, toStoredConfigurationSnapshot } from "@cadence/core/services/configuration-payload";
import type { BehaviorConfigurationSnapshot } from "@cadence/core/types/behavior-configuration-event";

const RECORDED_AT = "2026-11-25T12:00:00Z";
const configuration = (alongside: boolean | null | undefined): BehaviorConfigurationSnapshot => ({
  categoryId: null, locationText: null, whereKind: null, scheduleGraph: [],
  browserReminderEnabled: true, emailReminderEnabled: false, reminderOffsetMinutes: 0,
  active: true, timezone: "America/New_York", isOpportunity: true,
  ...(alongside === undefined ? {} : { alongside }),
});
const context = { recordedAt: RECORDED_AT, effectiveAt: RECORDED_AT, source: "manual" as const, reasonCode: "alongside_answered" };
type Payload = { previous_configuration: Record<string, unknown> | null; next_configuration: Record<string, unknown>; changed_fields: string[] };

describe("configuration plan payload and the alongside answer (Ticket 363)", () => {
  it("carries the answer on both sides once either side has one, including a cleared answer", () => {
    const set = toBehaviorConfigurationEventPlanPayload(planBehaviorConfigurationChangeEvent({
      ...context, previousConfiguration: configuration(null), nextConfiguration: configuration(true) })!) as Payload;
    expect(set.previous_configuration).toMatchObject({ alongside: null });
    expect(set.next_configuration).toMatchObject({ alongside: true });
    expect(set.changed_fields).toEqual(["alongside"]);
    const cleared = toBehaviorConfigurationEventPlanPayload(planBehaviorConfigurationChangeEvent({
      ...context, previousConfiguration: configuration(true), nextConfiguration: configuration(null) })!) as Payload;
    expect(cleared.next_configuration).toHaveProperty("alongside", null);
  });

  it("leaves the key out when neither side has an answer, so the database keeps the stored one", () => {
    const baseline = toBehaviorConfigurationEventPlanPayload(planInitialBehaviorConfigurationEvent({ ...context, configuration: configuration(undefined) })) as Payload;
    expect(baseline.next_configuration).not.toHaveProperty("alongside");
    // A plan without the key names no answer field, as the database expects of it.
    expect(baseline.changed_fields).not.toContain("alongside");
    const answered = toBehaviorConfigurationEventPlanPayload(planInitialBehaviorConfigurationEvent({ ...context, configuration: configuration(true) })) as Payload;
    expect(answered.next_configuration).toMatchObject({ alongside: true });
    expect(answered.changed_fields).toContain("alongside");
  });

  it("converts a Mac snapshot's answer to the hosted shape, and leaves older snapshots alone", () => {
    expect(toStoredConfigurationSnapshot({ ...configuration(false), scheduleGraph: [] } as never)).toMatchObject({ alongside: false });
    expect(toStoredConfigurationSnapshot({ ...configuration(undefined), scheduleGraph: [] } as never)).not.toHaveProperty("alongside");
  });
});
