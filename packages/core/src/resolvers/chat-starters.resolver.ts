import rawLibrary from "../data/chat-starters.json";
import type { ChatStarter } from "../types/chat";

/**
 * Chat starter questions (advisor plan Phase 5B, Emi's ask on Nov 20).
 *
 * Deterministic: the person's own week in, up to three questions out. No model call.
 * Questions live in `packages/core/src/data/chat-starters.json`, grouped by lane. A lane
 * names the fact that makes its questions worth asking. Lanes that read the coach's
 * signals (weekday gap, time of day, crowded hour, done together, setup gaps) light up
 * when a caller passes those signal kinds; until then their questions stay unused.
 */

export const CHAT_STARTERS_VERSION = "chat-starters-3";
export const CHAT_STARTER_COUNT = 3;
/** At most this many questions about patterns; the rest are about today or general. */
export const CHAT_STARTER_MAX_INSIGHTS = 2;
const TITLE_MAX = 40;

export const CHAT_STARTER_THRESHOLDS = Object.freeze({
  /** A Behavior is slipping at or under this done rate, with enough marks to say so. */
  low: { maxRate: 0.4, minDecided: 5 },
  /** A Behavior is steady at or over this done rate. */
  steady: { minRate: 0.9, minDecided: 8 },
  /** This week differs from the last four by at least this much. */
  weekShift: { minChange: 0.2, minDecidedThisWeek: 4, minDecidedMonth: 10 },
  /** Fewer marks than this in four weeks means the account is still new. */
  early: { maxDecidedMonth: 10 },
  /** A light day: at most this many open items today leaves room for an opportunity. */
  lightDay: { maxOpen: 2 },
});

export const CHAT_STARTER_SIGNAL_LANES = [
  "weekday_gap", "time_of_day_gap", "crowded_hour", "done_together", "setup_gaps",
] as const;
export type ChatStarterSignalLane = (typeof CHAT_STARTER_SIGNAL_LANES)[number];

export type ChatStarterLane =
  | "general" | "today_open" | "today_done" | "moved_today" | "unmarked"
  | "low_behavior" | "steady_behavior" | "week_down" | "week_up" | "early" | "opportunity_room"
  | ChatStarterSignalLane;

export type ChatStarterEntry = Readonly<{
  id: string;
  lane: ChatStarterLane;
  text: string;
  advice_card?: string;
  /** Hidden until the account has at least this many active Behaviors. */
  min_behaviors?: number;
}>;
export type ChatStarterLibrary = Readonly<{ version: string; starters: readonly ChatStarterEntry[] }>;

export type ChatStarterBehaviorFacts = Readonly<{
  title: string;
  /** Done plus not-done marks in the last four weeks. Unmarked items never count. */
  decided: number;
  /** Done share of `decided`; null with no marks. */
  rate: number | null;
}>;

export type ChatStarterFacts = Readonly<{
  /** The account's local date, so the pick changes day to day but not on every visit. */
  today: string;
  todayTotal: number;
  todayDone: number;
  todayOpen: number;
  /** Title of a Behavior moved for today, if any. */
  movedToday: string | null;
  /** Older items still waiting for a mark. */
  unmarked: number;
  /** Last seven days, overall. */
  week: Readonly<{ decided: number; rate: number | null }>;
  /** Last 28 days, overall and per active Behavior. */
  month: Readonly<{ decided: number; rate: number | null }>;
  behaviors: readonly ChatStarterBehaviorFacts[];
  /** Coach signal kinds stored for this account today. */
  signals?: readonly string[];
  /** Title of a running opportunity Behavior that is not on today yet, if any. */
  opportunity?: string | null;
}>;

const INSIGHT_ORDER: readonly ChatStarterLane[] = [
  "moved_today", "low_behavior", "opportunity_room", "week_down", "unmarked", "steady_behavior", "week_up", "early", ...CHAT_STARTER_SIGNAL_LANES,
];
const DAILY_ORDER: readonly ChatStarterLane[] = ["today_done", "today_open", "general"];

export const CHAT_STARTER_LIBRARY: ChatStarterLibrary = rawLibrary as ChatStarterLibrary;

/** The three questions shown when nothing about the account can be read. */
export const CHAT_STARTER_FALLBACK: readonly ChatStarter[] = Object.freeze(
  ["today-whats-on", "week-how-going", "today-plan-rest"].map((id) => {
    const entry = CHAT_STARTER_LIBRARY.starters.find((item) => item.id === id)!;
    return { id: entry.id, text: entry.text };
  }),
);

function shortTitle(title: string): string {
  const clean = title.replace(/\s+/g, " ").trim();
  return clean.length > TITLE_MAX ? `${clean.slice(0, TITLE_MAX - 1).trimEnd()}…` : clean;
}

function dayHash(text: string): number {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function lowest(behaviors: readonly ChatStarterBehaviorFacts[]) {
  const { maxRate, minDecided } = CHAT_STARTER_THRESHOLDS.low;
  return [...behaviors].filter((row) => row.rate !== null && row.decided >= minDecided && row.rate <= maxRate)
    .sort((a, b) => a.rate! - b.rate! || b.decided - a.decided || a.title.localeCompare(b.title))[0] ?? null;
}

function steadiest(behaviors: readonly ChatStarterBehaviorFacts[]) {
  const { minRate, minDecided } = CHAT_STARTER_THRESHOLDS.steady;
  return [...behaviors].filter((row) => row.rate !== null && row.decided >= minDecided && row.rate >= minRate)
    .sort((a, b) => b.rate! - a.rate! || b.decided - a.decided || a.title.localeCompare(b.title))[0] ?? null;
}

function weekShift(facts: ChatStarterFacts): "down" | "up" | null {
  const { minChange, minDecidedThisWeek, minDecidedMonth } = CHAT_STARTER_THRESHOLDS.weekShift;
  if (facts.week.rate === null || facts.month.rate === null) return null;
  if (facts.week.decided < minDecidedThisWeek || facts.month.decided < minDecidedMonth) return null;
  const change = facts.week.rate - facts.month.rate;
  return change <= -minChange ? "down" : change >= minChange ? "up" : null;
}

/** Which lanes hold for this account, and the Behavior title each one names. */
export function chatStarterLanes(facts: ChatStarterFacts): ReadonlyMap<ChatStarterLane, string | null> {
  const lanes = new Map<ChatStarterLane, string | null>();
  if (facts.movedToday) lanes.set("moved_today", shortTitle(facts.movedToday));
  const low = lowest(facts.behaviors);
  if (low) lanes.set("low_behavior", shortTitle(low.title));
  if (facts.opportunity && facts.todayOpen <= CHAT_STARTER_THRESHOLDS.lightDay.maxOpen) {
    lanes.set("opportunity_room", shortTitle(facts.opportunity));
  }
  const shift = weekShift(facts);
  if (shift === "down") lanes.set("week_down", null);
  if (facts.unmarked > 0) lanes.set("unmarked", null);
  const steady = steadiest(facts.behaviors);
  if (steady && steady.title !== low?.title) lanes.set("steady_behavior", shortTitle(steady.title));
  if (shift === "up") lanes.set("week_up", null);
  if (facts.month.decided < CHAT_STARTER_THRESHOLDS.early.maxDecidedMonth && facts.behaviors.length > 0) lanes.set("early", null);
  const signals = new Set(facts.signals ?? []);
  for (const lane of CHAT_STARTER_SIGNAL_LANES) if (signals.has(lane)) lanes.set(lane, null);
  if (facts.todayTotal > 0 && facts.todayOpen === 0 && facts.todayDone === facts.todayTotal) lanes.set("today_done", null);
  if (facts.todayOpen > 0) lanes.set("today_open", null);
  lanes.set("general", null);
  return lanes;
}

/**
 * Up to two questions about the person's patterns, then today or general ones, three in
 * all. Within a lane the question rotates by local date. No question repeats.
 */
export function pickChatStarters(facts: ChatStarterFacts, library: ChatStarterLibrary = CHAT_STARTER_LIBRARY): ChatStarter[] {
  const lanes = chatStarterLanes(facts);
  const picked: ChatStarter[] = [];
  const used = new Set<string>();
  const take = (lane: ChatStarterLane, title: string | null, offset = 0) => {
    const entries = library.starters.filter((entry) => entry.lane === lane && !used.has(entry.id)
      && (title !== null || !entry.text.includes("{behavior}"))
      && facts.behaviors.length >= (entry.min_behaviors ?? 0));
    if (entries.length === 0) return false;
    const entry = entries[(dayHash(`${facts.today}:${lane}`) + offset) % entries.length]!;
    used.add(entry.id);
    picked.push({ id: entry.id, text: title === null ? entry.text : entry.text.replaceAll("{behavior}", title) });
    return true;
  };
  for (const lane of INSIGHT_ORDER) {
    if (picked.length >= CHAT_STARTER_MAX_INSIGHTS) break;
    if (lanes.has(lane)) take(lane, lanes.get(lane) ?? null);
  }
  for (const lane of DAILY_ORDER) {
    if (picked.length >= CHAT_STARTER_COUNT) break;
    if (lanes.has(lane)) take(lane, null);
  }
  for (let offset = 1; picked.length < CHAT_STARTER_COUNT && offset <= library.starters.length; offset += 1) {
    if (!take("general", null, offset)) break;
  }
  return picked.slice(0, CHAT_STARTER_COUNT);
}
