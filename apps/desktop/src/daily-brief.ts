import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  DailyBriefing,
  DailyBriefResponse,
  DailyBriefSettings,
} from "@cadence/core/types/daily-brief";
import type { DailyBriefClient, DailyBriefPlanControls, DailyBriefPreferenceInput, DailyBriefRequestInput } from "@/lib/ui/daily-brief";
import { DAILY_BRIEF_CLIENT_DEADLINES, DailyBriefRequestError, dailyBriefFetch, withDailyBriefDeadline } from "@/lib/ui/daily-brief";
import { ChatGPTPlanError, chooseChatGPTPlanModel, generateChatGPTPlanDailyBrief } from "@/lib/services/daily-brief-chatgpt-plan";
import { readDesktopCalendarBrokerOrigin } from "./calendar/google-calendar";
import type { ChatGptConnection } from "./chatgpt/connection";

/**
 * Ticket 299 (decision D27): the Mac's ChatGPT plan path, present only when the plan
 * switch is on. `connect` starts ChatGPT sign-in; `openUsage` opens ChatGPT usage settings.
 */
export type DesktopDailyBriefPlan = Readonly<{
  connection: Pick<ChatGptConnection, "status" | "accessToken">;
  connect: () => Promise<void>;
  openUsage: () => void;
  /** The model call's fetch; tests pass a fake. */
  fetch?: typeof fetch;
}>;

/** The device prepare response (Ticket 298). Kept local so the webview imports no server module. */
type DevicePrepareResponse =
  | Readonly<{ state: "prepared"; request: Readonly<{ instructions: string; facts: string }>; envelope: string; expiresAt: string }>
  | Exclude<DailyBriefResponse, Readonly<{ state: "ready" }>>;

/** Prepare has 35 seconds on the server; complete and release are short. */
const DEVICE_PREPARE_MS = 40_000;
const DEVICE_COMPLETE_MS = 20_000;
const DEVICE_RELEASE_MS = 10_000;
/** The model call ends this long before the envelope does, leaving time for complete. */
const COMPLETE_RESERVE_MS = 8_000;

export function createDesktopDailyBriefClient(
  client: SupabaseClient,
  origin = readDesktopCalendarBrokerOrigin(),
  plan: DesktopDailyBriefPlan | null = null,
): DailyBriefClient | null {
  return origin ? new DesktopDailyBriefClient(origin, async () => (await client.auth.getSession()).data.session?.access_token ?? null, plan) : null;
}

export class DesktopDailyBriefClient implements DailyBriefClient {
  readonly plan?: DailyBriefPlanControls;
  /** The latest settings read; `deviceModelAvailable` decides whether the plan path can run. */
  private settings: DailyBriefSettings | null = null;
  private readonly planBriefs = new WeakSet<DailyBriefing>();
  private readonly planOffBriefs = new WeakSet<DailyBriefing>();

  constructor(
    private readonly origin: string,
    private readonly accessToken: () => Promise<string | null>,
    private readonly planPath: DesktopDailyBriefPlan | null = null,
    private readonly fetcher: typeof fetch = (...args) => fetch(...args),
  ) {
    if (planPath) {
      this.plan = {
        usage: (briefing) => this.planBriefs.has(briefing) ? "plan" : this.planOffBriefs.has(briefing) ? "plan_off" : null,
        manageUsage: planPath.openUsage,
        connect: planPath.connect,
      };
    }
  }

  async preferences(signal?: AbortSignal) {
    return this.remember(await this.request<DailyBriefSettings>("/api/advisor/preferences", {}, DAILY_BRIEF_CLIENT_DEADLINES.preferencesMs, signal));
  }

  async updatePreferences(input: DailyBriefPreferenceInput, signal?: AbortSignal) {
    return this.remember(await this.request<DailyBriefSettings>("/api/advisor/preferences", { method: "PUT", body: JSON.stringify(input) }, DAILY_BRIEF_CLIENT_DEADLINES.preferencesMs, signal));
  }

  async requestBrief(input: DailyBriefRequestInput, signal?: AbortSignal): Promise<DailyBriefResponse> {
    const plan = this.planPath;
    if (!plan) return this.hostedBrief(input, signal);
    const status = await plan.connection.status().catch(() => { throw new DailyBriefRequestError("chatgpt_retry_later"); });
    // D27: never connected, or connected without plan usage, keeps today's hosted path.
    if (status.state === "disconnected") return this.hostedBrief(input, signal);
    if (status.state === "connectedWithoutPlanUsage") {
      const response = await this.hostedBrief(input, signal);
      if (response.state === "ready") this.planOffBriefs.add(response.briefing);
      return response;
    }
    // D27: a connected plan that cannot run the brief shows why; Cadence's key never runs it.
    if (status.state === "needsReconnect") throw new DailyBriefRequestError("chatgpt_reconnect");
    if (!this.settings?.deviceModelAvailable) throw new DailyBriefRequestError("chatgpt_unavailable");
    return withDailyBriefDeadline(DAILY_BRIEF_CLIENT_DEADLINES.briefMs, signal, (deadline) => this.planBrief(plan, input, deadline));
  }

  private hostedBrief(input: DailyBriefRequestInput, signal?: AbortSignal) {
    return this.request<DailyBriefResponse>("/api/advisor/brief", { method: "POST", body: JSON.stringify(input) }, DAILY_BRIEF_CLIENT_DEADLINES.briefMs, signal);
  }

  /** Prepare, the model call on the user's plan, then complete. A failed model call releases the attempt. */
  private async planBrief(plan: DesktopDailyBriefPlan, input: DailyBriefRequestInput, signal: AbortSignal): Promise<DailyBriefResponse> {
    // Read the token first, so a needed reconnect does not spend an attempt. It stays in this call's memory only.
    const accessToken = await plan.connection.accessToken().catch((error: unknown) => {
      const text = error instanceof Error ? error.message : "";
      throw new DailyBriefRequestError(text.startsWith("Reconnect ChatGPT") || text.startsWith("ChatGPT is not connected") ? "chatgpt_reconnect" : "chatgpt_retry_later");
    });
    const prepared = await this.request<DevicePrepareResponse>("/api/advisor/brief/device/prepare", { method: "POST", body: JSON.stringify(input) }, DEVICE_PREPARE_MS, signal);
    if (prepared.state !== "prepared") return prepared;
    const model = new AbortController();
    const stop = () => model.abort();
    const timer = setTimeout(stop, Math.max(0, Date.parse(prepared.expiresAt) - Date.now() - COMPLETE_RESERVE_MS));
    signal.addEventListener("abort", stop, { once: true });
    let output: unknown;
    try {
      const call = { accessToken, signal: model.signal, ...(plan.fetch ? { fetch: plan.fetch } : {}) };
      output = await generateChatGPTPlanDailyBrief(prepared.request, { ...call, model: await chooseChatGPTPlanModel(call) });
    } catch (error) {
      // Owner decision, November 12, 2026: free the lease now, so a retry need not wait for it.
      // Its own deadline: the brief's signal may already have ended.
      await this.request("/api/advisor/brief/device/release", { method: "POST", body: JSON.stringify({ installationId: input.installationId, envelope: prepared.envelope }) }, DEVICE_RELEASE_MS)
        .catch(() => undefined);
      throw new DailyBriefRequestError(`chatgpt_${error instanceof ChatGPTPlanError ? error.code : "retry_later"}`);
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", stop);
    }
    const response = await this.request<DailyBriefResponse>("/api/advisor/brief/device/complete", {
      method: "POST", body: JSON.stringify({ installationId: input.installationId, envelope: prepared.envelope, output }),
    }, DEVICE_COMPLETE_MS, signal);
    if (response.state === "ready") this.planBriefs.add(response.briefing);
    return response;
  }

  private remember(settings: DailyBriefSettings): DailyBriefSettings {
    this.settings = settings;
    return settings;
  }

  /** The deadline covers session lookup, request and body decoding; a caller signal only adds cancellation. */
  private request<T>(path: string, init: RequestInit, deadlineMs: number, signal?: AbortSignal): Promise<T> {
    return dailyBriefFetch<T>(this.fetcher, `${this.origin}${path}`, { ...init, redirect: "error" }, {
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
