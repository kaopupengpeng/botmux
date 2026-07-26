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

export async function routeUrgentProvider(
  command: string,
  payload: unknown,
  deps: UrgentProviderRouterDeps,
): Promise<unknown> {
  if (command === 'capabilities') return URGENT_PROVIDER_CAPABILITIES;
  const key = handlers[command];
  if (!key || typeof deps[key] !== 'function') {
    throw new Error('URGENT_PROVIDER_OPERATION_INVALID');
  }
  return deps[key](payload);
}
