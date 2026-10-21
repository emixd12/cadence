import { handleOAuth, oauthOptions } from "@/lib/services/oauth/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const POST = (request: Request) => handleOAuth(request, "revoke");
export const OPTIONS = oauthOptions;
