import { describe, expect, it, vi } from 'vitest';
import {
  historyMessages,
  urgentProviderRuntimeDeps,
} from '../src/services/urgent-tier-provider-runtime.js';
import { findActiveBySessionId } from '../src/core/worker-pool.js';
import { resolveRole } from '../src/core/role-resolver.js';
import {
  listChatMemberOpenIds,
  listChatMessages,
  sendMessage,
  urgentProviderBotInChat,
  urgentProviderBotInfo,
} from '../src/im/lark/client.js';

vi.mock('../src/core/worker-pool.js', () => ({
  findActiveBySessionId: vi.fn(() => undefined),
}));
vi.mock('../src/core/role-resolver.js', () => ({
  resolveRole: vi.fn(() => ({ content: null, source: 'none' })),
}));
vi.mock('../src/core/scheduler.js', () => ({ addTask: vi.fn() }));
vi.mock('../src/services/schedule-store.js', () => ({
  getTask: vi.fn(),
  getManagedTask: vi.fn(),
  removeManagedTask: vi.fn(),
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

  it('preserves unknown Lark sender types for fail-closed history handling', () => {
    expect(historyMessages([
      { create_time: '1', message_id: 'om_1', sender: { sender_type: 'system' } },
      { create_time: '2', message_id: 'om_2', sender: {} },
      { create_time: '3', message_id: 'om_3', sender: { sender_type: 'app' } },
      { create_time: '4', message_id: 'om_4', sender: { sender_type: 'user' } },
    ]).map(item => item.sender_type)).toEqual(['unknown', 'unknown', 'bot', 'user']);
  });

  it('uses only daemon-owned route after proof issuance and history recheck', async () => {
    const originCapability = 'a'.repeat(64);
    vi.mocked(findActiveBySessionId).mockReturnValue({
      session: {
        sessionId: 'session-1',
        status: 'active',
        rootMessageId: 'om_root',
      },
      larkAppId: 'cli_daemon',
      chatId: 'oc_daemon',
      scope: 'thread',
      managedTurnOrigin: { capability: originCapability },
    } as never);
    vi.mocked(resolveRole).mockReturnValue({
      content: '# Role: pm-project\n',
      source: 'chat',
    } as never);
    vi.mocked(urgentProviderBotInfo).mockResolvedValue({
      tenantKey: 'tenant-1',
      openId: 'ou_bot',
    });
    vi.mocked(urgentProviderBotInChat).mockResolvedValue(true);
    vi.mocked(listChatMemberOpenIds).mockResolvedValue(['ou_target']);
    const anchor = {
      create_time: '100',
      message_id: 'om_anchor',
      root_id: 'om_root',
      thread_id: 'omt_thread',
      sender: { sender_type: 'bot', id: { app_id: 'cli_daemon' } },
    };
    vi.mocked(listChatMessages).mockResolvedValue([anchor]);
    const listThreadMessages = (await import('../src/im/lark/client.js')).listThreadMessages;
    vi.mocked(listThreadMessages).mockResolvedValue([anchor]);
    vi.mocked(sendMessage).mockResolvedValue('om_new');

    const deps = urgentProviderRuntimeDeps({ originCapability });
    const issue = async (
      operation: string,
      capability: string,
      targetOpenId = '',
    ) => {
      const issued = await deps.sessionAuthenticate({
        sessionId: 'session-1',
        operation,
        capability,
        projectId: 'project-1',
        targetOpenId: targetOpenId || undefined,
        probeOnly: false,
      }) as any;
      return {
        proofId: issued.proofId,
        proofType: 'group',
        proof: issued.proof,
        proofDigest: issued.proofDigest,
        operation,
        capability,
        projectId: 'project-1',
        targetOpenId,
        appId: issued.proof.app_id,
        chatId: issued.proof.chat_id,
        rootMessageId: issued.proof.root_message_id,
        sessionId: issued.proof.session_id,
      };
    };

    const history = await deps.historyScan({
      authorization: await issue('history', 'group_read'),
      anchor: { create_time_ms: 100, message_id: 'om_anchor' },
      requestId: 'request-1',
    }) as any;
    await deps.sendAnchor({
      authorization: await issue('send_anchor', 'group_write', 'ou_target'),
      anchor: { create_time_ms: 100, message_id: 'om_anchor' },
      proofId: history.proofId,
      proofDigest: history.proofDigest,
      actionId: 'b'.repeat(64),
      markdown: 'decision',
      targetOpenId: 'ou_target',
      appId: 'cli_attacker',
      chatId: 'oc_attacker',
      rootMessageId: 'om_attacker',
    });

    expect(sendMessage).not.toHaveBeenCalled();
    const replyMessage = (await import('../src/im/lark/client.js')).replyMessage;
    expect(replyMessage).toHaveBeenCalledWith(
      'cli_daemon',
      'om_root',
      expect.stringContaining('decision'),
      'text',
      true,
      'b'.repeat(64),
    );
  });
});
