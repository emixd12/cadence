"use client";

import { useId, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";

import styles from "./horse-avatar-trial.module.css";

// Trial only: a circled horse avatar for the advisor, reviewed on the bench
// before any product placement. Not tracked UI and not wired to Daily Brief.

type AvatarState = "idle" | "thinking" | "advice" | "open";
type Entrance = "top" | "center" | "none";

const STATES: readonly Readonly<{ id: AvatarState; label: string; note: string }>[] = [
  {
    id: "idle",
    label: "Idle",
    note: "Breathes slowly and blinks every few seconds. A light breeze lifts the mane; the two dots orbit.",
  },
  {
    id: "thinking",
    label: "Preparing",
    note: "Eye narrows in focus and blinks more often. The wind picks up; an arc spins and the dots speed up.",
  },
  {
    id: "advice",
    label: "Advice waiting",
    note: "Eye wide with a double blink. A gust lifts the mane with each pulse; the terracotta dot lands as a badge.",
  },
  {
    id: "open",
    label: "Open",
    note: "Leans toward the card. The wind settles to a slow drift and the blinks slow down.",
  },
];

// The eye opens once the entrance has landed.
const WAKE_DELAY: Readonly<Record<Entrance, string>> = {
  center: "1.75s",
  top: "0.5s",
  none: "0.25s",
};

// Mane ripple per state: displacement strength and how fast the noise drifts.
const WIND: Readonly<Record<AvatarState, Readonly<{ scale: number; duration: string }>>> = {
  idle: { scale: 8, duration: "6s" },
  thinking: { scale: 14, duration: "1.8s" },
  advice: { scale: 11, duration: "2.8s" },
  open: { scale: 5, duration: "9s" },
};

// Artwork geometry, in the 400 × 400 crop's coordinates. The face spans
// x 79–215 and y 94–302, so a 135-unit circle around (147, 198) holds all of
// it with about a fifth of the radius left as white space.
const FACE = { cx: 147, cy: 198, r: 135 } as const;
const MANE_ROOT = { x: 195, y: 130 } as const;
const MANE_AREA =
  "M183,120 L212,98 L300,96 L404,140 L404,310 L352,296 L300,246 L252,196 L212,156 L192,138 Z";
// Loose forelock wisps in front of the face, left of the forehead line.
const WISP_ROOT = { x: 114, y: 172 } as const;
const WISP_AREA = "M113,158 L113,192 L74,192 L74,158 Z";
const EYE_CLIP = "M148.5,192.5 C151.5,182.5 163,181 170,186.5 C165.5,196 156,200 148.5,192.5 Z";
const LID = "M140,138 H180 V171 L168,171 Q159,179 150,176 H140 Z";
const LASH = "M150,176 Q159,179 168,171";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const query = window.matchMedia(REDUCED_MOTION_QUERY);
      query.addEventListener("change", onChange);
      return () => query.removeEventListener("change", onChange);
    },
    () => window.matchMedia(REDUCED_MOTION_QUERY).matches,
    () => false,
  );
}

function HorseArt({ state }: Readonly<{ state: AvatarState }>) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const reduceMotion = usePrefersReducedMotion();
  const wind = WIND[state];
  const art = (
    <image href="/brand/cadence-horse-avatar.png" x="0" y="0" width="400" height="400" />
  );

  return (
    <svg
      className={styles.horse}
      viewBox={`${FACE.cx - FACE.r} ${FACE.cy - FACE.r} ${FACE.r * 2} ${FACE.r * 2}`}
      aria-hidden="true"
    >
      <defs>
        {/* Fades the edge of the circle and the banner lines under the jaw. */}
        <radialGradient id={`${id}-edge`} gradientUnits="userSpaceOnUse" cx={FACE.cx} cy={FACE.cy} r={FACE.r}>
          <stop offset="0.86" stopColor="#fff" />
          <stop offset="0.98" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${id}-floor`} gradientUnits="userSpaceOnUse" x1="0" y1="303" x2="0" y2="311">
          <stop offset="0" stopColor="#fff" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <mask id={`${id}-vignette`} maskUnits="userSpaceOnUse" x="0" y="0" width="400" height="400">
          <rect width="400" height="400" fill={`url(#${id}-edge)`} />
        </mask>
        <mask id={`${id}-floor-mask`} maskUnits="userSpaceOnUse" x="0" y="0" width="400" height="400">
          <rect width="400" height="400" fill={`url(#${id}-floor)`} />
        </mask>

        {/* Mane weight: 0 at the roots, 1 toward the tips, soft at the edges. */}
        <radialGradient id={`${id}-weight`} gradientUnits="userSpaceOnUse" cx={MANE_ROOT.x} cy={MANE_ROOT.y} r="60">
          <stop offset="0.15" stopColor="#fff" stopOpacity="0" />
          <stop offset="1" stopColor="#fff" stopOpacity="1" />
        </radialGradient>
        <radialGradient id={`${id}-weight-inverse`} gradientUnits="userSpaceOnUse" cx={MANE_ROOT.x} cy={MANE_ROOT.y} r="60">
          <stop offset="0.15" stopColor="#000" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity="1" />
        </radialGradient>
        <filter id={`${id}-soft`} x="-10%" y="-10%" width="120%" height="120%">
          <feGaussianBlur stdDeviation="5" />
        </filter>
        <linearGradient id={`${id}-wisp-weight`} gradientUnits="userSpaceOnUse" x1={WISP_ROOT.x} y1="0" x2="86" y2="0">
          <stop offset="0" stopColor="#fff" stopOpacity="0" />
          <stop offset="1" stopColor="#fff" stopOpacity="1" />
        </linearGradient>
        <linearGradient id={`${id}-wisp-weight-inverse`} gradientUnits="userSpaceOnUse" x1={WISP_ROOT.x} y1="0" x2="86" y2="0">
          <stop offset="0" stopColor="#000" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity="1" />
        </linearGradient>
        <filter id={`${id}-soft-small`} x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="2.5" />
        </filter>
        <mask id={`${id}-still`} maskUnits="userSpaceOnUse" x="0" y="0" width="400" height="400">
          <rect width="400" height="400" fill="#fff" />
          <path d={MANE_AREA} fill={`url(#${id}-weight-inverse)`} filter={`url(#${id}-soft)`} />
          <path d={WISP_AREA} fill={`url(#${id}-wisp-weight-inverse)`} filter={`url(#${id}-soft-small)`} />
        </mask>
        <mask id={`${id}-wisps`} maskUnits="userSpaceOnUse" x="0" y="0" width="400" height="400">
          <path d={WISP_AREA} fill={`url(#${id}-wisp-weight)`} filter={`url(#${id}-soft-small)`} />
        </mask>
        <mask id={`${id}-mane`} maskUnits="userSpaceOnUse" x="0" y="0" width="400" height="400">
          <path d={MANE_AREA} fill={`url(#${id}-weight)`} filter={`url(#${id}-soft)`} />
        </mask>

        {/* Wind ripple through the strands. */}
        <filter id={`${id}-wind`} x="-5%" y="-5%" width="110%" height="110%">
          <feTurbulence type="fractalNoise" baseFrequency="0.012 0.045" numOctaves="2" seed="4" result="noise">
            {reduceMotion ? null : (
              <animate
                attributeName="baseFrequency"
                dur={wind.duration}
                values="0.012 0.045;0.017 0.065;0.012 0.045"
                repeatCount="indefinite"
              />
            )}
          </feTurbulence>
          <feDisplacementMap in="SourceGraphic" in2="noise" scale={reduceMotion ? 0 : wind.scale} xChannelSelector="R" yChannelSelector="G" />
        </filter>

        <clipPath id={`${id}-eye`}>
          <path d={EYE_CLIP} />
        </clipPath>
      </defs>

      <g mask={`url(#${id}-vignette)`}>
        <g mask={`url(#${id}-floor-mask)`}>
          <g mask={`url(#${id}-still)`}>{art}</g>
          <g transform={`translate(${MANE_ROOT.x} ${MANE_ROOT.y})`}>
            <g className={styles.mane}>
              <g transform={`translate(${-MANE_ROOT.x} ${-MANE_ROOT.y})`} filter={`url(#${id}-wind)`}>
                <g mask={`url(#${id}-mane)`}>{art}</g>
              </g>
            </g>
          </g>
          <g transform={`translate(${WISP_ROOT.x} ${WISP_ROOT.y})`}>
            <g className={styles.wisps}>
              <g transform={`translate(${-WISP_ROOT.x} ${-WISP_ROOT.y})`} filter={`url(#${id}-wind)`}>
                <g mask={`url(#${id}-wisps)`}>{art}</g>
              </g>
            </g>
          </g>
        </g>
      </g>

      {/* Eyelid: rests above the eye, slides down to close it. */}
      <g clipPath={`url(#${id}-eye)`}>
        <g className={styles.lidRest}>
          <g className={styles.lidWake}>
            <g className={styles.lidBlink}>
              <path className={styles.lid} d={LID} />
              <path className={styles.lash} d={LASH} />
            </g>
          </g>
        </g>
      </g>
    </svg>
  );
}

const SAMPLE_ADVICE = {
  title: "Leave by 2:40 PM for Dentist",
  body: "The drive is about 18 minutes. You usually need 10 minutes to get ready.",
};

const benchFont: CSSProperties = { fontFamily: "Arial, Helvetica, sans-serif" };

export function HorseAvatar({
  state,
  size = 64,
  entrance = "none",
  onClick,
}: Readonly<{
  state: AvatarState;
  size?: number;
  entrance?: Entrance;
  onClick?: () => void;
}>) {
  const ref = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || entrance !== "center") return;
    // Reset first: the entrance transform already uses --from-y, and a second
    // effect run (React development mode) would otherwise measure the moved box.
    element.style.setProperty("--from-y", "0px");
    const rect = element.getBoundingClientRect();
    const fromY = window.innerHeight / 2 - (rect.top + rect.height / 2);
    element.style.setProperty("--from-y", `${Math.round(fromY)}px`);
  }, [entrance]);

  const entranceClass =
    entrance === "top" ? styles.arriveTop : entrance === "center" ? styles.arriveCenter : "";

  return (
    <button
      ref={ref}
      type="button"
      className={`${styles.avatar} ${entranceClass}`}
      style={{ "--size": `${size}px`, "--wake-delay": WAKE_DELAY[entrance] } as CSSProperties}
      data-state={state}
      aria-label={state === "advice" ? "Daily Brief: advice waiting" : "Daily Brief"}
      aria-expanded={state === "open"}
      onClick={onClick}
    >
      <span className={styles.halo} aria-hidden="true" />
      <span className={styles.face} aria-hidden="true">
        <HorseArt state={state} />
      </span>
      <svg className={styles.ring} viewBox="0 0 100 100" aria-hidden="true">
        <circle className={styles.ringArc} cx="50" cy="50" r="48" />
      </svg>
      <span className={styles.orbit} aria-hidden="true">
        <span className={`${styles.dot} ${styles.dotBlue}`} />
      </span>
      <span className={`${styles.orbit} ${styles.orbitReverse}`} aria-hidden="true">
        <span className={`${styles.dot} ${styles.dotRed}`} />
      </span>
      <span className={styles.badge} aria-hidden="true" />
    </button>
  );
}

export function HorseAvatarTrialBench() {
  const [state, setState] = useState<AvatarState>("advice");
  const [entrance, setEntrance] = useState<Entrance>("center");
  const [size, setSize] = useState(64);
  const [replay, setReplay] = useState(0);

  const toggleOpen = () => setState((current) => (current === "open" ? "advice" : "open"));

  return (
    <div className="min-h-dvh bg-neutral-100 text-neutral-950">
      <div className="mx-auto grid max-w-5xl gap-6 px-4 py-6 sm:px-6">
        <header className="grid gap-3 border border-neutral-300 bg-white p-5" style={benchFont}>
          <p className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
            Trial · not in product
          </p>
          <h1 className="text-2xl font-semibold">Advisor horse avatar</h1>
          <p className="max-w-2xl text-sm text-neutral-600">
            A circled horse that sits at the top center of a page and carries the
            advisor&apos;s state. Click the avatar in the frame to open the sample advice.
          </p>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3 text-sm">
            <Control label="State">
              {STATES.map((option) => (
                <ChipButton
                  key={option.id}
                  active={state === option.id}
                  onClick={() => setState(option.id)}
                >
                  {option.label}
                </ChipButton>
              ))}
            </Control>
            <Control label="Entrance">
              {(
                [
                  ["center", "From center"],
                  ["top", "At top"],
                  ["none", "None"],
                ] as const
              ).map(([id, label]) => (
                <ChipButton key={id} active={entrance === id} onClick={() => setEntrance(id)}>
                  {label}
                </ChipButton>
              ))}
              <ChipButton active={false} onClick={() => setReplay((count) => count + 1)}>
                Replay
              </ChipButton>
            </Control>
            <Control label="Size">
              {[48, 64, 96, 128].map((value) => (
                <ChipButton key={value} active={size === value} onClick={() => setSize(value)}>
                  {value}px
                </ChipButton>
              ))}
            </Control>
          </div>
        </header>

        <section
          aria-label="In context"
          className="border border-neutral-300 bg-[var(--background)] text-[var(--foreground)]"
        >
          <div className="grid justify-items-center gap-3 px-4 pt-6 pb-4">
            <HorseAvatar
              key={`${replay}-${entrance}`}
              state={state}
              size={size}
              entrance={entrance}
              onClick={toggleOpen}
            />
            <div className={styles.card} data-open={state === "open"}>
              <div className={styles.cardInner}>
                <div className="mt-1 w-[min(22rem,calc(100vw-4rem))] border border-[var(--line)] bg-[var(--background)] px-4 py-3 text-center">
                  <p className="text-sm text-[var(--foreground)]">{SAMPLE_ADVICE.title}</p>
                  <p className="mt-1 text-xs text-[var(--muted-readable)]">{SAMPLE_ADVICE.body}</p>
                </div>
              </div>
            </div>
          </div>
          <MockTimeline />
        </section>

        <section className="grid gap-3 border border-neutral-300 bg-white p-5" style={benchFont}>
          <h2 className="text-lg font-semibold">States side by side</h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {STATES.map((option) => (
              <figure
                key={option.id}
                className="grid justify-items-center gap-3 border border-neutral-200 bg-[var(--background)] px-3 py-5"
              >
                <HorseAvatar state={option.id} size={64} />
                <figcaption className="text-center text-xs text-neutral-600">
                  <span className="block font-semibold text-neutral-900">{option.label}</span>
                  {option.note}
                </figcaption>
              </figure>
            ))}
          </div>
          <p className="text-xs text-neutral-500">
            Reduced motion: breathing, orbits, the pulse and entrances stop. The
            badge and the preparing arc still show state without movement.
          </p>
        </section>
      </div>
    </div>
  );
}

function MockTimeline() {
  const rows = [
    ["8:00 AM", "Morning walk"],
    ["2:40 PM", "Leave for Dentist"],
    ["9:30 PM", "Read 20 pages"],
  ];
  return (
    <div className="grid gap-px border-t border-[var(--line)] bg-[var(--line)]">
      <p className="bg-[var(--background)] px-4 pt-3 pb-1 text-xs text-[var(--muted-readable)]">
        Today
      </p>
      {rows.map(([time, title]) => (
        <div
          key={title}
          className="flex items-center gap-4 bg-[var(--background)] px-4 py-3 text-sm"
        >
          <span className="w-16 shrink-0 text-xs text-[var(--muted-readable)]">{time}</span>
          <span className="flex-1">{title}</span>
          <span className="hidden gap-2 sm:flex">
            <span className="border border-[var(--line)] px-2 py-1 text-xs">Completed</span>
            <span className="border border-[var(--line)] px-2 py-1 text-xs">Not Completed</span>
          </span>
        </div>
      ))}
    </div>
  );
}

function Control({ label, children }: Readonly<{ label: string; children: ReactNode }>) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs font-semibold uppercase tracking-wider text-neutral-500">{label}</span>
      {children}
    </div>
  );
}

function ChipButton({
  active,
  onClick,
  children,
}: Readonly<{ active: boolean; onClick: () => void; children: ReactNode }>) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`border px-2.5 py-1 text-xs ${
        active ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300 bg-white text-neutral-800"
      }`}
    >
      {children}
    </button>
  );
}
