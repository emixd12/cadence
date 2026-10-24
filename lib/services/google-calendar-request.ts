import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { authRequestUrl } from "@/lib/auth/redirects";
import type { Database } from "@/lib/db/database.types";
import type { AppSupabaseClient } from "@/lib/db/behaviors.repo";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseRuntimeConfig } from "@/lib/supabase/env";
import { CalendarConnectionError } from "./google-calendar-oauth";
import type { CalendarCaller } from "./google-calendar.service";

const NATIVE_ORIGINS = new Set(["tauri://localhost", "http://tauri.localhost", "https://tauri.localhost"]);
export async function authenticateCalendarRequest(request: Request): Promise<CalendarCaller> {
  const authorization = request.headers.get("authorization");
  const origin = request.headers.get("origin");
  const sameOrigin = origin === authRequestUrl(request).origin;
  let client: AppSupabaseClient;
  let token: string | undefined;
  if (authorization) {
    if (!authorization.startsWith("Bearer ") || authorization.length > 16384 || (origin && !sameOrigin && !NATIVE_ORIGINS.has(origin))) throw new CalendarConnectionError("unauthenticated");
    token = authorization.slice(7);
    const config = getSupabaseRuntimeConfig();
    client = createSupabaseClient<Database>(config.url, config.publishableKey, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } });
  } else {
    if (!["GET", "HEAD"].includes(request.method) && !sameOrigin) throw new CalendarConnectionError("unauthenticated");
    client = await createClient();
  }
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) throw new CalendarConnectionError("unauthenticated");
  return { client, user: data.user };
}
export function calendarResponse(request: Request, body: unknown, status = 200) {
  const origin = request.headers.get("origin");
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff",
    ...(origin && NATIVE_ORIGINS.has(origin) ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : {}) } });
}
export function calendarPreflight(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || !NATIVE_ORIGINS.has(origin)) return new Response(null, { status: 403 });
  return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": origin, Vary: "Origin", "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS", "Access-Control-Allow-Headers": "Authorization, Content-Type", "Access-Control-Max-Age": "600" } });
}
export async function runCalendarRequest(request: Request, run: (caller: CalendarCaller) => Promise<unknown>) {
  try { return calendarResponse(request, await run(await authenticateCalendarRequest(request))); }
  catch (error) {
    const code = error instanceof CalendarConnectionError ? error.code : "provider_unavailable";
    return calendarResponse(request, { error: code }, code === "unauthenticated" ? 401 : code === "invalid_request" ? 400 : code === "not_configured" ? 503 : 409);
  }
}
export async function readCalendarRequestBody(request: Request, maxBytes = 70_000): Promise<unknown> {
  // A small explicit byte ceiling precedes JSON parsing, including chunked requests.
  const reader = request.body?.getReader();
  if (!reader) throw new CalendarConnectionError("invalid_request");
  const chunks: Uint8Array[] = []; let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > maxBytes) { await reader.cancel(); throw new CalendarConnectionError("invalid_request"); }
    chunks.push(value);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new CalendarConnectionError("invalid_request"); }
}
