"use client";

import { useState } from "react";
import { advisorAvatarCatalog } from "@cadence/core/advisor-avatar";
import type { AdvisorAvatarGesture, AdvisorAvatarState } from "@cadence/core/resolvers/advisor-avatar.resolver";

import { AdvisorAvatar, type AdvisorAvatarGestureEvent } from "@/components/advisor/AdvisorAvatar";

import options from "./advisor-avatar-bench.module.css";

// Bench for the advisor's avatar (Ticket 345): every catalog state and gesture at the product sizes.

const SIZES = [40, 48, 120] as const;
const STATES = Object.entries(advisorAvatarCatalog.states).sort(([, a], [, b]) => a.priority - b.priority);
const GESTURES = Object.entries(advisorAvatarCatalog.gestures);

/**
 * Step 2 review: the whole-drawing breathing turns and scales the drawing all the time, which
 * softens it. These rows show the resting avatar with each way of handling that. Bench only.
 * Tried and dropped: one breath every 9 seconds. Chrome keeps the drawing soft between breaths
 * for as long as the animation is attached, so it was no sharper than A.
 */
const BREATHING_OPTIONS = [
  { id: "A", name: "As shipped", note: "Breathing at every size, all the time. The drawing is always slightly turned and scaled, so it is never sharp.", className: undefined },
  { id: "B", name: "No breathing", note: "The drawing stays sharp. Life comes from the blink, the mane and the ears.", className: options.none },
  { id: "C", name: "Breathing in the panel only", note: "Sharp at 40 and 48 pixels; the 120 pixel panel avatar breathes as shipped.", className: options.panelOnly },
] as const;

export function AdvisorAvatarBench() {
  const [gesture, setGesture] = useState<AdvisorAvatarGestureEvent | null>(null);
  const play = (id: string) => setGesture((current) => ({ id: id as AdvisorAvatarGesture, key: (current?.key ?? 0) + 1 }));
  return (
    <div className="min-h-dvh bg-background px-6 py-6 text-foreground">
      <h1 className="text-xl">Advisor avatar</h1>
      <p className="mt-1 max-w-2xl text-sm text-muted-readable">
        Every state and gesture from <code>packages/core/src/advisor-avatar/catalog.json</code> at 40, 48 and 120 pixels.
        Reduced motion shows the still drawing in every state.
      </p>
      <section className="mt-6 grid gap-6" aria-label="States">
        {STATES.map(([id, entry]) => (
          <div key={id} className="flex flex-wrap items-center gap-6 border-t border-line pt-4" data-bench-state={id}>
            {SIZES.map((size) => <AdvisorAvatar key={size} size={size} state={id as AdvisorAvatarState} />)}
            <div className="max-w-md text-sm leading-6">
              <p className="font-bold">{id}</p>
              <p>{entry.when}</p>
              <p className="text-muted-readable">{entry.motion}</p>
            </div>
          </div>
        ))}
      </section>
      <section className="mt-10 border-t border-line pt-4" aria-label="Breathing options">
        <h2 className="text-lg">Breathing options</h2>
        <p className="mt-1 max-w-2xl text-sm text-muted-readable">
          The resting avatar. Only the whole-drawing breathing differs between rows; the blink and the mane move in all of them.
        </p>
        <div className="mt-4 grid gap-6">
          {BREATHING_OPTIONS.map((option) => (
            <div key={option.id} className={`flex flex-wrap items-center gap-6 border-t border-line pt-4 ${option.className ?? ""}`} data-bench-breathing={option.id}>
              {SIZES.map((size) => (
                <span key={size} data-bench-size={size} className="inline-flex">
                  <AdvisorAvatar size={size} state="state.resting" />
                </span>
              ))}
              <div className="max-w-md text-sm leading-6">
                <p className="font-bold">{option.id} {option.name}</p>
                <p className="text-muted-readable">{option.note}</p>
              </div>
            </div>
          ))}
        </div>
      </section>
      <section className="mt-8 border-t border-line pt-4" aria-label="Gestures">
        <div className="flex flex-wrap items-center gap-6">
          {SIZES.map((size) => <AdvisorAvatar key={size} size={size} state="state.resting" gesture={gesture} />)}
          <div className="text-sm leading-6">
            <p className="font-bold">Gestures play once</p>
            <p className="flex flex-wrap gap-x-4">
              {GESTURES.map(([id]) => (
                <button key={id} type="button" className="underline underline-offset-2" onClick={() => play(id)}>{id}</button>
              ))}
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
