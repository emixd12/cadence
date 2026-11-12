import { describe, expect, it } from "vitest";
import { Temporal } from "@js-temporal/polyfill";
import { BRIEFING_PRESETS, parseBriefingConfig } from "@cadence/core/services/briefing-config";
import { BRIEFING_FIXTURE_IDS, briefingFixture } from "@/lib/services/briefing-fixtures";
import {
  DailyBriefError, generateDailyBrief, prepareDailyBrief, validateDailyBrief, type DailyBriefModelRequest, type DailyBriefValidationData,
} from "@/lib/services/daily-brief-consumer";

// Ticket 296: the prepare and validate steps compose to exactly what generateDailyBrief returns,
// and the validation data survives a JSON round trip, so the model call can run on another device.
const signal = () => new AbortController().signal;
const roundTrip = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** A minimal output every recipe accepts: one sentence, no refs, no suggestions, no tip. */
const quietOutput = () => ({ text: "Today looks manageable.", occurrenceRefs: [], suggestions: [], tip: null });

function setup(presetId: string, fixtureId: typeof BRIEFING_FIXTURE_IDS[number]) {
  const config = parseBriefingConfig(BRIEFING_PRESETS.find((item) => item.id === presetId)!.config);
  const context = briefingFixture(fixtureId, config);
  const now = () => Temporal.Instant.from(context.capturedAt);
  return { config, context, now };
}

const presetIds = BRIEFING_PRESETS.map((item) => item.id);
const fixtures = ["sparse", "dense", "overlap", "tight_transition", "supported_gap", "uneventful", "travel_day"] as const;

describe("Daily Brief prepare and validate", () => {
  for (const presetId of presetIds) {
    for (const fixtureId of fixtures) {
      it(`matches generateDailyBrief after a JSON round trip (${presetId}, ${fixtureId})`, async () => {
        const { config, context, now } = setup(presetId, fixtureId);
        let sent: DailyBriefModelRequest | null = null;
        const composed = await generateDailyBrief(context, { config, now, signal: signal(),
          generate: async ({ instructions, facts }) => { sent = { instructions, facts }; return quietOutput(); } });
        const prepared = await prepareDailyBrief(context, { config, now, signal: signal() });
        expect(prepared.request).toEqual(sent);
        const validation = roundTrip(prepared.validation);
        expect(validation).toEqual(prepared.validation);
        expect(validateDailyBrief(roundTrip(quietOutput()), validation, { now })).toEqual(composed);
      });
    }
  }

  it("rejects output that names an occurrence the request did not include", async () => {
    const { config, context, now } = setup("cadence-default", "sparse");
    const { validation } = await prepareDailyBrief(context, { config, now, signal: signal() });
    const output = { ...quietOutput(), occurrenceRefs: ["occurrence_not_offered"] };
    expect(() => validateDailyBrief(output, roundTrip(validation), { now })).toThrow(expect.objectContaining({ code: "advisor_unavailable", reason: "validation_unknown_ref" }));
  });

  it("rejects validation after the context expires", async () => {
    const { config, context, now } = setup("cadence-default", "sparse");
    const { validation } = await prepareDailyBrief(context, { config, now, signal: signal() });
    const late = () => Temporal.Instant.from(context.expiresAt);
    expect(() => validateDailyBrief(quietOutput(), validation, { now: late })).toThrow(expect.objectContaining({ code: "context_expired" }));
  });

  it("rejects validation data whose configuration no longer matches its revision", async () => {
    const { config, context, now } = setup("cadence-default", "sparse");
    const { validation } = await prepareDailyBrief(context, { config, now, signal: signal() });
    const changed = { ...validation, config: { ...validation.config, alternatives: validation.config.alternatives + 1 } } as DailyBriefValidationData;
    expect(() => validateDailyBrief(quietOutput(), changed, { now })).toThrow(expect.objectContaining({ code: "context_changed" }));
  });

  it("rejects validation data from an unknown version", async () => {
    const { config, context, now } = setup("cadence-default", "sparse");
    const { validation } = await prepareDailyBrief(context, { config, now, signal: signal() });
    const other = { ...validation, version: 2 } as unknown as DailyBriefValidationData;
    expect(() => validateDailyBrief(quietOutput(), other, { now })).toThrow(DailyBriefError);
  });
});
