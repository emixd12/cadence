import { describe, expect, it } from "vitest";
import {
  APP_NAV_ITEMS,
  CHAT_PAGE_LIVE_ON_WEB,
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

  it("never shows Chat on Cadence for Mac until its screen exists", () => {
    expect(getAppNavItems("desktop", false).map((item) => item.href)).not.toContain("/chat");
    expect(getAppNavItems("desktop", true).map((item) => item.href)).not.toContain("/chat");
    expect(isChatPageAvailable("desktop", false)).toBe(false);
  });

  it("shows Chat on web after Timeline outside production", () => {
    expect(getAppNavItems("web", false).map((item) => item.href)).toEqual([
      "/timeline",
      "/chat",
      "/behaviors",
      "/export",
      "/settings",
    ]);
    expect(isChatPageAvailable("web", true)).toBe(CHAT_PAGE_LIVE_ON_WEB);
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
