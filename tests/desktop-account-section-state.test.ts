import { describe, expect, it } from "vitest";
import { desktopAccountSectionState, type DesktopAccountSectionInput } from "../apps/desktop/src/account/account-section-state";

const linked = { status: "linked" as const, userId: "user-1", email: "a@example.test" };
const input = (overrides: Partial<DesktopAccountSectionInput> = {}): DesktopAccountSectionInput => ({
  known: true, account: { status: "local" }, configured: true, connected: false,
  syncStatus: { state: "offline" }, conflictCount: 0, firstLinkPending: false, ...overrides,
});
const connected = (syncStatus: DesktopAccountSectionInput["syncStatus"]) => input({ account: linked, connected: true, syncStatus });

describe("desktopAccountSectionState (Ticket 302)", () => {
  it("checks until the saved session is read", () => {
    expect(desktopAccountSectionState(input({ known: false }))).toEqual({ text: "Checking…", attention: false, on: false });
  });

  it("shows a local Mac as not linked, or unavailable when sign-in is not configured", () => {
    expect(desktopAccountSectionState(input())).toEqual({ text: "Not linked", attention: false, on: false });
    expect(desktopAccountSectionState(input({ configured: false }))).toEqual({ text: "Unavailable in this build", attention: false, on: false });
    expect(desktopAccountSectionState(input({ account: { status: "waiting" } }))).toEqual({ text: "Waiting for sign-in", attention: false, on: false });
  });

  it("needs action for a sign-in error and a waiting first-link choice", () => {
    expect(desktopAccountSectionState(input({ account: { status: "error", message: "x" } })).attention).toBe(true);
    expect(desktopAccountSectionState(input({ account: linked, firstLinkPending: true })))
      .toEqual({ text: "Choose which data to use", attention: true, on: true });
  });

  it("needs action for sync conflicts, from the review or the sync status", () => {
    expect(desktopAccountSectionState(input({ account: linked, connected: true, conflictCount: 2 })))
      .toEqual({ text: "2 sync conflicts to review", attention: true, on: true });
    expect(desktopAccountSectionState(input({ account: linked, conflictCount: 1 })))
      .toEqual({ text: "1 sync conflict to review", attention: true, on: true });
    expect(desktopAccountSectionState(connected({ state: "conflict", count: 3 })).text).toBe("3 sync conflicts to review");
  });

  it("maps synchronization states while linked", () => {
    expect(desktopAccountSectionState(connected({ state: "current", completedAt: "2026-11-10T12:00:00Z" })))
      .toEqual({ text: "Linked · Up to date", attention: false, on: true });
    expect(desktopAccountSectionState(connected({ state: "offline" })).text).toBe("Linked · Offline");
    expect(desktopAccountSectionState(connected({ state: "syncing" })).text).toBe("Linked · Syncing…");
    expect(desktopAccountSectionState(connected({ state: "failed", message: "x" })))
      .toEqual({ text: "Linked · Sync failed", attention: false, on: true });
    expect(desktopAccountSectionState(connected({ state: "revoked" })))
      .toEqual({ text: "Needs reconnection", attention: true, on: true });
    expect(desktopAccountSectionState(connected({ state: "update_required", message: "x" })).attention).toBe(true);
  });

  it("checks while a linked session is still being connected", () => {
    expect(desktopAccountSectionState(input({ account: linked })).text).toBe("Checking…");
  });
});
