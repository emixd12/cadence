import { describe, expect, it } from "vitest";

import { advisorAvatarCatalog as catalog } from "@cadence/core/advisor-avatar";
import {
  chatAdvisorAvatarInput,
  isFirstAdvisorOpenToday,
  resolveAdvisorAvatarGesture,
  resolveAdvisorAvatarState,
  type AdvisorAvatarInput,
} from "@/lib/resolvers/advisor-avatar.resolver";

const calm: AdvisorAvatarInput = { hasNew: false, panelOpen: false, brief: "none", answering: false, replying: false, applied: 0, refused: 0 };
const everything: AdvisorAvatarInput = { hasNew: true, panelOpen: true, brief: "loading", answering: true, replying: true, applied: 0, refused: 0 };

describe("advisor avatar state", () => {
  it("shows nothing when there is no advisor", () => {
    expect(resolveAdvisorAvatarState(null)).toBeNull();
    expect(resolveAdvisorAvatarGesture(null, null, true)).toBeNull();
  });

  it("rests when nothing waits", () => {
    expect(resolveAdvisorAvatarState(calm)).toBe("state.resting");
    expect(resolveAdvisorAvatarState({ ...calm, brief: "ready" })).toBe("state.resting");
  });

  it.each([
    [{ hasNew: true }, "state.waiting"],
    [{ brief: "notice" as const }, "state.trouble"],
    [{ panelOpen: true }, "state.attending"],
    [{ brief: "loading" as const }, "state.preparing"],
    [{ answering: true }, "state.working"],
    [{ replying: true }, "state.replying"],
  ])("maps %o to %s", (change, state) => {
    expect(resolveAdvisorAvatarState({ ...calm, ...change })).toBe(state);
  });

  it("follows the catalog's priority order", () => {
    const order = Object.entries(catalog.states).sort(([, a], [, b]) => a.priority - b.priority).map(([id]) => id);
    let input = everything;
    const off: Record<string, Partial<AdvisorAvatarInput>> = {
      "state.replying": { replying: false }, "state.working": { answering: false }, "state.preparing": { brief: "notice" },
      "state.attending": { panelOpen: false }, "state.trouble": { brief: "none" }, "state.waiting": { hasNew: false }, "state.resting": {},
    };
    for (const id of order) {
      expect(resolveAdvisorAvatarState(input)).toBe(id);
      input = { ...input, ...off[id] };
    }
  });

  it("returns every active catalog state and no other", () => {
    const active = Object.entries(catalog.states).filter(([, entry]) => entry.status === "active").map(([id]) => id).sort();
    const seen = new Set<string>();
    for (const hasNew of [false, true]) for (const panelOpen of [false, true]) for (const brief of ["none", "loading", "ready", "closed", "notice"] as const)
      for (const answering of [false, true]) for (const replying of [false, true])
        seen.add(resolveAdvisorAvatarState({ ...calm, hasNew, panelOpen, brief, answering, replying })!);
    expect([...seen].sort()).toEqual(active);
  });
});

describe("advisor avatar gestures", () => {
  it("arrives on the first open of the day only", () => {
    expect(resolveAdvisorAvatarGesture(null, calm, true)).toBe("gesture.arrive");
    expect(resolveAdvisorAvatarGesture(null, calm, false)).toBeNull();
    expect(isFirstAdvisorOpenToday(null, "2026-11-22")).toBe(true);
    expect(isFirstAdvisorOpenToday("2026-11-21", "2026-11-22")).toBe(true);
    expect(isFirstAdvisorOpenToday("2026-11-22", "2026-11-22")).toBe(false);
  });

  it("notices something new once, and not while the panel is open", () => {
    expect(resolveAdvisorAvatarGesture(calm, { ...calm, hasNew: true }, false)).toBe("gesture.notice");
    expect(resolveAdvisorAvatarGesture({ ...calm, hasNew: true }, { ...calm, hasNew: true }, false)).toBeNull();
    expect(resolveAdvisorAvatarGesture({ ...calm, panelOpen: true }, { ...calm, panelOpen: true, hasNew: true }, false)).toBeNull();
  });

  it("acknowledges an applied answer and marks a refused one", () => {
    expect(resolveAdvisorAvatarGesture(calm, { ...calm, applied: 1 }, false)).toBe("gesture.acknowledge");
    expect(resolveAdvisorAvatarGesture(calm, { ...calm, refused: 1 }, false)).toBe("gesture.refused");
    expect(resolveAdvisorAvatarGesture(calm, { ...calm, applied: 1, refused: 1 }, false)).toBe("gesture.refused");
  });

  it("plays nothing when nothing changed", () => {
    expect(resolveAdvisorAvatarGesture(calm, calm, true)).toBeNull();
  });

  it("gives Chat a resting or replying avatar", () => {
    expect(resolveAdvisorAvatarState(chatAdvisorAvatarInput(false))).toBe("state.resting");
    expect(resolveAdvisorAvatarState(chatAdvisorAvatarInput(true))).toBe("state.replying");
  });
});
