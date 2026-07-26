import { describe, expect, it, vi } from 'vitest';
import { routeUrgentProvider } from '../src/services/urgent-tier-provider-router.js';

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
    for (const [command, key] of [
      ['session-authenticate', 'sessionAuthenticate'],
      ['node-read-authenticate', 'nodeReadAuthenticate'],
      ['authorization-consume', 'authorizationConsume'],
      ['authorization-revoke', 'authorizationRevoke'],
      ['callback-authenticate', 'callbackAuthenticate'],
      ['history-scan', 'historyScan'],
      ['send-anchor', 'sendAnchor'],
      ['send-urgent', 'sendUrgent'],
      ['schedule-ensure', 'scheduleEnsure'],
      ['schedule-observe', 'scheduleObserve'],
      ['schedule-remove', 'scheduleRemove'],
    ] as const) {
      await expect(routeUrgentProvider(command, { command }, deps)).resolves.toEqual({ ok: true });
      expect(deps[key]).toHaveBeenCalledWith({ command });
    }
  });

  it('rejects unknown commands generically', async () => {
    await expect(routeUrgentProvider('unknown', {}, {} as never)).rejects.toThrow(
      'URGENT_PROVIDER_OPERATION_INVALID',
    );
  });
});
