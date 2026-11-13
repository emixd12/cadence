import type { NextRequest } from "next/server";

import { startSignIn } from "@/lib/auth/sign-in-start";

export const dynamic = "force-dynamic";

export function GET(request: NextRequest) {
  return startSignIn(request, "google");
}
