import { describe, expect, it, vi } from 'vitest';
import { urgentProviderRuntimeDeps } from '../src/services/urgent-tier-provider-runtime.js';

vi.mock('../src/core/worker-pool.js', () => ({
  findActiveBySessionId: vi.fn(() => undefined),
}));
vi.mock('../src/core/role-resolver.js', () => ({
  resolveRole: vi.fn(() => ({ content: null, source: 'none' })),
}));
vi.mock('../src/core/scheduler.js', () => ({ addTask: vi.fn() }));
vi.mock('../src/services/schedule-store.js', () => ({
  getTask: vi.fn(),
  removeTask: vi.fn(),
}));
vi.mock('../src/im/lark/client.js', () => ({
  listChatMemberOpenIds: vi.fn(async () => []),
  listChatMessages: vi.fn(async () => []),
  listThreadMessages: vi.fn(async () => []),
  sendMessage: vi.fn(),
  replyMessage: vi.fn(),
  sendNativeUrgent: vi.fn(),
  urgentProviderBotInChat: vi.fn(async () => false),
  urgentProviderBotInfo: vi.fn(),
}));

describe('urgent provider runtime integration', () => {
  it('keeps capabilities non-mutating and dependency-complete', () => {
    const deps = urgentProviderRuntimeDeps();
    expect(Object.keys(deps).sort()).toEqual([
      'authorizationConsume', 'authorizationRevoke', 'callbackAuthenticate',
      'historyScan', 'nodeReadAuthenticate', 'scheduleEnsure', 'scheduleObserve',
      'scheduleRemove', 'sendAnchor', 'sendUrgent', 'sessionAuthenticate',
    ].sort());
  });

  it('rejects session authentication without a daemon-owned live session', async () => {
    const deps = urgentProviderRuntimeDeps({ originCapability: 'a'.repeat(64) });
    await expect(deps.sessionAuthenticate({
      sessionId: 'attacker',
      operation: 'start',
      capability: 'group_write',
      projectId: 'project',
      appId: 'cli_attacker',
      chatId: 'oc_attacker',
    })).rejects.toThrow('SESSION_AUTHORIZATION_UNPROVEN');
  });

  it('requires trusted host for node-read proof issuance', async () => {
    await expect(urgentProviderRuntimeDeps({ trustedHost: false })
      .nodeReadAuthenticate({ probeOnly: false }))
      .rejects.toThrow('NODE_READ_AUTHORIZATION_UNPROVEN');
  });
});
