"use client";

import { SourceLinkCreateChoice, SourceLinkSettings } from "@/components/behaviors/SourceLinkSettings";
import type { SourceLinkCoordinator } from "@/lib/ui/source-links";

// Ticket 317 bench fixture: synthetic routines only; no network call.
const coordinator: SourceLinkCoordinator = {
  getState: async () => ({
    source: "hevy", available: true, connected: true, mode: "routines", selectorKeys: ["a".repeat(64)], fenced: false,
    routines: [
      { key: "a".repeat(64), title: "Legs", holder: null },
      { key: "b".repeat(64), title: "Push", holder: { behaviorId: "bench-other", title: "Chest day" } },
    ],
    routinesComplete: true, staleLinkedCount: 1, anyHolder: { behaviorId: "bench-gym", title: "Gym" },
  }),
  save: async () => ({ saved: true, mode: "routines" }),
};

// Ticket 329: a Behavior being created has no link of its own.
const createCoordinator: SourceLinkCoordinator = {
  getState: async (behaviorId) => ({ ...(await coordinator.getState(behaviorId)), mode: "off", selectorKeys: [], staleLinkedCount: null }),
  save: coordinator.save,
};

export function SourceLinkBench() {
  return <div className="grid gap-6">
    <SourceLinkSettings behaviorId="bench-behavior" coordinator={coordinator} />
    <div data-bench-source-link-create>
      <SourceLinkCreateChoice coordinator={createCoordinator} onChange={() => undefined} />
    </div>
  </div>;
}
