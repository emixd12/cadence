import { exportFormats, statusDefinitions } from "./vocabulary";

export type FaqItem = { id: string; question: string; answer: string };
export type FaqGroup = { id: string; title: string; items: readonly FaqItem[] };

export const faqGroups: readonly FaqGroup[] = [
  { id: "recording-model", title: "Recording model", items: [
    { id: "what-is-cadence", question: "What is Cadence?", answer: `Cadence is an open-source tracker for recurring behaviors. You define a Behavior and its Schedule, and Cadence creates each Occurrence on a today-first timeline. ${statusDefinitions.completed} ${statusDefinitions.notCompleted} ${statusDefinitions.unresolved}` },
    { id: "what-happens-without-a-decision", question: "What happens if I do not make a decision?", answer: `${statusDefinitions.unresolved} Prior-day Unresolved Occurrences collect in Needs decision until you decide them. Cadence never converts silence into failure.` },
    { id: "why-no-streaks", question: "Why are there no streaks, badges, or points?", answer: "Cadence keeps the Record focused on explicit Decisions. It shows Adherence over 7, 30, or 90 days without turning a streak or score into the goal." },
  ] },
  { id: "context-and-history", title: "Context and history", items: [
    { id: "track-elapsed-time", question: "Can I track how long a behavior takes?", answer: "Yes. An Occurrence scheduled for today, or one still in Needs decision, can carry elapsed time. Start, stop, and reset the timer. Reviews show totals and averages alongside Adherence." },
    { id: "preserve-definition-history", question: "What happens when I rename or redefine a Behavior?", answer: "Cadence preserves title and description revision history in JSON and BehaviorLog exports. The current app does not provide a full revision browser." },
    { id: "add-context", question: "What Context can I add?", answer: "You can add an optional note and elapsed time to an Occurrence. Context does not decide whether the Occurrence is Completed or Not Completed." },
  ] },
  { id: "review-and-analysis", title: "Review and analysis", items: [
    { id: "how-adherence-works", question: "How does Adherence work?", answer: "Cadence shows Adherence across 7, 30, or 90 days. Adherence is the share of decided Occurrences marked Completed. Unresolved Occurrences remain separate from final calculations." },
    { id: "use-external-ai", question: "Can I analyze my Record with an AI service?", answer: "Cadence provides exports and prepared prompts for services you choose. When enabled, Daily Brief separately sends selected tracking information to OpenAI; Calendar timing and other optional sources require separate choices. MCP lets a connected AI client read tracking records and make permitted changes you direct and confirm. Calendar data is never shared through MCP. Hosted MCP launch remains pending." },
  ] },
  { id: "google-calendar", title: "Google Calendar", items: [
    { id: "is-calendar-required", question: "Is Google Calendar required?", answer: "No. Cadence tracking works without Calendar. Google’s review of the optional connector’s Calendar access is pending. The connector is not yet verified for public rollout." },
    { id: "what-calendar-can-read", question: "What can Cadence read from Google Calendar?", answer: "After separate consent with the same Google identity used for Cadence sign-in, Google grants read-only access to your subscribed calendar list and events on calendars you can access. Cadence reads the list so you can choose calendars, then fetches events only from selected calendars for the days displayed in Timeline. Depending on Google permissions and event data, details can include titles, descriptions, times, locations, organizers, attendees, conference details, attachment links, and Google event links." },
    { id: "can-calendar-change-events", question: "Can Cadence change my Google Calendar events?", answer: "No. Cadence requests read-only Calendar access. It cannot create, change, or delete Google events, and it does not download attachments automatically." },
    { id: "disconnect-calendar", question: "How do I disconnect Google Calendar?", answer: "Choose Disconnect Google Calendar in Settings. This removes the live server credential and requests global revocation of the Calendar grant. Web sign-out ends only that Cadence session and leaves the account-level Calendar connection active. Disconnecting a Cadence account on desktop clears that Mac's Calendar cache but does not revoke the global grant. An offline device may retain stale cached event details until it reconnects or its Cadence account is disconnected." },
  ] },
  { id: "privacy-and-portability", title: "Privacy and portability", items: [
    { id: "who-can-see-data", question: "Who can see my data?", answer: "Cadence is single-player by design. There is no social feed or collaboration layer. Read the Privacy page for the current data practices and the Trust page for bounded operational evidence." },
    { id: "export-formats", question: "Can I leave and take my Record with me?", answer: `Yes. Export your history as ${exportFormats.join(", ")}. These files can be inspected without Cadence.` },
    { id: "timing-in-exports", question: "Is tracked time included in my exports?", answer: "Only when you choose to include it. Exports omit timing data by default because exact session timestamps can reveal activity patterns." },
    { id: "what-is-behaviorlog", question: "What is BehaviorLog?", answer: "BehaviorLog is the open portability standard used by Cadence. A bundle contains plain JSONL files, a manifest, schemas, and SHA-256 checksums. The standard lives at https://github.com/emixd12/BehaviorLog-Bundle." },
    { id: "current-price", question: "What does Cadence cost?", answer: "Cadence is currently available without charge." },
  ] },
];

export const faqItems = faqGroups.flatMap((group) => group.items);

export function buildFaqMarkdown(): string {
  const lines = ["# Frequently Asked Questions", "", "Detailed answers about Cadence's recording model, context, review, privacy, and portability.", ""];
  for (const group of faqGroups) {
    lines.push(`## ${group.title}`, "");
    for (const item of group.items) lines.push(`### ${item.question}`, "", item.answer, "");
  }
  return lines.join("\n").trimEnd();
}
