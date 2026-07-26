import { describe, expect, it } from 'vitest';
import {
  UrgentHistoryProofStore,
  scanUrgentHistory,
} from '../src/services/urgent-tier-history.js';

const anchor = { create_time_ms: 100, message_id: 'om_anchor' };

describe('urgent history proof', () => {
  it('scans ordered pages and stores an opaque bound proof', async () => {
    const store = new UrgentHistoryProofStore({ now: () => 1_000 });
    const result = await scanUrgentHistory({
      appId: 'cli-1', chatId: 'oc-1', rootMessageId: '', anchor,
    }, {
      listPage: async token => token
        ? { items: [{ create_time_ms: 102, message_id: 'om_bot', sender_type: 'bot' }], complete: true }
        : { items: [{ ...anchor, sender_type: 'bot' }], nextToken: 'p2', complete: false },
      store,
    });
    expect(result.complete).toBe(true);
    expect(result.anchorFound).toBe(true);
    expect(result.proofId).toMatch(/^utph_/);
    expect(store.read(result.proofId, result.proofDigest).observedHead.message_id).toBe('om_bot');
  });

  it('rejects human messages, ordering gaps, rebinding, expiry, and replay', async () => {
    const store = new UrgentHistoryProofStore({ now: () => 1_000 });
    await expect(scanUrgentHistory({
      appId: 'cli-1', chatId: 'oc-1', rootMessageId: '', anchor,
    }, {
      listPage: async () => ({
        items: [{ ...anchor, sender_type: 'bot' }, {
          create_time_ms: 101, message_id: 'om_user', sender_type: 'user',
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
});
