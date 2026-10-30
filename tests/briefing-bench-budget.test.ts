import { expect, it } from "vitest";
import { createBriefingBenchBudget } from "@/lib/services/briefing-bench-budget";

it("reserves exact calls across callers, permits two providers, and releases undispatched cancellation", async () => {
  const budget = createBriefingBenchBudget(4);
  const first = budget.reserve(2), second = budget.reserve(2);
  expect(() => budget.reserve(1)).toThrow("comparison_limit");
  const controller = new AbortController();
  let releaseA!: () => void, releaseB!: () => void;
  const a = first.dispatch(controller.signal, () => new Promise<void>(resolve => { releaseA = resolve; }));
  const b = second.dispatch(controller.signal, () => new Promise<void>(resolve => { releaseB = resolve; }));
  await Promise.resolve();
  const queued = second.dispatch(controller.signal, async () => { throw new Error("must_not_dispatch"); });
  expect(budget.snapshot()).toMatchObject({ used: 2, reserved: 2, inFlight: 2, available: 0 });
  controller.abort();
  await expect(queued).rejects.toThrow("cancelled");
  first.close(); second.close();
  expect(budget.snapshot()).toMatchObject({ used: 2, reserved: 0, inFlight: 2, available: 2 });
  releaseA(); releaseB(); await Promise.all([a, b]);
  expect(budget.snapshot().inFlight).toBe(0);
});

it("counts failed calls and new retries without refunding provider failures", async () => {
  let clock = 0;
  const budget = createBriefingBenchBudget(2, () => clock);
  const first = budget.reserve(1);
  await expect(first.dispatch(new AbortController().signal, async () => { throw new Error("failure"); })).rejects.toThrow("failure"); first.close();
  const retry = budget.reserve(1);
  await retry.dispatch(new AbortController().signal, async () => "ready"); retry.close();
  expect(budget.snapshot()).toMatchObject({ used: 2, reserved: 0 });
  expect(() => budget.reserve(1)).toThrow("comparison_limit");
  clock = 3_600_000;
  expect(budget.snapshot().available).toBe(2);
});

it("never counts a signal aborted before provider dispatch", async () => {
  const budget = createBriefingBenchBudget(1), reservation = budget.reserve(1), controller = new AbortController();
  controller.abort();
  await expect(reservation.dispatch(controller.signal, async () => "unexpected")).rejects.toThrow("cancelled");
  reservation.close();
  expect(budget.snapshot()).toMatchObject({ used: 0, reserved: 0, inFlight: 0 });
});
