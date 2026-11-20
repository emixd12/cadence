import { ADVICE_CARDS, adviceSourceFor } from "@cadence/core/services/advice-library";
import type { AdviceCard } from "@cadence/core/types/advice-cards";
import type { AdvisorTipResearch } from "@cadence/core/types/advisor-tips";

/**
 * The "Why this?" research card for an advice card, shared by tips (4B) and the
 * questions tips carry ("Tips with one-tap changes"). Null when the card left the library.
 */
export function researchFor(cardId: string, cards: readonly AdviceCard[] = ADVICE_CARDS): AdvisorTipResearch | null {
  const card = cards.find((entry) => entry.id === cardId);
  if (!card) return null;
  const source = adviceSourceFor(card);
  return {
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
}
