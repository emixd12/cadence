import { advisorTipsPreflight, handleNextTip } from "@/lib/services/advisor-tips-request";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export function GET(request: Request) {
  return handleNextTip(request);
}

export const OPTIONS = advisorTipsPreflight;
