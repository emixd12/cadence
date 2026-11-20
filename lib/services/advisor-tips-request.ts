import { Temporal } from "@js-temporal/polyfill";

import { ADVICE_CARDS, adviceSourceFor } from "@cadence/core/services/advice-library";
import type { AdviceCard } from "@cadence/core/types/advice-cards";
import {
  ADVISOR_TIP_MINIMUM_SPACING_MINUTES,
  ADVISOR_RECENT_TIPS,
  ADVISOR_TIP_REACTIONS,
  type AdvisorTip,
  type AdvisorTipReaction,
  type AdvisorTipReactionResponse,
  type AdvisorTipResearch,
  type AdvisorTipsErrorCode,
  type AdvisorTipsNextResponse,
  type AdvisorTipsRecentResponse,
} from "@cadence/core/types/advisor-tips";

import { AdvisorTipsError, nextTip, reactToTip, recentTips, type TipRow } from "@/lib/db/advisor-tips.repo";
import type { AppSupabaseClient } from "@/lib/db/behaviors.repo";
import { agentCallerConfigured } from "@/lib/integrations/agent-caller";
import { readAdvisorTipsSettings, type AdvisorTipsSettings } from "./advisor-tips-settings";
import { chooseTipMatches, createHostedTipVisitPort, type TipVisitPort } from "./advisor-tips-job.service";
import { seedTips, tipItems, tipsPerDay } from "./advisor-tips-writer";
import { authenticateCalendarRequest, calendarPreflight, calendarResponse, readCalendarRequestBody } from "./google-calendar-request";
import { CalendarConnectionError } from "./google-calendar-oauth";
import { ADVICE_FIRST_WEEKS_DAYS } from "@cadence/core/resolvers/advice-matcher.resolver";

/**
 * Advisor plan Phase 4, workstream 4B step 5: the tip routes (`ADVISOR_TIP_ROUTES`).
 * Web sends its session cookie and the Mac its bearer token, as for the Daily Brief.
 * Opening the app never calls a model. A new account with no tips yet gets its first
 * tips from first-two-weeks cards, worded by the cards themselves and filled by code
 * (review call T7).
 */

export const advisorTipsPreflight = calendarPreflight;

const STATUS: Readonly<Record<AdvisorTipsErrorCode, number>> = {
  unauthenticated: 401,
  invalid_request: 400,
  tip_not_found: 404,
  advisor_unavailable: 503,
};

class TipRequestError extends Error {
  constructor(public readonly code: AdvisorTipsErrorCode) { super(code); }
}

export type TipRequestDeps = Readonly<{
  settings(client: AppSupabaseClient): Promise<AdvisorTipsSettings>;
  /** First-day tips (T7). Returns how many were written. */
  firstDay(userId: string): Promise<number>;
  cards: readonly AdviceCard[];
}>;

const hostedDeps: TipRequestDeps = {
  settings: readAdvisorTipsSettings,
  firstDay: (userId) => agentCallerConfigured() ? writeFirstDayTips(createHostedTipVisitPort(userId)) : Promise.resolve(0),
  cards: ADVICE_CARDS,
};

export async function handleNextTip(request: Request, deps: TipRequestDeps = hostedDeps): Promise<Response> {
  return respond(request, async () => {
    const caller = await authenticate(request);
    const settings = await deps.settings(caller.client);
    if (!settings.tipsOn) return { state: "none", reason: "tips_off", nextAt: null } satisfies AdvisorTipsNextResponse;
    let result = await nextTip(caller.client, ADVISOR_TIP_MINIMUM_SPACING_MINUTES);
    if (result.state === "none" && result.reason === "no_tips_today") {
      const written = await deps.firstDay(caller.userId).catch(() => 0);
      if (written > 0) result = await nextTip(caller.client, ADVISOR_TIP_MINIMUM_SPACING_MINUTES);
    }
    if (result.state === "none") return { state: "none", reason: result.reason, nextAt: result.nextAt } satisfies AdvisorTipsNextResponse;
    const tip = toAdvisorTip(result.tip, deps.cards);
    // A tip whose card left the library has nothing to show under "Why this?".
    if (!tip) return { state: "none", reason: "all_shown", nextAt: result.nextAt } satisfies AdvisorTipsNextResponse;
    return { state: "tip", tip, fresh: result.fresh, nextAt: result.nextAt } satisfies AdvisorTipsNextResponse;
  });
}

export async function handleTipReaction(request: Request, deps: TipRequestDeps = hostedDeps): Promise<Response> {
  return respond(request, async () => {
    const caller = await authenticate(request);
    const { tipId, reaction } = parseReaction(await readCalendarRequestBody(request, 2_000).catch(() => { throw new TipRequestError("invalid_request"); }));
    const row = await reactToTip(caller.client, tipId, reaction);
    if (!row) throw new TipRequestError("tip_not_found");
    const tip = toAdvisorTip(row, deps.cards);
    if (!tip) throw new TipRequestError("tip_not_found");
    return { tip } satisfies AdvisorTipReactionResponse;
  });
}

/** 4E: the panel's "Earlier" list. Tips off returns an empty list, so nothing shows. */
export async function handleRecentTips(request: Request, deps: TipRequestDeps = hostedDeps): Promise<Response> {
  return respond(request, async () => {
    const caller = await authenticate(request);
    const settings = await deps.settings(caller.client);
    if (!settings.tipsOn) return { tips: [] } satisfies AdvisorTipsRecentResponse;
    const rows = await recentTips(caller.client, ADVISOR_RECENT_TIPS.days, ADVISOR_RECENT_TIPS.limit);
    const tips = rows.map((row) => toAdvisorTip(row, deps.cards)).filter((tip): tip is AdvisorTip => tip !== null);
    return { tips } satisfies AdvisorTipsRecentResponse;
  });
}

export function toAdvisorTip(row: TipRow, cards: readonly AdviceCard[]): AdvisorTip | null {
  const card = cards.find((entry) => entry.id === row.cardId);
  if (!card) return null;
  const source = adviceSourceFor(card);
  const research: AdvisorTipResearch = {
    cardId: card.id,
    cardRevision: card.revision,
    advice: card.advice,
    action: card.action,
    claim: card.evidence.claim,
    source: { citation: source?.citation ?? "", url: source?.url ?? "", kind: card.evidence.kind },
    strength: card.evidence.strength,
    audience: card.audience,
    limitation: card.limitation,
  };
  return {
    id: row.id, localDate: row.localDate, text: row.text, behaviorId: row.behaviorId,
    shownAt: row.shownAt, reaction: row.reaction, research,
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseReaction(value: unknown): Readonly<{ tipId: string; reaction: AdvisorTipReaction }> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TipRequestError("invalid_request");
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some((key) => key !== "tipId" && key !== "reaction")) throw new TipRequestError("invalid_request");
  if (typeof body.tipId !== "string" || !UUID.test(body.tipId)) throw new TipRequestError("invalid_request");
  if (!ADVISOR_TIP_REACTIONS.includes(body.reaction as AdvisorTipReaction)) throw new TipRequestError("invalid_request");
  return { tipId: body.tipId, reaction: body.reaction as AdvisorTipReaction };
}

/**
 * First-day tips (T7): first-two-weeks cards that match the account's setup, worded by
 * their own seeds and filled by code. No model call. A run row is written only when there
 * is something to write.
 */
export async function writeFirstDayTips(port: TipVisitPort, cards: readonly AdviceCard[] = ADVICE_CARDS): Promise<number> {
  const today = Temporal.Now.plainDateISO().toString();
  // The run decides the account's real local date; this read only screens out older accounts.
  const setup = await port.setup(today);
  const firstCreated = setup.behaviors.map((b) => Temporal.Instant.from(b.createdAt).toZonedDateTimeISO(b.timezone).toPlainDate())
    .sort(Temporal.PlainDate.compare)[0];
  if (!firstCreated || firstCreated.until(Temporal.PlainDate.from(today), { largestUnit: "days" }).days >= ADVICE_FIRST_WEEKS_DAYS + 1) return 0;
  const run = await port.startRun({ trigger: "on_demand", model: null });
  try {
    const [signals, history] = await Promise.all([port.signals(run.localDate), port.history(run.localDate)]);
    const { chosen } = chooseTipMatches({
      localDate: run.localDate, signals, setup, history, cards: cards.filter((card) => card.audience === "first_two_weeks"),
      statuses: ["active"], maxPerDay: tipsPerDay(),
    });
    const outcome = seedTips(tipItems(chosen, setup.titles));
    const written = outcome.tips.length ? await port.write(run.runId, outcome.tips) : 0;
    await port.finishRun(run.runId, { outcome: "success", errorCode: null, errorReason: null, modelCalls: 0, usage: null });
    return written;
  } catch (error) {
    await port.finishRun(run.runId, { outcome: "error", errorCode: "first_day_failed", errorReason: null, modelCalls: 0, usage: null }).catch(() => undefined);
    throw error;
  }
}

async function authenticate(request: Request): Promise<Readonly<{ client: AppSupabaseClient; userId: string }>> {
  try {
    const caller = await authenticateCalendarRequest(request);
    return { client: caller.client, userId: caller.user.id };
  } catch (error) {
    if (error instanceof CalendarConnectionError && error.code === "unauthenticated") throw new TipRequestError("unauthenticated");
    throw error;
  }
}

async function respond(request: Request, run: () => Promise<unknown>): Promise<Response> {
  try {
    return calendarResponse(request, await run());
  } catch (error) {
    const code: AdvisorTipsErrorCode = error instanceof TipRequestError ? error.code
      : error instanceof CalendarConnectionError && error.code === "invalid_request" ? "invalid_request"
        : "advisor_unavailable";
    if (code === "advisor_unavailable") console.error("advisor tips request failed", error instanceof AdvisorTipsError ? error.code : error instanceof Error ? error.name : "unknown");
    return calendarResponse(request, { error: code }, STATUS[code]);
  }
}
