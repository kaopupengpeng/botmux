import { createHash, randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { findActiveBySessionId } from '../core/worker-pool.js';
import { resolveRole } from '../core/role-resolver.js';
import * as scheduler from '../core/scheduler.js';
import * as scheduleStore from './schedule-store.js';
import {
  listChatMemberOpenIds,
  listChatMessages,
  listThreadMessages,
  sendMessage,
  replyMessage,
  sendNativeUrgent,
  urgentProviderBotInChat,
  urgentProviderBotInfo,
} from '../im/lark/client.js';
import {
  UrgentAuthorizationStore,
  type UrgentAuthorizationRecord,
} from './urgent-tier-authorization-store.js';
import {
  authenticateUrgentNodeRead,
  authenticateUrgentSession,
} from './urgent-tier-session-auth.js';
import { authenticateUrgentCallback } from './urgent-tier-provider-auth.js';
import {
  scanUrgentHistory,
  UrgentHistoryProofStore,
  type HistoryMessage,
} from './urgent-tier-history.js';
import {
  sendConditionalAnchor,
  sendConditionalUrgent,
} from './urgent-tier-delivery.js';
import type { UrgentTaskMetadata } from './urgent-tier-provider-contract.js';
import type { UrgentProviderRouterDeps } from './urgent-tier-provider-router.js';

const bootId = randomUUID();
const authorizationStore = new UrgentAuthorizationStore({ bootId });
const historyStore = new UrgentHistoryProofStore();

function inputRecord(value: unknown): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('URGENT_PROVIDER_INPUT_INVALID');
  }
  return value as Record<string, any>;
}

function roleId(appId: string, chatId: string): string {
  const content = resolveRole(appId, chatId).content ?? '';
  const match = /^# Role:\s*([a-z0-9-]+)\s*$/mu.exec(content);
  return match?.[1] ?? '';
}

function liveSession(sessionId: string) {
  const ds = findActiveBySessionId(sessionId);
  if (!ds) return undefined;
  return {
    sessionId: ds.session.sessionId,
    appId: ds.larkAppId,
    chatId: ds.chatId,
    rootMessageId: ds.scope === 'thread' ? ds.session.rootMessageId : '',
    role: roleId(ds.larkAppId, ds.chatId),
    active: ds.session.status === 'active',
    managed: !!ds.managedTurnOrigin?.capability,
    receiver: !!ds.session.vcMeetingReceiver,
    adopt: !!ds.session.adoptedFrom,
    capabilityDigest: ds.managedTurnOrigin?.capability
      ? createHash('sha256').update(ds.managedTurnOrigin.capability).digest('hex')
      : '',
    originCapability: ds.managedTurnOrigin?.capability ?? '',
  };
}

function sessionDeps(originCapability?: string, trustedHost = false) {
  return {
    now: Date.now,
    bootId,
    store: authorizationStore,
    resolveSession: liveSession,
    verifyManagedOrigin: (session: { originCapability?: string }) =>
      !!originCapability && session.originCapability === originCapability,
    tenantKey: async (appId: string) => (await urgentProviderBotInfo(appId)).tenantKey,
    botInChat: urgentProviderBotInChat,
    targetInChat: async (appId: string, chatId: string, target: string) =>
      (await listChatMemberOpenIds(appId, chatId)).includes(target),
    verifyNodeOwner: () => trustedHost,
  };
}

function authorizationRecord(payload: Record<string, any>): UrgentAuthorizationRecord {
  return {
    proofType: payload.proofType,
    proof: payload.proof,
    proofDigest: payload.proofDigest,
    daemonBootId: bootId,
    sessionId: payload.sessionId ?? '',
    capabilityDigest: payload.capabilityDigest ?? '',
    operation: payload.operation,
    capability: payload.capability,
    projectId: payload.projectId ?? '',
    targetOpenId: payload.targetOpenId ?? '',
    appId: payload.appId ?? '',
    chatId: payload.chatId ?? '',
    rootMessageId: payload.rootMessageId ?? '',
    issuedAtMs: payload.issuedAtMs,
    expiresAtMs: payload.expiresAtMs,
    maxUses: 1,
    useCount: 0,
  };
}

function historyMessages(raw: any[]): HistoryMessage[] {
  return raw.map(item => ({
    create_time_ms: Number(item.create_time),
    message_id: String(item.message_id),
    sender_type: item.sender?.sender_type === 'user' ? 'user' : 'bot',
  }));
}

async function completeHistoryPage(payload: Record<string, any>) {
  const items = payload.rootMessageId
    ? await listThreadMessages(payload.appId, payload.chatId, payload.rootMessageId, 0)
    : await listChatMessages(payload.appId, payload.chatId, 0);
  return { items: historyMessages(items), complete: true };
}

export function urgentProviderRuntimeDeps(
  context: { originCapability?: string; trustedHost?: boolean } = {},
): UrgentProviderRouterDeps {
  return {
    sessionAuthenticate: async raw => {
      const p = inputRecord(raw);
      const result = await authenticateUrgentSession({
        sessionId: p.sessionId,
        operation: p.operation,
        capability: p.capability,
        projectId: p.projectId,
        targetOpenId: p.targetOpenId,
        probeOnly: p.probeOnly === true,
      }, sessionDeps(context.originCapability, context.trustedHost));
      return { ok: true, contract: 'botmux.urgent-tier-provider/v1', ...result };
    },
    nodeReadAuthenticate: async raw => {
      const p = inputRecord(raw);
      const result = await authenticateUrgentNodeRead(
        { probeOnly: p.probeOnly === true },
        sessionDeps(undefined, context.trustedHost),
      );
      return { ok: true, contract: 'botmux.urgent-tier-provider/v1', ...result };
    },
    authorizationConsume: raw => {
      const p = inputRecord(raw);
      return { ok: true, proof: authorizationStore.consume(p.proofId, authorizationRecord(p)) };
    },
    authorizationRevoke: raw => {
      const p = inputRecord(raw);
      return authorizationStore.revoke(p.proofId);
    },
    callbackAuthenticate: raw => {
      const p = inputRecord(raw);
      return authenticateUrgentCallback({
        sessionId: p.sessionId,
        executionId: p.executionId,
        providerTaskId: p.providerTaskId,
        familyId: p.familyId,
        specDigest: p.specDigest,
      }, {
        verifyManagedOrigin: sessionId => {
          const session = liveSession(sessionId);
          return !!session && !!context.originCapability
            && session.originCapability === context.originCapability;
        },
        resolveCallbackSession: liveSession,
        readTaskMetadata: taskId =>
          scheduleStore.getTask(taskId)?.managed?.metadata as UrgentTaskMetadata | undefined,
      });
    },
    historyScan: async raw => {
      const p = inputRecord(raw);
      return {
        ok: true,
        ...(await scanUrgentHistory({
          appId: p.appId,
          chatId: p.chatId,
          rootMessageId: p.rootMessageId ?? '',
          anchor: p.anchor,
        }, {
          listPage: () => completeHistoryPage(p),
          store: historyStore,
        })),
      };
    },
    sendAnchor: async raw => {
      const p = inputRecord(raw);
      const deliveryInput = {
        appId: String(p.appId),
        chatId: String(p.chatId),
        rootMessageId: String(p.rootMessageId ?? ''),
        anchor: p.anchor,
        proofId: String(p.proofId),
        proofDigest: String(p.proofDigest),
        actionId: String(p.actionId),
        markdown: String(p.markdown),
        targetOpenId: String(p.targetOpenId),
      };
      return {
        ok: true,
        ...(await sendConditionalAnchor(deliveryInput, {
          store: historyStore,
          finalRecheck: async () => {
            const page = await completeHistoryPage(deliveryInput);
            return {
              complete: page.complete,
              observedHead: page.items.at(-1) ?? deliveryInput.anchor,
            };
          },
          sendAnchor: async data => {
            const text = `<at user_id="${data.targetOpenId}"></at>\n${data.markdown}`;
            const messageId = p.rootMessageId
              ? await replyMessage(p.appId, p.rootMessageId, text, 'text', true, data.actionId)
              : await sendMessage(p.appId, p.chatId, text, 'text', data.actionId);
            return { messageId, createTimeMs: Date.now(), requestId: data.actionId };
          },
          now: Date.now,
        })),
      };
    },
    sendUrgent: async raw => {
      const p = inputRecord(raw);
      const deliveryInput = {
        appId: String(p.appId),
        chatId: String(p.chatId),
        rootMessageId: String(p.rootMessageId ?? ''),
        anchor: p.anchor,
        proofId: String(p.proofId),
        proofDigest: String(p.proofDigest),
        actionId: String(p.actionId),
        tier: p.tier as 'app' | 'sms' | 'phone',
        messageId: String(p.messageId),
        targetOpenId: String(p.targetOpenId),
      };
      return {
        ok: true,
        ...(await sendConditionalUrgent(deliveryInput, {
          store: historyStore,
          finalRecheck: async () => {
            const page = await completeHistoryPage(deliveryInput);
            return {
              complete: page.complete,
              observedHead: page.items.at(-1) ?? deliveryInput.anchor,
            };
          },
          sendUrgent: (tier, messageId, target) =>
            sendNativeUrgent(deliveryInput.appId, tier, messageId, target),
          now: Date.now,
        })),
      };
    },
    scheduleEnsure: raw => {
      const p = inputRecord(raw);
      const task = scheduler.addTask({
        id: p.metadata.provider_task_id,
        name: `ndbflow-urgent-${p.metadata.family_id.slice(0, 12)}`,
        schedule: new Date(p.metadata.deadline_utc_ms).toISOString(),
        prompt: p.prompt,
        workingDir: p.workingDir,
        chatId: p.metadata.chat_id,
        rootMessageId: p.metadata.root_message_id || undefined,
        executionPosition: p.metadata.root_message_id ? 'topic' : 'top-level',
        larkAppId: p.metadata.creator_app_id,
        creatorChatId: p.metadata.chat_id,
        creatorRootMessageId: p.metadata.root_message_id || undefined,
        creatorLarkAppId: p.metadata.creator_app_id,
        managed: {
          schema: 'botmux.schedule-managed/v1',
          manager_domain: 'ndbflow.urgent-tier.schedule/v1',
          metadata: p.metadata,
        },
      });
      return { ok: true, task };
    },
    scheduleObserve: raw => {
      const p = inputRecord(raw);
      const task = scheduleStore.getTask(p.providerTaskId);
      if (!task?.managed) throw new Error('MANAGED_SCHEDULE_UNAVAILABLE');
      return { ok: true, task };
    },
    scheduleRemove: raw => {
      const p = inputRecord(raw);
      const task = scheduleStore.getTask(p.providerTaskId);
      if (!task?.managed || task.managed.metadata_digest !== p.metadataDigest) {
        throw new Error('MANAGED_SCHEDULE_MISMATCH');
      }
      return { ok: scheduleStore.removeTask(p.providerTaskId) };
    },
  };
}
