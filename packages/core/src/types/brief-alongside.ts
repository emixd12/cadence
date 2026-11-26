/**
 * Ticket 360 (D33): the Daily Brief's one alongside question line, "Can {title} be done
 * alongside other things? Yes · No". No typing. Shared by the server, the web brief and
 * (Ticket 363) Cadence for Mac.
 *
 * Rules:
 *   - At most one question per brief: `pickBriefAlongsideQuestion` picks the earliest of
 *     today's items whose question is open (`alongsideQuestionOpen`). The saved brief
 *     keeps the pick, so reopening today's brief asks the same question, or nothing once
 *     it is answered.
 *   - Yes or No writes the Behavior's alongside setting through the Behavior definition
 *     service, which closes the question on every surface. That stored answer is the
 *     brief's record: an answered Behavior is never asked again.
 *   - Only a client that sends `alongside_question_v1` receives the line, and only while
 *     `CADENCE_ALONGSIDE` is on. Other clients see the brief exactly as before.
 */

export const BRIEF_ALONGSIDE_QUESTION_FEATURE = "alongside_question_v1" as const;

export type BriefAlongsideQuestion = Readonly<{
  behaviorId: string;
  /** The Behavior's title, from Cadence's records, never model text. */
  title: string;
}>;

export type BriefAlongsideAnswerRequest = Readonly<{ behaviorId: string; alongside: boolean }>;

/** `changed` is false when the setting already held this answer (another surface or device). */
export type BriefAlongsideAnswerResponse = Readonly<{ behaviorId: string; alongside: boolean; changed: boolean }>;

/** Same authentication as the other brief routes (web session or Mac Bearer). */
export const BRIEF_ALONGSIDE_ROUTE = "/api/advisor/brief/alongside" as const;
