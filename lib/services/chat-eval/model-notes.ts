/**
 * Phase 5 (5D) finalist round: light per-model tuning. Each note is appended to chat's
 * system prompt in the eval only (CADENCE_CHAT_EVAL_TUNED=1), to fix what the blind
 * graders marked down in the untuned round. The shared part fixes faults both
 * finalists showed; the per-model part fixes each one's own. Whichever model wins,
 * its note moves into chat-prompt.ts as part of the next prompt version.
 */

const SHARED = `Extra guidance:
- To the person, say "not marked yet" rather than "Unresolved".
- When a move is refused, say plainly that the item was not moved, give the reason in a few words, then name the other times offered and let the person pick.
- When Cadence shows a change or a question as its own line, add at most one short, warm sentence; do not copy the line.
- Mention a calendar or workouts only when a tool returned them. If none is connected, do not say "your calendar" as if one were.
- For an unrelated request, say clearly that you can't help with that here, then offer one thing you can do.
- For a research question with no advice card, say you have no research to cite on it, then offer help from the person's own records.`;

const PER_MODEL: Readonly<Record<string, string>> = {
  "openrouter/deepseek/deepseek-v4.1-flash-1017": `- Always write times with am or pm, such as 6:00 pm.
- Answer exactly the range asked. "This week" means Monday to today; do not add items from other days unless asked.
- When listing a part of the day, name every calendar event in that range.
- For a question about today or tonight, start from today's Timeline.
- Never write tool-call syntax or markup in your reply; call tools only through the tool interface.`,
};

export function chatEvalModelNote(model: string): string {
  const own = PER_MODEL[model];
  return own ? `${SHARED}\n${own}` : SHARED;
}
