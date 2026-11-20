import { ADVICE_CARDS, adviceSourceFor } from "@cadence/core/services/advice-library";
import type { AdviceCard } from "@cadence/core/types/advice-cards";

/**
 * Advisor plan Phase 5 (5A): `search_advice`, chat's one coach tool. It searches the
 * reviewed advice library (4A) by words, so research claims in chat come from cards
 * the owner reviewed, never from model memory. Only active cards are searched.
 */

export const CHAT_ADVICE_MAX_CARDS = 3;

export type ChatAdviceCard = Readonly<{
  id: string;
  advice: string;
  /** What the source found, in plain words. */
  finding: string;
  action: string;
  limitation: string;
  evidence_strength: string;
  source: Readonly<{ citation: string; url: string }> | null;
}>;

export type ChatAdviceResult = Readonly<{ cards: readonly ChatAdviceCard[]; note?: string }>;

const STOP = new Set([
  "the", "and", "for", "are", "but", "not", "you", "your", "with", "that", "this", "does", "should", "would", "could",
  "what", "when", "how", "why", "can", "about", "have", "has", "from", "into", "than", "then", "there", "they", "it's",
  "better", "good", "bad", "best", "any", "research", "science", "study", "studies", "say", "says", "show", "shows",
]);

/** Word stems a query and a card share; a stem is the first five letters. */
function stems(text: string): Set<string> {
  return new Set(text.toLowerCase().split(/[^a-z0-9']+/)
    .filter((word) => word.length > 2 && !STOP.has(word))
    .map((word) => word.slice(0, 5)));
}

export function searchAdviceCards(query: string, cards: readonly AdviceCard[] = ADVICE_CARDS): ChatAdviceResult {
  const wanted = stems(query);
  const none: ChatAdviceResult = { cards: [], note: "No reviewed research card matches. Say Cadence has no research on that." };
  if (!wanted.size) return none;
  const needed = Math.min(2, wanted.size);
  const scored = cards
    .filter((card) => card.status === "active")
    .map((card) => {
      const have = stems(`${card.advice} ${card.action} ${card.evidence.claim}`);
      return { card, score: [...wanted].filter((stem) => have.has(stem)).length };
    })
    .filter((entry) => entry.score >= needed)
    .sort((a, b) => b.score - a.score || a.card.id.localeCompare(b.card.id))
    .slice(0, CHAT_ADVICE_MAX_CARDS);
  if (!scored.length) return none;
  return {
    cards: scored.map(({ card }) => {
      const source = adviceSourceFor(card);
      return {
        id: card.id, advice: card.advice, finding: card.evidence.claim, action: card.action, limitation: card.limitation,
        evidence_strength: card.evidence.strength, source: source ? { citation: source.citation, url: source.url } : null,
      };
    }),
  };
}
