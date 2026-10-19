import { NextRequest } from "next/server";
import { beforeEach, expect, it, vi } from "vitest";
const { session } = vi.hoisted(() => ({ session: vi.fn() }));
vi.mock("@/lib/supabase/proxy", () => ({ updateSession: session }));
import { config, proxy } from "@/proxy";
beforeEach(() => { vi.clearAllMocks(); session.mockResolvedValue(new Response(null)); });
it("matches OAuth and refreshes consent cookies with private page headers", async () => {
  expect(config.matcher).toContain("/oauth/:path*");
  const response = await proxy(new NextRequest("https://app.cadence-me.com/oauth/consent?request=fixture"));
  expect(session).toHaveBeenCalledOnce(); expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("referrer-policy")).toBe("no-referrer"); expect(response.headers.get("x-frame-options")).toBe("DENY");
});
it.each(["authorize", "token", "register", "revoke"])("keeps %s accessible without browser authentication", async (path) => {
  const response = await proxy(new NextRequest(`https://app.cadence-me.com/oauth/${path}`, { headers: { cookie: "sb-forged-auth-token=invalid" } }));
  expect(session).not.toHaveBeenCalled(); expect(response.headers.get("location")).toBeNull();
});
