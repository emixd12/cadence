import type { BriefingReference } from "./briefing-references";
import type { BriefingPlanOption } from "../types/briefing-plan";
import type { DailyBriefing } from "../types/daily-brief";

export function formatBriefingTime(value: string, timezone: string): string {
  const date = new Date(value);
  // Fixed locale and the briefing's timezone keep rendered and server-validated text reproducible.
  return Number.isNaN(date.getTime()) ? "recently" : date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: timezone });
}

export function briefingOptionText(option: BriefingPlanOption, timezone: string, overlapsTravel = false): string {
  return `Hypothetical option: ${formatBriefingTime(option.intervals.proposed.startAt, timezone)}–${formatBriefingTime(option.intervals.proposed.endAt, timezone)} (${timezone}). No change applied.${overlapsTravel ? " This time overlaps planned travel." : ""}`;
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
  const parts = ["Daily Brief", briefing.text];
  for (const suggestion of briefing.suggestions ?? []) {
    parts.push(suggestion.text);
    if (suggestion.option) parts.push(briefingOptionText(suggestion.option, briefing.timezone));
    const sources = briefingReferenceLabels(briefing.references, suggestion.referenceIds);
    if (sources.length) parts.push(`Sources: ${sources.join(" ")}`);
  }
  if (briefing.tip) parts.push("Pattern tip", briefing.tip.text, briefingTipEvidence(briefing.tip.basis, briefing.tip.limitation));
  parts.push(`Generated ${formatBriefingTime(briefing.generatedAt, briefing.timezone)}.`);
  if (briefing.warnings.length) parts.push(briefing.warnings.join(" "));
  return parts.join("\n");
}
