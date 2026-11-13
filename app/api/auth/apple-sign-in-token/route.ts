import { calendarPreflight } from "@/lib/services/google-calendar-request";
import { keepDesktopAppleToken } from "@/lib/services/desktop-sign-in.service";

export const dynamic = "force-dynamic";

// Ticket 336: the Mac hands Apple's refresh token over once, after an Apple sign-in.
export function POST(request: Request) {
  return keepDesktopAppleToken(request);
}
export const OPTIONS = calendarPreflight;
