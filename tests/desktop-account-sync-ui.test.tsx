import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AccountConflictReview, AccountDisconnectPanel, AccountSyncPanel } from "../apps/desktop/src/account/account-panel";
import { shouldRetryAccountSync } from "../apps/desktop/src/sync-engine";

describe("AccountSyncPanel", () => {
  it.each([
    [{ state: "offline" } as const, "Offline. Changes on this Mac sync when Cadence is back online."],
    [{ state: "syncing" } as const, "Syncing…"],
    [{ state: "current", completedAt: "2026-09-01T12:00:00Z" } as const, "Account data is current."],
    [{ state: "failed", message: "Try again." } as const, "Try again."],
    [{ state: "conflict", count: 2 } as const, "2 sync conflicts to review."],
    [{ state: "revoked" } as const, "signed out of your Cadence account"],
  ])("shows the %s state", (status, message) => {
    const html = renderToStaticMarkup(<AccountSyncPanel status={status} busy={false} onSync={() => undefined} onReconnect={() => undefined} />);
    expect(html).toMatch(new RegExp(message));
  });

  it("offers one explicit Sync now action", () => {
    const html = renderToStaticMarkup(<AccountSyncPanel status={{ state: "current", completedAt: "2026-09-01T12:00:00Z" }} busy onSync={() => undefined} onReconnect={() => undefined} />);
    expect(html).toContain("Sync now");
    expect(html).toContain('disabled=""');
  });

  it("replaces manual sync with account reconnection after revocation", () => {
    const html = renderToStaticMarkup(<AccountSyncPanel status={{ state: "revoked" }} busy={false} onSync={() => undefined} onReconnect={() => undefined} />);
    expect(html).toContain("Reconnect account");
    expect(html).not.toContain("Sync now");
  });

  it("does not retry a revoked session", () => {
    expect(shouldRetryAccountSync({ state: "revoked" }, 0)).toBe(false);
    expect(shouldRetryAccountSync({ state: "offline" }, 0)).toBe(true);
    expect(shouldRetryAccountSync({ state: "failed", message: "Unavailable" }, 5)).toBe(false);
  });

  it("groups the two valid resolution actions and withholds invalid Keep both", () => {
    const html = renderToStaticMarkup(<AccountConflictReview busy={false} conflicts={[{ kind: "behavior", id: "one", reason: "concurrent_update", baseline: { title: "Base" }, local: { title: "Mac" }, hosted: { title: "Account" } }]} onResolve={() => undefined} />);
    expect(html).toContain("Use account version"); expect(html).toContain("Use this Mac version"); expect(html).not.toContain("Keep both");
    expect(html.match(/name="conflict-behavior:one"/g)).toHaveLength(2);
  });

  it("requires typed confirmation before removing account data", () => {
    const html = renderToStaticMarkup(<AccountDisconnectPanel busy={false} onDisconnect={() => undefined} />);
    expect(html).toContain("Keep a local copy"); expect(html).toContain("Type REMOVE"); expect(html).toContain('disabled=""');
  });
});
