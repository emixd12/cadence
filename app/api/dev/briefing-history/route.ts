import { readBriefingHistory, inspectBriefingHistory } from "@/lib/services/briefing-history.service";

export const dynamic = "force-dynamic";
export function GET(request: Request) { return readBriefingHistory(request); }
export function POST(request: Request) { return inspectBriefingHistory(request); }
