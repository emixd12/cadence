"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRefresh } from "@cadence/ui/runtime";
import type { BriefPlanningContext } from "@cadence/core/types/brief-moves";
import type {
  BriefOpportunities,
  BriefOpportunityAnswerRequest,
  BriefOpportunityLine,
  BriefOpportunityRefusal,
} from "@cadence/core/types/brief-opportunities";
import { noticeText } from "@cadence/core/notices";
import { AlertNotice } from "@/components/feedback/AlertNotice";
import { Notice } from "@/components/feedback/Notice";
import { moveTimeLabel, wallTime } from "@/components/timeline/OccurrenceMoves";
import type { BriefOpportunityClient } from "@/lib/ui/daily-brief-opportunities";
import { ActionLink, BriefOutcome, Dot, LINK, newKey, pickedInstant, requestRefusal } from "./BriefMoveLines";

/**
 * Behaviors of Opportunity (Task 7): the brief's "Add for today" lines, in the move
 * lines' text style. Yes adds the Behavior to today at the line's time; Other time picks
 * another free time; No stops suggestions for it today; Undo removes the added item.
 * Every answer is checked again on the server; a refusal shows under its line.
 */

export type BriefOpportunityLinesProps = Readonly<{
  opportunities: BriefOpportunities;
  client: BriefOpportunityClient;
  planningContext: () => BriefPlanningContext;
}>;

type LineUi = Readonly<{
  pending?: boolean;
  refusal?: BriefOpportunityRefusal | null;
  panel?: "other_time" | null;
  /** Answered in this page session: keep the line to show what happened. */
  answered?: boolean;
  neverAdded?: boolean;
}>;

/** Answers given in this page session, per brief (see BriefMoveLines). */
const answeredByBrief = new WeakMap<BriefOpportunities, Readonly<{ opportunities: BriefOpportunities; ui: Readonly<Record<string, LineUi>> }>>();

export function BriefOpportunityLines({ opportunities: initial, client, planningContext }: BriefOpportunityLinesProps) {
  const refresh = useRefresh();
  const [restored] = useState(() => answeredByBrief.get(initial));
  const [opportunities, setOpportunities] = useState(restored?.opportunities ?? initial);
  const [ui, setUi] = useState<Readonly<Record<string, LineUi>>>(restored?.ui ?? {});
  const linesRef = useRef(opportunities.lines);
  useEffect(() => { linesRef.current = opportunities.lines; }, [opportunities]);
  useEffect(() => {
    answeredByBrief.set(initial, { opportunities, ui: Object.fromEntries(Object.entries(ui).map(([id, line]) => [id, { ...line, pending: false, panel: null }])) });
  }, [initial, opportunities, ui]);

  const patchUi = useCallback((proposalId: string, patch: LineUi) => {
    setUi((current) => ({ ...current, [proposalId]: { ...current[proposalId], ...patch } }));
  }, []);
  const replaceLine = useCallback((proposalId: string, line: BriefOpportunityLine | null) => {
    setOpportunities((current) => ({
      ...current,
      lines: line ? current.lines.map((existing) => existing.proposalId === proposalId ? line : existing)
        : current.lines.filter((existing) => existing.proposalId !== proposalId),
    }));
  }, []);

  // Re-check on open: a line whose time was taken after the brief arrives re-planned.
  useEffect(() => {
    const open = linesRef.current.filter((line) => line.status === "proposed");
    if (!open.length) return;
    const controller = new AbortController();
    client.recheck({ localDate: initial.localDate, context: planningContext(), proposalIds: open.map((line) => line.proposalId) }, controller.signal)
      .then((response) => {
        if (controller.signal.aborted) return;
        for (const entry of response.replaced) replaceLine(entry.proposalId, entry.line);
      })
      .catch(() => undefined);
    return () => controller.abort();
    // Once per mount: the bubble remounts this component on every open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const answer = async (line: BriefOpportunityLine, request: BriefOpportunityAnswerRequest) => {
    patchUi(line.proposalId, { pending: true, refusal: null });
    try {
      const response = await client.answer(request);
      if (response.line) replaceLine(line.proposalId, response.line);
      if (response.outcome === "refused") {
        patchUi(line.proposalId, { refusal: response.refusal });
        return;
      }
      patchUi(line.proposalId, { panel: null, answered: true, ...(request.kind === "never_add" ? { neverAdded: true } : {}) });
      if (response.occurrenceId) refresh();
    } catch (error) {
      patchUi(line.proposalId, { refusal: requestRefusal(error) });
    } finally {
      patchUi(line.proposalId, { pending: false });
    }
  };

  const replan = async (line: BriefOpportunityLine) => {
    patchUi(line.proposalId, { pending: true, refusal: null });
    try {
      const response = await client.replan({ opportunityProposalId: line.proposalId, context: planningContext() });
      if (response.line) {
        replaceLine(line.proposalId, response.line);
        patchUi(line.proposalId, { panel: null });
      } else {
        patchUi(line.proposalId, { refusal: { reason: "no_time", message: noticeText("brief-opportunity.no-time-fits"), alternatives: [] } });
      }
    } catch (error) {
      patchUi(line.proposalId, { refusal: requestRefusal(error) });
    } finally {
      patchUi(line.proposalId, { pending: false });
    }
  };

  const base = (line: BriefOpportunityLine) => ({ target: "opportunity" as const, proposalId: line.proposalId, idempotencyKey: newKey() });
  const shown = opportunities.lines.filter((line) => line.status !== "superseded" && line.status !== "withdrawn"
    && !((line.status === "declined" || line.status === "undone") && !line.offerNeverAdd && !ui[line.proposalId]?.answered && !ui[line.proposalId]?.refusal));
  if (!shown.length) return null;

  return (
    <div className="mt-3 border-t border-line pt-2" data-brief-opportunities>
      <p className="text-xs font-bold text-muted-readable">Add for today</p>
      <ul className="grid gap-3">
        {shown.map((line) => <OpportunityLine
          key={line.proposalId}
          line={line}
          ui={ui[line.proposalId] ?? {}}
          onYes={() => void answer(line, { ...base(line), kind: "yes", context: planningContext() })}
          onNo={() => void answer(line, { ...base(line), kind: "no" })}
          onOtherTime={(startAt) => void answer(line, { ...base(line), kind: "other_time", startAt, context: planningContext() })}
          onUndo={() => void answer(line, { ...base(line), kind: "undo" })}
          onNeverAdd={() => void answer(line, { ...base(line), kind: "never_add" })}
          onReplan={() => void replan(line)}
          onPanel={(panel) => patchUi(line.proposalId, { panel, refusal: null })}
        />)}
      </ul>
    </div>
  );
}

type OpportunityLineProps = Readonly<{
  line: BriefOpportunityLine;
  ui: LineUi;
  onYes: () => void;
  onNo: () => void;
  onOtherTime: (startAt: string) => void;
  onUndo: () => void;
  onNeverAdd: () => void;
  onReplan: () => void;
  onPanel: (panel: LineUi["panel"]) => void;
}>;

function OpportunityLine({ line, ui, onYes, onNo, onOtherTime, onUndo, onNeverAdd, onReplan, onPanel }: OpportunityLineProps) {
  const at = moveTimeLabel(line.at.startAt, line.timezone);
  const added = (line.status === "accepted" || line.status === "other_time") && !!line.occurrenceId;
  const declined = line.status === "declined" || line.status === "undone";
  const pending = !!ui.pending;
  const neverAddLink = <ActionLink label="Don’t suggest adding this" disabled={pending} onClick={onNeverAdd} />;
  return (
    <li className="break-words text-sm leading-6 [overflow-wrap:anywhere]"
      data-brief-opportunity-line={line.proposalId} data-brief-opportunity-status={line.status}>
      <p data-brief-opportunity-head>
        <span className="font-bold">{line.title}</span>{" "}
        <span className="whitespace-nowrap tabular-nums">{at}</span>:{" "}
        {noticeText("brief-opportunity.reason", reasonParams(line))}
      </p>
      {line.status === "proposed" && line.travel === "not_checked"
        ? <Notice id="brief-opportunity.travel-not-checked" className="text-xs leading-5" /> : null}
      {line.status === "proposed" ? <p data-brief-opportunity-actions>
        <ActionLink label="Yes" strong disabled={pending} onClick={onYes} />
        <Dot /><ActionLink label="No" disabled={pending} onClick={onNo} />
        <Dot /><ActionLink label="Other time" disabled={pending} onClick={() => onPanel(ui.panel === "other_time" ? null : "other_time")} expanded={ui.panel === "other_time"} />
        {line.offerNeverAdd ? <><Dot />{neverAddLink}</> : null}
      </p> : <BriefOutcome>
        {added ? <>{noticeText("brief-opportunity.added", { time: moveTimeLabel(line.appliedAt?.startAt ?? line.at.startAt, line.timezone) })}{" "}
          <span className="not-italic"><ActionLink label="Undo" disabled={pending} onClick={onUndo} /></span></> : null}
        {line.status === "undone" ? noticeText("brief-opportunity.undone") : null}
        {line.status === "declined" && !ui.neverAdded ? noticeText("brief-opportunity.declined") : null}
        {ui.neverAdded ? noticeText("brief-opportunity.never-add", { title: line.title }) : null}
        {!ui.neverAdded && line.offerNeverAdd && declined ? <> <span className="not-italic">{neverAddLink}</span></> : null}
      </BriefOutcome>}
      {ui.panel === "other_time" && line.status === "proposed" ? <OtherTimePanel line={line} pending={pending} onPick={onOtherTime} onReplan={onReplan} /> : null}
      {ui.refusal ? <AlertNotice kind="write_refused" variant="inline" size="compact" className="mt-1"
        action={ui.refusal.alternatives.length ? <span>Free:{" "}{ui.refusal.alternatives.map((instant, index) => <span key={instant} className="whitespace-nowrap">
          {index ? " · " : ""}<button type="button" className={LINK} disabled={pending} onClick={() => onOtherTime(instant)}>{moveTimeLabel(instant, line.timezone)}</button>
        </span>)}</span> : undefined}>
        {ui.refusal.message}
      </AlertNotice> : null}
    </li>
  );
}

function OtherTimePanel({ line, pending, onPick, onReplan }: Readonly<{
  line: BriefOpportunityLine;
  pending: boolean;
  onPick: (startAt: string) => void;
  onReplan: () => void;
}>) {
  const [time, setTime] = useState(() => wallTime(line.at.startAt, line.timezone));
  const picked = pickedInstant(line, time);
  return (
    <div className="mt-1 grid gap-1 border-l border-line pl-3 text-sm leading-6" data-brief-opportunity-other-time>
      {line.otherTimes.length ? <p>
        <span>Free today: </span>
        {line.otherTimes.map((instant, index) => <span key={instant} className="whitespace-nowrap">
          {index ? " · " : ""}<button type="button" className={LINK} disabled={pending} onClick={() => onPick(instant)}>{moveTimeLabel(instant, line.timezone)}</button>
        </span>)}
      </p> : <Notice id="brief-moves.no-other-free-time" />}
      <p className="flex flex-wrap items-center gap-x-2">
        <label htmlFor={`brief-opportunity-time-${line.proposalId}`}>Or pick a time</label>
        <input id={`brief-opportunity-time-${line.proposalId}`} type="time" step={300} value={time} onChange={(event) => setTime(event.target.value)}
          className="min-h-11 border-0 border-b border-line bg-transparent px-0 py-1 text-sm tabular-nums focus:border-foreground focus:outline-none sm:min-h-9" />
        <button type="button" className={LINK} disabled={pending || !picked} onClick={() => picked && onPick(picked)}>Add</button>
      </p>
      <p><button type="button" className={LINK} disabled={pending} onClick={onReplan}>Re-plan</button></p>
    </div>
  );
}

function reasonParams(line: BriefOpportunityLine) {
  const days = line.daysSinceLastCompleted;
  const last = days === null ? "never" : days === 0 ? "today" : days === 1 ? "yesterday" : "days";
  return { minutes: line.length.minutes, last, days: days ?? 0 };
}
