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
  connection: Pick<ChatGptConnection, "status" | "accessToken" | "subscribe" | "isChanging">;
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
        subscribe: (listener) => planPath.connection.subscribe((event) => listener(event.kind)),
      };
    }
  }

  preferences(signal?: AbortSignal) {
    return this.settingsRequest({}, signal);
  }

  updatePreferences(input: DailyBriefPreferenceInput, signal?: AbortSignal) {
    return this.settingsRequest({ method: "PUT", body: JSON.stringify(input) }, signal);
  }

  async requestBrief(input: DailyBriefRequestInput, signal?: AbortSignal): Promise<DailyBriefResponse> {
    const plan = this.planPath;
    if (!plan) return this.hostedBrief(input, signal);
    // A grant change invalidates this request even when its launcher is not mounted.
    const lifetime = new AbortController();
    const cancel = () => lifetime.abort();
    if (signal?.aborted) cancel();
    signal?.addEventListener("abort", cancel, { once: true });
    const unsubscribe = plan.connection.subscribe((event) => { if (event.kind === "start") cancel(); });
    try {
      return await withDailyBriefDeadline(DAILY_BRIEF_CLIENT_DEADLINES.briefMs, lifetime.signal, async (deadline) => {
        if (plan.connection.isChanging()) throw new DailyBriefRequestError("chatgpt_retry_later");
        const status = await plan.connection.status().catch(() => { throw new DailyBriefRequestError("chatgpt_retry_later"); });
        if (deadline.aborted) throw new DailyBriefRequestError("cancelled");
        // D27: never connected, or connected without plan usage, keeps today's hosted path.
        if (status.state === "disconnected") return this.hostedBrief(input, deadline);
        if (status.state === "connectedWithoutPlanUsage") {
          const response = await this.hostedBrief(input, deadline);
          if (response.state === "ready") this.planOffBriefs.add(response.briefing);
          return response;
        }
        // D27: a connected plan that cannot run the brief shows why; Cadence's key never runs it.
        if (status.state === "needsReconnect") throw new DailyBriefRequestError("chatgpt_reconnect");
        if (!this.settings?.deviceModelAvailable) throw new DailyBriefRequestError("chatgpt_unavailable");
        return this.planBrief(plan, input, deadline);
      });
    } finally {
      unsubscribe();
      signal?.removeEventListener("abort", cancel);
    }
  }

  private hostedBrief(input: DailyBriefRequestInput, signal?: AbortSignal) {
    return this.request<DailyBriefResponse>("/api/advisor/brief", { method: "POST", body: JSON.stringify(input) }, DAILY_BRIEF_CLIENT_DEADLINES.briefMs, signal);
  }

  /** Prepare, the model call on the user's plan, then complete. Any later failure releases the pending attempt. */
  private async planBrief(plan: DesktopDailyBriefPlan, input: DailyBriefRequestInput, signal: AbortSignal): Promise<DailyBriefResponse> {
    // Read the token first, so a needed reconnect does not spend an attempt. It stays in this call's memory only.
    const accessToken = await plan.connection.accessToken().catch((error: unknown) => {
      const text = error instanceof Error ? error.message : "";
      throw new DailyBriefRequestError(text.startsWith("Reconnect ChatGPT") || text.startsWith("ChatGPT is not connected") ? "chatgpt_reconnect" : "chatgpt_retry_later");
    });
    const prepared = await this.request<DevicePrepareResponse>("/api/advisor/brief/device/prepare", { method: "POST", body: JSON.stringify(input) }, DEVICE_PREPARE_MS, signal);
    if (prepared.state !== "prepared") return prepared;
    try {
      const modelMs = Date.parse(prepared.expiresAt) - Date.now() - COMPLETE_RESERVE_MS;
      if (!Number.isFinite(modelMs) || modelMs <= 0) throw new DailyBriefRequestError("context_expired");
      const output = await withDailyBriefDeadline(modelMs, signal, async (modelSignal) => {
        const call = { accessToken, signal: modelSignal, ...(plan.fetch ? { fetch: plan.fetch } : {}) };
        return generateChatGPTPlanDailyBrief(prepared.request, { ...call, model: await chooseChatGPTPlanModel(call) });
      }).catch((error: unknown) => {
        if (error instanceof DailyBriefRequestError && error.code === "cancelled") throw error;
        throw new DailyBriefRequestError(`chatgpt_${error instanceof ChatGPTPlanError ? error.code
          : error instanceof DailyBriefRequestError && error.code === "timeout" ? "timeout" : "retry_later"}`);
      });
      const response = await this.request<DailyBriefResponse>("/api/advisor/brief/device/complete", {
        method: "POST", body: JSON.stringify({ installationId: input.installationId, envelope: prepared.envelope, output }),
      }, DEVICE_COMPLETE_MS, signal);
      if (response.state === "ready") this.planBriefs.add(response.briefing);
      return response;
    } catch (error) {
      // The pending-only RPC is safe even if complete succeeded but its response was lost.
      // Use a separate deadline because cancellation may already have ended this request.
      await this.request("/api/advisor/brief/device/release", { method: "POST", body: JSON.stringify({ installationId: input.installationId, envelope: prepared.envelope }) }, DEVICE_RELEASE_MS)
        .catch(() => undefined);
      throw error;
    }
  }

  /** Keep the server's settings for route selection; normalize availability only for this Mac's UI. */
  private settingsRequest(init: RequestInit, signal?: AbortSignal): Promise<DailyBriefSettings> {
    return withDailyBriefDeadline(DAILY_BRIEF_CLIENT_DEADLINES.preferencesMs, signal, async (deadline) => {
      const settings = await this.request<DailyBriefSettings>("/api/advisor/preferences", init, DAILY_BRIEF_CLIENT_DEADLINES.preferencesMs, deadline);
      let available = settings.available;
      if (!available && settings.deviceModelAvailable && this.planPath) {
        const status = await this.planPath.connection.status().catch(() => null);
        available = status?.state === "connectedWithPlanUsage" || status?.state === "needsReconnect";
      }
      if (deadline.aborted) throw new DailyBriefRequestError("cancelled");
      this.settings = settings;
      return available === settings.available ? settings : { ...settings, available };
    });
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
