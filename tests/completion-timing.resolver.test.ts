import { Temporal } from '@js-temporal/polyfill';
import { describe, expect, it } from 'vitest';
import { resolveCompletionTiming, type CompletionTimingOccurrence } from '../packages/core/src/resolvers/completion-timing.resolver';
import { resolveStatusTransition } from '../packages/core/src/resolvers/status.resolver';

const now = Temporal.Instant.from('2026-11-03T17:00:00Z');
function occurrence(day: string, time: string, id = day): CompletionTimingOccurrence {
  return { id, behaviorId: 'walk', localDate: day, status: 'completed',
    statusMarkedAt: Temporal.PlainDate.from(day).toZonedDateTime({ timeZone: 'America/New_York', plainTime: time }).toInstant().toString() };
}
const morning = [occurrence('2026-10-31', '08:10'), occurrence('2026-11-01', '08:25'), occurrence('2026-11-02', '08:15')];
const resolve = (occurrences = morning, overrides = {}) => resolveCompletionTiming({ behaviorId: 'walk', occurrences,
  timezone: 'America/New_York', now, historyDays: 7, complete: true, sourceAvailable: true, ...overrides });

describe('historical completion marking patterns', () => {
  it('uses three prior marks across DST without requiring a completed occurrence today', () => {
    expect(resolve([...morning, { ...occurrence('2026-11-03', '08:00'), status: 'unresolved' }])).toMatchObject({
      sampleCount: 3, sampledDayCount: 3, typicalMarkedTime: '08:15', reason: null,
      range: { startTime: '08:10', endTime: '08:25', spansMidnight: false },
    });
  });
  it('keeps midnight neighbors adjacent and uses the requested timezone', () => {
    const rows = [occurrence('2026-10-31', '23:50'), occurrence('2026-11-01', '00:10'), occurrence('2026-11-02', '00:05')];
    expect(resolve(rows)).toMatchObject({ typicalMarkedTime: '00:05', range: { startTime: '23:50', endTime: '00:10', spansMidnight: true } });
    expect(resolve(morning, { timezone: 'America/Los_Angeles' }).typicalMarkedTime).toBe('05:15');
  });
  it('filters both occurrence dates and mark dates to preceding complete local days', () => {
    const rows = [...morning,
      { ...occurrence('2026-11-02', '08:00', 'today-mark'), statusMarkedAt: '2026-11-03T05:00:00Z' },
      occurrence('2026-10-26', '08:00'),
      { ...occurrence('2026-11-02', '08:00', 'utc-boundary'), statusMarkedAt: '2026-11-03T04:59:00Z' },
    ];
    const result = resolve(rows, { historyDays: 2 });
    expect(result.sampleCount).toBe(3);
    expect(result.sampledDayCount).toBe(2);
    expect(result.reason).toBe('insufficient_samples');
    expect(result.exclusions.outsideWindow).toBe(3);
  });
  it('keeps delayed marks as approximate evidence and excludes one-day batch logging as a typical pattern', () => {
    const rows = morning.map((row, index) => ({ ...row, localDate: `2026-10-${28 + index}` }));
    expect(resolve(rows)).toMatchObject({ sampleCount: 3, delayedMarkCount: 3, typicalMarkedTime: '08:15' });
    expect(resolve(rows.map(row => ({ ...row, statusMarkedAt: rows[0].statusMarkedAt })))).toMatchObject({ sampleCount: 3, sampledDayCount: 1, typicalMarkedTime: null });
  });
  it('does not manufacture a typical time from sparse, dispersed, capped or unavailable evidence', () => {
    expect(resolve(morning.slice(0, 2))).toMatchObject({ sampleCount: 2, reason: 'insufficient_samples', typicalMarkedTime: null });
    expect(resolve([morning[0], morning[1], occurrence('2026-11-02', '20:00')])).toMatchObject({ reason: 'dispersed_times', typicalMarkedTime: null });
    expect(resolve(morning, { complete: false })).toMatchObject({ sampleCount: 0, reason: 'history_limit_exceeded' });
    expect(resolve(morning, { sourceAvailable: false })).toMatchObject({ sampleCount: 0, reason: 'source_unavailable' });
  });
  it('reports null, malformed, future and duplicate marks without inventing timestamps', () => {
    const result = resolve([...morning, morning[0],
      { ...morning[0], id: 'null', statusMarkedAt: null }, { ...morning[0], id: 'invalid', statusMarkedAt: 'bad' },
      { ...morning[0], id: 'future', statusMarkedAt: '2026-11-04T12:00:00Z' }, { ...morning[0], id: 'other', behaviorId: 'other' }]);
    expect(result.sampleCount).toBe(3);
    expect(result.exclusions).toMatchObject({ duplicateOccurrence: 1, missingMark: 1, invalidMark: 1, futureMark: 1 });
  });
  it('uses the latest current Completed mark after correction; repeated taps and unmarking cannot double-count', () => {
    const original = { status: 'completed' as const, completedAt: morning[0].statusMarkedAt!, statusMarkedAt: morning[0].statusMarkedAt!, note: null };
    const repeat = resolveStatusTransition({ occurrence: original, nextStatus: 'completed', now });
    expect(repeat.statusMarkedAt).toBe(original.statusMarkedAt);
    for (const nextStatus of ['unresolved', 'not_completed'] as const) {
      const correction = resolveStatusTransition({ occurrence: original, nextStatus, now });
      expect(resolve([{ ...morning[0], ...correction }]).sampleCount).toBe(0);
      const remarked = resolveStatusTransition({ occurrence: { ...correction, note: null }, nextStatus: 'completed', now: Temporal.Instant.from('2026-11-02T13:45:00Z') });
      expect(resolve([{ ...morning[0], ...remarked }])).toMatchObject({ sampleCount: 1, delayedMarkCount: 1 });
      expect(remarked.statusMarkedAt).toBe('2026-11-02T13:45:00Z');
    }
  });
  it('rejects invalid history windows', () => { expect(() => resolve(morning, { historyDays: 0 })).toThrow(); });
  it('excludes connector completions so patterns stay the user\'s own (Ticket 322)', () => {
    const all = resolve(morning);
    const connector = new Set([morning[0].id]);
    const excluded = resolve(morning, { connectorMarkedOccurrenceIds: connector });
    expect(excluded.sampleCount).toBe(all.sampleCount - 1);
    expect(excluded.exclusions.missingMark).toBe(all.exclusions.missingMark + 1);
  });
});
