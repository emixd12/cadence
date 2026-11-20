import { advisorTipsPreflight, handleRecentTips } from "@/lib/services/advisor-tips-request";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Advisor 4E: tips shown on the last few days, for the advisor panel's "Earlier" list. */
export function GET(request: Request) {
  return handleRecentTips(request);
}

export const OPTIONS = advisorTipsPreflight;
