// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { advisorAvatarCatalog, advisorAvatarFile, advisorAvatarRendition } from "@cadence/core/advisor-avatar";
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

  it("has a file at exactly its pixels for each product size and screen density", () => {
    const { window: view } = advisorAvatarCatalog.art.anchors;
    for (const size of [40, 48, 120]) {
      for (const density of [1, 2, 3]) {
        const rendition = advisorAvatarRendition(size, density);
        expect(rendition.file).toBe(`public/brand/advisor/advisor-${size}-${density}x.webp`);
        // One file pixel is one screen pixel: the window spans size x density pixels.
        const unitsPerPixel = view.size / (size * density);
        expect(rendition.area.width / rendition.pixels.width).toBeCloseTo(unitsPerPixel, 6);
        expect(rendition.area.height / rendition.pixels.height).toBeCloseTo(unitsPerPixel, 6);
        // The file starts on a whole pixel of the window and covers all of it.
        expect((view.x - rendition.area.x) / unitsPerPixel).toBeCloseTo(Math.round((view.x - rendition.area.x) / unitsPerPixel), 6);
        expect((view.y - rendition.area.y) / unitsPerPixel).toBeCloseTo(Math.round((view.y - rendition.area.y) / unitsPerPixel), 6);
        expect(rendition.area.x).toBeLessThanOrEqual(view.x);
        expect(rendition.area.y).toBeLessThanOrEqual(view.y);
        expect(rendition.area.x + rendition.area.width).toBeGreaterThanOrEqual(view.x + view.size);
        expect(rendition.area.y + rendition.area.height).toBeGreaterThanOrEqual(view.y + view.size);
      }
    }
  });

  it("serves denser screens the densest file and other sizes the general file", () => {
    expect(advisorAvatarFile(48, 4)).toBe("/brand/advisor/advisor-48-3x.webp");
    expect(advisorAvatarFile(48, 1.5)).toBe("/brand/advisor/advisor-48-2x.webp");
    expect(advisorAvatarFile(64, 2)).toBe("/brand/advisor/advisor-768.webp");
    expect(advisorAvatarRendition(64, 2).area).toEqual({ x: 0, y: 0, width: 1024, height: 1024 });
  });

  it("places the file where the catalog says it sits in the drawing", () => {
    act(() => root.render(<AdvisorAvatar size={120} />));
    const density = Math.min(3, Math.max(1, Math.ceil((window.devicePixelRatio || 1) - 0.01)));
    const rendition = advisorAvatarRendition(120, density);
    const image = avatar().querySelector("image")!;
    expect(image.getAttribute("href")).toBe(rendition.file.replace(/^public/, ""));
    expect(Number(image.getAttribute("x"))).toBe(rendition.area.x);
    expect(Number(image.getAttribute("width"))).toBe(rendition.area.width);
  });

  it("ripples the mane only above 72px", () => {
    act(() => root.render(<AdvisorAvatar size={48} />));
    expect(avatar().querySelector("feTurbulence")).toBeNull();
    act(() => root.render(<AdvisorAvatar size={120} />));
    expect(avatar().querySelector("feTurbulence")).not.toBeNull();
  });
});
