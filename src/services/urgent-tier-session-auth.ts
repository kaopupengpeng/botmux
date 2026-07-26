import { createHash } from 'node:crypto';
import {
  UrgentAuthorizationStore,
  type UrgentAuthorizationRecord,
} from './urgent-tier-authorization-store.js';

type Operation =
  | 'config' | 'start' | 'stop' | 'status' | 'history'
  | 'send_anchor' | 'send_urgent'
  | 'schedule_ensure' | 'schedule_observe' | 'schedule_remove';
type Capability = 'group_read' | 'group_write';

const MATRIX: Record<Operation, Capability> = {
  config: 'group_write',
  start: 'group_write',
  stop: 'group_write',
  status: 'group_read',
  history: 'group_read',
  send_anchor: 'group_write',
  send_urgent: 'group_write',
  schedule_ensure: 'group_write',
  schedule_observe: 'group_read',
  schedule_remove: 'group_write',
};

interface SessionIdentity {
  sessionId: string;
  appId: string;
  chatId: string;
  rootMessageId: string;
  role: string;
  active: boolean;
  managed: boolean;
  receiver: boolean;
  adopt: boolean;
  capabilityDigest: string;
}

interface AuthDeps {
  now: () => number;
  bootId: string;
  store: UrgentAuthorizationStore;
  resolveSession: (sessionId: string) => SessionIdentity | undefined;
  verifyManagedOrigin: (session: SessionIdentity) => boolean;
  tenantKey: (appId: string) => Promise<string>;
  botInChat: (appId: string, chatId: string) => Promise<boolean>;
  targetInChat: (appId: string, chatId: string, target: string) => Promise<boolean>;
  verifyNodeOwner: () => boolean;
}

export interface SessionProof {
  schema: 'botmux.urgent-tier.session-proof/v1';
  operation: Operation;
  capability: Capability;
  connector: 'lark';
  tenant_id: string;
  app_id: string;
  chat_id: string;
  root_message_id: string;
  session_id: string;
  runtime_role: 'pm-project';
  project_id: string;
  bot_membership: 'verified';
  target_open_id: string;
  target_membership: 'verified' | 'not_requested';
  provider_interface_revision: 1;
  issued_at_ms: number;
  expires_at_ms: number;
}

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function genericSessionFailure(): Error {
  return new Error('SESSION_AUTHORIZATION_UNPROVEN');
}

function genericNodeFailure(): Error {
  return new Error('NODE_READ_AUTHORIZATION_UNPROVEN');
}

export async function authenticateUrgentSession(
  input: {
    sessionId: string;
    operation: Operation;
    capability: Capability;
    projectId: string;
    targetOpenId?: string;
    probeOnly: boolean;
  },
  deps: AuthDeps,
): Promise<{
  proof: SessionProof;
  proofDigest: string;
  proofId?: string;
  authorizationIssued: boolean;
}> {
  try {
    if (MATRIX[input.operation] !== input.capability
      || !/^[A-Za-z0-9._-]{1,128}$/u.test(input.projectId)) {
      throw genericSessionFailure();
    }
    const session = deps.resolveSession(input.sessionId);
    if (!session || !session.active || !session.managed || session.receiver || session.adopt
      || session.role !== 'pm-project' || !deps.verifyManagedOrigin(session)) {
      throw genericSessionFailure();
    }
    const [tenantId, botMember, targetMember] = await Promise.all([
      deps.tenantKey(session.appId),
      deps.botInChat(session.appId, session.chatId),
      input.targetOpenId
        ? deps.targetInChat(session.appId, session.chatId, input.targetOpenId)
        : Promise.resolve(true),
    ]);
    if (!tenantId || !botMember || !targetMember) throw genericSessionFailure();
    const issuedAt = deps.now();
    const proof: SessionProof = {
      schema: 'botmux.urgent-tier.session-proof/v1',
      operation: input.operation,
      capability: input.capability,
      connector: 'lark',
      tenant_id: tenantId,
      app_id: session.appId,
      chat_id: session.chatId,
      root_message_id: session.rootMessageId,
      session_id: session.sessionId,
      runtime_role: 'pm-project',
      project_id: input.projectId,
      bot_membership: 'verified',
      target_open_id: input.targetOpenId ?? '',
      target_membership: input.targetOpenId ? 'verified' : 'not_requested',
      provider_interface_revision: 1,
      issued_at_ms: issuedAt,
      expires_at_ms: issuedAt + 30_000,
    };
    const proofDigest = digest(proof);
    if (input.probeOnly) {
      return { proof, proofDigest, authorizationIssued: false };
    }
    const record: UrgentAuthorizationRecord = {
      proofType: 'group',
      proof: proof as unknown as Record<string, unknown>,
      proofDigest,
      daemonBootId: deps.bootId,
      sessionId: session.sessionId,
      capabilityDigest: session.capabilityDigest,
      operation: input.operation,
      capability: input.capability,
      projectId: input.projectId,
      targetOpenId: input.targetOpenId ?? '',
      appId: session.appId,
      chatId: session.chatId,
      rootMessageId: session.rootMessageId,
      issuedAtMs: issuedAt,
      expiresAtMs: issuedAt + 30_000,
      maxUses: 1,
      useCount: 0,
    };
    return {
      proof,
      proofDigest,
      proofId: deps.store.issue(record).proofId,
      authorizationIssued: true,
    };
  } catch {
    throw genericSessionFailure();
  }
}

export async function authenticateUrgentNodeRead(
  input: { probeOnly: boolean },
  deps: AuthDeps,
): Promise<{
  proof: Record<string, unknown>;
  proofDigest: string;
  proofId?: string;
  authorizationIssued: boolean;
}> {
  try {
    if (!deps.verifyNodeOwner()) throw genericNodeFailure();
    const issuedAt = deps.now();
    const proof = {
      schema: 'botmux.urgent-tier.node-read-proof/v1',
      proof_type: 'node_read',
      capability: 'node_read',
      provider_interface_revision: 1,
      issued_at_ms: issuedAt,
      expires_at_ms: issuedAt + 30_000,
    };
    const proofDigest = digest(proof);
    if (input.probeOnly) {
      return { proof, proofDigest, authorizationIssued: false };
    }
    const record: UrgentAuthorizationRecord = {
      proofType: 'node',
      proof,
      proofDigest,
      daemonBootId: deps.bootId,
      sessionId: '',
      capabilityDigest: '',
      operation: 'status_all',
      capability: 'node_read',
      projectId: '',
      targetOpenId: '',
      appId: '',
      chatId: '',
      rootMessageId: '',
      issuedAtMs: issuedAt,
      expiresAtMs: issuedAt + 30_000,
      maxUses: 1,
      useCount: 0,
    };
    return {
      proof,
      proofDigest,
      proofId: deps.store.issue(record).proofId,
      authorizationIssued: true,
    };
  } catch {
    throw genericNodeFailure();
  }
}
