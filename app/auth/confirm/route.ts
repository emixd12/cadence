import type { NextRequest } from "next/server";

import { confirmEmailLink } from "@/lib/auth/email-sign-in-server";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  return confirmEmailLink(request);
}
