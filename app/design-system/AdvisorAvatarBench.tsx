"use client";

import { useState } from "react";
import { advisorAvatarCatalog } from "@cadence/core/advisor-avatar";
import type { AdvisorAvatarGesture, AdvisorAvatarState } from "@cadence/core/resolvers/advisor-avatar.resolver";

import { AdvisorAvatar, type AdvisorAvatarGestureEvent } from "@/components/advisor/AdvisorAvatar";

// Bench for the advisor's avatar (Ticket 345): every catalog state and gesture at the product sizes.

const SIZES = [40, 48, 120] as const;
const STATES = Object.entries(advisorAvatarCatalog.states).sort(([, a], [, b]) => a.priority - b.priority);
const GESTURES = Object.entries(advisorAvatarCatalog.gestures);

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
