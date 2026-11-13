import { NextResponse, type NextRequest } from "next/server";

import { requestEmailSignIn } from "@/lib/auth/email-sign-in-server";
import { authRequestUrl, buildLoginPath } from "@/lib/auth/redirects";
import { SIGN_IN_METHOD_UNAVAILABLE_ERROR } from "@/lib/auth/sign-in-methods";
import { startSignIn } from "@/lib/auth/sign-in-start";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ method: string }> },
) {
  const { method } = await params;
  return startSignIn(request, method);
}

// Ticket 332: the email form posts here, so the address never sits in a URL.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ method: string }> },
) {
  const { method } = await params;
  if (method === "email") return requestEmailSignIn(request);
  return NextResponse.redirect(
    new URL(
      buildLoginPath(undefined, SIGN_IN_METHOD_UNAVAILABLE_ERROR),
      authRequestUrl(request),
    ),
    303,
  );
}
