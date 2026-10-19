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
    { id: "use-external-ai", question: "Can I analyze my Record with an AI service?", answer: "You choose whether to share exports with an external AI service. Separately, where enabled, optional Daily Brief sends disclosed context to OpenAI. Each connected source needs its own model-data choice." },
  ] },
  { id: "google-calendar", title: "Google Calendar", items: [
    { id: "is-calendar-required", question: "Is Google Calendar required?", answer: "No. Cadence tracking works without Calendar. Where enabled, Google Calendar requires separate read-only consent. Provider approval and acceptance of a particular deployment or desktop build are separate evidence." },
    { id: "what-calendar-can-read", question: "What can Cadence read from Google Calendar?", answer: "After separate consent with the same Google identity used for Cadence sign-in, Google grants read-only access to your subscribed calendar list and events on calendars you can access. Cadence reads the list so you can choose calendars, then fetches events only from selected calendars for the days displayed in Timeline. Depending on Google permissions and event data, details can include titles, descriptions, times, locations, organizers, attendees, conference details, attachment links, and Google event links." },
    { id: "can-calendar-change-events", question: "Can Cadence change my Google Calendar events?", answer: "No. Cadence requests read-only Calendar access. It cannot create, change, or delete Google events, and it does not download attachments automatically." },
    { id: "disconnect-calendar", question: "How do I disconnect Google Calendar?", answer: "Choose Disconnect Google Calendar in Settings. This removes the live server credential and requests global revocation of the Calendar grant. Web sign-out ends only that Cadence session and leaves the account-level Calendar connection active. Disconnecting a Cadence account on desktop clears that Mac's Calendar cache but does not revoke the global grant. An offline device may retain stale cached event details until it reconnects or its Cadence account is disconnected." },
  ] },
  { id: "connected-sources", title: "Outlook, iCloud, and Hevy", items: [
    { id: "new-connector-availability", question: "Are Outlook, iCloud and Hevy available?", answer: "The web and linked-desktop implementations have local source and synthetic verification. Live Microsoft, Apple and Hevy access, installed desktop behavior and deployment remain unverified. iCloud real-credential use and release also await owner acceptance of hosted password custody. Local checks do not establish public availability." },
    { id: "hevy-timing-limits", question: "What does the Hevy connector use?", answer: "Hevy requires Pro. Cadence displays recorded workout timing and duration. API responses can include exercises, sets, weights, titles, routines and notes; Cadence discards these details. Location is unsupported. Workouts never automatically complete a Behavior or prove free time. Even today-only requests scan global history, bounded at 500 workouts. Larger accounts return incomplete without workout page reads. Count and page checks mean no detected change, not an atomic snapshot; concurrent changes can escape detection." },
    { id: "new-connector-credentials", question: "Where do connector credentials and records go?", answer: "Cadence seals credentials in its hosted private schema. Desktop posts key/password intake once and never persists it. An Apple app-specific password can also reach Mail, Contacts and other iCloud data; Cadence restricts its use to Calendar reads. Web snapshots stay in memory. Desktop can keep a disposable source cache outside tracking exports, account synchronization and user-created backups. Cadence does not persist source records in its hosted database. Deleted ciphertext can remain in infrastructure backups for the existing seven-day window." },
    { id: "new-connector-model-choice", question: "Does connecting a source let Daily Brief use it?", answer: "No. Google Calendar, Outlook Calendar, iCloud Calendar and Hevy each need a separate default-off Daily Brief choice. Calendar context includes today's timing and availability without event titles or details; Hevy contributes only today's past workout timing and duration. Credentials and raw records stay out. Reconnect or calendar reselection requires renewed permission. Turning Daily Brief off or saving from an older client revokes the new source choices. Cadence keeps no production prompt or briefing history; OpenAI retention can still apply." },
    { id: "new-connector-removal", question: "Does disconnect revoke provider access?", answer: "For Outlook, iCloud and Hevy, disconnect removes Cadence's live credential and clears the local source cache, but does not revoke provider access. Remove Cadence in Microsoft account app permissions or work/school My Apps, revoke the app-specific password at account.apple.com, or remove or regenerate the Hevy API key. Account deletion also needs these manual steps. Other devices clear source data on their next connection check; offline devices can retain stale context. Desktop sign-out and account switch clear local caches." },
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
