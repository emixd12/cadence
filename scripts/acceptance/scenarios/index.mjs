// Ticket 250 watcher scenarios. Each is an ordered list of server-side events
// the watcher must see for one client run. A step matches the first later
// event of `kind` whose fields equal `where`.
// - bindsClient / sameClient: the grant must belong to the registered client.
// - bindsGrant / sameGrant: later events must use the matched grant.
// - access: tool calls match by the operation's registry access (read/write).
// Steps whose kind the source cannot see are reported as unverifiable.

const clientScenario = (name, description, verifiedClient, registrationType) => Object.freeze({
  name, description,
  steps: Object.freeze([
    Object.freeze({ id: 'client-registered', kind: 'client.registered', where: { verifiedClient, ...(registrationType ? { registrationType } : {}) }, bindsClient: true }),
    Object.freeze({ id: 'grant-created', kind: 'grant.created', where: { verifiedClient }, sameClient: true, bindsGrant: true }),
    Object.freeze({ id: 'token-issued', kind: 'token.issued', sameGrant: true }),
    Object.freeze({ id: 'read-succeeded', kind: 'tool.call', sameGrant: true, access: 'read', where: { outcome: 'success' } }),
    Object.freeze({ id: 'write-succeeded', kind: 'tool.call', sameGrant: true, access: 'write', where: { outcome: 'success' } }),
  ]),
});

// API connectors call Cadence with a token from Ticket 248's driver, so the
// grant belongs to the driver's client. Bind it with --grant when known.
const apiScenario = (name, description) => Object.freeze({
  name, description,
  steps: Object.freeze([
    Object.freeze({ id: 'grant-created', kind: 'grant.created', bindsGrant: true }),
    Object.freeze({ id: 'token-issued', kind: 'token.issued', sameGrant: true }),
    Object.freeze({ id: 'read-succeeded', kind: 'tool.call', sameGrant: true, access: 'read', where: { outcome: 'success' } }),
    Object.freeze({ id: 'write-succeeded', kind: 'tool.call', sameGrant: true, access: 'write', where: { outcome: 'success' } }),
  ]),
});

// Ticket 256 web variants. Partial consent: reads and Behavior writes work, an
// Occurrence write is refused for scope. Disconnect: only the first read is
// expected; the runner checks that nothing succeeds after the revocation.
const webVariant = (name, description, verifiedClient, registrationType, extra) => {
  const base = clientScenario(name, description, verifiedClient, registrationType).steps;
  const steps = extra === 'read-only' ? base.filter((s) => s.id !== 'write-succeeded') : [
    ...base.map((s) => s.id === 'write-succeeded'
      ? Object.freeze({ ...s, where: { ...s.where, operation: 'create_behavior' } }) : s),
    Object.freeze({ id: 'occurrence-write-denied', kind: 'tool.call', sameGrant: true, access: 'write', where: { operation: 'set_occurrence_status', outcome: 'denied', errorCode: 'insufficient_scope' } })];
  return Object.freeze({ name, description, steps: Object.freeze(steps) });
};

export const SCENARIOS = Object.freeze({
  'claude-web-partial': webVariant('claude-web-partial',
    'Claude web with Occurrence writes switched off at consent: one read, one Behavior write, then a refused Occurrence write.', 'claude', 'cimd', 'partial'),
  'claude-web-read': webVariant('claude-web-read',
    'Claude web before a disconnect: verified Claude client, consent and one read.', 'claude', 'cimd', 'read-only'),
  'chatgpt-partial': webVariant('chatgpt-partial',
    'ChatGPT with Occurrence writes switched off at consent: one read, one Behavior write, then a refused Occurrence write.', 'chatgpt', null, 'partial'),
  'chatgpt-read': webVariant('chatgpt-read', 'ChatGPT before a disconnect: verified ChatGPT client, consent and one read.', 'chatgpt', null, 'read-only'),
  'claude-web': clientScenario('claude-web',
    'Claude web connector: verified Claude client (metadata document), consent, one read and one write.', 'claude', 'cimd'),
  'claude-code': clientScenario('claude-code',
    'Claude Code: verified Claude Code client, consent, one read and one write.', 'claude_code', null),
  chatgpt: clientScenario('chatgpt',
    'ChatGPT: verified ChatGPT client, consent, one read and one write. A read-only link must step up before the write.', 'chatgpt', null),
  inspector: clientScenario('inspector',
    'MCP Inspector: unverified dynamically registered client, consent, one read and one write.', null, 'dcr'),
  'anthropic-api': apiScenario('anthropic-api',
    "Anthropic Messages API MCP connector with a Ticket 248 driver grant: one read and one write. Bind the driver's grant with --grant."),
  'openai-api': apiScenario('openai-api',
    "OpenAI Responses API MCP tool with a Ticket 248 driver grant: one read and one write. Bind the driver's grant with --grant."),
});
