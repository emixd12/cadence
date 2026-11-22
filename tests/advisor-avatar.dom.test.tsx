// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { advisorAvatarCatalog, advisorAvatarFile } from "@cadence/core/advisor-avatar";
import { AdvisorAvatar } from "@/components/advisor/AdvisorAvatar";

// Tickets 343 to 346: the avatar draws the state it is given, from the catalog's files.

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const avatar = () => container.querySelector<HTMLElement>("[data-advisor-avatar]")!;

describe("AdvisorAvatar", () => {
  it("rests by default and is hidden from assistive technology", () => {
    act(() => root.render(<AdvisorAvatar size={48} />));
    expect(avatar().dataset.advisorAvatar).toBe("state.resting");
    expect(avatar().getAttribute("aria-hidden")).toBe("true");
    expect(avatar().dataset.gesture).toBeUndefined();
  });

  it("carries the state and the gesture it is given", () => {
    act(() => root.render(<AdvisorAvatar size={48} state="state.preparing" gesture={{ id: "gesture.notice", key: 1 }} />));
    expect(avatar().dataset.advisorAvatar).toBe("state.preparing");
    expect(avatar().dataset.gesture).toBe("gesture.notice");
  });

  it("draws no dot, badge or count", () => {
    act(() => root.render(<AdvisorAvatar size={48} state="state.waiting" />));
    expect(avatar().textContent).toBe("");
    expect(avatar().querySelectorAll("circle")).toHaveLength(1); // the preparing arc only
  });

  it("uses the small file up to 72px and the large file above", () => {
    const [small, large] = advisorAvatarCatalog.art.renditions;
    expect(advisorAvatarFile(40)).toBe(small.file.replace(/^public/, ""));
    expect(advisorAvatarFile(72)).toBe(small.file.replace(/^public/, ""));
    expect(advisorAvatarFile(120)).toBe(large.file.replace(/^public/, ""));
    act(() => root.render(<AdvisorAvatar size={120} />));
    expect(avatar().querySelector("image")?.getAttribute("href")).toBe("/brand/advisor/advisor-768.webp");
  });

  it("ripples the mane only above 72px", () => {
    act(() => root.render(<AdvisorAvatar size={48} />));
    expect(avatar().querySelector("feTurbulence")).toBeNull();
    act(() => root.render(<AdvisorAvatar size={120} />));
    expect(avatar().querySelector("feTurbulence")).not.toBeNull();
  });
});
