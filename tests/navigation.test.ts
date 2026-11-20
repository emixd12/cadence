import { describe, expect, it } from "vitest";
import {
  APP_NAV_ITEMS,
  CHAT_PAGE_LIVE,
  DEFAULT_APP_ROUTE,
  getAppNavItems,
  isChatPageAvailable,
  isProtectedAppRoute,
} from "../lib/navigation";

describe("app navigation", () => {
  it("uses the documented primary screens", () => {
    expect(APP_NAV_ITEMS.map((item) => item.label)).toEqual([
      "Timeline",
      "Chat",
      "Behaviors",
      "Export & Import",
      "Settings",
    ]);
  });

  it("shows Chat on Cadence for Mac after Timeline in development, and in release builds once Chat is live", () => {
    expect(getAppNavItems("desktop", false).map((item) => item.href)).toEqual([
      "/timeline",
      "/chat",
      "/behaviors",
      "/export",
      "/settings",
    ]);
    expect(isChatPageAvailable("desktop", true)).toBe(CHAT_PAGE_LIVE);
    expect(isChatPageAvailable("desktop", true)).toBe(isChatPageAvailable("web", true));
  });

  it("shows Chat on web after Timeline outside production", () => {
    expect(getAppNavItems("web", false).map((item) => item.href)).toEqual([
      "/timeline",
      "/chat",
      "/behaviors",
      "/export",
      "/settings",
    ]);
    expect(isChatPageAvailable("web", true)).toBe(CHAT_PAGE_LIVE);
  });

  it("keeps Timeline as the default app route", () => {
    expect(DEFAULT_APP_ROUTE).toBe("/timeline");
  });

  it("does not introduce a dashboard route", () => {
    expect(APP_NAV_ITEMS.map((item) => item.href)).not.toContain("/dashboard");
  });

  it("treats documented app routes as protected", () => {
    expect(isProtectedAppRoute("/timeline")).toBe(true);
    expect(isProtectedAppRoute("/timeline/day")).toBe(true);
    expect(isProtectedAppRoute("/analytics")).toBe(true);
    expect(isProtectedAppRoute("/chat")).toBe(true);
    expect(isProtectedAppRoute("/login")).toBe(false);
    expect(isProtectedAppRoute("/auth/callback")).toBe(false);
  });
});
