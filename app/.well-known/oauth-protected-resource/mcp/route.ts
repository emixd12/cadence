import { oauthDiscovery, oauthOptions } from "@/lib/services/oauth/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = () => oauthDiscovery("resource");
export const OPTIONS = oauthOptions;
