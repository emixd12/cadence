import { startBriefingSequence, readBriefingSequence, cancelBriefingSequence } from "@/lib/services/briefing-sequence.service";

export const dynamic = "force-dynamic";
export function GET(request: Request) { return readBriefingSequence(request); }
export function POST(request: Request) { return startBriefingSequence(request); }
export function DELETE(request: Request) { return cancelBriefingSequence(request); }
