import { describe, expect, it } from "vitest";

import { groupTimezoneOptions, timezonePlaceLabel, timezoneRegionLabel } from "@/lib/ui/timezone-labels";

describe("timezone place labels (Ticket 309)", () => {
  it("names a timezone after its place", () => {
    expect(timezonePlaceLabel("America/New_York")).toBe("New York");
    expect(timezonePlaceLabel("Europe/London")).toBe("London");
    expect(timezonePlaceLabel("Asia/Ho_Chi_Minh")).toBe("Ho Chi Minh");
  });

  it("adds the sub-region for three-part names", () => {
    expect(timezonePlaceLabel("America/Indiana/Knox")).toBe("Knox, Indiana");
    expect(timezonePlaceLabel("America/North_Dakota/New_Salem")).toBe("New Salem, North Dakota");
    expect(timezonePlaceLabel("America/Argentina/Buenos_Aires")).toBe("Buenos Aires, Argentina");
  });

  it("keeps names that are not places unchanged", () => {
    for (const name of ["UTC", "Etc/GMT+5", "US/Eastern", "", "America/"]) expect(timezonePlaceLabel(name)).toBe(name);
  });

  it("names the region group", () => {
    expect(timezoneRegionLabel("America/New_York")).toBe("Americas");
    expect(timezoneRegionLabel("Indian/Maldives")).toBe("Indian Ocean");
    expect(timezoneRegionLabel("UTC")).toBeNull();
    expect(timezoneRegionLabel("Etc/GMT+5")).toBeNull();
  });

  it("gives every supported timezone a distinct label", () => {
    const zones = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
    const labels = zones.map((zone) => `${timezoneRegionLabel(zone)}:${timezonePlaceLabel(zone)}`);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("groups by region, sorts places by label, and keeps the IANA name as the value", () => {
    const groups = groupTimezoneOptions(["UTC", "America/New_York", "Europe/London", "America/Chicago", "America/Indiana/Knox"]);
    expect(groups).toEqual([
      { region: null, options: [{ value: "UTC", label: "UTC" }] },
      { region: "Americas", options: [
        { value: "America/Chicago", label: "Chicago" },
        { value: "America/Indiana/Knox", label: "Knox, Indiana" },
        { value: "America/New_York", label: "New York" },
      ] },
      { region: "Europe", options: [{ value: "Europe/London", label: "London" }] },
    ]);
  });
});
