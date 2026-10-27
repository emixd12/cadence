import type { BriefingReference } from "./briefing-references";
import type { BriefingPlanOption } from "../types/briefing-plan";
import type { DailyBriefing } from "../types/daily-brief";

export function formatBriefingTime(value: string, timezone: string): string {
  const date = new Date(value);
  // Fixed locale and the briefing's timezone keep rendered and server-validated text reproducible.
  return Number.isNaN(date.getTime()) ? "recently" : date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: timezone });
}

export function briefingOptionText(option: BriefingPlanOption, timezone: string, overlapsTravel = false, plain = false): string {
  const range = `${formatBriefingTime(option.intervals.proposed.startAt, timezone)}–${formatBriefingTime(option.intervals.proposed.endAt, timezone)}`;
  // The bubble's closing warning already says nothing was applied.
  const lead = plain ? `Suggested time: ${range}.` : `Hypothetical option: ${range} (${timezone}). No change applied.`;
  return `${lead}${overlapsTravel ? " This time overlaps planned travel." : ""}`;
}

/** Recipe 1.1 and 1.2 briefs use plain option text and tip labels. */
export function isPlainBriefing(briefing: Pick<DailyBriefing, "versions">): boolean {
  return briefing.versions?.recipe === "daily_brief@1.1" || isLaneBriefing(briefing);
}

/** Recipe 1.2 briefs show each kind of advice in its own labeled block. */
export function isLaneBriefing(briefing: Pick<DailyBriefing, "versions">): boolean {
  return briefing.versions?.recipe === "daily_brief@1.2";
}

/** Recipe 1.2 block label for one suggestion. */
export function briefingSuggestionLabel(suggestion: NonNullable<DailyBriefing["suggestions"]>[number]): string {
  return suggestion.option ? "New suggested time" : "Suggestion";
}

type BriefingSuggestion = NonNullable<DailyBriefing["suggestions"]>[number];

/** Recipe 1.2: one labeled group per advice type, in order of first appearance (owner review, October 23). */
export function briefingSuggestionGroups(suggestions: readonly BriefingSuggestion[] | undefined): Readonly<{ label: string; items: readonly BriefingSuggestion[] }>[] {
  const groups = new Map<string, BriefingSuggestion[]>();
  for (const suggestion of suggestions ?? []) {
    const label = briefingSuggestionLabel(suggestion);
    groups.set(label, [...(groups.get(label) ?? []), suggestion]);
  }
  return [...groups].map(([label, items]) => ({ label, items }));
}

/** Recipe 1.2 move line: the current and new times, so the shift reads at a glance. */
export function briefingMoveText(option: BriefingPlanOption, timezone: string, overlapsTravel = false): string {
  const range = (interval: Readonly<{ startAt: string; endAt: string }>) => `${formatBriefingTime(interval.startAt, timezone)}–${formatBriefingTime(interval.endAt, timezone)}`;
  return `${range(option.intervals.current)} → ${range(option.intervals.proposed)}${overlapsTravel ? ". This time overlaps planned travel." : ""}`;
}

/** A recipe 1.2 quiet day can leave nothing to show; the bubble then stays hidden. */
export function isEmptyBriefing(briefing: Pick<DailyBriefing, "text" | "suggestions" | "tip">): boolean {
  return !briefing.text.trim() && !briefing.suggestions?.length && !briefing.tip;
}

const NAME_CHARACTER = /[\p{L}\p{N}]/u;

function nameAt(text: string, index: number, name: string): boolean {
  return text.startsWith(name, index) &&
    !(index > 0 && NAME_CHARACTER.test(text[index - 1]!)) &&
    !(index + name.length < text.length && NAME_CHARACTER.test(text[index + name.length]!));
}

/** Behavior titles that the bubble would highlight in any of the texts, longest first. */
export function briefingBehaviorNames(titles: readonly string[], texts: readonly string[]): string[] {
  const unique = [...new Set(titles.map((title) => title.trim()).filter(Boolean))];
  const found = new Set(texts.flatMap((text) => briefingTextSegments(text, unique).filter((segment) => segment.behavior).map((segment) => segment.text)));
  return [...found].sort((left, right) => right.length - left.length || left.localeCompare(right));
}

/** Splits text so known Behavior names can be highlighted. Longer names win over names they contain. */
export function briefingTextSegments(text: string, names: readonly string[] | undefined): Readonly<{ text: string; behavior: boolean }>[] {
  const ordered = [...(names ?? [])].filter(Boolean).sort((left, right) => right.length - left.length);
  const segments: { text: string; behavior: boolean }[] = [];
  let plain = "";
  for (let index = 0; index < text.length;) {
    const name = ordered.find((item) => nameAt(text, index, item));
    if (name) {
      if (plain) segments.push({ text: plain, behavior: false });
      segments.push({ text: name, behavior: true });
      plain = "";
      index += name.length;
    } else {
      plain += text[index];
      index += 1;
    }
  }
  if (plain) segments.push({ text: plain, behavior: false });
  return segments;
}

export function briefingTipLabel(tip: NonNullable<DailyBriefing["tip"]>): string {
  return tip.category === "logging" ? "Logging tip" : tip.category === "setup" ? "Setup tip" : "Pattern tip";
}

export function briefingReferenceLabels(references: readonly BriefingReference[] | undefined, referenceIds: readonly string[]): string[] {
  return referenceIds.flatMap((id) => {
    const source = references?.find((item) => item.id === id);
    return source ? [briefingReferenceLabel(source)] : [];
  });
}

export function briefingReferenceLabel(source: BriefingReference): string {
  return `${source.title} (${source.kind.replaceAll("_", " ")})`;
}

export function briefingTipEvidence(basis: string, limitation: string | null): string {
  return `${basis}${limitation ? ` ${limitation}` : ""}`;
}

/** Text displayed by the workbench bubble, in reading order. The bench has no travel input. */
export function visibleDailyBriefText(briefing: DailyBriefing): string {
  const lanes = isLaneBriefing(briefing);
  const parts = ["Daily Brief", ...(briefing.text.trim() || !lanes ? [briefing.text] : [])];
  if (lanes) {
    for (const group of briefingSuggestionGroups(briefing.suggestions)) {
      parts.push(group.label);
      for (const suggestion of group.items) {
        parts.push(suggestion.option ? `${suggestion.behavior ? `${suggestion.behavior}: ` : ""}${briefingMoveText(suggestion.option, briefing.timezone)}` : suggestion.text);
      }
    }
  }
  for (const suggestion of lanes ? [] : briefing.suggestions ?? []) {
    parts.push(suggestion.text);
    if (suggestion.option) parts.push(briefingOptionText(suggestion.option, briefing.timezone, false, isPlainBriefing(briefing)));
    const sources = briefingReferenceLabels(briefing.references, suggestion.referenceIds);
    if (sources.length) parts.push(`Sources: ${sources.join(" ")}`);
  }
  if (briefing.tip) parts.push(briefingTipLabel(briefing.tip), briefing.tip.text, briefingTipEvidence(briefing.tip.basis, briefing.tip.limitation));
  parts.push(`Generated ${formatBriefingTime(briefing.generatedAt, briefing.timezone)}.`);
  if (briefing.warnings.length) parts.push(briefing.warnings.join(" "));
  return parts.join("\n");
}
