"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import { readLocalItem, writeLocalItem } from "@/lib/ui/browser-storage";

/**
 * Timeline Semantic Zoom. Layer 1 ("parents") shows each routine as one collapsed row beside
 * standalone Behaviors. Layer 2 ("sub_behaviors") opens every routine inline. A click on one
 * routine overrides the layer for that routine only, until the layer changes again.
 */
export type SemanticZoomLayer = "parents" | "sub_behaviors";

export const SEMANTIC_ZOOM_STORAGE_KEY = "cadence:timeline-semantic-zoom";
export const SEMANTIC_ZOOM_DEFAULT_LAYER: SemanticZoomLayer = "parents";

/** Summed ctrl+wheel delta (a trackpad pinch) that switches one layer. */
export const WHEEL_ZOOM_THRESHOLD = 60;
/** A wheel pinch pause longer than this starts a new gesture. */
export const WHEEL_GESTURE_IDLE_MS = 250;
/** Two-finger spread ratio that switches one layer: in at 1.25, out at 0.8. */
export const TOUCH_ZOOM_RATIO = 1.25;
/** After a switch, the rest of the same gesture switches nothing. */
export const ZOOM_SWITCH_COOLDOWN_MS = 450;

const LAYER_EVENT = "cadence:timeline-semantic-zoom-change";
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function parseLayer(value: string | null): SemanticZoomLayer {
  return value === "sub_behaviors" ? "sub_behaviors" : SEMANTIC_ZOOM_DEFAULT_LAYER;
}

export function readStoredSemanticZoomLayer(): SemanticZoomLayer {
  return parseLayer(readLocalItem(SEMANTIC_ZOOM_STORAGE_KEY));
}

export function storeSemanticZoomLayer(layer: SemanticZoomLayer): void {
  memoryLayer = layer;
  // Private windows may refuse storage; the layer still applies for this page.
  storageRefused = !writeLocalItem(SEMANTIC_ZOOM_STORAGE_KEY, layer);
  window.dispatchEvent(new Event(LAYER_EVENT));
}

// Holds the layer when storage refuses writes, so the toggle still works.
let memoryLayer: SemanticZoomLayer = SEMANTIC_ZOOM_DEFAULT_LAYER;
let storageRefused = false;

function subscribeLayer(onChange: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === SEMANTIC_ZOOM_STORAGE_KEY) onChange();
  };
  window.addEventListener(LAYER_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(LAYER_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

function layerSnapshot(): SemanticZoomLayer {
  return storageRefused ? memoryLayer : readStoredSemanticZoomLayer();
}

/** The device's zoom layer, shared by every Timeline surface on the page. */
export function useSemanticZoomLayer(): SemanticZoomLayer {
  return useSyncExternalStore(subscribeLayer, layerSnapshot, () => SEMANTIC_ZOOM_DEFAULT_LAYER);
}

function subscribeReducedMotion(onChange: () => void) {
  if (typeof window.matchMedia !== "function") return () => {};
  const query = window.matchMedia(REDUCED_MOTION_QUERY);
  query.addEventListener?.("change", onChange);
  return () => query.removeEventListener?.("change", onChange);
}

export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeReducedMotion,
    () => typeof window.matchMedia === "function" && window.matchMedia(REDUCED_MOTION_QUERY).matches,
    () => false,
  );
}

/** Per-routine overrides on top of a layer. Keys are parent slot keys. */
export type ParentExpansionOverrides = Readonly<Record<string, boolean>>;

export function isParentExpanded(layer: SemanticZoomLayer, overrides: ParentExpansionOverrides, key: string): boolean {
  return overrides[key] ?? layer === "sub_behaviors";
}

export function toggleParentOverride(
  layer: SemanticZoomLayer,
  overrides: ParentExpansionOverrides,
  key: string,
): ParentExpansionOverrides {
  const next = !isParentExpanded(layer, overrides, key);
  const rest = { ...overrides };
  delete rest[key];
  // An override equal to the layer is no override.
  return next === (layer === "sub_behaviors") ? rest : { ...rest, [key]: next };
}

export type SemanticZoomDirection = "in" | "out";

export function stepLayer(layer: SemanticZoomLayer, direction: SemanticZoomDirection): SemanticZoomLayer {
  return direction === "in" ? "sub_behaviors" : "parents";
}

/**
 * Turns one gesture's summed ctrl+wheel delta into a step. Negative delta spreads the
 * fingers (zoom in). Returns null below the threshold.
 */
export function wheelZoomDirection(accumulatedDeltaY: number): SemanticZoomDirection | null {
  if (accumulatedDeltaY <= -WHEEL_ZOOM_THRESHOLD) return "in";
  if (accumulatedDeltaY >= WHEEL_ZOOM_THRESHOLD) return "out";
  return null;
}

/** Turns a pinch's scale (current spread over starting spread) into a step. */
export function pinchZoomDirection(scale: number): SemanticZoomDirection | null {
  if (!Number.isFinite(scale) || scale <= 0) return null;
  if (scale >= TOUCH_ZOOM_RATIO) return "in";
  if (scale <= 1 / TOUCH_ZOOM_RATIO) return "out";
  return null;
}

export function keyboardZoomDirection(event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey">): SemanticZoomDirection | null {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return null;
  if (event.key === "=" || event.key === "+") return "in";
  if (event.key === "-" || event.key === "_") return "out";
  return null;
}

type UseSemanticZoomOptions = Readonly<{
  /** The Timeline element that owns pinch, ctrl+wheel and the keyboard shortcut. */
  containerRef: RefObject<HTMLElement | null>;
  /** False while the Timeline has no routine: gestures then keep their browser meaning. */
  enabled: boolean;
}>;

export type SemanticZoom = Readonly<{
  layer: SemanticZoomLayer;
  setLayer: (layer: SemanticZoomLayer) => void;
  zoom: (direction: SemanticZoomDirection) => void;
  isExpanded: (key: string) => boolean;
  toggleParent: (key: string) => void;
  reducedMotion: boolean;
}>;

type Distance = Readonly<{ start: number; switched: boolean }>;

export function useSemanticZoom({ containerRef, enabled }: UseSemanticZoomOptions): SemanticZoom {
  const layer = useSemanticZoomLayer();
  const reducedMotion = usePrefersReducedMotion();
  const [overrides, setOverrides] = useState<ParentExpansionOverrides>({});

  const setLayer = useCallback((next: SemanticZoomLayer) => {
    // A layer change is a whole-Timeline choice, so it clears single-routine overrides.
    setOverrides({});
    storeSemanticZoomLayer(next);
  }, []);
  const layerRef = useRef(layer);
  useEffect(() => { layerRef.current = layer; }, [layer]);
  const zoom = useCallback((direction: SemanticZoomDirection) => {
    setLayer(stepLayer(layerRef.current, direction));
  }, [setLayer]);
  const isExpanded = useCallback((key: string) => isParentExpanded(layer, overrides, key), [layer, overrides]);
  const toggleParent = useCallback((key: string) => {
    setOverrides((previous) => toggleParentOverride(layerRef.current, previous, key));
  }, []);

  useEffect(() => {
    const element = containerRef.current;
    if (!element || !enabled) return;
    let wheelDelta = 0;
    let lastWheelAt = 0;
    let cooldownUntil = 0;
    let pinch: Distance | null = null;

    const apply = (direction: SemanticZoomDirection | null, at: number) => {
      if (!direction || at < cooldownUntil) return false;
      cooldownUntil = at + ZOOM_SWITCH_COOLDOWN_MS;
      zoom(direction);
      return true;
    };

    const onWheel = (event: WheelEvent) => {
      // Plain wheel and two-finger scroll keep scrolling. Only a pinch (ctrl+wheel) zooms,
      // and the browser's page zoom stays off while it is over the Timeline.
      if (!event.ctrlKey) return;
      event.preventDefault();
      const at = event.timeStamp || performance.now();
      if (at - lastWheelAt > WHEEL_GESTURE_IDLE_MS) wheelDelta = 0;
      lastWheelAt = at;
      const scale = event.deltaMode === 1 ? 16 : 1;
      wheelDelta += event.deltaY * scale;
      if (apply(wheelZoomDirection(wheelDelta), at)) wheelDelta = 0;
      else if (at < cooldownUntil) wheelDelta = 0;
    };

    const spread = (touches: TouchList) => {
      const [a, b] = [touches[0], touches[1]];
      return a && b ? Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) : 0;
    };
    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length === 2) {
        const start = spread(event.touches);
        pinch = start > 0 ? { start, switched: false } : null;
      } else {
        pinch = null;
      }
    };
    const onTouchMove = (event: TouchEvent) => {
      if (!pinch || event.touches.length !== 2) return;
      event.preventDefault();
      if (pinch.switched) return;
      if (apply(pinchZoomDirection(spread(event.touches) / pinch.start), event.timeStamp || performance.now())) {
        pinch = { ...pinch, switched: true };
      }
    };
    const onTouchEnd = (event: TouchEvent) => {
      if (event.touches.length < 2) pinch = null;
    };

    // Safari reports trackpad pinch as gesture events with a scale.
    type GestureEvent = Event & { scale?: number };
    let gestureSwitched = false;
    const onGestureStart = (event: Event) => { event.preventDefault(); gestureSwitched = false; };
    const onGestureChange = (event: Event) => {
      event.preventDefault();
      if (gestureSwitched) return;
      gestureSwitched = apply(pinchZoomDirection((event as GestureEvent).scale ?? 1), event.timeStamp || performance.now());
    };

    const onKeyDown = (event: KeyboardEvent) => {
      const direction = keyboardZoomDirection(event);
      if (!direction) return;
      event.preventDefault();
      zoom(direction);
    };

    element.addEventListener("wheel", onWheel, { passive: false });
    element.addEventListener("touchstart", onTouchStart, { passive: true });
    element.addEventListener("touchmove", onTouchMove, { passive: false });
    element.addEventListener("touchend", onTouchEnd);
    element.addEventListener("touchcancel", onTouchEnd);
    element.addEventListener("gesturestart", onGestureStart);
    element.addEventListener("gesturechange", onGestureChange);
    element.addEventListener("keydown", onKeyDown);
    return () => {
      element.removeEventListener("wheel", onWheel);
      element.removeEventListener("touchstart", onTouchStart);
      element.removeEventListener("touchmove", onTouchMove);
      element.removeEventListener("touchend", onTouchEnd);
      element.removeEventListener("touchcancel", onTouchEnd);
      element.removeEventListener("gesturestart", onGestureStart);
      element.removeEventListener("gesturechange", onGestureChange);
      element.removeEventListener("keydown", onKeyDown);
    };
  }, [containerRef, enabled, zoom]);

  return { layer, setLayer, zoom, isExpanded, toggleParent, reducedMotion };
}
