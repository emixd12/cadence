import type { NextRequest } from "next/server";

import { verifyEmailCode } from "@/lib/auth/email-sign-in-server";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  return verifyEmailCode(request);
}
