import { dailyBriefPreflight, readDailyBriefRequestBody, runDailyBriefRequest } from "@/lib/services/daily-brief-request";
import { DAILY_BRIEF_DEVICE_RELEASE_MAX_BYTES, releaseDeviceDailyBrief } from "@/lib/services/daily-brief-device.service";
export const dynamic = "force-dynamic";
export const maxDuration = 15;
export function POST(request: Request) {
  return runDailyBriefRequest(request, async (caller) => releaseDeviceDailyBrief(caller, await readDailyBriefRequestBody(request, DAILY_BRIEF_DEVICE_RELEASE_MAX_BYTES)));
}
export const OPTIONS = dailyBriefPreflight;
