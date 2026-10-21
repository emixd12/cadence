import { handleOAuth, oauthOptions } from "@/lib/services/oauth/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = (request: Request) => handleOAuth(request, "authorize");
export const OPTIONS = oauthOptions;
