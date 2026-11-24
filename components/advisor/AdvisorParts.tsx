"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ADVISOR_RECENT_TIPS, type AdvisorTip, type AdvisorTipReaction, type AdvisorTipResearch } from "@cadence/core/types/advisor-tips";
import type { ScheduleProposalAnswer, ScheduleProposalView } from "@cadence/core/types/behavior-change-proposals";

import {
  TIP_REACTION_OUTCOME,
  audienceLabel,
  briefLineText,
  evidenceKindLabel,
  evidenceStrengthLabel,
  proposalShortLine,
} from "@/lib/ui/advisor";
import { AlertNotice } from "@/components/feedback/AlertNotice";
import { AdvisorAvatar } from "./AdvisorAvatar";
import { useAdvisor, useAdvisorBriefTarget } from "./AdvisorProvider";

/**
 * Advisor plan Phase 4 (4E), placement K: the window horse at the top, the one line
 * under today's date and the advisor panel. Text-like per DESIGN.md: actions are
 * underlined text, outcomes italic, small notes grey, errors one red line.
 */

const LINK = "underline underline-offset-2 disabled:no-underline disabled:opacity-60";
/** Global anchor styles win over utility classes, so links set their underline inline. */
const ANCHOR_STYLE = { textDecoration: "underline", textUnderlineOffset: 2 } as const;

/**
 * The round "window" avatar: the whole head shows and the neck runs out of the bottom, so it never looks cropped.
 * Its state and gesture come from the advisor (`advisor-avatar.resolver`); outside an advisor it rests.
 */
export function AdvisorHorse({ size }: Readonly<{ size: number }>) {
  const avatar = useAdvisor()?.avatar;
  return <AdvisorAvatar size={size} state={avatar?.state} gesture={avatar?.gesture} />;
}

/**
 * Top centre of the page, staying there on scroll: 48px on desktop and the Mac, 40px in
 * the middle of the phone top bar. "Advisor · 1 new" when something waits.
 */
export function AdvisorWindow() {
  const advisor = useAdvisor();
  if (!advisor) return null;
  const { hasNew, panelOpen, openPanel, closePanel } = advisor;
  const label = hasNew ? "Advisor · 1 new" : "Advisor";
  const button = (size: number) => (
    <button type="button" onClick={panelOpen ? closePanel : openPanel} aria-expanded={panelOpen}
      aria-label={hasNew ? "Open the advisor, 1 new" : panelOpen ? "Close the advisor" : "Open the advisor"}
      className="pointer-events-auto flex flex-col items-center" data-advisor-window>
      <AdvisorHorse size={size} />
      <span className="bg-background px-1 text-xs leading-4">{label}</span>
    </button>
  );
  return (
    <>
      {/* Phones and narrow windows: the middle of the top bar. */}
      <div className="pointer-events-none fixed inset-x-0 top-0.5 z-50 flex items-start justify-center lg:hidden">{button(40)}</div>
      {/* Desktop and the Mac: top centre of the page column, kept in view on scroll. */}
      <div className="pointer-events-none sticky top-3 z-30 hidden h-0 items-start justify-center overflow-visible lg:flex">{button(48)}</div>
    </>
  );
}

/** Space under the banner so the horse and its label never cover the date. */
export function AdvisorWindowSpacer() {
  return useAdvisor() ? <div aria-hidden="true" className="h-12 sm:h-14" /> : null;
}

function Dot() {
  return <span aria-hidden="true"> · </span>;
}

function Outcome({ children }: Readonly<{ children: ReactNode }>) {
  return <p className="italic text-foreground" role="status">{children}</p>;
}

function ErrorLine({ text }: Readonly<{ text: string | null }>) {
  return text ? <AlertNotice kind="write_refused" variant="inline" size="compact">{text}</AlertNotice> : null;
}

/** The "Why this?" research card, under the tip with a 1px left rule. */
export function ResearchCard({ research, full }: Readonly<{ research: AdvisorTipResearch; full: boolean }>) {
  const audience = audienceLabel(research.audience);
  return (
    <div className="mt-2 border-l border-line pl-3" data-advisor-card>
      <p className="text-foreground">{research.claim}</p>
      {research.source.url
        ? <p><a href={research.source.url} target="_blank" rel="noreferrer" style={ANCHOR_STYLE} className="break-words [overflow-wrap:anywhere]">{research.source.citation || research.source.url}</a></p>
        : research.source.citation ? <p>{research.source.citation}</p> : null}
      <p className="text-xs leading-5 text-muted-readable">{evidenceKindLabel(research.source.kind)} · {evidenceStrengthLabel(research.strength)}</p>
      {full && audience ? <p className="text-xs leading-5 text-muted-readable">Applies to: {audience}</p> : null}
      {full && research.limitation ? <p className="text-xs leading-5 text-muted-readable">Limitation: {research.limitation}</p> : null}
    </div>
  );
}

/** Today's tip with its links. The line offers three reactions; the panel adds "Don’t suggest this again". */
function TipBlock({ full }: Readonly<{ full: boolean }>) {
  const advisor = useAdvisor();
  const state = advisor?.tip;
  if (!advisor || !state) return null;
  const { tip, pending, error, answeredHere } = state;
  const reactions: readonly [AdvisorTipReaction, string][] = full
    ? [["helpful", "Helpful"], ["not_now", "Not now"], ["dont_suggest", "Don’t suggest this again"]]
    : [["helpful", "Helpful"], ["not_now", "Not now"]];
  const answered = tip.reaction !== null;
  return (
    <div className="text-sm leading-6" data-advisor-tip={tip.id}>
      <p className="break-words text-foreground [overflow-wrap:anywhere]">{tip.text}</p>
      {advisor.researchOpen ? <ResearchCard research={tip.research} full={full} /> : null}
      {answered && (answeredHere || tip.reaction === "helpful") ? (
        <>
          <Outcome>{TIP_REACTION_OUTCOME[tip.reaction!]}</Outcome>
          {tip.reaction === "helpful" && (tip.link || !advisor.researchOpen) ? (
            <p>
              {tip.link ? <TipLinkButton tip={tip} /> : null}
              {tip.link && !advisor.researchOpen ? <Dot /> : null}
              {!advisor.researchOpen ? <button type="button" className={LINK} onClick={advisor.toggleResearch}>Why this?</button> : null}
            </p>
          ) : null}
        </>
      ) : (
        <p>
          {tip.link ? <span className="whitespace-nowrap"><TipLinkButton tip={tip} /><Dot /></span> : null}
          <span className="whitespace-nowrap">
            <button type="button" className={LINK} onClick={advisor.toggleResearch} aria-expanded={advisor.researchOpen}>
              {advisor.researchOpen ? "Hide research" : "Why this?"}
            </button>
          </span>
          {reactions.map(([reaction, label]) => (
            <span key={reaction} className="whitespace-nowrap">
              <Dot />
              <button type="button" className={LINK} disabled={pending !== null} onClick={() => advisor.react(reaction)}>{label}</button>
            </span>
          ))}
        </p>
      )}
      <ErrorLine text={error} />
    </div>
  );
}

/** A tip's link: "Set a length", "Change the set time", "Open Needs decision". */
function TipLinkButton({ tip }: Readonly<{ tip: AdvisorTip }>) {
  const advisor = useAdvisor();
  const link = tip.link;
  if (!advisor || !link) return null;
  return <button type="button" className={LINK} onClick={() => advisor.openLink(link)} data-advisor-tip-link={link.target}>{link.label}</button>;
}

function ProposalAnswers({ answers, trailing }: Readonly<{ answers: readonly (readonly [ScheduleProposalAnswer, string])[]; trailing?: ReactNode }>) {
  const advisor = useAdvisor();
  const state = advisor?.proposal;
  if (!advisor || !state) return null;
  return (
    <p>
      {answers.map(([answer, label], index) => (
        <span key={answer} className="whitespace-nowrap">
          {index > 0 ? <Dot /> : null}
          <button type="button" className={LINK} disabled={state.pending !== null} onClick={() => advisor.answer(answer)}>{label}</button>
        </span>
      ))}
      {trailing ? <span className="whitespace-nowrap"><Dot />{trailing}</span> : null}
    </p>
  );
}

/** The italic outcome of an answer; after Change for good it offers Undo (regular text). */
function ProposalOutcome() {
  const advisor = useAdvisor();
  const state = advisor?.proposal;
  if (!advisor || !state?.outcome) return null;
  return (
    <>
      <Outcome>{state.outcome}</Outcome>
      {state.undoable ? (
        <p><button type="button" className={LINK} disabled={state.pending !== null} onClick={() => advisor.answer("undo")}>Undo</button></p>
      ) : null}
    </>
  );
}

/**
 * A question that came from a tip: the tip's sentence, Cadence's question with the value
 * a Yes applies, the three answers and the tip's "Why this?" card.
 */
function TipQuestion({ view }: Readonly<{ view: Extract<ScheduleProposalView, { kind: "proposal" }> }>) {
  const advisor = useAdvisor();
  const [researchOpen, setResearchOpen] = useState(false);
  const tip = view.tip;
  if (!advisor || !tip) return null;
  const answered = !!advisor.proposal?.outcome;
  const why = tip.research ? (
    <button type="button" className={LINK} onClick={() => setResearchOpen((open) => !open)} aria-expanded={researchOpen}>
      {researchOpen ? "Hide research" : "Why this?"}
    </button>
  ) : null;
  return (
    <div data-advisor-tip-question={view.proposalId}>
      <p className="break-words text-foreground [overflow-wrap:anywhere]">{tip.text}</p>
      <p>{tip.question}</p>
      {answered ? <ProposalOutcome /> : <ProposalAnswers answers={PROPOSAL_ANSWERS} trailing={why} />}
      {researchOpen && tip.research ? <ResearchCard research={tip.research} full /> : null}
    </div>
  );
}

const PROPOSAL_ANSWERS = [["try", "Try for two weeks"], ["for_good", "Change for good"], ["no", "No"]] as const;
const CHECK_IN_ANSWERS = [["keep", "Keep"], ["go_back", "Go back"]] as const;

/** The one line under today's date, with no avatar. A day with nothing shows no line. */
export function AdvisorDayLine() {
  const advisor = useAdvisor();
  const item = advisor?.item;
  if (!advisor || !item || advisor.panelOpen) return null;
  const proposal = advisor.proposal;
  let body: ReactNode;
  if (item.kind === "brief") {
    body = <p>{briefLineText(item.openMoves)} <button type="button" className={LINK} onClick={advisor.openPanel}>Open</button></p>;
  } else if (item.kind === "proposal") {
    body = (
      <>
        <p>{proposalShortLine(item.view)}{proposal?.outcome ? null : <> <button type="button" className={LINK} onClick={advisor.openPanel}>Answer</button></>}</p>
        <ProposalOutcome />
      </>
    );
  } else if (item.kind === "check_in") {
    body = (
      <>
        <p>{item.view.question}</p>
        {proposal?.outcome ? <Outcome>{proposal.outcome}</Outcome> : <ProposalAnswers answers={CHECK_IN_ANSWERS} />}
        {proposal?.outcome ? null : <p className="text-xs leading-5 text-muted-readable">Your two-week try ends today.</p>}
        <ErrorLine text={proposal?.error ?? null} />
      </>
    );
  } else if (item.kind === "notice") {
    body = <p>{item.view.text}</p>;
  } else {
    body = <TipBlock full={false} />;
  }
  return <div className="pt-3 text-sm leading-6" data-advisor-line={item.kind}>{body}</div>;
}

function Section({ heading, children }: Readonly<{ heading?: string; children: ReactNode }>) {
  return (
    <div className="mt-6 border-t border-line pt-4 text-sm leading-6">
      {heading ? <h3 className="text-xs font-bold text-muted-readable">{heading}</h3> : null}
      {children}
    </div>
  );
}

function BriefSection() {
  const setTarget = useAdvisorBriefTarget();
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    setTarget?.(ref.current);
    return () => setTarget?.(null);
  }, [setTarget]);
  return <Section heading="Today’s brief"><div ref={ref} data-advisor-brief /></Section>;
}

/**
 * Tapping the horse opens the panel. From 1280px wide it is a 26rem column on the right
 * and the Timeline narrows beside it; below that it fills the window with a 36rem text column.
 */
export function AdvisorPanel() {
  const advisor = useAdvisor();
  if (!advisor?.panelOpen) return null;
  return <AdvisorPanelContent />;
}

function AdvisorPanelContent() {
  const advisor = useAdvisor();
  const [pastTipsOpen, setPastTipsOpen] = useState(false);
  const backButtonRef = useRef<HTMLButtonElement>(null);
  const pastTipsButtonRef = useRef<HTMLButtonElement>(null);
  const previousPastTipsOpen = useRef(false);
  const pastCount = advisor?.recent?.length ?? 0;
  const showPastTipsView = pastTipsOpen && pastCount > 0;

  useEffect(() => {
    if (showPastTipsView && !previousPastTipsOpen.current) {
      backButtonRef.current?.focus();
    } else if (!showPastTipsView && previousPastTipsOpen.current) {
      pastTipsButtonRef.current?.focus();
    }
    previousPastTipsOpen.current = showPastTipsView;
  }, [showPastTipsView]);

  if (!advisor) return null;
  const { brief, proposal, tip, recent, chatHref, closePanel } = advisor;
  const view = proposal?.view;
  const showTodayTip = Boolean(tip && !(view?.kind === "proposal" && tip.tip.proposalId && tip.tip.proposalId === view.proposalId));
  const pastTipsButton = pastCount > 0 ? (
    <p className={showTodayTip ? "mt-3" : undefined}>
      <button ref={pastTipsButtonRef} type="button" className={LINK} onClick={() => setPastTipsOpen(true)} data-advisor-past-tips-open>
        See past tips ({pastCount})
      </button>
    </p>
  ) : null;

  return (
    <section aria-label="Advisor" role="dialog" aria-modal={false}
      className="fixed inset-0 z-50 overflow-y-auto bg-background px-5 pb-10 pt-4 xl:inset-y-0 xl:left-auto xl:right-0 xl:w-[26rem] xl:border-l xl:border-line"
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        if (showPastTipsView) setPastTipsOpen(false);
        else closePanel();
      }} data-advisor-panel>
      <div className="mx-auto max-w-xl">
        <div className={showPastTipsView ? "flex items-center justify-between" : "flex justify-end"}>
          {showPastTipsView ? (
            <button ref={backButtonRef} type="button" onClick={() => setPastTipsOpen(false)}
              className="min-h-11 text-left text-muted-readable underline underline-offset-2 hover:text-foreground"
              data-advisor-past-tips-back>
              <span className="text-sm">← Back</span>
            </button>
          ) : null}
          <button type="button" onClick={closePanel} className="min-h-11 min-w-11 text-right text-muted-readable underline underline-offset-2 hover:text-foreground">
            <span className="text-sm">Close</span>
          </button>
        </div>
        {showPastTipsView ? (
          <div data-advisor-past-tips>
            <h2 className="mt-2 text-xl">Past tips</h2>
            <p className="mt-1 text-xs leading-5 text-muted-readable">Tips shown in the last {ADVISOR_RECENT_TIPS.days} days.</p>
            <div className="mt-4 divide-y divide-line border-t border-line text-sm leading-6">
              {recent!.map((earlier) => <PastTip key={earlier.id} tip={earlier} />)}
            </div>
          </div>
        ) : (
          <>
            <div className="flex flex-col items-center gap-1 text-center">
              <AdvisorHorse size={120} />
              <h2 className="mt-2 text-xl">Advisor</h2>
            </div>
            {brief.kind !== "none" ? <BriefSection /> : null}
            {view && (view.kind === "proposal" || view.kind === "check_in" || view.kind === "notice") ? (
              <Section heading="Needs your answer">
                {view.kind === "proposal" && view.tip ? <TipQuestion view={view} /> : view.kind === "proposal" ? (
                  <>
                    <p>{view.line}</p>
                    {view.reason ? <p className="text-xs leading-5 text-muted-readable">{view.reason}</p> : null}
                    {proposal?.outcome ? <ProposalOutcome /> : <ProposalAnswers answers={PROPOSAL_ANSWERS} />}
                  </>
                ) : view.kind === "check_in" ? (
                  <>
                    <p>{view.question}</p>
                    {proposal?.outcome ? <Outcome>{proposal.outcome}</Outcome> : <ProposalAnswers answers={CHECK_IN_ANSWERS} />}
                  </>
                ) : <p>{view.text}</p>}
                <ErrorLine text={proposal?.error ?? null} />
              </Section>
            ) : null}
            {/* A tip that carries the question above is shown there, once. */}
            {showTodayTip ? (
              <Section heading="Today’s tip">
                <TipBlock full />
                {pastTipsButton}
              </Section>
            ) : pastTipsButton ? (
              <Section heading="Past tips">{pastTipsButton}</Section>
            ) : null}
            {view?.kind === "trial" ? (
              <Section heading="Trying for two weeks">
                <p>{view.line}</p>
                <p className="text-xs leading-5 text-muted-readable">Check-in on {formatDay(view.checkInDate)}.</p>
              </Section>
            ) : null}
            {brief.kind === "none" && (!view || view.kind === "none" || view.kind === "hold") && !tip && !pastCount ? (
              <Section><p className="text-muted-readable">Nothing from the advisor today.</p></Section>
            ) : null}
            {chatHref ? (
              <Section><a href={chatHref} style={ANCHOR_STYLE}>Chat with the advisor</a></Section>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}

function PastTip({ tip }: Readonly<{ tip: AdvisorTip }>) {
  const [researchOpen, setResearchOpen] = useState(false);
  return (
    <div className="py-4 first:pt-4" data-advisor-past-tip={tip.id}>
      <p className="break-words text-foreground [overflow-wrap:anywhere]">{tip.text}</p>
      <p className="mt-1 text-xs leading-5 text-muted-readable">
        {formatDay(tip.localDate)}
        {tip.reaction ? <> · <span className="italic">{TIP_REACTION_OUTCOME[tip.reaction]}</span></> : null}
      </p>
      <p className="mt-1">
        {tip.link ? <span className="whitespace-nowrap"><TipLinkButton tip={tip} /><Dot /></span> : null}
        <button type="button" className={LINK} onClick={() => setResearchOpen((open) => !open)} aria-expanded={researchOpen}>
          {researchOpen ? "Hide research" : "Why this?"}
        </button>
      </p>
      {researchOpen ? <ResearchCard research={tip.research} full /> : null}
    </div>
  );
}

/** "Tuesday, Nov 17" from a local date, without time zone shifts. */
export function formatDay(localDate: string): string {
  const [year, month, day] = localDate.split("-").map(Number);
  if (!year || !month || !day) return localDate;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" });
}

/** The Timeline column narrows beside the panel from 1280px wide. */
export function useAdvisorPanelPadding(): string {
  return useAdvisor()?.panelOpen ? "xl:pr-[26rem]" : "";
}
