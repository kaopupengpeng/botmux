import {
  UrgentHistoryProofStore,
  type HistoryCursor,
} from './urgent-tier-history.js';

interface FinalRecheck {
  complete: boolean;
  observedHead: HistoryCursor;
}

interface MutationReceipt {
  acceptedHead: HistoryCursor;
  finalHead: HistoryCursor;
  proofDigest: string;
  mutation: {
    requestId: string;
    startedAtMs: number;
    completedAtMs: number;
  };
}

function sameCursor(left: HistoryCursor, right: HistoryCursor): boolean {
  return left.create_time_ms === right.create_time_ms
    && left.message_id === right.message_id;
}

async function authorizeWrite(
  input: {
    appId: string;
    chatId: string;
    rootMessageId: string;
    anchor: HistoryCursor;
    proofId: string;
    proofDigest: string;
  },
  deps: {
    store: UrgentHistoryProofStore;
    finalRecheck: () => Promise<FinalRecheck>;
  },
) {
  const proof = deps.store.consume(input.proofId, input.proofDigest, input);
  const final = await deps.finalRecheck();
  if (!final.complete) throw new Error('HISTORY_VISIBILITY_UNKNOWN');
  if (!sameCursor(final.observedHead, proof.observedHead)) {
    throw new Error('HISTORY_HEAD_ADVANCED');
  }
  return { proof, final };
}

export async function sendConditionalAnchor(
  input: {
    appId: string;
    chatId: string;
    rootMessageId: string;
    anchor: HistoryCursor;
    proofId: string;
    proofDigest: string;
    actionId: string;
    markdown: string;
    targetOpenId: string;
  },
  deps: {
    store: UrgentHistoryProofStore;
    finalRecheck: () => Promise<FinalRecheck>;
    sendAnchor: (input: {
      actionId: string;
      markdown: string;
      targetOpenId: string;
    }) => Promise<{ messageId: string; createTimeMs: number; requestId: string }>;
    now: () => number;
  },
): Promise<MutationReceipt & { messageId: string; createTimeMs: number }> {
  const { proof, final } = await authorizeWrite(input, deps);
  const startedAtMs = deps.now();
  const result = await deps.sendAnchor({
    actionId: input.actionId,
    markdown: input.markdown,
    targetOpenId: input.targetOpenId,
  });
  const completedAtMs = deps.now();
  return {
    acceptedHead: proof.observedHead,
    finalHead: final.observedHead,
    proofDigest: input.proofDigest,
    messageId: result.messageId,
    createTimeMs: result.createTimeMs,
    mutation: { requestId: result.requestId, startedAtMs, completedAtMs },
  };
}

export async function sendConditionalUrgent(
  input: {
    appId: string;
    chatId: string;
    rootMessageId: string;
    anchor: HistoryCursor;
    proofId: string;
    proofDigest: string;
    actionId: string;
    tier: 'app' | 'sms' | 'phone';
    messageId: string;
    targetOpenId: string;
  },
  deps: {
    store: UrgentHistoryProofStore;
    finalRecheck: () => Promise<FinalRecheck>;
    sendUrgent: (
      tier: 'app' | 'sms' | 'phone',
      messageId: string,
      targetOpenId: string,
    ) => Promise<{ requestId: string; invalidTargets: string[] }>;
    now: () => number;
  },
): Promise<MutationReceipt> {
  const { proof, final } = await authorizeWrite(input, deps);
  const startedAtMs = deps.now();
  const result = await deps.sendUrgent(input.tier, input.messageId, input.targetOpenId);
  const completedAtMs = deps.now();
  if (result.invalidTargets.length) throw new Error('URGENT_TARGET_INVALID');
  return {
    acceptedHead: proof.observedHead,
    finalHead: final.observedHead,
    proofDigest: input.proofDigest,
    mutation: { requestId: result.requestId, startedAtMs, completedAtMs },
  };
}
