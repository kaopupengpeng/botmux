import { describe, expect, it, vi } from 'vitest';
import { UrgentHistoryProofStore } from '../src/services/urgent-tier-history.js';
import {
  sendConditionalAnchor,
  sendConditionalUrgent,
} from '../src/services/urgent-tier-delivery.js';

const scope = {
  appId: 'cli-1', chatId: 'oc-1', rootMessageId: '',
  anchor: { create_time_ms: 100, message_id: 'om_anchor' },
  sessionId: 'session-1', capabilityDigest: 'a'.repeat(64),
};

function proof(store: UrgentHistoryProofStore) {
  return store.create({
    ...scope,
    observedHead: scope.anchor,
    messagesDigest: 'a'.repeat(64),
    complete: true,
    requestId: 'request-1',
    scanStartedAtMs: 900,
    scanCompletedAtMs: 1_000,
  });
}

describe('urgent conditional delivery', () => {
  it('sends an anchor only after an unchanged final recheck', async () => {
    const store = new UrgentHistoryProofStore({ now: () => 1_000 });
    const issued = proof(store);
    const send = vi.fn(async () => ({
      messageId: 'om_new', createTimeMs: 110, requestId: 'req-anchor',
    }));
    const receipt = await sendConditionalAnchor({
      ...scope, proofId: issued.proofId, proofDigest: issued.proofDigest,
      actionId: 'b'.repeat(64), markdown: 'decision', targetOpenId: 'ou_target',
    }, {
      store,
      finalRecheck: async () => ({
        complete: true,
        anchorFound: true,
        humanReplyObserved: false,
        observedHead: scope.anchor,
        messagesDigest: 'a'.repeat(64),
      }),
      sendAnchor: send,
      now: (() => { let value = 1_100; return () => value++; })(),
    });
    expect(send).toHaveBeenCalledOnce();
    expect(receipt.mutation.requestId).toBe('req-anchor');
    expect(receipt.mutation.startedAtMs).toBeLessThan(receipt.mutation.completedAtMs);
  });

  it.each(['app', 'sms', 'phone'] as const)('maps %s to the exact native operation', async tier => {
    const store = new UrgentHistoryProofStore({ now: () => 1_000 });
    const issued = proof(store);
    const urgent = vi.fn(async () => ({ requestId: `req-${tier}`, invalidTargets: [] }));
    await sendConditionalUrgent({
      ...scope, proofId: issued.proofId, proofDigest: issued.proofDigest,
      actionId: 'b'.repeat(64), tier, messageId: 'om_anchor', targetOpenId: 'ou_target',
    }, {
      store,
      finalRecheck: async () => ({
        complete: true,
        anchorFound: true,
        humanReplyObserved: false,
        observedHead: scope.anchor,
        messagesDigest: 'a'.repeat(64),
      }),
      sendUrgent: urgent,
      now: Date.now,
    });
    expect(urgent).toHaveBeenCalledWith(tier, 'om_anchor', 'ou_target');
  });

  it('denies advanced or uncertain final history without writing', async () => {
    const store = new UrgentHistoryProofStore({ now: () => 1_000 });
    const first = proof(store);
    const send = vi.fn();
    await expect(sendConditionalAnchor({
      ...scope, proofId: first.proofId, proofDigest: first.proofDigest,
      actionId: 'b'.repeat(64), markdown: 'decision', targetOpenId: 'ou_target',
    }, {
      store,
      finalRecheck: async () => ({
        complete: true,
        anchorFound: true,
        humanReplyObserved: false,
        observedHead: { create_time_ms: 101, message_id: 'om_advanced' },
        messagesDigest: 'b'.repeat(64),
      }),
      sendAnchor: send,
      now: Date.now,
    })).rejects.toThrow('HISTORY_HEAD_ADVANCED');
    expect(send).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: 'missing anchor',
      recheck: {
        complete: true, anchorFound: false, humanReplyObserved: false,
        observedHead: scope.anchor, messagesDigest: 'a'.repeat(64),
      },
    },
    {
      name: 'human reply',
      recheck: {
        complete: true, anchorFound: true, humanReplyObserved: true,
        observedHead: scope.anchor, messagesDigest: 'a'.repeat(64),
      },
    },
    {
      name: 'changed ordered evidence',
      recheck: {
        complete: true, anchorFound: true, humanReplyObserved: false,
        observedHead: scope.anchor, messagesDigest: 'b'.repeat(64),
      },
    },
  ])('denies $name even when the head cursor is unchanged', async ({ recheck }) => {
    const store = new UrgentHistoryProofStore({ now: () => 1_000 });
    const issued = proof(store);
    const send = vi.fn();
    await expect(sendConditionalAnchor({
      ...scope, proofId: issued.proofId, proofDigest: issued.proofDigest,
      actionId: 'b'.repeat(64), markdown: 'decision', targetOpenId: 'ou_target',
    }, {
      store,
      finalRecheck: async () => recheck,
      sendAnchor: send,
      now: Date.now,
    })).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
  });
});
