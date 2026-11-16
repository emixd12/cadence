import Ajv from "ajv";
import { Temporal } from "@js-temporal/polyfill";
import type { DailyBriefValidationData } from "../daily-brief-consumer";
import { DAILY_BRIEF_SCHEMA } from "../daily-brief-schema";

/**
 * Phase 1B eval harness, layer 1: rule checks with no model. They run on the
 * planner's offered moves and on the moves the model picked, so a failure says
 * which side broke the rule.
 */
export const LAYER_ONE_RULES = ["schema", "declined_move_reoffered", "proposals_collide", "proposal_hits_busy_time", "proposal_leaves_day", "proposal_in_past"] as const;
export type LayerOneRule = typeof LAYER_ONE_RULES[number];

export type LayerOneViolation = Readonly<{
  rule: LayerOneRule;
  /** `planner` for an offered move, `model` for the brief's own output. */
  source: "planner" | "model";
  detail: string;
}>;

type Option = DailyBriefValidationData["offeredOptions"][number];
type Interval = Readonly<{ startAt: string; endAt: string }>;

const validateSchema = new Ajv({ allErrors: true, strict: false }).compile(DAILY_BRIEF_SCHEMA);

export function checkSchema(output: unknown): LayerOneViolation[] {
  if (validateSchema(output)) return [];
  return [{ rule: "schema", source: "model", detail: (validateSchema.errors ?? []).map((error) => `${error.instancePath || "/"} ${error.message}`).slice(0, 3).join("; ") }];
}

export type LayerOneInput = Readonly<{
  /** Raw model output, before Cadence's validator runs. `undefined` checks the planner only. */
  output?: unknown;
  validation: DailyBriefValidationData;
  declinedMoves: readonly Readonly<{ occurrenceRef: string; proposedStartAt: string }>[];
  /** Busy intervals that a move must not land on (calendar events marked busy). */
  busy: readonly (Interval & Readonly<{ ref: string }>)[];
  dayStartAt: string;
  dayEndAt: string;
}>;

export function checkLayerOne(input: LayerOneInput): LayerOneViolation[] {
  const violations: LayerOneViolation[] = input.output === undefined ? [] : checkSchema(input.output);
  violations.push(...checkMoves("planner", input.validation.offeredOptions, input));
  const picked = pickedOptions(input.output, input.validation.offeredOptions);
  violations.push(...checkMoves("model", picked, input));
  return violations;
}

/** Options the model selected by id. Unknown ids are the validator's job, not a layer 1 rule. */
export function pickedOptions(output: unknown, offered: readonly Option[]): Option[] {
  if (!output || typeof output !== "object" || !Array.isArray((output as { suggestions?: unknown }).suggestions)) return [];
  return ((output as { suggestions: unknown[] }).suggestions).flatMap((item) => {
    const id = item && typeof item === "object" ? (item as { optionId?: unknown }).optionId : null;
    const option = typeof id === "string" ? offered.find((candidate) => candidate.id === id) : undefined;
    return option ? [option] : [];
  });
}

function checkMoves(source: LayerOneViolation["source"], options: readonly Option[], input: LayerOneInput): LayerOneViolation[] {
  const violations: LayerOneViolation[] = [];
  const proposed = options.flatMap((option) => {
    const interval = option.intervals.proposed;
    return interval.kind === "timed" ? [{ option, startAt: interval.startAt, endAt: interval.endAt }] : [];
  });
  for (const move of proposed) {
    const declined = input.declinedMoves.find((item) => item.occurrenceRef === move.option.occurrenceRef && same(item.proposedStartAt, move.startAt));
    if (declined) violations.push({ rule: "declined_move_reoffered", source, detail: `${move.option.id} re-offers a declined move of ${move.option.occurrenceRef}` });
    if (before(move.startAt, input.dayStartAt) || before(input.dayEndAt, move.endAt)) {
      violations.push({ rule: "proposal_leaves_day", source, detail: `${move.option.id} runs outside the day` });
    }
    if (before(move.startAt, input.validation.planningNow)) violations.push({ rule: "proposal_in_past", source, detail: `${move.option.id} starts before now` });
    for (const busy of input.busy) {
      if (overlaps(move, busy)) violations.push({ rule: "proposal_hits_busy_time", source, detail: `${move.option.id} overlaps ${busy.ref}` });
    }
  }
  for (let left = 0; left < proposed.length; left += 1) {
    for (let right = left + 1; right < proposed.length; right += 1) {
      const a = proposed[left];
      const b = proposed[right];
      if (a.option.occurrenceRef === b.option.occurrenceRef) {
        violations.push({ rule: "proposals_collide", source, detail: `${a.option.id} and ${b.option.id} move the same occurrence` });
      } else if (overlaps(a, b)) {
        violations.push({ rule: "proposals_collide", source, detail: `${a.option.id} and ${b.option.id} overlap` });
      }
    }
  }
  return violations;
}

function instant(value: string): Temporal.Instant {
  return Temporal.Instant.from(value);
}

function before(left: string, right: string): boolean {
  return Temporal.Instant.compare(instant(left), instant(right)) < 0;
}

function same(left: string, right: string): boolean {
  return instant(left).equals(instant(right));
}

function overlaps(a: Interval, b: Interval): boolean {
  return before(a.startAt, b.endAt) && before(b.startAt, a.endAt);
}
