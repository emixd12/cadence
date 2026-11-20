import { describe, expect, it } from "vitest";

import { config } from "@/proxy";

describe("root proxy route coverage", () => {
  it("refreshes auth cookies before structured export API handlers", () => {
    expect(config.matcher).toContain("/api/export/:path*");
    expect(config.matcher).toContain("/chat/:path*");
  });
});
