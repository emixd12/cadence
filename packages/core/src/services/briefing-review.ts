import type {
  BriefingAnalysisLaneId,
  BriefingAnalysisLaneState,
  BriefingAnalysisUnavailableReason,
} from "../types/briefing-analysis";
import type { BriefingTipDecision } from "../resolvers/briefing-analysis.resolver";

/**
 * Editorial review helpers for the development workbench (Ticket 175). They
 * warn; they never reject or rewrite production output.
 */

/** Proposed working range for a roughly 45-second read. Not a validated reading-speed formula. */
export const BRIEFING_READING_TARGET = Object.freeze({ minWords: 80, maxWords: 120 });

/** Shared-phrase length that counts as repetition between two visible parts. */
export const BRIEFING_REPETITION_WORDS = 5;

/** Internal vocabulary that should not reach the reader. Warnings only. */
export const BRIEFING_MECHANICS_TERMS = Object.freeze([
  "planner", "move option", "option id", "planner route", "analysis lane", "inspector", "fingerprint",
  "baseline", "materiality", "cooldown", "occurrence ref", "day evidence", "evidence band",
  "sample size", "typical marked time", "reserved range", "dayevidence", "typicalmarkedtime",
  "experiment", "association",
]);

export const BRIEFING_LANE_LABELS: Readonly<Record<BriefingAnalysisLaneId, string>> = Object.freeze({
  "weekday-time-dips": "Weaker days or time slots",
  "realistic-timing": "When you usually log it",
  "schedule-load": "Busy days",
  "cross-source-context": "Calendar-heavy days",
  "decision-debt": "Decisions left open",
  "logging-chronology": "Logging on a later day",
  "correction-patterns": "Changed decisions",
  "reminder-effectiveness": "Reminders",
  "notes-failure-themes": "Obstacles in Notes",
});

export const BRIEFING_LANE_STATE_LABELS: Readonly<Record<BriefingAnalysisLaneState, string>> = Object.freeze({
  finding: "Found a pattern",
  no_finding: "No pattern met the evidence bar",
  unavailable: "Not available",
  not_selected: "Not selected",
});

export const BRIEFING_LANE_REASON_LABELS: Readonly<Record<BriefingAnalysisUnavailableReason, string>> = Object.freeze({
  source_not_permitted: "the source is off in Settings",
  source_capped: "the source exceeded its read limit",
  source_not_requested: "the source was not read",
  insufficient_window: "the history window is too short",
  insufficient_stable_period: "the schedule changed too recently",
  historical_calendar_not_read: "past Calendar days are not read",
  actual_time_unavailable: "actual times are not recorded",
});

export const BRIEFING_TIP_DECISION_LABELS: Readonly<Record<BriefingTipDecision, string>> = Object.freeze({
  selected: "Offered as today's tip",
  not_relevant: "Does not bear on today",
  cooldown: "Shown recently",
  spacing: "A different tip was shown yesterday",
  not_ranked: "A stronger pattern was offered",
  disabled: "Tips are off in this configuration",
});

export type BriefingReadingSegment = Readonly<{ label: string; text: string }>;

export type BriefingReadingReview = Readonly<{
  /** Every word the reader sees in the bubble body, including evidence, option and travel lines. */
  visibleWords: number;
  target: typeof BRIEFING_READING_TARGET;
  position: "below" | "within" | "above";
  repeated: readonly Readonly<{ between: readonly [string, string]; phrase: string }>[];
  mechanicsTerms: readonly string[];
}>;

export function countBriefingWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/u).length : 0;
}

/**
 * Reviews reading burden, repeated phrasing across visible parts, and internal
 * vocabulary. A term that also appears in a Behavior title is not flagged.
 */
export function reviewBriefingReading(input: Readonly<{
  visibleText: string;
  segments: readonly BriefingReadingSegment[];
  behaviorTitles?: readonly string[];
}>): BriefingReadingReview {
  const visibleWords = countBriefingWords(input.visibleText);
  const target = BRIEFING_READING_TARGET;
  const repeated: { between: readonly [string, string]; phrase: string }[] = [];
  const segments = input.segments.filter((segment) => segment.text.trim());
  for (let left = 0; left < segments.length; left += 1) {
    for (let right = left + 1; right < segments.length; right += 1) {
      const phrase = sharedPhrase(segments[left]!.text, segments[right]!.text, BRIEFING_REPETITION_WORDS);
      if (phrase) repeated.push({ between: [segments[left]!.label, segments[right]!.label], phrase });
    }
  }
  const titleTokens = (input.behaviorTitles ?? []).map(tokens).filter((title) => title.length).sort((a, b) => b.length - a.length);
  const proseTokens = tokens(segments.map((segment) => segment.text).join(" "));
  const prose = removeTitleMatches(proseTokens, titleTokens).join(" ");
  const mechanicsTerms = BRIEFING_MECHANICS_TERMS.filter((term) =>
    new RegExp(`(^|[^\\p{L}\\p{N}])${escape(term)}s?($|[^\\p{L}\\p{N}])`, "u").test(prose));
  return {
    visibleWords,
    target,
    position: visibleWords < target.minWords ? "below" : visibleWords > target.maxWords ? "above" : "within",
    repeated,
    mechanicsTerms,
  };
}

export type BriefingConfigDifference = Readonly<{ path: string; before: unknown; after: unknown }>;

/** Leaf differences between two configurations. Arrays compare as whole values. */
export function diffBriefingConfigs(before: unknown, after: unknown, path = ""): BriefingConfigDifference[] {
  const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
  if (isObject(before) && isObject(after)) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
    return keys.flatMap((key) => diffBriefingConfigs(before[key], after[key], path ? `${path}.${key}` : key));
  }
  return JSON.stringify(before) === JSON.stringify(after) ? [] : [{ path, before, after }];
}

function tokens(value: string): string[] {
  return value.toLowerCase().normalize("NFKC").split(/[^\p{L}\p{N}']+/u).filter(Boolean);
}

/** Removes only complete normalized title phrases, preserving separate term uses. */
function removeTitleMatches(prose: readonly string[], titles: readonly (readonly string[])[]): string[] {
  const result: string[] = [];
  for (let index = 0; index < prose.length;) {
    const title = titles.find((candidate) => candidate.every((token, offset) => prose[index + offset] === token));
    if (title) {
      result.push("\u0000");
      index += title.length;
    } else {
      result.push(prose[index]!);
      index += 1;
    }
  }
  return result;
}

function sharedPhrase(left: string, right: string, words: number): string | null {
  const haystack = ` ${tokens(right).join(" ")} `;
  const needle = tokens(left);
  for (let index = 0; index + words <= needle.length; index += 1) {
    const phrase = needle.slice(index, index + words).join(" ");
    if (haystack.includes(` ${phrase} `)) return phrase;
  }
  return null;
}

function escape(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
