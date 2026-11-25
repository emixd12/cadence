"use client";

import { useId, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { advisorAvatarArt, advisorAvatarRendition } from "@cadence/core/advisor-avatar";
import type { AdvisorAvatarGesture, AdvisorAvatarState } from "@cadence/core/resolvers/advisor-avatar.resolver";

import styles from "./advisor-avatar.module.css";

/**
 * The advisor's avatar (Tickets 343 to 346): the round "window" drawing, moving by state.
 * The state and gesture come from `advisor-avatar.resolver`; this component only draws them.
 * Every coordinate comes from the catalog's `art.anchors`, so a new drawing needs new
 * anchors and no change here. Reduced motion shows the still drawing in every state.
 */

export type AdvisorAvatarGestureEvent = Readonly<{ id: AdvisorAvatarGesture; key: number }>;

const { window: VIEW, eyes: EYES, mane: MANE_AREA, maneRoot: MANE_ROOT, ears: EARS, head: HEAD } = advisorAvatarArt.anchors;
const ART_SIZE = 1024;
/** From this size upward the mane also ripples; smaller, its strands are too fine to show it. */
const DETAIL_FROM = 72;
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const query = window.matchMedia?.(REDUCED_MOTION_QUERY);
      query?.addEventListener("change", onChange);
      return () => query?.removeEventListener("change", onChange);
    },
    () => window.matchMedia?.(REDUCED_MOTION_QUERY).matches ?? false,
    () => false,
  );
}

/** Screen pixels per CSS pixel, as a whole number from 1 to 3. The server and the first paint assume 2. */
function useScreenDensity(): number {
  return useSyncExternalStore(
    (onChange) => {
      const query = window.matchMedia?.(`(resolution: ${window.devicePixelRatio}dppx)`);
      query?.addEventListener("change", onChange);
      return () => query?.removeEventListener("change", onChange);
    },
    () => Math.min(3, Math.max(1, Math.ceil((window.devicePixelRatio || 1) - 0.01))),
    () => 2,
  );
}

/** Rotates its children around a point of the drawing; CSS animates the middle group. */
function Pivot({ x, y, className, part, children }: Readonly<{ x: number; y: number; className: string; part?: string; children: ReactNode }>) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <g className={className} data-avatar-part={part}>
        <g className={styles.gesture}>
          <g transform={`translate(${-x} ${-y})`}>{children}</g>
        </g>
      </g>
    </g>
  );
}

export function AdvisorAvatar({
  size,
  state = "state.resting",
  gesture = null,
}: Readonly<{ size: number; state?: AdvisorAvatarState | null; gesture?: AdvisorAvatarGestureEvent | null }>) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const reduceMotion = usePrefersReducedMotion();
  const detailed = size >= DETAIL_FROM && !reduceMotion;
  // A product size has a file made at exactly its pixels for this screen, so nothing is scaled at rest.
  const rendition = advisorAvatarRendition(size, useScreenDensity());
  const { area } = rendition;
  const art = <image href={rendition.file.replace(/^public/, "")} x={area.x} y={area.y} width={area.width} height={area.height} />;
  const full = <rect width={ART_SIZE} height={ART_SIZE} fill="#fff" />;

  return (
    <span
      aria-hidden="true"
      className={styles.avatar}
      style={{ "--size": `${size}px` } as CSSProperties}
      data-advisor-avatar={state ?? "state.resting"}
      data-gesture={gesture?.id}
    >
      {/* A new gesture remounts the drawing, so its one-shot animations start again. */}
      <span key={gesture?.key ?? 0} className={styles.face}>
        <span className={styles.nod}>
        <svg className={styles.horse} viewBox={`${VIEW.x} ${VIEW.y} ${VIEW.size} ${VIEW.size}`} focusable="false">
          <defs>
            {/* Mane weight: 0 at the roots, 1 toward the tips, soft at the edges. */}
            <radialGradient id={`${id}-weight`} gradientUnits="userSpaceOnUse" cx={MANE_ROOT.x} cy={MANE_ROOT.y} r="420">
              <stop offset="0.1" stopColor="#fff" stopOpacity="0" />
              <stop offset="0.8" stopColor="#fff" stopOpacity="1" />
            </radialGradient>
            <radialGradient id={`${id}-weight-inverse`} gradientUnits="userSpaceOnUse" cx={MANE_ROOT.x} cy={MANE_ROOT.y} r="420">
              <stop offset="0.1" stopColor="#000" stopOpacity="0" />
              <stop offset="0.8" stopColor="#000" stopOpacity="1" />
            </radialGradient>
            <filter id={`${id}-soft`} x="-10%" y="-10%" width="120%" height="120%">
              <feGaussianBlur stdDeviation="10" />
            </filter>
            <filter id={`${id}-soft-small`} x="-10%" y="-10%" width="120%" height="120%">
              <feGaussianBlur stdDeviation="4" />
            </filter>
            <mask id={`${id}-still`} maskUnits="userSpaceOnUse" x="0" y="0" width={ART_SIZE} height={ART_SIZE}>
              {full}
              <path d={MANE_AREA} fill={`url(#${id}-weight-inverse)`} filter={`url(#${id}-soft)`} />
              {EARS.map((ear) => <path key={ear.area} d={ear.area} fill="#000" filter={`url(#${id}-soft-small)`} />)}
              <path d={HEAD.area} fill="#000" filter={`url(#${id}-soft-small)`} />
            </mask>
            {/* The head without the mane and the ears, which are layers of their own. */}
            <mask id={`${id}-head`} maskUnits="userSpaceOnUse" x="0" y="0" width={ART_SIZE} height={ART_SIZE}>
              <path d={HEAD.area} fill="#fff" filter={`url(#${id}-soft-small)`} />
              <path d={MANE_AREA} fill={`url(#${id}-weight-inverse)`} filter={`url(#${id}-soft)`} />
              {EARS.map((ear) => <path key={ear.area} d={ear.area} fill="#000" filter={`url(#${id}-soft-small)`} />)}
            </mask>
            <mask id={`${id}-mane`} maskUnits="userSpaceOnUse" x="0" y="0" width={ART_SIZE} height={ART_SIZE}>
              <path d={MANE_AREA} fill={`url(#${id}-weight)`} filter={`url(#${id}-soft)`} />
            </mask>
            {EARS.map((ear, index) => (
              <mask key={ear.area} id={`${id}-ear-${index}`} maskUnits="userSpaceOnUse" x="0" y="0" width={ART_SIZE} height={ART_SIZE}>
                <path d={ear.area} fill="#fff" filter={`url(#${id}-soft-small)`} />
              </mask>
            ))}
            {EYES.map((eye, index) => (
              <clipPath key={eye.cx} id={`${id}-eye-${index}`}>
                <ellipse cx={eye.cx} cy={eye.cy} rx={eye.rx} ry={eye.ry} transform={`rotate(${eye.tilt} ${eye.cx} ${eye.cy})`} />
              </clipPath>
            ))}
            {detailed ? (
              <filter id={`${id}-wind`} x="-5%" y="-5%" width="110%" height="110%">
                <feTurbulence type="fractalNoise" baseFrequency="0.004 0.014" numOctaves="2" seed="4" result="noise">
                  <animate attributeName="baseFrequency" dur="7s" values="0.004 0.014;0.006 0.02;0.004 0.014" repeatCount="indefinite" />
                </feTurbulence>
                <feDisplacementMap in="SourceGraphic" in2="noise" scale="16" xChannelSelector="R" yChannelSelector="G" />
              </filter>
            ) : null}
          </defs>

          <g mask={`url(#${id}-still)`}>{art}</g>
          {/* The head turns on the neck around the poll, and carries the ears and the eyelids. */}
          <Pivot x={HEAD.pivot.x} y={HEAD.pivot.y} className={styles.head} part="head">
          <g mask={`url(#${id}-head)`}>{art}</g>
          {EARS.map((ear, index) => (
            <Pivot key={ear.area} x={ear.pivot.x} y={ear.pivot.y} className={`${styles.ear} ${index === 0 ? styles.earNear : styles.earFar}`}>
              <g mask={`url(#${id}-ear-${index})`}>{art}</g>
            </Pivot>
          ))}

          {/* Eyelids: each rests above its eye and slides down to close it. */}
          {EYES.map((eye, index) => {
            const close = eye.ry * 2 + 4;
            const top = eye.cy - eye.ry - close;
            return (
              <g key={eye.cx} clipPath={`url(#${id}-eye-${index})`} style={{ "--close": `${close}px` } as CSSProperties}>
                <g className={styles.lidRest}>
                  <g className={styles.lidBlink}>
                    <g className={styles.gesture}>
                      <rect className={styles.lid} x={eye.cx - eye.rx - 8} y={top} width={eye.rx * 2 + 16} height={close - 2} />
                      <path className={styles.lash}
                        d={`M${eye.cx - eye.rx - 4},${top + close - 3} Q${eye.cx},${top + close + 1} ${eye.cx + eye.rx + 4},${top + close - 3}`} />
                    </g>
                  </g>
                </g>
              </g>
            );
          })}
          </Pivot>
          {/* The mane is painted last: Chrome redraws, softly, whatever is painted after a moving layer. */}
          <Pivot x={MANE_ROOT.x} y={MANE_ROOT.y} className={styles.mane}>
            <g filter={detailed ? `url(#${id}-wind)` : undefined}>
              <g mask={`url(#${id}-mane)`}>{art}</g>
            </g>
          </Pivot>
        </svg>
        </span>
      </span>
      <svg className={styles.ring} viewBox="0 0 100 100" focusable="false">
        <circle className={styles.ringArc} cx="50" cy="50" r="48" />
      </svg>
    </span>
  );
}
