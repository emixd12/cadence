/**
 * Owner decision, November 12, 2026 (`docs/DECISIONS.md`, "Keep the ChatGPT plan Daily
 * Brief hidden until the owner turns it on"): the "Use your ChatGPT plan" card and the
 * plan path of the Daily Brief stay off unless a build sets `VITE_CADENCE_CHATGPT_PLAN=1`.
 * Vite inlines the value at build time, so a default build ships the feature dormant:
 * no card, no new copy and today's hosted Daily Brief path.
 */
declare global {
  interface ImportMetaEnv {
    readonly VITE_CADENCE_CHATGPT_PLAN?: string;
  }
}

export const CHATGPT_PLAN_SWITCH_ENV = "VITE_CADENCE_CHATGPT_PLAN";

export function chatGptPlanSwitchOn(value: string | undefined = import.meta.env.VITE_CADENCE_CHATGPT_PLAN): boolean {
  return value === "1";
}
