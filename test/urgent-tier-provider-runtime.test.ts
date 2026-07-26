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
import { getManagedTask, removeManagedTask } from '../src/services/schedule-store.js';
import { taskMetadataDigest } from '../src/services/urgent-tier-provider-contract.js';

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
  const managedMetadata = {
    schema: 'botmux.urgent-tier.task-metadata/v1' as const,
    manager_domain: 'ndbflow.urgent-tier.schedule/v1' as const,
    provider_contract: 'botmux.urgent-tier-provider/v1' as const,
    provider_interface_revision: 1 as const,
    callback_contract: 'ndbflow.urgent-tier.callback/v2' as const,
    callback_contract_revision: 2 as const,
    provider_task_id: `utp_${'1'.repeat(40)}`,
    creator_session_id: '11111111-1111-4111-8111-111111111111',
    creator_app_id: 'cli_daemon',
    chat_id: 'oc_daemon',
    root_message_id: 'om_root',
    project_id: 'project-1',
    run_id: '22222222-2222-4222-8222-222222222222',
    family_id: 'a'.repeat(64),
    generation: 0,
    tier: 'app' as const,
    deadline_utc_ms: 1_785_000_000_000,
    action_id: 'b'.repeat(64),
    spec_digest: 'c'.repeat(64),
  };

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
      managedTurnOrigin: {
        capability: originCapability,
        turnId: 'schedule:managed:execution-1',
      },
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

  it('does not rebind a history proof to another session or capability generation', async () => {
    const firstCapability = 'a'.repeat(64);
    const secondCapability = 'b'.repeat(64);
    const active = (sessionId: string, capability: string) => ({
      session: {
        sessionId,
        status: 'active',
        rootMessageId: 'om_root',
      },
      larkAppId: 'cli_daemon',
      chatId: 'oc_daemon',
      scope: 'thread',
      managedTurnOrigin: { capability },
    }) as never;
    vi.mocked(findActiveBySessionId).mockImplementation(sessionId =>
      sessionId === 'session-1'
        ? active('session-1', firstCapability)
        : sessionId === 'session-2'
          ? active('session-2', secondCapability)
          : undefined);
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

    const first = urgentProviderRuntimeDeps({ originCapability: firstCapability });
    const historyAuthorization = await first.sessionAuthenticate({
      sessionId: 'session-1',
      operation: 'history',
      capability: 'group_read',
      projectId: 'project-1',
      probeOnly: false,
    }) as any;
    const history = await first.historyScan({
      authorization: {
        ...historyAuthorization,
        proofType: 'group',
        operation: 'history',
        capability: 'group_read',
        projectId: 'project-1',
        targetOpenId: '',
        appId: historyAuthorization.proof.app_id,
        chatId: historyAuthorization.proof.chat_id,
        rootMessageId: historyAuthorization.proof.root_message_id,
        sessionId: historyAuthorization.proof.session_id,
      },
      anchor: { create_time_ms: 100, message_id: 'om_anchor' },
      requestId: 'request-cross-binding',
    }) as any;

    const second = urgentProviderRuntimeDeps({ originCapability: secondCapability });
    const sendAuthorization = await second.sessionAuthenticate({
      sessionId: 'session-2',
      operation: 'send_anchor',
      capability: 'group_write',
      projectId: 'project-1',
      targetOpenId: 'ou_target',
      probeOnly: false,
    }) as any;
    await expect(second.sendAnchor({
      authorization: {
        ...sendAuthorization,
        proofType: 'group',
        operation: 'send_anchor',
        capability: 'group_write',
        projectId: 'project-1',
        targetOpenId: 'ou_target',
        appId: sendAuthorization.proof.app_id,
        chatId: sendAuthorization.proof.chat_id,
        rootMessageId: sendAuthorization.proof.root_message_id,
        sessionId: sendAuthorization.proof.session_id,
      },
      anchor: { create_time_ms: 100, message_id: 'om_anchor' },
      proofId: history.proofId,
      proofDigest: history.proofDigest,
      actionId: 'c'.repeat(64),
      markdown: 'must not send',
      targetOpenId: 'ou_target',
    })).rejects.toThrow('HISTORY_PROOF_UNPROVEN');
  });

  it.each([
    ['scheduleObserve', 'project_id', 'project-other'],
    ['scheduleObserve', 'creator_session_id', '22222222-2222-4222-8222-222222222222'],
    ['scheduleObserve', 'creator_app_id', 'cli_other'],
    ['scheduleObserve', 'chat_id', 'oc_other'],
    ['scheduleObserve', 'root_message_id', 'om_other'],
    ['scheduleRemove', 'project_id', 'project-other'],
    ['scheduleRemove', 'creator_session_id', '22222222-2222-4222-8222-222222222222'],
    ['scheduleRemove', 'creator_app_id', 'cli_other'],
    ['scheduleRemove', 'chat_id', 'oc_other'],
    ['scheduleRemove', 'root_message_id', 'om_other'],
  ] as const)(
    'binds %s against cross-scope %s',
    async (operation, field, value) => {
      const originCapability = 'd'.repeat(64);
      vi.mocked(findActiveBySessionId).mockReturnValue({
        session: {
          sessionId: managedMetadata.creator_session_id,
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
      vi.mocked(getManagedTask).mockReturnValue({
        id: managedMetadata.provider_task_id,
        managed: {
          metadata_digest: taskMetadataDigest({
            ...managedMetadata,
            [field]: value,
          }),
          metadata: { ...managedMetadata, [field]: value },
        },
      } as never);
      vi.mocked(removeManagedTask).mockReturnValue(true);

      const deps = urgentProviderRuntimeDeps({ originCapability });
      const operationName = operation === 'scheduleObserve'
        ? 'schedule_observe'
        : 'schedule_remove';
      const capability = operation === 'scheduleObserve' ? 'group_read' : 'group_write';
      const issued = await deps.sessionAuthenticate({
        sessionId: managedMetadata.creator_session_id,
        operation: operationName,
        capability,
        projectId: 'project-1',
        probeOnly: false,
      }) as any;
      const authorization = {
        ...issued,
        proofType: 'group',
        operation: operationName,
        capability,
        projectId: 'project-1',
        targetOpenId: '',
        appId: issued.proof.app_id,
        chatId: issued.proof.chat_id,
        rootMessageId: issued.proof.root_message_id,
        sessionId: issued.proof.session_id,
      };
      await expect(deps[operation]({
        authorization,
        providerTaskId: managedMetadata.provider_task_id,
        metadataDigest: taskMetadataDigest({ ...managedMetadata, [field]: value }),
      })).rejects.toThrow('MANAGED_SCHEDULE_UNAVAILABLE');
      expect(removeManagedTask).not.toHaveBeenCalled();
    },
  );

  it('authenticates the daemon-owned managed callback and denies stale task binding', () => {
    const originCapability = 'f'.repeat(64);
    const metadataDigest = taskMetadataDigest(managedMetadata);
    vi.mocked(resolveRole).mockReturnValue({
      content: '# Role: pm-project\n',
      source: 'chat',
    } as never);
    vi.mocked(findActiveBySessionId).mockReturnValue({
      session: {
        sessionId: 'callback-session',
        status: 'active',
        rootMessageId: managedMetadata.root_message_id,
        managedScheduleRun: {
          taskId: managedMetadata.provider_task_id,
          turnId: 'schedule:managed:execution-1',
          creatorSessionId: managedMetadata.creator_session_id,
          appId: managedMetadata.creator_app_id,
          chatId: managedMetadata.chat_id,
          rootMessageId: managedMetadata.root_message_id,
          familyId: managedMetadata.family_id,
          specDigest: managedMetadata.spec_digest,
          metadataDigest,
          createdAt: '2026-07-26T00:00:00.000Z',
        },
      },
      larkAppId: managedMetadata.creator_app_id,
      chatId: managedMetadata.chat_id,
      scope: 'thread',
      managedTurnOrigin: {
        capability: originCapability,
        turnId: 'schedule:managed:execution-1',
      },
    } as never);
    vi.mocked(getManagedTask).mockReturnValue({
      id: managedMetadata.provider_task_id,
      managed: { metadata: managedMetadata, metadata_digest: metadataDigest },
    } as never);

    const deps = urgentProviderRuntimeDeps({ originCapability });
    const authenticated = deps.callbackAuthenticate({
      sessionId: 'callback-session',
      executionId: 'attacker-execution',
      providerTaskId: `utp_${'9'.repeat(40)}`,
      familyId: '9'.repeat(64),
      specDigest: '9'.repeat(64),
    }) as any;
    expect(authenticated.claims).toMatchObject({
      execution_id: 'schedule:managed:execution-1',
      callback_session_id: 'callback-session',
      task_metadata: managedMetadata,
      task_metadata_digest: metadataDigest,
    });

    vi.mocked(getManagedTask).mockReturnValue({
      id: managedMetadata.provider_task_id,
      managed: {
        metadata: { ...managedMetadata, generation: 1 },
        metadata_digest: taskMetadataDigest({ ...managedMetadata, generation: 1 }),
      },
    } as never);
    expect(() => deps.callbackAuthenticate({ sessionId: 'callback-session' }))
      .toThrow('CALLBACK_ORIGIN_UNPROVEN');

    vi.mocked(getManagedTask).mockReturnValue({
      id: managedMetadata.provider_task_id,
      managed: { metadata: managedMetadata, metadata_digest: metadataDigest },
    } as never);
    vi.mocked(findActiveBySessionId).mockReturnValue({
      session: {
        sessionId: 'callback-session',
        status: 'active',
        rootMessageId: managedMetadata.root_message_id,
        managedScheduleRun: {
          taskId: managedMetadata.provider_task_id,
          turnId: 'schedule:managed:execution-1',
          creatorSessionId: managedMetadata.creator_session_id,
          appId: managedMetadata.creator_app_id,
          chatId: managedMetadata.chat_id,
          rootMessageId: managedMetadata.root_message_id,
          familyId: managedMetadata.family_id,
          specDigest: managedMetadata.spec_digest,
          metadataDigest,
          createdAt: '2026-07-26T00:00:00.000Z',
        },
      },
      larkAppId: managedMetadata.creator_app_id,
      chatId: managedMetadata.chat_id,
      scope: 'thread',
      managedTurnOrigin: {
        capability: originCapability,
        turnId: 'schedule:managed:stale-execution',
      },
    } as never);
    expect(() => deps.callbackAuthenticate({ sessionId: 'callback-session' }))
      .toThrow('CALLBACK_ORIGIN_UNPROVEN');
  });
});
