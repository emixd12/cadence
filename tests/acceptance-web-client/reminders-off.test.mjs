// The Behavior a web run creates must have reminders off. See harness.mjs.
import { describe, expect, it } from 'vitest';
import { PROMPTS } from '../../scripts/acceptance/web-client.mjs';
import { parsed, resetState, scenario, state, startWebClientHarness } from './harness.mjs';

startWebClientHarness();

describe('created test Behavior has reminders off', () => {
  it('asks for reminders off in every create prompt', () => {
    expect(PROMPTS.write('x1')).toContain('with browser and email reminders off');
    expect(PROMPTS.lifecycle('x1')).toContain('with browser and email reminders off');
  });
  it('passes the write only after reading the Behavior back with reminders off', async () => {
    const out = await scenario('chatgpt', 'read-write');
    expect(out.result, out.lines.join('\n')).toMatchObject({ ok: true });
    expect(parsed(out.lines).find((e) => e.step === 'creation-reminders')).toMatchObject({ ok: true, remindersOff: true, updated: false });
    expect(state.behaviors[0]).toMatchObject({ browser_reminder_enabled: false, email_reminder_enabled: false });
  }, 120_000);
  it('asks the client to turn reminders off through the same grant when the model ignored the prompt', async () => {
    resetState({ ignoreRemindersOff: true });
    const out = await scenario('chatgpt', 'read-write');
    expect(out.result, out.lines.join('\n')).toMatchObject({ ok: true });
    const steps = parsed(out.lines).map((e) => e.step);
    expect(steps).toEqual(['preflight', 'connect', 'grant-checkpoint', 'prompt-read', 'prompt-write', 'creation-checkpoint', 'prompt-reminders-off', 'creation-reminders', 'archive-chats', 'watcher', 'revoke']);
    expect(parsed(out.lines).find((e) => e.step === 'creation-reminders')).toMatchObject({ ok: true, remindersOff: true, updated: true });
    expect(state.behaviors[0]).toMatchObject({ browser_reminder_enabled: false, email_reminder_enabled: false });
    const grantId = out.run.cleanupInputs().grants[0].grantId;
    expect(state.activity.find((a) => a.operation === 'update_behavior')).toMatchObject({ outcome: 'success', grant_id: grantId });
    expect(state.chats).toHaveLength(3);
    expect(state.chats.every((c) => c.archived)).toBe(true);
  }, 120_000);
  it('stops before cleanup when reminders stay on, keeping the creation for cleanup', async () => {
    resetState({ ignoreRemindersOff: true, ignoreReminderUpdate: true });
    const out = await scenario('chatgpt', 'read-write');
    expect(out.result).toMatchObject({ ok: false, reason: 'behavior-reminders-on', step: 'creation-reminders' });
    expect(out.run.cleanupInputs().creations).toHaveLength(1);
  }, 120_000);
});
