import { Temporal } from "@js-temporal/polyfill";
import rawLibrary from "../data/advice-library.json";
import { BRIEFING_REFERENCES } from "./briefing-references";
import {
  ADVICE_AUDIENCES,
  ADVICE_COMMON_FACTS,
  ADVICE_EVIDENCE_KINDS,
  ADVICE_EVIDENCE_STRENGTHS,
  ADVICE_SIGNAL_FACTS,
  ADVICE_SIGNAL_KINDS,
  type AdviceCard,
  type AdviceEvidence,
  type AdviceFactCondition,
  type AdviceLibrary,
  type AdviceRule,
  type AdviceSignalKind,
  type AdviceSource,
} from "../types/advice-cards";

/**
 * Parses and validates the advice library (4A). Throws `invalid_advice_library: <reason>`
 * on the first problem, so a bad content edit fails tests with a readable message.
 *
 * Sources may also be cited by the id of an active briefing reference
 * (`briefing-references.json`), which keeps the two existing references usable as card
 * sources without changing the Daily Brief's reference catalog.
 */
export function parseAdviceLibrary(value: unknown, extraSourceIds: readonly string[] = BRIEFING_REFERENCES.map((source) => source.id)): AdviceLibrary {
  const fail = (reason: string): never => { throw new Error(`invalid_advice_library: ${reason}`); };
  const record = (item: unknown, keys: readonly string[], where: string): Record<string, unknown> => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return fail(`${where} is not an object`);
    const got = Object.keys(item).sort().join();
    if (got !== [...keys].sort().join()) return fail(`${where} keys must be ${[...keys].sort().join()}, got ${got}`);
    return item as Record<string, unknown>;
  };
  const text = (item: unknown, where: string, max = 400): string => {
    if (typeof item !== "string" || !item.trim() || item !== item.trim()) return fail(`${where} must be trimmed non-empty text`);
    if (item.length > max) return fail(`${where} is longer than ${max} characters`);
    return item;
  };
  const date = (item: unknown, where: string): string => {
    const day = text(item, where);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return fail(`${where} must be YYYY-MM-DD`);
    try { Temporal.PlainDate.from(day); } catch { return fail(`${where} is not a real date`); }
    return day;
  };
  const oneOf = <T extends string>(item: unknown, options: readonly T[], where: string): T =>
    options.includes(item as T) ? (item as T) : fail(`${where} must be one of ${options.join(", ")}`);
  const id = (item: unknown, where: string): string => {
    const value = text(item, where, 64);
    return /^[a-z0-9][a-z0-9_-]{0,63}$/.test(value) ? value : fail(`${where} must be a lowercase id`);
  };
  const sentence = (item: unknown, where: string, max = 240): string => {
    const value = text(item, where, max);
    return /[.?!]$/.test(value) ? value : fail(`${where} must end with a full stop`);
  };

  const library = record(value, ["version", "sources", "cards"], "library");
  const version = text(library.version, "version", 64);
  if (!Array.isArray(library.sources) || !Array.isArray(library.cards)) return fail("sources and cards must be arrays");

  const sourceIds = new Set<string>();
  const sources = library.sources.map((item, index): AdviceSource => {
    const where = `sources[${index}]`;
    const source = record(item, ["id", "citation", "url", "doi", "year", "kind", "checked_at"], where);
    const sourceId = id(source.id, `${where}.id`);
    if (sourceIds.has(sourceId) || extraSourceIds.includes(sourceId)) fail(`${where}.id ${sourceId} is not unique`);
    sourceIds.add(sourceId);
    const url = text(source.url, `${where}.url`);
    if (!/^https:\/\/[^\s]+$/.test(url)) fail(`${where}.url must be https`);
    const doi = source.doi === null ? null : text(source.doi, `${where}.doi`);
    if (doi !== null && !/^10\.\d{4,9}\/\S+$/.test(doi)) fail(`${where}.doi is not a DOI`);
    if (doi !== null && url !== `https://doi.org/${doi}`) fail(`${where}.url must be the DOI link`);
    const year = source.year === null ? null : source.year;
    if (year !== null && (typeof year !== "number" || !Number.isInteger(year) || year < 1900 || year > 2100)) fail(`${where}.year is invalid`);
    return {
      id: sourceId, citation: text(source.citation, `${where}.citation`), url, doi, year: year as number | null,
      kind: oneOf(source.kind, ADVICE_EVIDENCE_KINDS, `${where}.kind`), checked_at: date(source.checked_at, `${where}.checked_at`),
    };
  });

  const condition = (item: unknown, kind: AdviceSignalKind, where: string): AdviceFactCondition => {
    const raw = record(item, ["fact", "op", "value"], where);
    const fact = text(raw.fact, `${where}.fact`, 64);
    if (!allowedFacts(kind).includes(fact)) fail(`${where}.fact ${fact} is not a ${kind} fact`);
    const op = oneOf(raw.op, ["eq", "ne", "gt", "gte", "lt", "lte", "in"] as const, `${where}.op`);
    const scalar = (v: unknown) => typeof v === "string" || (typeof v === "number" && Number.isFinite(v)) || typeof v === "boolean";
    if (op === "in") {
      if (!Array.isArray(raw.value) || raw.value.length === 0 || !raw.value.every((v) => typeof v === "string" || typeof v === "number")) fail(`${where}.value must be a list for "in"`);
    } else if (["gt", "gte", "lt", "lte"].includes(op)) {
      if (typeof raw.value !== "number" || !Number.isFinite(raw.value)) fail(`${where}.value must be a number for "${op}"`);
    } else if (!scalar(raw.value)) fail(`${where}.value must be a string, number or boolean`);
    return { fact, op, value: raw.value as AdviceFactCondition["value"] };
  };
  const rules = (item: unknown, where: string, allowEmpty: boolean): AdviceRule[] => {
    if (!Array.isArray(item) || (!allowEmpty && item.length === 0)) return fail(`${where} must be ${allowEmpty ? "a list" : "a non-empty list"}`);
    return item.map((entry, index) => {
      const at = `${where}[${index}]`;
      const raw = record(entry, ["signal", "scope", "facts"], at);
      const signal = oneOf(raw.signal, ADVICE_SIGNAL_KINDS, `${at}.signal`);
      const scope = oneOf(raw.scope, ["behavior", "account", "either"] as const, `${at}.scope`);
      if (signal === "account" && scope !== "account") fail(`${at}.scope must be "account" for account facts`);
      if (!Array.isArray(raw.facts)) return fail(`${at}.facts must be a list`);
      return { signal, scope, facts: raw.facts.map((fact, f) => condition(fact, signal, `${at}.facts[${f}]`)) };
    });
  };

  const cardIds = new Set<string>();
  const cards = library.cards.map((item, index): AdviceCard => {
    const where = `cards[${index}]`;
    const raw = record(item, ["id", "revision", "status", "advice", "applies_when", "does_not_apply_when", "action", "evidence", "limitation", "quip_seeds", "audience", "reviewed_at", "reviewer"], where);
    const cardId = id(raw.id, `${where}.id`);
    if (cardIds.has(cardId)) fail(`${where}.id ${cardId} is not unique`);
    cardIds.add(cardId);
    const at = `card ${cardId}`;
    if (typeof raw.revision !== "number" || !Number.isInteger(raw.revision) || raw.revision < 1) fail(`${at}.revision must be a positive whole number`);
    const status = oneOf(raw.status, ["draft", "active", "withdrawn"] as const, `${at}.status`);
    const applies = rules(raw.applies_when, `${at}.applies_when`, false);
    const excludes = rules(raw.does_not_apply_when, `${at}.does_not_apply_when`, true);
    const ev = record(raw.evidence, ["source_id", "kind", "strength", "claim", "quote", "locator"], `${at}.evidence`);
    const sourceId = id(ev.source_id, `${at}.evidence.source_id`);
    if (!sourceIds.has(sourceId) && !extraSourceIds.includes(sourceId)) fail(`${at}.evidence.source_id ${sourceId} is not a known source`);
    const evidence: AdviceEvidence = {
      source_id: sourceId,
      kind: oneOf(ev.kind, ADVICE_EVIDENCE_KINDS, `${at}.evidence.kind`),
      strength: oneOf(ev.strength, ADVICE_EVIDENCE_STRENGTHS, `${at}.evidence.strength`),
      claim: sentence(ev.claim, `${at}.evidence.claim`, 400),
      quote: text(ev.quote, `${at}.evidence.quote`, 600),
      locator: text(ev.locator, `${at}.evidence.locator`, 120),
    };
    const source = sources.find((entry) => entry.id === sourceId);
    if (source && source.kind !== evidence.kind) fail(`${at}.evidence.kind must match its source's kind`);
    if ((evidence.strength === "product_rule") !== (evidence.kind === "editorial_guidance")) fail(`${at}: product_rule strength goes with editorial_guidance only`);
    if (!Array.isArray(raw.quip_seeds) || raw.quip_seeds.length < 2 || raw.quip_seeds.length > 3) fail(`${at}.quip_seeds must hold 2 to 3 lines`);
    const seedFacts = new Set(applies.flatMap((rule) => allowedFacts(rule.signal)));
    const quipSeeds = (raw.quip_seeds as unknown[]).map((seed, s) => {
      const line = text(seed, `${at}.quip_seeds[${s}]`, 160);
      for (const name of placeholders(line)) {
        if (name === "behavior") {
          if (!applies.some((rule) => rule.scope !== "account")) fail(`${at}.quip_seeds[${s}] uses {behavior} but no rule is Behavior-scoped`);
          continue;
        }
        if (name === "other_behavior") {
          if (!applies.some((rule) => rule.signal === "done_together" && rule.scope !== "account")) fail(`${at}.quip_seeds[${s}] uses {other_behavior}, which only Behavior-scoped done_together rules carry`);
          continue;
        }
        if (!seedFacts.has(baseFact(name))) fail(`${at}.quip_seeds[${s}] uses {${name}}, which no applies_when signal carries`);
        if (name.endsWith("_duration") && !/(hours|minutes)/.test(baseFact(name))) fail(`${at}.quip_seeds[${s}] uses {${name}}, but only _hours and _minutes facts have a duration`);
      }
      return line;
    });
    const named = quipSeeds.filter((seed) => seed.includes("{behavior}")).length;
    if (applies.some((rule) => rule.scope !== "account") && named === 0) fail(`${at}.quip_seeds need a line that starts from {behavior} for Behavior signals`);
    if (applies.some((rule) => rule.scope !== "behavior") && named === quipSeeds.length) fail(`${at}.quip_seeds need a line without {behavior} for account-wide signals`);
    const reviewedAt = raw.reviewed_at === null ? null : date(raw.reviewed_at, `${at}.reviewed_at`);
    const reviewer = raw.reviewer === null ? null : text(raw.reviewer, `${at}.reviewer`, 80);
    if (status === "active" && (reviewedAt === null || reviewer === null)) fail(`${at} is active without a review`);
    return {
      id: cardId, revision: raw.revision as number, status,
      advice: sentence(raw.advice, `${at}.advice`), applies_when: applies, does_not_apply_when: excludes,
      action: sentence(raw.action, `${at}.action`), evidence, limitation: sentence(raw.limitation, `${at}.limitation`, 400),
      quip_seeds: quipSeeds, audience: oneOf(raw.audience, ADVICE_AUDIENCES, `${at}.audience`),
      reviewed_at: reviewedAt, reviewer,
    };
  });

  return { version, sources, cards };
}

function allowedFacts(kind: AdviceSignalKind): readonly string[] {
  return kind === "account" ? ADVICE_SIGNAL_FACTS.account : [...ADVICE_SIGNAL_FACTS[kind], ...ADVICE_COMMON_FACTS];
}

/**
 * Seed placeholders: `{fact}`, a formatted `{fact_pct}`, `{fact_clock}` ("21:46" → "9:46 PM"),
 * `{fact_duration}` (a `_hours` or `_minutes` fact → "about 50 minutes"), `{weekday_name}`,
 * `{hour_label}`, `{other_behavior}` (the paired Behavior's title, done_together only), and a counted noun `{fact|item has|items have}` → "1 item has" / "3 items have".
 */
const PLACEHOLDER = /\{([a-z0-9_]+)(?:\|([^|{}]+)\|([^|{}]+))?\}/g;
const FORMATTED_SUFFIX = /_(pct|clock|duration)$/;

function placeholders(line: string): string[] {
  return [...line.matchAll(PLACEHOLDER)].map((match) => match[1]!);
}

/** `recent_rate_pct` → `recent_rate`; `weekday_name` → `weekday`; `hour_label` → `hour`. */
function baseFact(name: string): string {
  if (name === "weekday_name") return "weekday";
  if (name === "hour_label") return "hour";
  return name.replace(FORMATTED_SUFFIX, "");
}

const WEEKDAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function clockLabel(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  return `${hour % 12 === 0 ? 12 : hour % 12}:${match[2]} ${hour < 12 ? "AM" : "PM"}`;
}

function durationLabel(base: string, value: unknown): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  const minutes = base.includes("minutes") ? value : base.includes("hours") ? value * 60 : null;
  if (minutes === null) return null;
  if (minutes < 1) return "under a minute";
  if (minutes < 90) {
    const rounded = minutes < 15 ? Math.round(minutes) : Math.round(minutes / 5) * 5;
    return `about ${rounded} ${rounded === 1 ? "minute" : "minutes"}`;
  }
  const hours = Math.round(minutes / 60);
  return hours >= 48 ? `about ${Math.round(hours / 24)} days` : `about ${hours} hours`;
}

/**
 * Fills a quip seed with a Behavior title and the matched signal's facts. Returns null when
 * any placeholder has no value, so a caller never shows a half-filled line.
 */
export type QuipSeedValues = Readonly<{
  behavior?: string | null;
  /** Title of the paired Behavior (`done_together`'s `other_behavior_id`), for `{other_behavior}`. */
  otherBehavior?: string | null;
  facts: Readonly<Record<string, unknown>>;
}>;

export function fillQuipSeed(seed: string, values: QuipSeedValues): string | null {
  let missing = false;
  const filled = seed.replace(PLACEHOLDER, (_, name: string, one?: string, many?: string) => {
    const value = fillOne(name, one, many, values);
    if (value === null) { missing = true; return ""; }
    return value;
  });
  return missing ? null : filled;
}

function fillOne(name: string, one: string | undefined, many: string | undefined, values: QuipSeedValues): string | null {
  if (name === "behavior") return values.behavior || null;
  if (name === "other_behavior") return values.otherBehavior || null;
  const base = baseFact(name);
  const raw = values.facts[base];
  if (one !== undefined && many !== undefined) {
    if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
    return `${raw} ${raw === 1 ? one : many}`;
  }
  if (name === "weekday_name") {
    if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 1 || raw > 7) return null;
    return WEEKDAY_NAMES[raw - 1]!;
  }
  if (name === "hour_label") {
    if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 0 || raw > 23) return null;
    const hour12 = raw % 12 === 0 ? 12 : raw % 12;
    return `${hour12} ${raw < 12 ? "AM" : "PM"}`;
  }
  if (name.endsWith("_clock")) return clockLabel(raw);
  if (name.endsWith("_duration")) return durationLabel(base, raw);
  if (name.endsWith("_pct")) return typeof raw === "number" && Number.isFinite(raw) ? `${Math.round(raw * 100)}%` : null;
  if (typeof raw === "number" && Number.isFinite(raw)) return String(raw);
  if (typeof raw === "string" && raw) return raw;
  return null;
}

/**
 * The seeds that fit one match: lines naming the Behavior for a Behavior signal, the others
 * for an account-wide one, so a Behavior's line never reads as a claim about every item.
 */
export function quipSeedsFor(card: AdviceCard, behaviorId: string | null): readonly string[] {
  return card.quip_seeds.filter((seed) => seed.includes("{behavior}") === (behaviorId !== null));
}

const library = parseAdviceLibrary(rawLibrary);
export const ADVICE_LIBRARY_VERSION = library.version;
export const ADVICE_SOURCES: readonly AdviceSource[] = library.sources;
/** Every card, drafts included. The matcher reaches people with active cards only. */
export const ADVICE_CARDS: readonly AdviceCard[] = library.cards;

/** The source behind a card, from the library or the briefing references, for "Why this?". */
export function adviceSourceFor(card: AdviceCard): Readonly<{ citation: string; url: string; doi: string | null }> | null {
  const source = ADVICE_SOURCES.find((entry) => entry.id === card.evidence.source_id);
  if (source) return { citation: source.citation, url: source.url, doi: source.doi };
  const reference = BRIEFING_REFERENCES.find((entry) => entry.id === card.evidence.source_id && entry.status === "active");
  return reference ? { citation: reference.title, url: reference.url, doi: null } : null;
}
