import { readBriefingGenerationOptions, readBriefingWorkbenchAccount, runBriefingComparison } from "@/lib/services/briefing-workbench.service";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export function POST(request: Request) { return runBriefingComparison(request); }
/** `?view=generation` returns the allowed workbench generation values (Ticket 290); otherwise account metadata. */
export function GET(request: Request) {
  return new URL(request.url).searchParams.get("view") === "generation" ? readBriefingGenerationOptions(request) : readBriefingWorkbenchAccount(request);
}
