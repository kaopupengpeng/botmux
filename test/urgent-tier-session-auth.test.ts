import { describe, expect, it } from 'vitest';
import { UrgentAuthorizationStore } from '../src/services/urgent-tier-authorization-store.js';
import {
  authenticateUrgentNodeRead,
  authenticateUrgentSession,
} from '../src/services/urgent-tier-session-auth.js';

const session = {
  sessionId: 'session-1', appId: 'cli-1', chatId: 'oc-1', rootMessageId: '',
  role: 'pm-project', active: true, managed: true, receiver: false, adopt: false,
  capabilityDigest: 'a'.repeat(64),
};

function deps() {
  return {
    now: () => 1_000,
    bootId: 'boot-1',
    store: new UrgentAuthorizationStore({ bootId: 'boot-1', now: () => 1_000 }),
    resolveSession: () => session,
    verifyManagedOrigin: () => true,
    tenantKey: async () => 'tenant-1',
    botInChat: async () => true,
    targetInChat: async () => true,
    verifyNodeOwner: () => true,
  };
}

describe('urgent-tier session authentication', () => {
  it('issues a single-use group proof from daemon-owned identity', async () => {
    const result = await authenticateUrgentSession({
      sessionId: 'session-1', operation: 'start', capability: 'group_write',
      projectId: 'project-1', targetOpenId: 'ou_target', probeOnly: false,
    }, deps());
    expect(result.proof.app_id).toBe('cli-1');
    expect(result.proof.tenant_id).toBe('tenant-1');
    expect(result.proof.target_membership).toBe('verified');
    expect(result.proofId).toMatch(/^utpa_/);
  });

  it('probe-only performs checks but issues no bearer', async () => {
    const result = await authenticateUrgentSession({
      sessionId: 'session-1', operation: 'status', capability: 'group_read',
      projectId: 'project-1', probeOnly: true,
    }, deps());
    expect(result.authorizationIssued).toBe(false);
    expect(result.proofId).toBeUndefined();
  });

  it.each([
    ['wrong role', { resolveSession: () => ({ ...session, role: 'dev-lead' }) }],
    ['receiver', { resolveSession: () => ({ ...session, receiver: true }) }],
    ['adopt', { resolveSession: () => ({ ...session, adopt: true }) }],
    ['origin', { verifyManagedOrigin: () => false }],
    ['bot membership', { botInChat: async () => false }],
    ['target membership', { targetInChat: async () => false }],
    ['tenant', { tenantKey: async () => '' }],
  ])('fails generically for %s', async (_name, override) => {
    await expect(authenticateUrgentSession({
      sessionId: 'session-1', operation: 'start', capability: 'group_write',
      projectId: 'project-1', targetOpenId: 'ou_target', probeOnly: false,
    }, { ...deps(), ...override })).rejects.toThrow('SESSION_AUTHORIZATION_UNPROVEN');
  });

  it('keeps node-read authority separate', async () => {
    const result = await authenticateUrgentNodeRead({ probeOnly: false }, deps());
    expect(result.proof.proof_type).toBe('node_read');
    expect(result.proofId).toMatch(/^utpa_/);
    await expect(authenticateUrgentNodeRead(
      { probeOnly: false },
      { ...deps(), verifyNodeOwner: () => false },
    )).rejects.toThrow('NODE_READ_AUTHORIZATION_UNPROVEN');
  });
});
