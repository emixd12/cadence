import { describe, expect, it } from "vitest";
import { checkboxState, permissionLine, scrubLog } from "../scripts/location-vm.mjs";

describe("location VM results", () => {
  it("drops every log line that looks like a coordinate", () => {
    const log = [
      "cadence location result granted reason none",
      "CoreLocationAgent handle auth-prompt",
      "fix 40.712776 -74.005974",
      "lat=-33.8688 lon=151.2093",
    ].join("\n");
    expect(scrubLog(log)).toEqual(["cadence location result granted reason none", "CoreLocationAgent handle auth-prompt"]);
  });

  it("reads the Device location line without the next accessibility field", () => {
    expect(permissionLine("AXStaticText: Device location: denied. To use your current position | other"))
      .toBe("Device location: denied. To use your current position");
    expect(permissionLine("no match")).toBeNull();
  });

  it("reads the Travel estimates checkbox value", () => {
    expect(checkboxState("AXCheckBox: Travel estimates | 1")).toBe("on");
    expect(checkboxState("AXCheckBox: Travel estimates | 0")).toBe("off");
    expect(checkboxState("no match")).toBe("unknown");
  });
});
