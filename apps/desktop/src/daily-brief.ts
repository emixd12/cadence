import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  DailyBriefResponse,
  DailyBriefSettings,
} from "@cadence/core/types/daily-brief";
import type { DailyBriefClient, DailyBriefPreferenceInput } from "@/lib/ui/daily-brief";
import { DAILY_BRIEF_CLIENT_DEADLINES, DailyBriefRequestError, dailyBriefFetch } from "@/lib/ui/daily-brief";
import { readDesktopCalendarBrokerOrigin } from "./calendar/google-calendar";

export function createDesktopDailyBriefClient(
  client: SupabaseClient,
  origin = readDesktopCalendarBrokerOrigin(),
): DailyBriefClient | null {
  return origin ? new DesktopDailyBriefClient(origin, async () => (await client.auth.getSession()).data.session?.access_token ?? null) : null;
}

class DesktopDailyBriefClient implements DailyBriefClient {
  constructor(
    private readonly origin: string,
    private readonly accessToken: () => Promise<string | null>,
  ) {}

  preferences(signal?: AbortSignal) {
    return this.request<DailyBriefSettings>("/api/advisor/preferences", {}, DAILY_BRIEF_CLIENT_DEADLINES.preferencesMs, signal);
  }

  updatePreferences(input: DailyBriefPreferenceInput, signal?: AbortSignal) {
    return this.request<DailyBriefSettings>("/api/advisor/preferences", { method: "PUT", body: JSON.stringify(input) }, DAILY_BRIEF_CLIENT_DEADLINES.preferencesMs, signal);
  }

  requestBrief(input: Readonly<{ installationId: string; retry: boolean }>, signal?: AbortSignal) {
    return this.request<DailyBriefResponse>("/api/advisor/brief", { method: "POST", body: JSON.stringify(input) }, DAILY_BRIEF_CLIENT_DEADLINES.briefMs, signal);
  }

  /** The deadline covers session lookup, request and body decoding; a caller signal only adds cancellation. */
  private request<T>(path: string, init: RequestInit, deadlineMs: number, signal?: AbortSignal): Promise<T> {
    return dailyBriefFetch<T>(fetch, `${this.origin}${path}`, { ...init, redirect: "error" }, {
      signal,
      deadlineMs,
      headers: async () => {
        const token = await this.accessToken();
        if (!token) throw new DailyBriefRequestError("unauthenticated");
        return { Authorization: `Bearer ${token}` };
      },
    });
  }
}
