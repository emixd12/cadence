import { readBriefingReviews, writeBriefingReview } from "@/lib/services/briefing-review.service";
export const dynamic = "force-dynamic";
export function GET(request: Request) { return readBriefingReviews(request); }
export function POST(request: Request) { return writeBriefingReview(request); }
