type Handler = (payload: unknown) => unknown | Promise<unknown>;

export interface UrgentProviderRouterDeps {
  sessionAuthenticate: Handler;
  nodeReadAuthenticate: Handler;
  authorizationConsume: Handler;
  authorizationRevoke: Handler;
  callbackAuthenticate: Handler;
  historyScan: Handler;
  sendAnchor: Handler;
  sendUrgent: Handler;
  scheduleEnsure: Handler;
  scheduleObserve: Handler;
  scheduleRemove: Handler;
}

export const URGENT_PROVIDER_CAPABILITIES = {
  ok: true,
  contract: 'botmux.urgent-tier-provider/v1',
  interface_revision: 1,
  identity_binding: 'managed-origin-session',
  ordinary_session_auth: 'botmux.urgent-tier.session-proof/v1',
  node_read_auth: 'botmux.urgent-tier.node-read-proof/v1',
  authorization_authority: 'opaque-daemon-ledger-single-use/v1',
  authorization_ttl_ms: 30_000,
  authorization_max_uses: 1,
  probe_issues_authorization: false,
  bot_membership_probe: true,
  target_membership_probe: true,
  tenant_provenance: 'lark-bot-info-tenant-key',
  anchor_idempotency: 'lark-message-uuid',
  urgent_operations: ['app', 'sms', 'phone'],
  history_cursor: 'lark-create-time-message-id/v1',
  history_proof: 'botmux.urgent-tier.history-proof/v1',
  task_metadata: 'botmux.urgent-tier.task-metadata/v1',
  schedule_metadata_roundtrip: true,
  schedule_callback_envelope: 'botmux.deferred-run/v1',
  provider_timeout_ms: {
    recommended: 5_000,
    min: 100,
    max: 10_000,
    provenance: 'botmux.urgent-tier-provider/v1',
  },
} as const;

const handlers: Record<string, keyof UrgentProviderRouterDeps> = {
  'session-authenticate': 'sessionAuthenticate',
  'node-read-authenticate': 'nodeReadAuthenticate',
  'authorization-consume': 'authorizationConsume',
  'authorization-revoke': 'authorizationRevoke',
  'callback-authenticate': 'callbackAuthenticate',
  'history-scan': 'historyScan',
  'send-anchor': 'sendAnchor',
  'send-urgent': 'sendUrgent',
  'schedule-ensure': 'scheduleEnsure',
  'schedule-observe': 'scheduleObserve',
  'schedule-remove': 'scheduleRemove',
};

const payloadKeys: Record<string, readonly string[]> = {
  capabilities: [],
  'session-authenticate': [
    'sessionId', 'operation', 'capability', 'projectId', 'targetOpenId', 'probeOnly',
  ],
  'node-read-authenticate': ['probeOnly'],
  'authorization-consume': [
    'proofId', 'proofType', 'proof', 'proofDigest', 'operation', 'capability',
    'projectId', 'targetOpenId', 'appId', 'chatId', 'rootMessageId', 'sessionId',
  ],
  'authorization-revoke': [
    'proofId', 'proofType', 'proof', 'proofDigest', 'operation', 'capability',
    'projectId', 'targetOpenId', 'appId', 'chatId', 'rootMessageId', 'sessionId',
  ],
  'callback-authenticate': ['sessionId'],
  'history-scan': ['authorization', 'anchor', 'requestId'],
  'send-anchor': [
    'authorization', 'anchor', 'proofId', 'proofDigest', 'actionId', 'markdown',
    'targetOpenId',
  ],
  'send-urgent': [
    'authorization', 'anchor', 'proofId', 'proofDigest', 'actionId', 'tier',
    'messageId', 'targetOpenId',
  ],
  'schedule-ensure': ['authorization', 'metadata', 'prompt', 'workingDir'],
  'schedule-observe': ['authorization', 'providerTaskId'],
  'schedule-remove': ['authorization', 'providerTaskId', 'metadataDigest'],
};

function plainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  required: readonly string[],
): boolean {
  const keys = Object.keys(value);
  return keys.every(key => allowed.includes(key))
    && required.every(key => Object.hasOwn(value, key));
}

function validAuthorization(value: unknown): boolean {
  if (!plainObject(value)) return false;
  const allowed = payloadKeys['authorization-consume'];
  return exactKeys(value, allowed, ['proofId', 'proofType', 'proof', 'proofDigest', 'operation', 'capability'])
    && typeof value.proofId === 'string'
    && (value.proofType === 'group' || value.proofType === 'node')
    && plainObject(value.proof)
    && typeof value.proofDigest === 'string'
    && typeof value.operation === 'string'
    && typeof value.capability === 'string'
    && (value.projectId === undefined || typeof value.projectId === 'string')
    && (value.targetOpenId === undefined || typeof value.targetOpenId === 'string')
    && (value.appId === undefined || typeof value.appId === 'string')
    && (value.chatId === undefined || typeof value.chatId === 'string')
    && (value.rootMessageId === undefined || typeof value.rootMessageId === 'string')
    && (value.sessionId === undefined || typeof value.sessionId === 'string');
}

function validAnchor(value: unknown): boolean {
  return plainObject(value)
    && exactKeys(value, ['create_time_ms', 'message_id'], ['create_time_ms', 'message_id'])
    && Number.isSafeInteger(value.create_time_ms)
    && (value.create_time_ms as number) >= 0
    && typeof value.message_id === 'string'
    && value.message_id.length > 0;
}

function requirePayload(command: string, payload: unknown): Record<string, unknown> {
  if (!plainObject(payload)) throw new Error('URGENT_PROVIDER_INPUT_INVALID');
  const allowed = payloadKeys[command];
  if (!allowed) throw new Error('URGENT_PROVIDER_OPERATION_INVALID');
  const required: Record<string, readonly string[]> = {
    capabilities: [],
    'session-authenticate': ['sessionId', 'operation', 'capability', 'projectId', 'probeOnly'],
    'node-read-authenticate': ['probeOnly'],
    'authorization-consume': ['proofId', 'proofType', 'proof', 'proofDigest', 'operation', 'capability'],
    'authorization-revoke': ['proofId', 'proofType', 'proof', 'proofDigest', 'operation', 'capability'],
    'callback-authenticate': ['sessionId'],
    'history-scan': ['authorization', 'anchor', 'requestId'],
    'send-anchor': ['authorization', 'anchor', 'proofId', 'proofDigest', 'actionId', 'markdown', 'targetOpenId'],
    'send-urgent': ['authorization', 'anchor', 'proofId', 'proofDigest', 'actionId', 'tier', 'messageId', 'targetOpenId'],
    'schedule-ensure': ['authorization', 'metadata', 'prompt', 'workingDir'],
    'schedule-observe': ['authorization', 'providerTaskId'],
    'schedule-remove': ['authorization', 'providerTaskId', 'metadataDigest'],
  };
  if (!exactKeys(payload, allowed, required[command])) {
    throw new Error('URGENT_PROVIDER_INPUT_INVALID');
  }
  const stringKeys = allowed.filter(key => ![
    'probeOnly', 'proof', 'authorization', 'anchor', 'metadata',
  ].includes(key));
  if (stringKeys.some(key => payload[key] !== undefined && typeof payload[key] !== 'string')) {
    throw new Error('URGENT_PROVIDER_INPUT_INVALID');
  }
  if (payload.probeOnly !== undefined && typeof payload.probeOnly !== 'boolean') {
    throw new Error('URGENT_PROVIDER_INPUT_INVALID');
  }
  if (payload.authorization !== undefined && !validAuthorization(payload.authorization)) {
    throw new Error('URGENT_PROVIDER_INPUT_INVALID');
  }
  if (payload.anchor !== undefined && !validAnchor(payload.anchor)) {
    throw new Error('URGENT_PROVIDER_INPUT_INVALID');
  }
  if (payload.proof !== undefined && !plainObject(payload.proof)) {
    throw new Error('URGENT_PROVIDER_INPUT_INVALID');
  }
  if (command === 'send-urgent' && !['app', 'sms', 'phone'].includes(payload.tier as string)) {
    throw new Error('URGENT_PROVIDER_INPUT_INVALID');
  }
  if (command === 'schedule-ensure' && !plainObject(payload.metadata)) {
    throw new Error('URGENT_PROVIDER_INPUT_INVALID');
  }
  return payload;
}

export function parseUrgentProviderRequest(
  command: string,
  raw: string,
): { payload: Record<string, unknown>; originCapability?: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('URGENT_PROVIDER_INPUT_INVALID');
  }
  if (JSON.stringify(parsed) !== raw || !plainObject(parsed)) {
    throw new Error('URGENT_PROVIDER_INPUT_INVALID');
  }
  const originCapability = parsed.originCapability;
  if (originCapability !== undefined && typeof originCapability !== 'string') {
    throw new Error('URGENT_PROVIDER_INPUT_INVALID');
  }
  const payload = { ...parsed };
  delete payload.originCapability;
  return {
    payload: command === 'capabilities'
      ? requirePayload('capabilities', payload)
      : requirePayload(command, payload),
    ...(typeof originCapability === 'string' ? { originCapability } : {}),
  };
}

export async function routeUrgentProvider(
  command: string,
  payload: unknown,
  deps: UrgentProviderRouterDeps,
): Promise<unknown> {
  if (command === 'capabilities') {
    if (!plainObject(payload) || Object.keys(payload).length !== 0) {
      throw new Error('URGENT_PROVIDER_INPUT_INVALID');
    }
    return URGENT_PROVIDER_CAPABILITIES;
  }
  const key = handlers[command];
  if (!key || typeof deps[key] !== 'function') {
    throw new Error('URGENT_PROVIDER_OPERATION_INVALID');
  }
  return deps[key](requirePayload(command, payload));
}
