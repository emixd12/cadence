import { reportMonitoringEvent } from "@/lib/monitoring/privacy-safe-events";
import type { CalendarListEntry } from "@/lib/types/google-calendar";
import type { ExternalEventSnapshotV1 } from "@cadence/core/types/external-event";

export const DEFAULT_MCP_CALENDARS_TTL_MS = 10 * 60 * 1_000; // 10 minutes
export const DEFAULT_MCP_SNAPSHOT_TTL_MS = 5 * 60 * 1_000; // 5 minutes
export const DEFAULT_MCP_CACHE_MAX_ENTRIES = 500;
export const DEFAULT_MCP_DAILY_USER_LIMIT = 40;
export const DEFAULT_MCP_DAILY_PROJECT_ALERT_THRESHOLD = 3_500;

export type GoogleCalendarMcpCacheKey = Readonly<{
  userId: string;
  grantGeneration: number;
  selectionRevision: number;
  rangeKey: string;
}>;

export type GoogleCalendarMcpBudgetResult = Readonly<{
  allowed: boolean;
  remaining: number;
  limit: number;
  used: number;
  utcDay: string;
  reason?: "mcp_daily_budget_exceeded";
}>;

export type GoogleCalendarMcpCacheOptions = Readonly<{
  calendarsTtlMs?: number;
  snapshotTtlMs?: number;
  maxEntries?: number;
  dailyUserLimit?: number;
  dailyProjectAlertThreshold?: number;
  now?: () => number;
  reportEvent?: typeof reportMonitoringEvent;
}>;

type CacheEntry<T> = {
  userId: string;
  value: T;
  expiresAt: number;
};

export type GoogleCalendarMcpCache = Readonly<{
  getCalendars: (key: Omit<GoogleCalendarMcpCacheKey, "rangeKey">) => CalendarListEntry[] | null;
  setCalendars: (key: Omit<GoogleCalendarMcpCacheKey, "rangeKey">, calendars: CalendarListEntry[]) => void;
  getSnapshot: (key: GoogleCalendarMcpCacheKey) => ExternalEventSnapshotV1 | null;
  setSnapshot: (key: GoogleCalendarMcpCacheKey, snapshot: ExternalEventSnapshotV1) => void;
  invalidateUser: (userId: string) => void;
  consumeBudget: (userId: string, count?: number) => GoogleCalendarMcpBudgetResult;
  getBudgetStatus: (userId: string) => GoogleCalendarMcpBudgetResult;
  getProjectDailyCount: () => number;
  clear: () => void;
}>;

export function createGoogleCalendarMcpCache(
  options: GoogleCalendarMcpCacheOptions = {},
): GoogleCalendarMcpCache {
  const calendarsTtlMs = options.calendarsTtlMs ?? DEFAULT_MCP_CALENDARS_TTL_MS;
  const snapshotTtlMs = options.snapshotTtlMs ?? DEFAULT_MCP_SNAPSHOT_TTL_MS;
  const maxEntries = Math.max(1, options.maxEntries ?? DEFAULT_MCP_CACHE_MAX_ENTRIES);
  const dailyUserLimit = Math.max(1, options.dailyUserLimit ?? DEFAULT_MCP_DAILY_USER_LIMIT);
  const dailyProjectAlertThreshold = Math.max(
    1,
    options.dailyProjectAlertThreshold ?? DEFAULT_MCP_DAILY_PROJECT_ALERT_THRESHOLD,
  );
  const clock = options.now ?? Date.now;
  const emitEvent = options.reportEvent ?? reportMonitoringEvent;

  const calendarCache = new Map<string, CacheEntry<CalendarListEntry[]>>();
  const snapshotCache = new Map<string, CacheEntry<ExternalEventSnapshotV1>>();

  // Budget state keyed by `${userId}\0${utcDay}`
  const userDailyCounts = new Map<string, number>();
  const projectDailyCounts = new Map<string, number>();
  const projectAlertEmittedDays = new Set<string>();

  function utcDayString(timestampMs: number): string {
    return new Date(timestampMs).toISOString().slice(0, 10);
  }

  function serializeKey(key: GoogleCalendarMcpCacheKey): string {
    return JSON.stringify([
      key.userId,
      key.grantGeneration,
      key.selectionRevision,
      key.rangeKey,
    ]);
  }

  function getFromLru<T>(store: Map<string, CacheEntry<T>>, serializedKey: string): T | null {
    const entry = store.get(serializedKey);
    if (!entry) return null;
    if (clock() >= entry.expiresAt) {
      store.delete(serializedKey);
      return null;
    }
    // Refresh LRU recency
    store.delete(serializedKey);
    store.set(serializedKey, entry);
    return entry.value;
  }

  function setInLru<T>(
    store: Map<string, CacheEntry<T>>,
    serializedKey: string,
    userId: string,
    value: T,
    ttlMs: number,
  ): void {
    const nowMs = clock();
    if (store.has(serializedKey)) {
      store.delete(serializedKey);
    }
    store.set(serializedKey, {
      userId,
      value,
      expiresAt: nowMs + ttlMs,
    });
    while (store.size > maxEntries) {
      const oldestKey = store.keys().next().value;
      if (oldestKey === undefined) break;
      store.delete(oldestKey);
    }
  }

  function pruneOldBudgetDays(currentDay: string): void {
    if (userDailyCounts.size <= 1_000 && projectDailyCounts.size <= 7) return;
    for (const key of userDailyCounts.keys()) {
      if (!key.endsWith(`\0${currentDay}`)) {
        userDailyCounts.delete(key);
      }
    }
    for (const day of projectDailyCounts.keys()) {
      if (day !== currentDay) {
        projectDailyCounts.delete(day);
        projectAlertEmittedDays.delete(day);
      }
    }
  }

  return {
    getCalendars(key) {
      const serialized = serializeKey({ ...key, rangeKey: "__calendars__" });
      return getFromLru(calendarCache, serialized);
    },

    setCalendars(key, calendars) {
      const serialized = serializeKey({ ...key, rangeKey: "__calendars__" });
      setInLru(calendarCache, serialized, key.userId, calendars, calendarsTtlMs);
    },

    getSnapshot(key) {
      const serialized = serializeKey(key);
      return getFromLru(snapshotCache, serialized);
    },

    setSnapshot(key, snapshot) {
      const serialized = serializeKey(key);
      setInLru(snapshotCache, serialized, key.userId, snapshot, snapshotTtlMs);
    },

    invalidateUser(userId) {
      for (const [key, entry] of calendarCache.entries()) {
        if (entry.userId === userId) {
          calendarCache.delete(key);
        }
      }
      for (const [key, entry] of snapshotCache.entries()) {
        if (entry.userId === userId) {
          snapshotCache.delete(key);
        }
      }
    },

    consumeBudget(userId, count = 1) {
      if (!Number.isSafeInteger(count) || count < 1) {
        throw new RangeError("MCP budget consumption count must be a positive integer.");
      }
      const utcDay = utcDayString(clock());
      pruneOldBudgetDays(utcDay);

      const userDayKey = `${userId}\0${utcDay}`;
      const currentUsed = userDailyCounts.get(userDayKey) ?? 0;
      if (currentUsed + count > dailyUserLimit) {
        return {
          allowed: false,
          remaining: Math.max(0, dailyUserLimit - currentUsed),
          limit: dailyUserLimit,
          used: currentUsed,
          utcDay,
          reason: "mcp_daily_budget_exceeded",
        };
      }

      const nextUsed = currentUsed + count;
      userDailyCounts.set(userDayKey, nextUsed);

      const nextProjectCount = (projectDailyCounts.get(utcDay) ?? 0) + count;
      projectDailyCounts.set(utcDay, nextProjectCount);

      if (nextProjectCount >= dailyProjectAlertThreshold && !projectAlertEmittedDays.has(utcDay)) {
        projectAlertEmittedDays.add(utcDay);
        emitEvent({
          name: "google_calendar_mcp_daily_volume_warning",
          severity: "warning",
          context: {
            utc_day: utcDay,
            daily_requests: nextProjectCount,
            alert_threshold: dailyProjectAlertThreshold,
          },
        });
      }

      return {
        allowed: true,
        remaining: Math.max(0, dailyUserLimit - nextUsed),
        limit: dailyUserLimit,
        used: nextUsed,
        utcDay,
      };
    },

    getBudgetStatus(userId) {
      const utcDay = utcDayString(clock());
      const used = userDailyCounts.get(`${userId}\0${utcDay}`) ?? 0;
      const remaining = Math.max(0, dailyUserLimit - used);
      return remaining > 0
        ? { allowed: true, remaining, limit: dailyUserLimit, used, utcDay }
        : {
            allowed: false,
            remaining: 0,
            limit: dailyUserLimit,
            used,
            utcDay,
            reason: "mcp_daily_budget_exceeded",
          };
    },

    getProjectDailyCount() {
      const utcDay = utcDayString(clock());
      return projectDailyCounts.get(utcDay) ?? 0;
    },

    clear() {
      calendarCache.clear();
      snapshotCache.clear();
      userDailyCounts.clear();
      projectDailyCounts.clear();
      projectAlertEmittedDays.clear();
    },
  };
}

const defaultCache = createGoogleCalendarMcpCache();

export function getCachedGoogleCalendarMcpCalendars(
  key: Omit<GoogleCalendarMcpCacheKey, "rangeKey">,
): CalendarListEntry[] | null {
  return defaultCache.getCalendars(key);
}

export function setCachedGoogleCalendarMcpCalendars(
  key: Omit<GoogleCalendarMcpCacheKey, "rangeKey">,
  calendars: CalendarListEntry[],
): void {
  defaultCache.setCalendars(key, calendars);
}

export function getCachedGoogleCalendarMcpSnapshot(
  key: GoogleCalendarMcpCacheKey,
): ExternalEventSnapshotV1 | null {
  return defaultCache.getSnapshot(key);
}

export function setCachedGoogleCalendarMcpSnapshot(
  key: GoogleCalendarMcpCacheKey,
  snapshot: ExternalEventSnapshotV1,
): void {
  defaultCache.setSnapshot(key, snapshot);
}

export function invalidateGoogleCalendarMcpCache(userId: string): void {
  defaultCache.invalidateUser(userId);
}

export function consumeGoogleCalendarMcpBudget(
  userId: string,
  count = 1,
): GoogleCalendarMcpBudgetResult {
  return defaultCache.consumeBudget(userId, count);
}

export function resetGoogleCalendarMcpCacheForTests(): void {
  defaultCache.clear();
}
