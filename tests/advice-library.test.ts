import { describe, expect, it } from "vitest";

import document from "@/packages/core/src/data/advice-library.json";
import { ADVICE_CARDS, ADVICE_SOURCES, adviceSourceFor, fillQuipSeed, parseAdviceLibrary } from "@cadence/core/services/advice-library";
import { BRIEFING_REFERENCES } from "@cadence/core/services/briefing-references";
import { ADVICE_SIGNAL_FACTS, ADVICE_SIGNAL_KINDS_V1, ADVICE_SIGNAL_KINDS_V2 } from "@cadence/core/types/advice-cards";

// Advisor plan Phase 4, workstream 4A: the card schema, its validator and the shipped content.

const SOURCE = { id: "src-a", citation: "Author A (2020). Title.", url: "https://doi.org/10.1000/abc", doi: "10.1000/abc", year: 2020, kind: "meta_analysis", checked_at: "2026-11-19" };
const CARD = {
  id: "card-a", revision: 1, status: "draft",
  advice: "Plan the cue.", action: "Add a place.", limitation: "Not for everyone.",
  applies_when: [{ signal: "completion_drop", scope: "behavior", facts: [{ fact: "drop", op: "gte", value: 0.3 }] }],
  does_not_apply_when: [],
  evidence: { source_id: "src-a", kind: "meta_analysis", strength: "moderate", claim: "It helped.", quote: "It helped a lot.", locator: "Abstract" },
  quip_seeds: ["{behavior} went from {baseline_rate_pct} to {recent_rate_pct}.", "Another line."],
  audience: "any_account", reviewed_at: null, reviewer: null,
};
const lib = (cards: unknown[], sources: unknown[] = [SOURCE]) => ({ version: "t", sources, cards });

describe("parseAdviceLibrary", () => {
  it("accepts a well-formed card and the briefing references as sources", () => {
    expect(parseAdviceLibrary(lib([CARD])).cards[0]!.id).toBe("card-a");
    const onReference = { ...CARD, evidence: { ...CARD.evidence, source_id: BRIEFING_REFERENCES[0]!.id, kind: "guidance" } };
    expect(parseAdviceLibrary(lib([onReference])).cards).toHaveLength(1);
  });

  it.each([
    ["unknown key", { prompt: "x" }, "keys must be"],
    ["active without review", { status: "active" }, "active without a review"],
    ["unknown signal", { applies_when: [{ signal: "mood", scope: "behavior", facts: [] }] }, "applies_when[0].signal"],
    ["unknown fact", { applies_when: [{ signal: "completion_drop", scope: "behavior", facts: [{ fact: "title", op: "eq", value: "x" }] }] }, "not a completion_drop fact"],
    ["empty rules", { applies_when: [] }, "non-empty list"],
    ["account fact on Behavior scope", { applies_when: [{ signal: "account", scope: "behavior", facts: [] }] }, "must be \"account\""],
    ["number op with text", { applies_when: [{ signal: "completion_drop", scope: "behavior", facts: [{ fact: "drop", op: "gt", value: "x" }] }] }, "must be a number"],
    ["one seed", { quip_seeds: ["Only one."] }, "2 to 3"],
    ["seed fact not carried", { quip_seeds: ["{late_share}.", "Two."] }, "uses {late_share}"],
    ["behavior seed on account rule", { applies_when: [{ signal: "account", scope: "account", facts: [] }], quip_seeds: ["{behavior}.", "Two."] }, "uses {behavior}"],
    ["unknown source", { evidence: { ...CARD.evidence, source_id: "nope" } }, "not a known source"],
    ["kind differs from source", { evidence: { ...CARD.evidence, kind: "randomized_trial" } }, "must match its source"],
    ["product rule on research", { evidence: { ...CARD.evidence, strength: "product_rule" } }, "product_rule"],
    ["advice without full stop", { advice: "Plan the cue" }, "full stop"],
    ["bad review date", { reviewed_at: "2026-02-30" }, "real date"],
    ["duration on a count", { quip_seeds: ["{recent_completed_duration}.", "Two."] }, "have a duration"],
  ])("rejects %s", (_, change, message) => {
    expect(() => parseAdviceLibrary(lib([{ ...CARD, ...change }]))).toThrow(message);
  });

  it("rejects duplicate ids and bad sources", () => {
    expect(() => parseAdviceLibrary(lib([CARD, CARD]))).toThrow("not unique");
    expect(() => parseAdviceLibrary(lib([], [SOURCE, SOURCE]))).toThrow("not unique");
    expect(() => parseAdviceLibrary(lib([], [{ ...SOURCE, url: "https://example.com" }]))).toThrow("DOI link");
    expect(() => parseAdviceLibrary(lib([], [{ ...SOURCE, doi: "abc", url: "https://doi.org/abc" }]))).toThrow("not a DOI");
    expect(() => parseAdviceLibrary(lib([], [{ ...SOURCE, url: "http://x.org", doi: null }]))).toThrow("https");
    expect(() => parseAdviceLibrary(lib([], [{ ...SOURCE, id: BRIEFING_REFERENCES[0]!.id }]))).toThrow("not unique");
  });
});

describe("fillQuipSeed", () => {
  it("fills Behavior titles, counts, percents, weekdays and hours", () => {
    expect(fillQuipSeed("{behavior}: {recent_completed} of {recent_resolved}, {recent_rate_pct}.", { behavior: "Gym", facts: { recent_completed: 3, recent_resolved: 8, recent_rate: 0.375 } }))
      .toBe("Gym: 3 of 8, 38%.");
    expect(fillQuipSeed("{weekday_name} at {hour_label} and {hour_label}.", { facts: { weekday: 2, hour: 0 } })).toBe("Tuesday at 12 AM and 12 AM.");
    expect(fillQuipSeed("{hour_label}.", { facts: { hour: 13 } })).toBe("1 PM.");
  });

  it("agrees counted nouns with one and many", () => {
    expect(fillQuipSeed("{n|item has|items have} no place.", { facts: { n: 1 } })).toBe("1 item has no place.");
    expect(fillQuipSeed("{n|item has|items have} no place.", { facts: { n: 3 } })).toBe("3 items have no place.");
    expect(fillQuipSeed("{n|item|items}.", { facts: { n: "3" } })).toBeNull();
  });

  it("reads clock times and durations the way people say them", () => {
    expect(fillQuipSeed("{mark_time_clock}", { facts: { mark_time: "21:46" } })).toBe("9:46 PM");
    expect(fillQuipSeed("{mark_time_clock}", { facts: { mark_time: "00:05" } })).toBe("12:05 AM");
    expect(fillQuipSeed("{mark_time_clock}", { facts: { mark_time: "9pm" } })).toBeNull();
    expect(fillQuipSeed("{lag_hours_duration}", { facts: { lag_hours: 0.8 } })).toBe("about 50 minutes");
    expect(fillQuipSeed("{lag_hours_duration}", { facts: { lag_hours: 5.2 } })).toBe("about 5 hours");
    expect(fillQuipSeed("{lag_hours_duration}", { facts: { lag_hours: 60 } })).toBe("about 3 days");
    expect(fillQuipSeed("{after_minutes_duration}", { facts: { after_minutes: 1 } })).toBe("about 1 minute");
    expect(fillQuipSeed("{after_minutes_duration}", { facts: { after_minutes: 0.2 } })).toBe("under a minute");
  });

  it("returns null instead of a half-filled line", () => {
    expect(fillQuipSeed("{behavior} {x}.", { facts: { x: 1 } })).toBeNull();
    expect(fillQuipSeed("{x}.", { behavior: "Gym", facts: {} })).toBeNull();
    expect(fillQuipSeed("{weekday_name}.", { facts: { weekday: 9 } })).toBeNull();
    expect(fillQuipSeed("{rate_pct}.", { facts: { rate: "high" } })).toBeNull();
  });
});

describe("shipped advice library", () => {
  it("parses", () => {
    expect(parseAdviceLibrary(document).cards).toEqual(ADVICE_CARDS);
  });

  it("gives every source a DOI or a working https link, and every card a source", () => {
    for (const source of ADVICE_SOURCES) expect(source.url).toMatch(/^https:\/\//);
    for (const card of ADVICE_CARDS) expect(adviceSourceFor(card)).not.toBeNull();
  });

  it("covers every v2 signal and serves new accounts once content is in", () => {
    if (ADVICE_CARDS.length === 0) return;
    const covered = new Set(ADVICE_CARDS.filter((card) => card.status !== "withdrawn").flatMap((card) => card.applies_when.map((rule) => rule.signal)));
    for (const kind of [...ADVICE_SIGNAL_KINDS_V1, ...ADVICE_SIGNAL_KINDS_V2]) {
      if (kind === "brief_answers") continue;
      expect(covered, kind).toContain(kind);
    }
    expect(ADVICE_CARDS.filter((card) => card.audience === "first_two_weeks").length).toBeGreaterThanOrEqual(5);
  });
});

describe("shipped quip seeds", () => {
  // One plausible value per fact name, so every seed of every card can be filled.
  const SAMPLE: Record<string, unknown> = {
    weekday: 2, hour: 7, part_of_day: "evening", direction: "later", median_target_time: "18:30", median_mark_time: "21:10",
    pattern: "clustered", weaker_mode: "range", other_behavior_id: "b-2", recovered: true, last_moved_date: "2026-11-18",
  };
  const valueFor = (name: string) => SAMPLE[name] ?? (/(rate|share|gap|drop|change)$/.test(name) ? 0.42 : 3);

  it("fill completely from the facts their rules carry, with no leftover braces", () => {
    for (const card of ADVICE_CARDS) {
      const facts = Object.fromEntries(
        card.applies_when.flatMap((rule) => [...(ADVICE_SIGNAL_FACTS[rule.signal] ?? []), "window_days"]).map((name) => [name, valueFor(name)]),
      );
      for (const seed of card.quip_seeds) {
        const line = fillQuipSeed(seed, { behavior: "Gym", facts });
        expect(line, `${card.id}: ${seed}`).not.toBeNull();
        expect(line).not.toMatch(/[{}]/);
      }
    }
  });

  it("read correctly when every count is 1", () => {
    for (const card of ADVICE_CARDS) {
      const facts = Object.fromEntries(
        card.applies_when.flatMap((rule) => [...(ADVICE_SIGNAL_FACTS[rule.signal] ?? []), "window_days"])
          .map((name) => [name, typeof SAMPLE[name] === "string" || /(rate|share|gap|drop|change)$/.test(name) ? valueFor(name) : 1]),
      );
      for (const seed of card.quip_seeds) {
        const line = fillQuipSeed(seed, { behavior: "Gym", facts });
        expect(line, `${card.id}: ${seed}`).not.toMatch(/\b1 (items|days|weeks|marks|minutes|sessions|routines|new routines)\b|\b1 of your 1 items\b/);
      }
    }
  });

  it("keep praise and pep talk out of the seeds", () => {
    for (const card of ADVICE_CARDS) {
      for (const seed of card.quip_seeds) expect(seed, card.id).not.toMatch(/\b(great|awesome|amazing|well done|keep it up|proud|crush|you got this)\b|!/i);
    }
  });
});
