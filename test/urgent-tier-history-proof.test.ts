import { describe, expect, it } from 'vitest';
import {
  UrgentHistoryProofStore,
  scanUrgentHistory,
} from '../src/services/urgent-tier-history.js';

const anchor = { create_time_ms: 100, message_id: 'om_anchor' };

describe('urgent history proof', () => {
  it('scans ordered pages and stores an opaque bound proof', async () => {
    let now = 1_000;
    const store = new UrgentHistoryProofStore({ now: () => now, bootId: 'boot-1' });
    const result = await scanUrgentHistory({
      appId: 'cli-1', chatId: 'oc-1', rootMessageId: '', anchor,
      sessionId: 'session-1', capabilityDigest: 'a'.repeat(64),
    }, {
      listPage: async token => {
        now += 5;
        return token
          ? { items: [{ create_time_ms: 102, message_id: 'om_bot', sender_type: 'bot', sender_id: 'ou_bot' }], complete: true }
          : { items: [{ ...anchor, sender_type: 'bot', sender_id: 'ou_bot' }], nextToken: 'p2', complete: false };
      },
      store,
      requestId: 'request-1',
      now: () => now,
    });
    expect(result.complete).toBe(true);
    expect(result.anchorFound).toBe(true);
    expect(result.proofId).toMatch(/^utph_/);
    expect(store.read(result.proofId, result.proofDigest)).toMatchObject({
      observedHead: { message_id: 'om_bot' },
      requestId: 'request-1',
      scanStartedAtMs: 1_000,
      scanCompletedAtMs: 1_010,
      sessionId: 'session-1',
      capabilityDigest: 'a'.repeat(64),
      daemonBootId: 'boot-1',
    });
  });

  it('rejects human messages, ordering gaps, rebinding, expiry, and replay', async () => {
    const store = new UrgentHistoryProofStore({ now: () => 1_000 });
    await expect(scanUrgentHistory({
      appId: 'cli-1', chatId: 'oc-1', rootMessageId: '', anchor,
    }, {
      listPage: async () => ({
        items: [{ ...anchor, sender_type: 'bot', sender_id: 'ou_bot' }, {
          create_time_ms: 101, message_id: 'om_user', sender_type: 'user', sender_id: 'ou_user',
        }],
        complete: true,
      }),
      store,
    })).rejects.toThrow(/HUMAN_REPLY_OBSERVED/);

    const proof = store.create({
      appId: 'cli-1', chatId: 'oc-1', rootMessageId: '', anchor,
      observedHead: anchor, messagesDigest: 'a'.repeat(64), complete: true,
    });
    expect(() => store.consume(proof.proofId, proof.proofDigest, {
      appId: 'cli-1', chatId: 'oc-other', rootMessageId: '', anchor,
    })).toThrow(/HISTORY_PROOF_UNPROVEN/);
    expect(store.consume(proof.proofId, proof.proofDigest, {
      appId: 'cli-1', chatId: 'oc-1', rootMessageId: '', anchor,
    }).anchor).toEqual(anchor);
    expect(() => store.consume(proof.proofId, proof.proofDigest, {
      appId: 'cli-1', chatId: 'oc-1', rootMessageId: '', anchor,
    })).toThrow(/HISTORY_PROOF_UNPROVEN/);
  });

  it('treats unknown sender types as visibility uncertainty', async () => {
    const store = new UrgentHistoryProofStore({ now: () => 1_000 });
    await expect(scanUrgentHistory({
      appId: 'cli-1', chatId: 'oc-1', rootMessageId: '', anchor,
    }, {
      listPage: async () => ({
        items: [{ ...anchor, sender_type: 'unknown' as never, sender_id: 'ou_unknown' }],
        complete: true,
      }),
      store,
    })).rejects.toThrow('HISTORY_VISIBILITY_UNKNOWN');
  });

  it('fails closed at capacity and revokes by session or capability generation', () => {
    const make = (store: UrgentHistoryProofStore, sessionId: string, capabilityDigest: string) =>
      store.create({
        appId: 'cli-1', chatId: 'oc-1', rootMessageId: '', anchor,
        sessionId, capabilityDigest, observedHead: anchor,
        messagesDigest: 'a'.repeat(64), complete: true,
        requestId: 'request-1', scanStartedAtMs: 900, scanCompletedAtMs: 1_000,
      });
    const store = new UrgentHistoryProofStore({
      now: () => 1_000, bootId: 'boot-1', capacity: 2,
    });
    const first = make(store, 'session-1', 'a'.repeat(64));
    const second = make(store, 'session-2', 'b'.repeat(64));
    expect(() => make(store, 'session-3', 'c'.repeat(64))).toThrow(/capacity/);

    store.revokeCapability('session-1', 'a'.repeat(64));
    expect(() => store.read(first.proofId, first.proofDigest)).toThrow('HISTORY_PROOF_UNPROVEN');
    store.revokeSession('session-2');
    expect(() => store.read(second.proofId, second.proofDigest)).toThrow('HISTORY_PROOF_UNPROVEN');
  });
});
