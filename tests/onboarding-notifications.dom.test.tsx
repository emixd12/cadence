// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserPushSubscriptionStatus } from "@/lib/push/browser";
import type { FirstRunOnboardingState } from "@/lib/types/onboarding";

const push = vi.hoisted(() => ({ status: "missing" as BrowserPushSubscriptionStatus, reads: 0 }));
vi.mock("@/lib/push/browser", () => ({
  getBrowserPushSupport: () => ({ supported: true }),
  readNotificationPermission: () => "granted",
  readBrowserPushSubscriptionStatus: async () => { push.reads += 1; return push.status; },
}));

const { FirstRunOnboardingPanel } = await import("@/components/onboarding/FirstRunOnboardingPanel");

const STATE: FirstRunOnboardingState = {
  hasAnyBehavior: false,
  hasImportRuns: false,
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  vapidPublicKey: "public-key",
  travel: null,
};

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  localStorage.clear();
  push.status = "missing";
  push.reads = 0;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
});

async function flush() {
  for (let step = 0; step < 4; step++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}
const notificationsRow = () => [...container.querySelectorAll("li")].find((row) => row.textContent?.includes("Browser notifications"));

describe("first-run setup: browser notifications (Ticket 284 finding)", () => {
  it("reads this device again on return, so notifications enabled elsewhere stop reading Not enabled", async () => {
    await act(async () => root.render(<FirstRunOnboardingPanel onboarding={STATE} />));
    await flush();
    expect(notificationsRow()?.textContent).toContain("Not enabled");
    // Notifications were enabled in Settings in another tab; this tab regains focus.
    push.status = "saved";
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    await flush();
    expect(notificationsRow()?.textContent).toContain("Enabled");
    expect(notificationsRow()?.textContent).not.toContain("Not enabled");
  });

  it("makes no request on focus once the pop-up is gone", async () => {
    localStorage.setItem("cadence-first-run-dismissed", "true");
    await act(async () => root.render(<FirstRunOnboardingPanel onboarding={STATE} />));
    await flush();
    expect(container.textContent).not.toContain("Set up Cadence");
    const reads = push.reads;
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    await flush();
    expect(push.reads).toBe(reads);
  });
});
