import { dailyBriefPreflight, readDailyBriefRequestBody, runDailyBriefRequest } from "@/lib/services/daily-brief-request";
import { completeDeviceDailyBrief, DAILY_BRIEF_DEVICE_COMPLETE_MAX_BYTES } from "@/lib/services/daily-brief-device.service";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
export function POST(request: Request) {
  return runDailyBriefRequest(request, async (caller) => completeDeviceDailyBrief(caller, await readDailyBriefRequestBody(request, DAILY_BRIEF_DEVICE_COMPLETE_MAX_BYTES)));
}
export const OPTIONS = dailyBriefPreflight;
