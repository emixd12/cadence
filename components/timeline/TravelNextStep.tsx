"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";

import {
  TRAVEL_ATTENDANCE_IN_PERSON,
  TRAVEL_ATTENDANCE_REMOTE,
  TRAVEL_OFF_DISMISS,
  departureStepLead,
  departureTravelOffPhrase,
} from "@cadence/core/services/departure-phrases";
import type { DepartureTrip } from "@cadence/core/types/departure";

/** Web links by address; the Mac app navigates by callback. */
export type TravelLinkTarget = Readonly<{ href: string }> | Readonly<{ onOpen: () => void }>;

/**
 * Ticket 273: what a missing estimate's one action can do. Each lookup returns null when the
 * stop has no such action, for example a Behavior has no trip correction.
 */
export type TravelStepActions = Readonly<{
  /** Opens a Calendar event's details with its trip correction open. */
  correction: (ref: string) => (() => void) | null;
  /** Answers In person or Remote for a Calendar event, for this trip. */
  attendance: (ref: string) => ((attendance: "physical" | "remote") => void) | null;
  /** Where a Behavior's place is changed. */
  behavior: (ref: string) => TravelLinkTarget | null;
  /** Travel settings: Home and device location. */
  settings: TravelLinkTarget | null;
}>;

type TravelStep =
  | Readonly<{ kind: "attendance"; answer: (attendance: "physical" | "remote") => void }>
  | Readonly<{ kind: "lead"; target: TravelLinkTarget }>;

const STEP_STATES: ReadonlySet<DepartureTrip["state"]> = new Set(["needs_place", "needs_attendance", "needs_origin"]);

export function isTravelStep(trip: Pick<DepartureTrip, "state">): boolean {
  return STEP_STATES.has(trip.state);
}

/** A stop's place is fixed through its trip correction (Calendar) or its Behavior. */
function placeStep(ref: string | null, actions: TravelStepActions): TravelStep | null {
  if (!ref) return null;
  const correction = actions.correction(ref);
  if (correction) return { kind: "lead", target: { onOpen: correction } };
  const behavior = actions.behavior(ref);
  return behavior ? { kind: "lead", target: behavior } : null;
}

/** The one action for a trip's missing estimate. The blocking stop comes from the departure model. */
export function resolveTravelStep(trip: DepartureTrip, actions: TravelStepActions): TravelStep | null {
  switch (trip.state) {
    case "needs_attendance": {
      const answer = trip.destinationRef ? actions.attendance(trip.destinationRef) : null;
      return answer ? { kind: "attendance", answer } : null;
    }
    case "needs_place": return placeStep(trip.destinationRef, actions);
    case "needs_origin":
      if (trip.blockingRef) return placeStep(trip.blockingRef, actions);
      return actions.settings ? { kind: "lead", target: actions.settings } : null;
    default: return null;
  }
}

function TravelAction({ target, children }: Readonly<{ target: TravelLinkTarget; children: ReactNode }>) {
  return "href" in target
    ? <a className="text-link" href={target.href} data-travel-step-action>{children}</a>
    : <button type="button" className="text-link" onClick={target.onOpen} data-travel-step-action>{children}</button>;
}

/**
 * Keeps keyboard focus when an answer removes its own buttons: it moves to the nearest
 * `data-travel-focus` container still on the page, or to its `data-travel-focus-target`.
 */
function useKeepFocus() {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const node = ref.current;
    return () => {
      if (!node || !node.contains(document.activeElement)) return;
      const scope = node.closest<HTMLElement>("[data-travel-focus]");
      const target = scope?.querySelector<HTMLElement>("[data-travel-focus-target]") ?? scope;
      queueMicrotask(() => {
        const active = document.activeElement;
        if (target?.isConnected && (!active || active === document.body || !active.isConnected)) target.focus();
      });
    };
  }, []);
  return ref;
}

/**
 * Ticket 273: one sentence and one action for a missing estimate. A place, start or Home step
 * makes the sentence's own first words the action, as Refresh travel does (owner change R1).
 * Attendance asks In person or Remote in one tap. Key it by trip key and state.
 */
export function TravelStepText({ trip, text, actions }: Readonly<{ trip: DepartureTrip; text: string; actions: TravelStepActions }>) {
  const ref = useKeepFocus();
  const step = resolveTravelStep(trip, actions);
  if (step?.kind === "attendance") return <span ref={ref} data-travel-step={trip.state}>{text}{" "}
    <button type="button" className="text-link" onClick={() => step.answer("physical")}>{TRAVEL_ATTENDANCE_IN_PERSON}</button>{" · "}
    <button type="button" className="text-link" onClick={() => step.answer("remote")}>{TRAVEL_ATTENDANCE_REMOTE}</button>
  </span>;
  const split = step ? departureStepLead(text) : null;
  if (!step || !split) return <>{text}</>;
  return <span ref={ref} data-travel-step={trip.state}><TravelAction target={step.target}>{split.lead}</TravelAction>{split.rest}</span>;
}

const OFFER_DISMISSED_KEY = "cadence:travel-offer-dismissed";

/** The offer stays hidden on this device once dismissed. Nothing about the event is stored. */
export function travelOfferDismissed(): boolean {
  try { return window.localStorage.getItem(OFFER_DISMISSED_KEY) === "true"; } catch { return false; }
}

export function dismissTravelOffer(): void {
  try { window.localStorage.setItem(OFFER_DISMISSED_KEY, "true"); } catch { /* Storage unavailable: hidden until reload. */ }
}

/**
 * Ticket 273: with Travel estimates off and a located event ahead today, one line offers to
 * turn them on. It only opens Travel settings: consent comes from the Travel estimates toggle.
 */
export function TravelOffOffer({ label, target, onDismiss, className }: Readonly<{
  label: string; target: TravelLinkTarget; onDismiss: () => void; className?: string;
}>) {
  const split = departureStepLead(departureTravelOffPhrase(label))!;
  return <p className={className} data-travel-offer>
    <TravelAction target={target}>{split.lead}</TravelAction>{split.rest}{" "}
    <button type="button" className="text-link" onClick={onDismiss}>{TRAVEL_OFF_DISMISS}</button>
  </p>;
}
