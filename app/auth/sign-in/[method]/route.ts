import type { NextRequest } from "next/server";

import { startSignIn } from "@/lib/auth/sign-in-start";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ method: string }> },
) {
  const { method } = await params;
  return startSignIn(request, method);
}
