import { Temporal } from "@js-temporal/polyfill";
import type { BriefingPlanOption, BriefingPlanResult } from "../types/briefing-plan";
import { formatBriefingTime } from "./daily-brief-presentation";

export type BriefingMoveReason = "time_passed" | "overlap" | "too_close";

/** Why the planner moved an occurrence: its time passed undecided, it overlaps something, or it sits too close. */
export function briefingMoveReason(option: BriefingPlanOption, plan: Pick<BriefingPlanResult, "dayEvidence">, planningNow: string): BriefingMoveReason {
  if (Temporal.Instant.compare(Temporal.Instant.from(option.intervals.current.startAt), Temporal.Instant.from(planningNow)) < 0) return "time_passed";
  return plan.dayEvidence.findings.some((finding) => finding.kind === "known_overlap" && finding.refs.occurrenceRefs.includes(option.occurrenceRef)) ? "overlap" : "too_close";
}

/**
 * Recipe 1.2 fallback overview, one plain sentence per move, used only when the model
 * returns no overview while moves are shown (owner review, October 23).
 */
export function briefingMoveOverview(input: Readonly<{
  options: readonly BriefingPlanOption[];
  plan: Pick<BriefingPlanResult, "dayEvidence">;
  planningNow: string;
  timezone: string;
  titleOf: (occurrenceRef: string) => string | null;
}>): string {
  const time = (value: string) => formatBriefingTime(value, input.timezone);
  const titled = input.options.flatMap((option) => {
    const title = input.titleOf(option.occurrenceRef);
    return title ? [{ option, title, reason: briefingMoveReason(option, input.plan, input.planningNow) }] : [];
  });
  const sentences: string[] = [];
  // Moves that share "time passed" become one sentence, so the overview does not read as a list.
  const passed = titled.filter((item) => item.reason === "time_passed");
  if (passed.length === 1) sentences.push(`${passed[0]!.title} was due at ${time(passed[0]!.option.intervals.current.startAt)} and is still open.`);
  else if (passed.length > 1) {
    const morning = passed.every((item) => Temporal.Instant.from(item.option.intervals.current.startAt).toZonedDateTimeISO(input.timezone).hour < 12);
    sentences.push(`${joinTitles(passed.map((item) => item.title))} are still open from ${morning ? "this morning" : "earlier today"}.`);
  }
  for (const { option, title } of titled.filter((item) => item.reason === "overlap")) {
    const finding = input.plan.dayEvidence.findings.find((item) => item.kind === "known_overlap" && item.refs.occurrenceRefs.includes(option.occurrenceRef));
    const minutes = finding?.kind === "known_overlap" ? Math.round(finding.interval.duration.seconds / 60) : null;
    const other = finding?.kind === "known_overlap" ? finding.participants.find((item) => item.ref !== option.occurrenceRef) : undefined;
    const otherLabel = other ? other.source === "calendar_event"
      ? `your ${time(other.interval.startAt)}–${time(other.interval.endAt)} calendar event`
      : input.titleOf(other.ref) ?? "another Behavior" : "another commitment";
    sentences.push(`${title} overlaps ${otherLabel}${minutes ? ` by ${minutes} minutes` : ""}.`);
  }
  const close = titled.filter((item) => item.reason === "too_close");
  if (close.length) sentences.push(`${joinTitles(close.map((item) => item.title))} ${close.length === 1 ? "sits" : "sit"} too close to other plans to leave time in between.`);
  return sentences.join(" ");
}

/** "A", "A and B", "A, B and C". */
function joinTitles(titles: readonly string[]): string {
  return titles.length <= 2 ? titles.join(" and ") : `${titles.slice(0, -1).join(", ")} and ${titles[titles.length - 1]}`;
}
