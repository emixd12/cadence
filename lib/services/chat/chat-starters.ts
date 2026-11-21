import { Temporal } from "@js-temporal/polyfill";
import {
  CHAT_STARTER_FALLBACK, pickChatStarters, type ChatStarterFacts,
} from "@cadence/core/resolvers/chat-starters.resolver";
import type { IntegrationOperationName, IntegrationOperationOutput } from "@cadence/core/integration";
import type { ChatStarterList } from "@cadence/core/types/chat";
import { executeMcpOperation } from "@/lib/integrations/operations/execute";
import type { IntegrationContext } from "@/lib/integrations/request-context";
import type { ChatSession } from "./chat.service";

/**
 * Advisor plan Phase 5B: starter questions for an empty conversation. Reads today's
 * Timeline and the last four weeks of marks through chat's own grant, then picks
 * questions in code (chat-starters.resolver.ts). No model call. Any read that fails
 * falls back to the three general questions, so the page never shows an error here.
 */

async function read<N extends IntegrationOperationName>(name: N, context: IntegrationContext, input: unknown) {
  const result = await executeMcpOperation(name, context, input);
  return result.ok ? result.value as IntegrationOperationOutput<N> : null;
}

type Counts = Readonly<{ completed: number; not_completed: number }>;
const decided = (counts: Counts) => counts.completed + counts.not_completed;
const rate = (counts: Counts) => (decided(counts) === 0 ? null : counts.completed / decided(counts));

export async function readChatStarterFacts(context: IntegrationContext): Promise<ChatStarterFacts | null> {
  const timeline = await read("get_timeline", context, { days: 1, include_needs_decision: true });
  if (!timeline) return null;
  const today = timeline.today_local_date;
  const plain = Temporal.PlainDate.from(today);
  const [month, week, opportunities] = await Promise.all([
    read("get_adherence_summary", context, { start_local_date: plain.subtract({ days: 27 }).toString(), end_local_date: today }),
    read("get_adherence_summary", context, { start_local_date: plain.subtract({ days: 6 }).toString(), end_local_date: today }),
    read("list_behaviors", context, { state: "running", is_opportunity: true }),
  ]);
  if (!month || !week) return null;
  const items = timeline.days.flatMap((day) => day.occurrences);
  const onToday = new Set(items.map((item) => item.behavior_id));
  const opportunity = (opportunities?.behaviors ?? []).filter((row) => !onToday.has(row.id))
    .sort((a, b) => a.title.localeCompare(b.title))[0]?.title ?? null;
  return {
    today,
    todayTotal: items.length,
    todayDone: items.filter((item) => item.status === "completed").length,
    todayOpen: items.filter((item) => item.status === "unresolved").length,
    movedToday: items.find((item) => item.move !== null)?.behavior_title ?? null,
    unmarked: timeline.needs_decision?.total_count ?? 0,
    week: { decided: decided(week.overall), rate: rate(week.overall) },
    month: { decided: decided(month.overall), rate: rate(month.overall) },
    behaviors: month.behaviors.filter((row) => row.state === "active")
      .map((row) => ({ title: row.behavior_title, decided: decided(row), rate: rate(row) })),
    opportunity,
  };
}

export async function readChatStarters(session: ChatSession): Promise<ChatStarterList> {
  try {
    const facts = await readChatStarterFacts(session.context);
    return { starters: facts ? pickChatStarters(facts) : CHAT_STARTER_FALLBACK };
  } catch {
    return { starters: CHAT_STARTER_FALLBACK };
  }
}
