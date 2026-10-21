import { invoke, isTauri } from "@tauri-apps/api/core";

export const nativeAvailable = isTauri();
export type Snapshot = { value: string | null; revision: number };
export type NativeDeliveryProof = { requestId: string; fireAt: string; title: string; body: string; deliveredAt: string };
export type NativeEvent = { kind: string; id?: string; at: string; delivery?: NativeDeliveryProof };
export type Reminder = { id: string; title: string; body: string; fireAt: string };
export type DeliveredReminder = { id: string; title: string; body: string; fireAt: string | null; deliveredAt: string };
export type NotificationResult = {
  authorization?: string;
  bundleIdentifier?: string;
  pending?: Reminder[];
  delivered?: DeliveredReminder[];
  requestedCount?: number;
  missingIds?: string[];
  errors?: { id: string; error: string }[];
};

export const readSnapshot = () => invoke<Snapshot>("spike_read");
export const writeSnapshot = (value: string, forceRollback: boolean) =>
  invoke<Snapshot>("spike_write", { value, forceRollback });
export const readNativeEvents = () => invoke<NativeEvent[]>("native_events");
export const notifications = (request: {
  operation: "status" | "requestPermission" | "pending" | "delivered" | "schedule" | "cancel" | "cancelPending";
  reminders?: Reminder[];
  ids?: string[];
}) => invoke<NotificationResult>("native_notifications", { request });

// Operator-only scheduling probe. Product scheduling belongs to shared resolvers.
export function assertProbeCount(count: number) {
  if (!Number.isInteger(count) || count < 1 || count > 4096) {
    throw new Error("Use 1 to 4096 notifications.");
  }
}

export async function scheduleProbe(count: number, delaySeconds: number) {
  assertProbeCount(count);
  if (!Number.isFinite(delaySeconds) || delaySeconds < 10 || delaySeconds > 2592000) {
    throw new Error("Use a delay from 10 seconds through 30 days.");
  }
  const fireAt = new Date(Date.now() + delaySeconds * 1000).toISOString();
  return notifications({
    operation: "schedule",
    reminders: Array.from({ length: count }, (_, index) => ({
      id: `cadence-spike.${index + 1}`,
      title: "Cadence native reminder test",
      body: "Synthetic notification. Open Cadence to verify activation.",
      fireAt,
    })),
  });
}

export async function cancelProbes() {
  const [{ pending = [] }, { delivered = [] }] = await Promise.all([
    notifications({ operation: "pending" }), notifications({ operation: "delivered" }),
  ]);
  const ids = [...new Set([...pending, ...delivered].map(({ id }) => id).filter((id) => id.startsWith("cadence-spike.")))];
  return notifications({ operation: "cancel", ids });
}
