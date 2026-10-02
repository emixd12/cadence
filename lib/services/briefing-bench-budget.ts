import { DailyBriefError } from "./daily-brief-consumer";

export type BriefingBenchBudgetSnapshot = Readonly<{ limit: number; used: number; reserved: number; inFlight: number; available: number; windowMs: number }>;
export type BriefingBenchReservation = ReturnType<ReturnType<typeof createBriefingBenchBudget>["reserve"]>;

/** Count provider submissions, rather than comparisons, separately from production admission. */
export function createBriefingBenchBudget(limit = 100, now = Date.now) {
  let reserved = 0, inFlight = 0;
  let dispatched: number[] = [];
  const waiting: Array<() => void> = [];
  const windowMs = 3_600_000;
  const snapshot = (): BriefingBenchBudgetSnapshot => {
    dispatched = dispatched.filter((at) => now() - at < windowMs);
    return { limit, used: dispatched.length, reserved, inFlight, available: Math.max(0, limit - dispatched.length - reserved), windowMs };
  };
  const acquire = (signal: AbortSignal) => new Promise<void>((resolve, reject) => {
    const abort = () => { const index = waiting.indexOf(enter); if (index >= 0) waiting.splice(index, 1); reject(new DailyBriefError("cancelled")); };
    const enter = () => {
      signal.removeEventListener("abort", abort);
      if (signal.aborted) { reject(new DailyBriefError("cancelled")); return; }
      inFlight += 1; resolve();
    };
    if (signal.aborted) { reject(new DailyBriefError("cancelled")); return; }
    if (inFlight < 2) enter();
    else { waiting.push(enter); signal.addEventListener("abort", abort, { once: true }); }
  });
  function reserve(count: number) {
    if (!Number.isSafeInteger(count) || count < 0 || count > snapshot().available) throw new DailyBriefError("comparison_limit", 3600);
    reserved += count;
    let remaining = count, used = 0, closed = false;
    return {
      get used() { return used; },
      close() { if (!closed) { reserved -= remaining; remaining = 0; closed = true; } },
      async dispatch<T>(signal: AbortSignal, call: () => Promise<T>, beforeDispatch?: () => Promise<void>): Promise<T> {
        if (closed || remaining === 0) throw new DailyBriefError("comparison_limit", 3600);
        await acquire(signal);
        try {
          if (beforeDispatch) await beforeDispatch();
          signal.throwIfAborted();
          if (closed || remaining === 0) throw new DailyBriefError("comparison_limit", 3600);
          remaining -= 1; reserved -= 1; used += 1; dispatched.push(now());
          // Hold the permit until the actual provider settles, even when its caller times out.
          return await call();
        } finally { inFlight -= 1; waiting.shift()?.(); }
      },
    };
  }
  return { snapshot, reserve };
}

// ponytail: one process handles the loopback bench; use shared admission before authorizing hosted evaluation.
const BUDGET_KEY = Symbol.for("cadence.briefingBenchBudget");
export function briefingBenchBudget() {
  const configured = Number(process.env.CADENCE_BRIEFING_BENCH_CALL_LIMIT ?? 100);
  const shared = globalThis as typeof globalThis & { [BUDGET_KEY]?: ReturnType<typeof createBriefingBenchBudget> };
  const value = shared[BUDGET_KEY] ??= createBriefingBenchBudget(Number.isSafeInteger(configured) && configured > 0 && configured <= 100 ? configured : 100);
  return { snapshot: value.snapshot, reserve(count: number) {
    // A prior development bundle may own the shared closure; normalize its error to this bundle's class.
    try { return value.reserve(count); } catch { throw new DailyBriefError("comparison_limit", 3600); }
  } };
}
