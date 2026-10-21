import { afterEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/.well-known/openai-apps-challenge/route";

describe("OpenAI domain verification", () => {
  afterEach(() => vi.unstubAllEnvs());

  it.each([undefined, ""])("returns an uncached empty 404 when unset (%s)", async (token) => {
    vi.stubEnv("OPENAI_APPS_CHALLENGE", token);
    const response = GET();

    expect(response.status).toBe(404);
    expect(await response.text()).toBe("");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("returns only the exact token as uncached plain text, including after rotation", async () => {
    vi.stubEnv("CADENCE_MCP_ENABLED", "false");
    for (const token of ["verification-example+/=", " replacement-token\n"]) {
      vi.stubEnv("OPENAI_APPS_CHALLENGE", token);
      const response = GET();

      expect(response.status).toBe(200);
      expect(await response.text()).toBe(token);
      expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    }

    vi.stubEnv("OPENAI_APPS_CHALLENGE", undefined);
    expect(GET().status).toBe(404);
  });
});
