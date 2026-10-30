import { describe, expect, it } from "vitest";

import { BehaviorValidationError } from "@cadence/core/services/behavior-values";
import { planBehaviorWhere, storedBehaviorWhere } from "@cadence/core/services/behavior-where";
import { parseBehaviorFormData } from "@/lib/services/behavior-form";

// Ticket 215: Not set (null), Anywhere, Home, or A place with its text.
describe("planBehaviorWhere", () => {
  it("keeps place text only for A place", () => {
    expect(planBehaviorWhere({ whereKind: "place", locationText: "  1 Example Street " }))
      .toEqual({ where_kind: "place", location_text: "1 Example Street" });
    for (const whereKind of [null, "anywhere", "home"] as const) {
      expect(planBehaviorWhere({ whereKind, locationText: "1 Example Street" }, { where_kind: "place", location_text: "1 Example Street" }))
        .toEqual({ where_kind: whereKind, location_text: null });
    }
  });

  it("requires text for A place", () => {
    expect(() => planBehaviorWhere({ whereKind: "place", locationText: "  " })).toThrow(BehaviorValidationError);
    try { planBehaviorWhere({ whereKind: "place", locationText: null }); }
    catch (error) { expect((error as BehaviorValidationError).fieldErrors).toEqual({ location_text: "Enter the place." }); }
  });

  it("applies the pre-Where rule when a caller sends only location text", () => {
    expect(planBehaviorWhere({ locationText: "2 Example Street" }, { where_kind: "home", location_text: null }))
      .toEqual({ where_kind: "place", location_text: "2 Example Street" });
    expect(planBehaviorWhere({ locationText: null }, { where_kind: "place", location_text: "2 Example Street" }))
      .toEqual({ where_kind: null, location_text: null });
    expect(planBehaviorWhere({ locationText: null }, { where_kind: "anywhere", location_text: null }))
      .toEqual({ where_kind: "anywhere", location_text: null });
    expect(planBehaviorWhere({}, { where_kind: "home", location_text: null }))
      .toEqual({ where_kind: "home", location_text: null });
    expect(planBehaviorWhere({})).toEqual({ where_kind: null, location_text: null });
  });

  it("rejects unknown Where values", () => {
    expect(() => planBehaviorWhere({ whereKind: "elsewhere" as never })).toThrow(BehaviorValidationError);
  });
});

describe("storedBehaviorWhere", () => {
  it("reads rows written before Where from their location text", () => {
    expect(storedBehaviorWhere({ location_text: "1 Example Street" })).toEqual({ where_kind: "place", location_text: "1 Example Street" });
    expect(storedBehaviorWhere({ location_text: null })).toEqual({ where_kind: null, location_text: null });
    expect(storedBehaviorWhere({ where_kind: "home", location_text: null })).toEqual({ where_kind: "home", location_text: null });
    expect(() => storedBehaviorWhere({ where_kind: "office" })).toThrow();
  });
});

describe("parseBehaviorFormData Where", () => {
  const base: Array<[string, string]> = [
    ["title", "Walk"], ["scheduled_time", "09:00"], ["recurrence_kind", "daily"], ["daily_interval", "1"], ["reminder_offset", "0"],
  ];
  const parse = (entries: Array<[string, string]>) => {
    const form = new FormData();
    for (const [key, value] of [...base, ...entries]) form.append(key, value);
    return parseBehaviorFormData(form, { mode: "create" });
  };

  it("reads Not set, Anywhere and Home without place text", () => {
    expect(parse([["where_kind", ""]])).toMatchObject({ whereKind: null, locationText: null });
    expect(parse([["where_kind", "anywhere"], ["location_text", "ignored"]])).toMatchObject({ whereKind: "anywhere", locationText: null });
    expect(parse([["where_kind", "home"]])).toMatchObject({ whereKind: "home", locationText: null });
  });

  it("requires the place for A place", () => {
    expect(parse([["where_kind", "place"], ["location_text", " 1 Example Street "]])).toMatchObject({ whereKind: "place", locationText: "1 Example Street" });
    expect(() => parse([["where_kind", "place"], ["location_text", ""]])).toThrow(BehaviorValidationError);
    try { parse([["where_kind", "office"]]); }
    catch (error) { expect((error as BehaviorValidationError).fieldErrors).toEqual({ where_kind: "Choose where this happens." }); }
  });

  it("leaves Where to the service when the form has no Where field (MCP input)", () => {
    const parsed = parse([["location_text", "1 Example Street"]]);
    expect(parsed.whereKind).toBeUndefined();
    expect(parsed.locationText).toBe("1 Example Street");
  });
});
