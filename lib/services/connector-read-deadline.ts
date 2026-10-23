import { ConnectorError } from "@/lib/types/connectors";
import { ProviderCallTimeoutError, runProviderCallWithTimeout } from "./provider-call-timeout";

type ConnectorReadOptions = Readonly<{ clock?: () => number; signal?: AbortSignal; deadlineMs?: number }>;

export function assertConnectorReadActive(options: ConnectorReadOptions, deadlineAt: number): void {
  if (options.signal?.aborted || (options.clock ?? Date.now)() >= deadlineAt) throw new ConnectorError("timeout");
}

/** Bounds the whole read, including database waits and the final credential fence. */
export async function withConnectorReadDeadline<Options extends ConnectorReadOptions, Result>(
  options: Options,
  maximumMs: number,
  read: (bounded: Options & { signal: AbortSignal }, deadlineAt: number) => Promise<Result>,
): Promise<Result> {
  if (options.deadlineMs !== undefined && (!Number.isFinite(options.deadlineMs) || options.deadlineMs <= 0)) {
    throw new ConnectorError("timeout");
  }
  const timeoutMs = Math.max(1, Math.ceil(Math.min(maximumMs, options.deadlineMs ?? maximumMs)));
  const deadlineAt = (options.clock ?? Date.now)() + timeoutMs;
  const signal = AbortSignal.any([AbortSignal.timeout(timeoutMs), ...(options.signal ? [options.signal] : [])]);
  const bounded = { ...options, signal };
  try {
    return await runProviderCallWithTimeout(async () => {
      assertConnectorReadActive(bounded, deadlineAt);
      const result = await read(bounded, deadlineAt);
      assertConnectorReadActive(bounded, deadlineAt);
      return result;
    }, { signal, timeoutMs });
  } catch (error) {
    if (error instanceof ProviderCallTimeoutError) throw new ConnectorError("timeout");
    throw error;
  }
}
