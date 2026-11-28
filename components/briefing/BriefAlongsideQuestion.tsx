"use client";

import { useEffect, useState } from "react";
import { useRefresh } from "@cadence/ui/runtime";
import { noticeText } from "@cadence/core/notices";
import type { BriefAlongsideQuestion as BriefAlongsideQuestionData } from "@cadence/core/types/brief-alongside";
import { AlertNotice } from "@/components/feedback/AlertNotice";
import type { BriefAlongsideClient } from "@/lib/ui/daily-brief-alongside";
import { DailyBriefRequestError } from "@/lib/ui/daily-brief";
import { ActionLink, BriefOutcome, Dot } from "./BriefMoveLines";

/**
 * Ticket 360 (D33): the brief's one alongside question, in the move lines' text style:
 * "Can Red light helmet be done alongside other things? Yes · No". No typing. Either
 * answer is the Behavior's own setting; the server writes it and the Timeline redraws.
 * The server sends the line only while the question is open, so the component holds no
 * rule of its own.
 */

/** `already`: the Behavior held the other answer, made elsewhere; `answered` is that stored answer. */
type QuestionUi = Readonly<{ pending?: boolean; answered?: boolean | null; already?: boolean; refusal?: string | null }>;

/** Answers given in this page session, per brief, so a remount keeps the outcome. */
const answeredByQuestion = new WeakMap<BriefAlongsideQuestionData, QuestionUi>();

export function BriefAlongsideQuestion({ question, client }: Readonly<{ question: BriefAlongsideQuestionData; client: BriefAlongsideClient }>) {
  const refresh = useRefresh();
  const [ui, setUi] = useState<QuestionUi>(() => answeredByQuestion.get(question) ?? {});
  useEffect(() => { answeredByQuestion.set(question, { ...ui, pending: false }); }, [question, ui]);

  const answer = async (alongside: boolean) => {
    setUi({ pending: true, refusal: null });
    try {
      const response = await client.answer({ behaviorId: question.behaviorId, alongside });
      setUi(response.alreadyAnswered ? { answered: response.alongside, already: true } : { answered: alongside });
      refresh();
    } catch (error) {
      setUi({ refusal: refusalText(error) });
    }
  };

  const pending = !!ui.pending;
  const answered = typeof ui.answered === "boolean";
  return (
    <div className="mt-3 border-t border-line pt-2 text-sm leading-6" data-brief-alongside-question={question.behaviorId}>
      <p className="break-words [overflow-wrap:anywhere]">{noticeText("alongside.brief-question", { title: question.title })}</p>
      {answered ? <BriefOutcome>{noticeText(ui.already ? "alongside.answer-already" : "alongside.answer-saved", { answer: ui.answered ? "yes" : "no" })}</BriefOutcome> : <p data-brief-alongside-actions>
        <ActionLink label="Yes" strong disabled={pending} onClick={() => void answer(true)} />
        <Dot /><ActionLink label="No" disabled={pending} onClick={() => void answer(false)} />
      </p>}
      {ui.refusal ? <AlertNotice kind="write_refused" variant="inline" size="compact" className="mt-1">{ui.refusal}</AlertNotice> : null}
    </div>
  );
}

function refusalText(error: unknown): string {
  const code = error instanceof DailyBriefRequestError ? error.code : null;
  return noticeText(code === "offline" ? "brief-moves.request.offline"
    : code === "timeout" ? "brief-moves.request.timeout"
      : code === "proposal_not_found" ? "alongside.answer-not-found"
        : code === "revision_changed" ? "alongside.answer-changed"
          : "alongside.answer-unavailable");
}
