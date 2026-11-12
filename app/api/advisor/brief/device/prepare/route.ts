import { dailyBriefPreflight, readDailyBriefRequestBody, runDailyBriefRequest } from "@/lib/services/daily-brief-request";
import { prepareDeviceDailyBrief } from "@/lib/services/daily-brief-device.service";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export function POST(request: Request) {
  return runDailyBriefRequest(request, async (caller) => prepareDeviceDailyBrief(caller, await readDailyBriefRequestBody(request)));
}
export const OPTIONS = dailyBriefPreflight;
