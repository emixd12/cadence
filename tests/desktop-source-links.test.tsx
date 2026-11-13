// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resolveAnalytics } from "@/lib/resolvers/analytics.resolver";
import type { BehaviorActionState } from "@/lib/types/behavior";
import type { SourceLinkFormState } from "@/lib/services/source-links.service";
import type { SourceLinkCoordinator } from "@/lib/ui/source-links";
import { BehaviorsScreen } from "../apps/desktop/src/behaviors-screen";
import { DesktopConnectorBroker } from "../apps/desktop/src/calendar/connector-broker";
import { desktopSourceLinkCoordinator } from "../apps/desktop/src/calendar/source-links";
import { Temporal } from "@js-temporal/polyfill";

// Ticket 330: Complete from Hevy on a linked Mac.
const BEHAVIOR = "11111111-1111-4111-8111-111111111111";
const LEGS = "a".repeat(64);
const state: SourceLinkFormState = {
  source: "hevy", available: true, connected: true, mode: "off", selectorKeys: [], fenced: false,
  routines: [{ key: LEGS, title: "Legs", holder: null }], routinesComplete: true, staleLinkedCount: null, anyHolder: null,
};

describe("desktop source link coordinator", () => {
  it("reads and saves through the hosted broker routes", async () => {
    const request = vi.fn(async (path: string, init?: RequestInit) => path.startsWith("/api/connectors/links?") ? state
      : { saved: true, mode: JSON.parse(String(init?.body)).mode });
    const broker = new DesktopConnectorBroker({ request } as never);
    await broker.sourceLinkState("");
    expect(request).toHaveBeenLastCalledWith("/api/connectors/links?behaviorId=&source=hevy");
    await broker.sourceLinkSave({ behaviorId: BEHAVIOR, mode: "routines", selectorKeys: [LEGS] });
    expect(request).toHaveBeenLastCalledWith("/api/connectors/links", { method: "PUT",
      body: JSON.stringify({ behaviorId: BEHAVIOR, source: "hevy", mode: "routines", selectorKeys: [LEGS] }) });
  });

  it("syncs before saving, so a Behavior made on this Mac exists, and again after a save", async () => {
    const order: string[] = [];
    const sync = vi.fn(async () => { order.push("sync"); });
    const coordinator = desktopSourceLinkCoordinator({
      sourceLinkState: async () => state,
      sourceLinkSave: async () => { order.push("save"); return { saved: true, mode: "any" }; },
    }, sync);
    await expect(coordinator.save({ behaviorId: BEHAVIOR, mode: "any", selectorKeys: [] })).resolves.toEqual({ saved: true, mode: "any" });
    await vi.waitFor(() => expect(order).toEqual(["sync", "save", "sync"]));
  });

  it("saves even when the first sync fails, and does not sync after a refusal", async () => {
    const sync = vi.fn(async () => { throw new Error("offline"); });
    const coordinator = desktopSourceLinkCoordinator({
      sourceLinkState: async () => state,
      sourceLinkSave: async () => ({ saved: false, reason: "any_link_exists", holder: null }),
    }, sync);
    await expect(coordinator.save({ behaviorId: BEHAVIOR, mode: "any", selectorKeys: [] })).resolves.toMatchObject({ saved: false });
    expect(sync).toHaveBeenCalledTimes(1);
  });
});

describe("desktop Behaviors screen", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  });
  afterEach(async () => { await act(() => root.unmount()); container.remove(); });

  function screen(coordinator: SourceLinkCoordinator | null) {
    const action = vi.fn(async (): Promise<BehaviorActionState> => ({ status: "idle", message: "" }));
    const unchanged = async <T,>(value: T) => value;
    return <BehaviorsScreen activeBehaviors={[]} archivedBehaviors={[]} categories={[{ id: "category-health", name: "Health" }]}
      analytics={resolveAnalytics({ occurrences: [], now: Temporal.Instant.from("2026-11-13T15:00:00Z"), timezone: "America/New_York" })}
      createAction={action} updateAction={action} archiveAction={action} restoreAction={action} archiveNoteAction={action}
      statusAction={unchanged} noteAction={unchanged} stopTimeTrackingAction={unchanged} resetTimeTrackingAction={unchanged}
      defaultTimezone="America/New_York" onRefresh={vi.fn()} onNavigateReview={vi.fn()} sourceLinkCoordinator={coordinator} />;
  }

  it("offers Complete from Hevy in Create behavior only while linked", async () => {
    const coordinator = { getState: vi.fn(async () => state), save: vi.fn() } as unknown as SourceLinkCoordinator;
    await act(() => root.render(screen(coordinator)));
    await vi.waitFor(() => expect(container.querySelector("[data-source-link-create]")).not.toBeNull());
    expect(coordinator.getState).toHaveBeenCalledWith("");
    await act(() => root.render(screen(null)));
    await act(async () => undefined);
    expect(container.querySelector("[data-source-link-create]")).toBeNull();
  });
});
