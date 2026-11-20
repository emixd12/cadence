"use client";

import { Fragment } from "react";
import { useDevelopmentBuild } from "@cadence/ui/runtime";
import type { DailyBriefing } from "@cadence/core/types/daily-brief";
import { overlapsTravelSpans, type BriefTravelGuidance, type BriefTravelGuidanceItem } from "@cadence/core/services/brief-travel-guidance";
import { briefingMoveText, briefingOptionText, briefingReferenceLabel, briefingSuggestionGroups, briefingTextSegments, briefingTipEvidence, briefingTipLabel, formatBriefingTime, isEmptyBriefing, isLaneBriefing, isPlainBriefing } from "@cadence/core/services/daily-brief-presentation";
import { OPEN_METEO_ATTRIBUTION } from "@cadence/core/resolvers/weather-margin.resolver";
import { departureBriefFooterPhrase, departurePhraseContext } from "@cadence/core/services/departure-phrases";
import { TravelWeatherCredit, travelWeatherMarginText, travelWeatherStateText } from "@/components/timeline/TravelWeather";
import type { DailyBriefPlanUsage } from "@/lib/ui/daily-brief";
import { ContinueWithChatGptButton } from "./ChatGptPlanCard";
import type { NoticeId, NoticeParams } from "@cadence/core/notices";
import { AlertNotice } from "@/components/feedback/AlertNotice";
import { Notice } from "@/components/feedback/Notice";
import type { BriefPlanningContext } from "@cadence/core/types/brief-moves";
import type { BriefMoveClient } from "@/lib/ui/daily-brief-moves";
import { BriefMoveLines } from "./BriefMoveLines";

type DailyBriefBubbleProps = Readonly<{
  state: "loading" | "ready" | "error";
  briefing?: DailyBriefing;
  message?: string;
  /** The message's notice, so it shows in its style. Without it, `message` shows as plain text. */
  messageNotice?: Readonly<{ id: NoticeId; params?: NoticeParams }>;
  onDismiss: () => void;
  onRetry?: () => void;
  retryLabel?: string;
  /** Keeps the control in place while the server's retry timing has not passed. */
  retryDisabled?: boolean;
  /** Deterministic travel guidance from the Timeline (Ticket 170); never model text. */
  travel?: BriefTravelGuidance | null;
  /** Ticket 299: the primary recovery action of a notice, such as Manage usage; the retry stays secondary. */
  action?: Readonly<{ label: string; onClick: () => void; chatGpt?: boolean }>;
  /** Ticket 299 (Mac only, behind its switch): how a ready brief ran on the user's ChatGPT plan. */
  plan?: Readonly<{ usage: DailyBriefPlanUsage; onManageUsage: () => void; onConnect: () => void }> | null;
  /** Advisor Phase 3: answers for the brief's move lines. Without it, lines are not shown. */
  moves?: Readonly<{ client: BriefMoveClient; planningContext: () => BriefPlanningContext }> | null;
  /** Advisor Phase 3: Refresh replaces today's brief (up to two a day; the server decides). */
  refresh?: Readonly<{ onRefresh: () => void; pending: boolean; available: boolean; error: Extract<NoticeId, `brief.refresh.${string}`> | null }> | null;
  /**
   * Advisor Phase 4 (4E, placement K): the brief sits in the advisor's panel under its
   * "Today’s brief" heading. No frame, pointer, title or Close; the panel has its own.
   */
  embedded?: boolean;
}>;

export function DailyBriefBubble({
  state,
  briefing,
  message,
  messageNotice,
  onDismiss,
  onRetry,
  retryLabel = "Try again",
  retryDisabled = false,
  travel = null,
  action,
  plan = null,
  moves = null,
  refresh = null,
  embedded = false,
}: DailyBriefBubbleProps) {
  const developmentBuild = useDevelopmentBuild();
  const ready = state === "ready" && briefing;
  const travelToday = ready && travel && travel.localDate === briefing.localDate ? travel : null;
  const weatherShown = !!travelToday?.items.some((item) => item.kind === "departure" && item.weather);
  const weatherState = travelWeatherStateText(travelToday?.weather?.state);
  // Recipe 1.2 quiet day with no tip: nothing to say, so no bubble.
  const moveLines = ready && moves && briefing.moves ? briefing.moves : null;
  if (ready && isEmptyBriefing(briefing) && !travelToday?.items.length && !moveLines?.lines.length && !moveLines?.conflicts.length) return null;
  const lanes = ready && isLaneBriefing(briefing);
  const named = (text: string) => lanes ? <NamedText text={text} names={briefing?.behaviorNames} /> : text;

  return (
    <section
      aria-label="Cadence Daily Brief"
      className={embedded ? "relative w-full" : "relative z-10 ml-auto -mt-8 w-full border border-line bg-background p-4 shadow-none motion-reduce:transition-none sm:-mt-6 sm:w-[min(40rem,100%)]"}
      data-daily-brief-state={state}
      data-daily-brief-embedded={embedded ? "" : undefined}
    >
      {embedded ? null : <>
        <span aria-hidden="true" className="absolute -top-2 right-[20%] h-4 w-4 rotate-45 border-l border-t border-line bg-background" />
        {/* Close sits on the title row only, so the brief's text uses the full width below it. */}
        {/* Buttons inherit their size (globals.css), so the row sets it for Close. */}
        <div className="flex items-baseline justify-between gap-3 text-sm">
          <p className="font-bold">Daily Brief</p>
          <button type="button" onClick={onDismiss} aria-label="Dismiss Daily Brief"
            className="-my-3 min-h-11 min-w-11 py-3 text-right text-muted-readable underline underline-offset-2 hover:text-foreground">Close</button>
        </div>
      </>}
      <div className={embedded ? "" : "max-h-[min(34rem,70dvh)] overflow-y-auto"}>
        <div className="min-w-0">
          {state === "loading" ? <Notice id="brief.preparing" className="mt-1 text-sm leading-6" /> : null}
          {ready ? <>
            {briefing.text.trim() || !lanes ? <p role="status" aria-live="polite" className="mt-1 break-words whitespace-pre-wrap text-sm leading-6 text-foreground [overflow-wrap:anywhere]">{named(briefing.text)}</p> : null}
            {moveLines ? <BriefMoveLines key={`${moveLines.runId ?? ""}:${briefing.generatedAt}`} moves={moveLines} client={moves!.client} planningContext={moves!.planningContext} /> : null}
            {!moveLines && lanes && briefing.suggestions?.length ? <div aria-label="Suggestions">
              {/* Recipe 1.2: one heading per advice type; each move is a bullet with its times only. */}
              {briefingSuggestionGroups(briefing.suggestions).map((group) => <div key={group.label} className="mt-2 border-t border-line pt-2 text-sm leading-6">
                <p className="text-xs font-bold text-muted-readable">{group.label}</p>
                <ul className="list-disc pl-5">
                  {group.items.map((suggestion, index) => <li key={index} className="break-words [overflow-wrap:anywhere]">
                    {suggestion.option ? <>{suggestion.behavior ? <><strong className={BEHAVIOR_NAME}>{suggestion.behavior}</strong>: </> : null}{briefingMoveText(suggestion.option, briefing.timezone, !!travelToday && overlapsTravelSpans(suggestion.option.intervals.proposed, travelToday.occupiedSpans))}</> : named(suggestion.text)}
                  </li>)}
                </ul>
              </div>)}
            </div> : null}
            {!moveLines && !lanes && briefing.suggestions?.length ? <ul aria-label="Suggestions" className="mt-2 space-y-2 text-sm leading-6">
              {briefing.suggestions.map((suggestion, index) => <li key={index} className="break-words [overflow-wrap:anywhere]">
                <p>{suggestion.text}</p>
                {suggestion.option ? <p className="text-xs text-muted-readable">{briefingOptionText(suggestion.option, briefing.timezone, !!travelToday && overlapsTravelSpans(suggestion.option.intervals.proposed, travelToday.occupiedSpans), isPlainBriefing(briefing))}</p> : null}
                {suggestion.referenceIds.length ? <p className="text-xs">Sources: {suggestion.referenceIds.map((id) => {
                  const source = briefing.references?.find((source) => source.id === id);
                  return source ? <Fragment key={id}><a href={source.url} target="_blank" rel="noreferrer" className="mr-2 underline">{briefingReferenceLabel(source)}</a>{" "}</Fragment> : null;
                })}</p> : null}
              </li>)}
            </ul> : null}
            {briefing.tip ? <div className="mt-3 border-t border-line pt-2" data-tip-category={briefing.tip.category ?? "pattern"}>
              <p className="text-xs font-bold text-muted-readable">{briefingTipLabel(briefing.tip)}</p>
              <p className="break-words text-sm leading-6 [overflow-wrap:anywhere]">{named(briefing.tip.text)}</p>
              {/* Recipe 1.1 nests the evidence under its tip so it reads as support, not a separate item. */}
              <p className={`text-xs leading-5 text-muted-readable ${isPlainBriefing(briefing) ? "mt-1 border-l border-line pl-3" : ""}`}>{briefingTipEvidence(briefing.tip.basis, briefing.tip.limitation)}</p>
            </div> : null}
            {/* Ticket 219: the model used Open-Meteo facts; credit them unless the travel block below already does. */}
            {briefing.attributions?.includes("open_meteo") && !(weatherShown && travelToday?.weather?.attribution)
              ? <div className="mt-2 text-xs leading-5 text-muted-readable" data-brief-weather-credit><TravelWeatherCredit attribution={OPEN_METEO_ATTRIBUTION} /></div> : null}
            {travelToday?.items.length ? <div className="mt-3 border-t border-line pt-2">
              <p className="text-xs font-bold text-muted-readable">Travel</p>
              <ul className="text-sm leading-6">
                {travelToday.items.map((item, index) => <li key={index} className="break-words [overflow-wrap:anywhere]">{travelLine(item, developmentBuild)}</li>)}
              </ul>
              <p className="text-xs leading-5 text-muted-readable">{departureBriefFooterPhrase(travelToday.attribution, travelToday.observedAt, departurePhraseContext(travelToday.observedAt, briefing.timezone))}</p>
              {weatherShown && travelToday.weather?.attribution ? <div className="text-xs leading-5 text-muted-readable"><TravelWeatherCredit attribution={travelToday.weather.attribution} /></div> : null}
              {weatherState ? <p className="text-xs leading-5 text-muted-readable">{weatherState}</p> : null}
            </div> : null}
            <p className="mt-2 text-xs leading-5 text-muted-readable">
              Generated <time dateTime={briefing.generatedAt}>{formatBriefingTime(briefing.generatedAt, briefing.timezone)}</time>.
              {refresh && refresh.available ? <>{" "}
                <button type="button" onClick={refresh.onRefresh} disabled={refresh.pending} data-brief-refresh
                  className="-my-2 inline-block py-2 underline underline-offset-2 hover:text-foreground disabled:opacity-60">
                  {refresh.pending ? "Refreshing…" : "Refresh"}
                </button>
              </> : null}
            </p>
            {refresh?.error ? <Notice id={refresh.error} className="mt-1" /> : null}
            {briefing.warnings.length ? <p className="mt-1 text-xs leading-5 text-muted-readable">{briefing.warnings.join(" ")}</p> : null}
            {briefNotices(briefing, Boolean(moves)).map((notice) => <AlertNotice key={notice.kind} kind={NOTICE_KIND[notice.kind]} variant="inline" size="compact" className="mt-1"
              label={notice.kind === "calendar_stale" ? "Calendar not current" : undefined}>{notice.text}</AlertNotice>)}
            {plan?.usage === "plan" ? <p className="mt-2 flex flex-wrap items-center gap-x-3 border-t border-line pt-2 text-xs leading-5" data-brief-plan="plan">
              <span>Using ChatGPT plan</span>
              <button type="button" onClick={plan.onManageUsage} className="min-h-11 underline">Manage usage</button>
            </p> : null}
            {plan?.usage === "plan_off" ? <div className="mt-2 border-t border-line pt-2" data-brief-plan="plan_off">
              <Notice id="brief.plan-off" className="text-xs leading-5" />
              <ContinueWithChatGptButton onClick={plan.onConnect} className="mt-2" />
            </div> : null}
          </> : null}
          {state === "error" ? <>
            {messageNotice ? <Notice id={messageNotice.id} params={messageNotice.params} announce="status" className="mt-1 text-sm leading-6" />
              : message ? <p role="status" aria-live="polite" className="mt-1 text-sm leading-6 text-muted-readable">{message}</p>
                : <Notice id="brief.unavailable" announce="status" className="mt-1 text-sm leading-6" />}
            {action || onRetry ? <div className="mt-3 flex flex-wrap gap-3">
              {action ? action.chatGpt
                ? <ContinueWithChatGptButton onClick={action.onClick} />
                : <button type="button" onClick={action.onClick} className="product-action product-action-primary min-h-11 py-2 text-sm">{action.label}</button> : null}
              {onRetry ? <button type="button" onClick={onRetry} disabled={retryDisabled} className="product-action product-action-secondary min-h-11 py-2 text-sm">{retryLabel}</button> : null}
            </div> : null}
          </> : null}
        </div>
      </div>
    </section>
  );
}

/** Product type stays at weight 400 (DESIGN.md), so a name is a compact chip: Ash Line hairline, Cold Surface fill, Ink text. */
const BEHAVIOR_NAME = "border border-line bg-surface px-1 font-normal text-foreground [box-decoration-break:clone]";

/** Recipe 1.2 highlights today's Behavior names, which Cadence lists deterministically. */
function NamedText({ text, names }: Readonly<{ text: string; names: readonly string[] | undefined }>) {
  return <>{briefingTextSegments(text, names).map((segment, index) => segment.behavior
    ? <strong key={index} className={BEHAVIOR_NAME}>{segment.text}</strong>
    : <Fragment key={index}>{segment.text}</Fragment>)}</>;
}

/** Ticket 272: the departure model's sentence. The mode advice shows in development builds only (Ticket 260). */
function travelLine(item: BriefTravelGuidanceItem, developmentBuild: boolean): string {
  return item.weather ? `${item.phrase} ${travelWeatherMarginText(item.weather, { developmentBuild })}` : item.phrase;
}

/** Advisor Phase 3 (3A2): Cadence's own notices about today's brief, read defensively for older servers. */
type BriefNotice = Readonly<{ kind: "calendar_stale" | "budget_reached" | "words_unavailable"; text: string; until?: string }>;
const NOTICE_KIND: Readonly<Record<BriefNotice["kind"], "data_stale" | "budget_reached" | "model_failed">> = {
  calendar_stale: "data_stale", budget_reached: "budget_reached", words_unavailable: "model_failed",
};
function briefNotices(briefing: DailyBriefing, movesShown: boolean): readonly BriefNotice[] {
  const notices = (briefing as DailyBriefing & { notices?: readonly BriefNotice[] }).notices ?? [];
  // The move lines already say the calendar is stale; do not say it twice.
  const lineSaysStale = movesShown && briefing.moves?.calendar === "stale";
  return notices.filter((notice) => notice.kind in NOTICE_KIND && typeof notice.text === "string" && !(lineSaysStale && notice.kind === "calendar_stale"));
}
