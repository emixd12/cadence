import { advisorTipsPreflight, handleTipReaction } from "@/lib/services/advisor-tips-request";

export const dynamic = "force-dynamic";

export function POST(request: Request) {
  return handleTipReaction(request);
}

export const OPTIONS = advisorTipsPreflight;
