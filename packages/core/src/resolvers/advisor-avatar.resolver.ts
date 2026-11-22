/**
 * Which state and gesture the advisor's avatar shows (Ticket 344).
 * The catalog, `packages/core/src/advisor-avatar/catalog.json`, says what each one means
 * and looks like; this file is the only place that decides. Pure: no clock, storage or UI.
 */

export type AdvisorAvatarState =
  | "state.replying"
  | "state.working"
  | "state.preparing"
  | "state.attending"
  | "state.trouble"
  | "state.waiting"
  | "state.resting";

export type AdvisorAvatarGesture = "gesture.arrive" | "gesture.notice" | "gesture.acknowledge" | "gesture.refused";

export type AdvisorAvatarInput = Readonly<{
  /** Something waits for the person (the label reads "Advisor · 1 new"). */
  hasNew: boolean;
  panelOpen: boolean;
  /** The Daily Brief as the advisor sees it. */
  brief: "none" | "loading" | "ready" | "closed" | "notice";
  /** An answer was sent and its result has not come back. */
  answering: boolean;
  /** Chat is writing a reply. */
  replying: boolean;
  /** Counts answers that were applied, and answers that were refused, on this screen. */
  applied: number;
  refused: number;
}>;

/** States in priority order: the first whose condition holds is shown. */
const STATE_ORDER: readonly (readonly [AdvisorAvatarState, (input: AdvisorAvatarInput) => boolean])[] = [
  ["state.replying", (input) => input.replying],
  ["state.working", (input) => input.answering],
  ["state.preparing", (input) => input.brief === "loading"],
  ["state.attending", (input) => input.panelOpen],
  ["state.trouble", (input) => input.brief === "notice"],
  ["state.waiting", (input) => input.hasNew],
  ["state.resting", () => true],
];

/** The one state to show. Null when there is no advisor (no account, or AI features off). */
export function resolveAdvisorAvatarState(input: AdvisorAvatarInput | null): AdvisorAvatarState | null {
  if (!input) return null;
  return STATE_ORDER.find(([, holds]) => holds(input))![0];
}

/**
 * The gesture to play once when the input changes, or null.
 * `previous` is null on the first render; `firstOpenToday` then asks for the arrival.
 */
export function resolveAdvisorAvatarGesture(
  previous: AdvisorAvatarInput | null,
  next: AdvisorAvatarInput | null,
  firstOpenToday: boolean,
): AdvisorAvatarGesture | null {
  if (!next) return null;
  if (!previous) return firstOpenToday ? "gesture.arrive" : null;
  if (next.refused > previous.refused) return "gesture.refused";
  if (next.applied > previous.applied) return "gesture.acknowledge";
  if (next.hasNew && !previous.hasNew && !next.panelOpen) return "gesture.notice";
  return null;
}

/** First open of the local day on this device: the stored day differs from today. */
export function isFirstAdvisorOpenToday(storedLocalDate: string | null, todayLocalDate: string): boolean {
  return storedLocalDate !== todayLocalDate;
}

/** A Chat page has no panel or brief: it rests, or replies while a reply streams. */
export function chatAdvisorAvatarInput(replying: boolean): AdvisorAvatarInput {
  return { hasNew: false, panelOpen: false, brief: "none", answering: false, replying, applied: 0, refused: 0 };
}
