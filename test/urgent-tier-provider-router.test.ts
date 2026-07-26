import { describe, expect, it, vi } from 'vitest';
import {
  parseUrgentProviderRequest,
  routeUrgentProvider,
} from '../src/services/urgent-tier-provider-router.js';

describe('urgent provider router', () => {
  it('returns the exact non-mutating capability contract', async () => {
    const result = await routeUrgentProvider('capabilities', {}, {} as never);
    expect(result).toMatchObject({
      ok: true,
      contract: 'botmux.urgent-tier-provider/v1',
      interface_revision: 1,
      authorization_authority: 'opaque-daemon-ledger-single-use/v1',
      probe_issues_authorization: false,
    });
  });

  it('dispatches every operation through an explicit dependency', async () => {
    const deps = {
      sessionAuthenticate: vi.fn(() => ({ ok: true })),
      nodeReadAuthenticate: vi.fn(() => ({ ok: true })),
      authorizationConsume: vi.fn(() => ({ ok: true })),
      authorizationRevoke: vi.fn(() => ({ ok: true })),
      callbackAuthenticate: vi.fn(() => ({ ok: true })),
      historyScan: vi.fn(() => ({ ok: true })),
      sendAnchor: vi.fn(() => ({ ok: true })),
      sendUrgent: vi.fn(() => ({ ok: true })),
      scheduleEnsure: vi.fn(() => ({ ok: true })),
      scheduleObserve: vi.fn(() => ({ ok: true })),
      scheduleRemove: vi.fn(() => ({ ok: true })),
    };
    for (const [command, key, payload] of [
      ['session-authenticate', 'sessionAuthenticate',
        { sessionId: 's', operation: 'status', capability: 'group_read', projectId: 'p', probeOnly: true }],
      ['node-read-authenticate', 'nodeReadAuthenticate', { probeOnly: true }],
      ['authorization-consume', 'authorizationConsume',
        { proofId: 'p', proofType: 'node', proof: {}, proofDigest: 'd', operation: 'status_all', capability: 'node_read' }],
      ['authorization-revoke', 'authorizationRevoke',
        { proofId: 'p', proofType: 'node', proof: {}, proofDigest: 'd', operation: 'status_all', capability: 'node_read' }],
      ['callback-authenticate', 'callbackAuthenticate', { sessionId: 's' }],
      ['history-scan', 'historyScan',
        { authorization: { proofId: 'p', proofType: 'group', proof: {}, proofDigest: 'd', operation: 'history', capability: 'group_read' }, anchor: { create_time_ms: 1, message_id: 'om_1' }, requestId: 'r' }],
      ['send-anchor', 'sendAnchor',
        { authorization: { proofId: 'p', proofType: 'group', proof: {}, proofDigest: 'd', operation: 'send_anchor', capability: 'group_write' }, anchor: { create_time_ms: 1, message_id: 'om_1' }, proofId: 'h', proofDigest: 'd', actionId: 'a', markdown: 'm', targetOpenId: 'ou_1' }],
      ['send-urgent', 'sendUrgent',
        { authorization: { proofId: 'p', proofType: 'group', proof: {}, proofDigest: 'd', operation: 'send_urgent', capability: 'group_write' }, anchor: { create_time_ms: 1, message_id: 'om_1' }, proofId: 'h', proofDigest: 'd', actionId: 'a', tier: 'app', messageId: 'om_1', targetOpenId: 'ou_1' }],
      ['schedule-ensure', 'scheduleEnsure',
        { authorization: { proofId: 'p', proofType: 'group', proof: {}, proofDigest: 'd', operation: 'schedule_ensure', capability: 'group_write' }, metadata: {}, prompt: 'p', workingDir: '/tmp' }],
      ['schedule-observe', 'scheduleObserve',
        { authorization: { proofId: 'p', proofType: 'group', proof: {}, proofDigest: 'd', operation: 'schedule_observe', capability: 'group_read' }, providerTaskId: 'utp_1' }],
      ['schedule-remove', 'scheduleRemove',
        { authorization: { proofId: 'p', proofType: 'group', proof: {}, proofDigest: 'd', operation: 'schedule_remove', capability: 'group_write' }, providerTaskId: 'utp_1', metadataDigest: 'd' }],
    ] as const) {
      await expect(routeUrgentProvider(command, payload, deps)).resolves.toEqual({ ok: true });
      expect(deps[key]).toHaveBeenCalledWith(payload);
    }
  });

  it('rejects unknown commands generically', async () => {
    await expect(routeUrgentProvider('unknown', {}, {} as never)).rejects.toThrow(
      'URGENT_PROVIDER_OPERATION_INVALID',
    );
  });

  it.each([
    ['session-authenticate', { sessionId: 's', operation: 'status', capability: 'group_read', projectId: 'p', probeOnly: true }],
    ['node-read-authenticate', { probeOnly: true }],
    ['authorization-consume', {
      proofId: `utpa_${'a'.repeat(43)}`, proofType: 'node', proof: {},
      proofDigest: 'a'.repeat(64), operation: 'status_all', capability: 'node_read',
    }],
    ['authorization-revoke', {
      proofId: `utpa_${'a'.repeat(43)}`, proofType: 'node', proof: {},
      proofDigest: 'a'.repeat(64), operation: 'status_all', capability: 'node_read',
    }],
    ['callback-authenticate', { sessionId: 's' }],
    ['history-scan', {
      authorization: {}, anchor: { create_time_ms: 1, message_id: 'om_1' }, requestId: 'r',
    }],
    ['send-anchor', {
      authorization: {}, anchor: { create_time_ms: 1, message_id: 'om_1' },
      proofId: 'p', proofDigest: 'a'.repeat(64), actionId: 'b'.repeat(64),
      markdown: 'm', targetOpenId: 'ou_1',
    }],
    ['send-urgent', {
      authorization: {}, anchor: { create_time_ms: 1, message_id: 'om_1' },
      proofId: 'p', proofDigest: 'a'.repeat(64), actionId: 'b'.repeat(64),
      tier: 'app', messageId: 'om_1', targetOpenId: 'ou_1',
    }],
    ['schedule-ensure', { authorization: {}, metadata: {}, prompt: 'p', workingDir: '/tmp' }],
    ['schedule-observe', { authorization: {}, providerTaskId: `utp_${'1'.repeat(40)}` }],
    ['schedule-remove', {
      authorization: {}, providerTaskId: `utp_${'1'.repeat(40)}`, metadataDigest: 'a'.repeat(64),
    }],
  ] as const)('rejects unknown fields for %s before dispatch', async (command, payload) => {
    const deps = new Proxy({}, {
      get: () => vi.fn(() => ({ ok: true })),
    }) as never;
    await expect(routeUrgentProvider(command, { ...payload, attacker: true }, deps))
      .rejects.toThrow('URGENT_PROVIDER_INPUT_INVALID');
  });

  it('rejects duplicate keys in raw JSON before conversion', () => {
    expect(() => parseUrgentProviderRequest(
      'session-authenticate',
      '{"sessionId":"s","operation":"status","capability":"group_read","projectId":"p","probeOnly":true,"operation":"start"}',
    )).toThrow('URGENT_PROVIDER_INPUT_INVALID');
  });
});
