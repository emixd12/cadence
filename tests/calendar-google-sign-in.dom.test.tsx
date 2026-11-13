// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { User } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GoogleCalendarPanel } from "@/components/settings/GoogleCalendarPanel";
import { calendarAfterGoogleSignIn } from "@/components/settings/WebGoogleCalendarPanel";
import { calendarGoogleSignIn } from "@/lib/services/google-calendar.service";
import type { CalendarConnectionView, CalendarGoogleSignIn } from "@/lib/types/google-calendar";
import type { GoogleCalendarCoordinator } from "@/lib/ui/google-calendar";

// Ticket 335 (D31.5): what Connect offers an account without exactly one Google sign-in.
// The flow itself runs in tests/calendar-google-sign-in.local-integration.test.ts; this
// covers the flag-off branch, which that server-level run cannot switch per request.

const google = (sub: string) => ({ provider: "google", identity_data: { sub } });
const caller = (identities: unknown[], via?: "cookie" | "bearer") =>
  ({ client: {} as never, user: { id: "owner", identities } as unknown as User, via });

describe("calendarGoogleSignIn", () => {
  afterEach(() => vi.unstubAllEnvs());

  it.each([
    ["off", [], "cookie", "unavailable"],
    ["off", [], "bearer", "unavailable"],
    ["on", [], "cookie", "add"],
    ["on", [], "bearer", "add_on_web"],
    ["on", [{ provider: "email", identity_data: {} }], "cookie", "add"],
    ["off", [google("a")], "cookie", undefined],
    ["on", [google("a")], "bearer", undefined],
    ["on", [google("a"), google("b")], "cookie", "multiple"],
    ["off", [google("a"), google("b")], "cookie", "multiple"],
  ] as const)("linking %s, identities %j, via %s → %s", (flag, identities, via, expected) => {
    vi.stubEnv("CADENCE_SIGN_IN_LINKING", flag);
    expect(calendarGoogleSignIn(caller([...identities], via))).toBe(expected);
  });
});

describe("Calendar return after adding Google", () => {
  it("names the next step and never starts consent from the address", () => {
    expect(calendarAfterGoogleSignIn("added", "google")).toContain("Select Connect Google Calendar");
    expect(calendarAfterGoogleSignIn("taken", "google")).toContain("already signs in to a different Cadence account");
    expect(calendarAfterGoogleSignIn("add_failed", "google")).toContain("Google was not added");
    expect(calendarAfterGoogleSignIn("added", "apple")).toContain("Google was not added");
  });
});

describe("GoogleCalendarPanel without one Google sign-in", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(() => root.unmount());
    container.remove();
  });

  async function render(googleSignIn: CalendarGoogleSignIn | undefined) {
    const view: CalendarConnectionView = {
      accountId: "owner", status: "disconnected", generation: 0, selectionRevision: 0,
      preferences: { selectedCalendarIds: [], hiddenCalendarIds: [], visible: true, showAllDay: true },
      ...(googleSignIn ? { googleSignIn } : {}),
    };
    const coordinator = {
      getConnection: vi.fn(async () => view), beginConnect: vi.fn(async () => undefined),
      listCalendars: vi.fn(), savePreferences: vi.fn(), refreshEvents: vi.fn(), disconnect: vi.fn(),
    } as unknown as GoogleCalendarCoordinator;
    await act(() => root.render(<GoogleCalendarPanel coordinator={coordinator} refreshRange={{ startLocalDate: "2026-11-13", endLocalDate: "2026-11-20" }} />));
    const button = [...container.querySelectorAll("button")].find((item) => item.textContent === "Connect Google Calendar");
    return { text: container.textContent ?? "", button };
  }

  it.each([
    [undefined, true, null],
    ["add", true, "Connecting adds the Google account you choose as a way to sign in to Cadence."],
    ["unavailable", false, "this account does not sign in with Google"],
    ["add_on_web", false, "Add Google under Sign-in methods in Cadence on the web"],
    ["multiple", false, "more than one Google account"],
  ] as const)("%s: Connect shown %s", async (googleSignIn, connect, sentence) => {
    const { text, button } = await render(googleSignIn);
    expect(Boolean(button)).toBe(connect);
    if (sentence) expect(text).toContain(sentence);
    else expect(text).not.toContain("way to sign in");
  });
});
