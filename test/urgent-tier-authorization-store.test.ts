import { describe, expect, it } from 'vitest';
import {
  UrgentAuthorizationStore,
  UrgentAuthorizationError,
  type UrgentAuthorizationRecord,
} from '../src/services/urgent-tier-authorization-store.js';

function record(overrides: Partial<UrgentAuthorizationRecord> = {}): UrgentAuthorizationRecord {
  return {
    proofType: 'group',
    proof: { schema: 'botmux.urgent-tier.session-proof/v1', operation: 'config' },
    proofDigest: 'a'.repeat(64),
    daemonBootId: 'boot-1',
    sessionId: 'session-1',
    capabilityDigest: 'b'.repeat(64),
    operation: 'config',
    capability: 'group_write',
    projectId: 'project-1',
    targetOpenId: '',
    appId: 'cli-1',
    chatId: 'oc-1',
    rootMessageId: '',
    issuedAtMs: 1_000,
    expiresAtMs: 31_000,
    maxUses: 1,
    useCount: 0,
    ...overrides,
  };
}

describe('UrgentAuthorizationStore', () => {
  it('issues an opaque single-use proof and burns it before success', () => {
    const store = new UrgentAuthorizationStore({ bootId: 'boot-1', now: () => 2_000 });
    const issued = store.issue(record());
    expect(issued.proofId).toMatch(/^utpa_[A-Za-z0-9_-]{43}$/);
    expect(store.consume(issued.proofId, record())).toEqual(record());
    expect(() => store.consume(issued.proofId, record())).toThrow(UrgentAuthorizationError);
  });

  it.each([
    ['operation', { operation: 'start' }],
    ['capability', { capability: 'group_read' }],
    ['project', { projectId: 'other' }],
    ['target', { targetOpenId: 'ou_other' }],
    ['route', { chatId: 'oc_other' }],
    ['proof type', { proofType: 'node' as const }],
    ['capability generation', { capabilityDigest: 'c'.repeat(64) }],
  ])('rejects cross-%s use', (_label, changed) => {
    const store = new UrgentAuthorizationStore({ bootId: 'boot-1', now: () => 2_000 });
    const issued = store.issue(record());
    expect(() => store.consume(issued.proofId, record(changed))).toThrow(
      /AUTHORIZATION_UNPROVEN/,
    );
  });

  it('rejects caller-modified proof even with a recomputed informational digest', () => {
    const store = new UrgentAuthorizationStore({ bootId: 'boot-1', now: () => 2_000 });
    const issued = store.issue(record());
    expect(() => store.consume(issued.proofId, record({
      proof: { schema: 'botmux.urgent-tier.session-proof/v1', operation: 'start' },
      proofDigest: 'd'.repeat(64),
    }))).toThrow(/AUTHORIZATION_UNPROVEN/);
  });

  it('invalidates expiry, daemon restart, session revocation, and capability rotation', () => {
    let now = 2_000;
    const expired = new UrgentAuthorizationStore({ bootId: 'boot-1', now: () => now });
    const expiredId = expired.issue(record()).proofId;
    now = 32_000;
    expect(() => expired.consume(expiredId, record())).toThrow(/AUTHORIZATION_UNPROVEN/);

    const store = new UrgentAuthorizationStore({ bootId: 'boot-1', now: () => 2_000 });
    const restartId = store.issue(record()).proofId;
    store.setBootId('boot-2');
    expect(() => store.consume(restartId, record({ daemonBootId: 'boot-2' })))
      .toThrow(/AUTHORIZATION_UNPROVEN/);

    store.setBootId('boot-1');
    const sessionId = store.issue(record()).proofId;
    store.revokeSession('session-1');
    expect(() => store.consume(sessionId, record())).toThrow(/AUTHORIZATION_UNPROVEN/);

    const generationId = store.issue(record()).proofId;
    store.revokeCapability('session-1', 'b'.repeat(64));
    expect(() => store.consume(generationId, record())).toThrow(/AUTHORIZATION_UNPROVEN/);
  });

  it('fails capacity without evicting a live proof', () => {
    const store = new UrgentAuthorizationStore({
      bootId: 'boot-1',
      now: () => 2_000,
      capacity: 1,
    });
    const first = store.issue(record());
    expect(() => store.issue(record({ sessionId: 'session-2' }))).toThrow(/capacity/);
    expect(store.consume(first.proofId, record())).toEqual(record());
  });

  it('revokes exact ids without disclosing whether they existed', () => {
    const store = new UrgentAuthorizationStore({ bootId: 'boot-1', now: () => 2_000 });
    const issued = store.issue(record());
    expect(store.revoke(issued.proofId)).toEqual({ ok: true });
    expect(store.revoke(issued.proofId)).toEqual({ ok: true });
  });
});
