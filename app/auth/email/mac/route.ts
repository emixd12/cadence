import { requestDesktopEmailCode } from "@/lib/services/desktop-sign-in.service";

export const dynamic = "force-dynamic";

// Ticket 336: the Mac's email page sends the code request here.
export function POST(request: Request) {
  return requestDesktopEmailCode(request);
}
