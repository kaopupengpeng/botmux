import { createHash, randomBytes } from 'node:crypto';

export interface HistoryCursor {
  create_time_ms: number;
  message_id: string;
}

export interface HistoryMessage extends HistoryCursor {
  sender_type: 'bot' | 'user' | 'unknown';
  sender_id?: string;
  withdrawn?: boolean;
  root_id?: string;
  thread_id?: string;
}

export interface ProofScope {
  appId: string;
  chatId: string;
  rootMessageId: string;
  anchor: HistoryCursor;
  sessionId: string;
  capabilityDigest: string;
}

interface ProofRecord extends ProofScope {
  proofId: string;
  proofDigest: string;
  daemonBootId: string;
  requestId: string;
  scanStartedAtMs: number;
  scanCompletedAtMs: number;
  observedHead: HistoryCursor;
  messagesDigest: string;
  complete: true;
  expiresAtMs: number;
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  const input = value as Record<string, unknown>;
  return `{${Object.keys(input).sort().map(key =>
    `${JSON.stringify(key)}:${canonical(input[key])}`).join(',')}}`;
}

function digest(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex');
}

function cursorCompare(left: HistoryCursor, right: HistoryCursor): number {
  return left.create_time_ms - right.create_time_ms
    || left.message_id.localeCompare(right.message_id);
}

export function evaluateUrgentHistory(
  scope: Pick<ProofScope, 'anchor'>,
  messages: HistoryMessage[],
): {
  anchorFound: boolean;
  humanReplyObserved: boolean;
  observedHead: HistoryCursor;
  messagesDigest: string;
} {
  for (const message of messages) {
    if (!Number.isSafeInteger(message.create_time_ms)
      || message.create_time_ms < 0
      || !message.message_id
      || !message.sender_id) {
      throw new Error('HISTORY_VISIBILITY_UNKNOWN');
    }
    if (message.sender_type !== 'bot' && message.sender_type !== 'user') {
      throw new Error('HISTORY_VISIBILITY_UNKNOWN');
    }
    if (message.withdrawn) throw new Error('HISTORY_VISIBILITY_UNKNOWN');
  }
  for (let index = 1; index < messages.length; index += 1) {
    if (cursorCompare(messages[index - 1], messages[index]) >= 0) {
      throw new Error('HISTORY_VISIBILITY_UNKNOWN');
    }
  }
  const anchorFound = messages.some(message => cursorCompare(message, scope.anchor) === 0);
  const humanReplyObserved = messages.some(message => message.sender_type === 'user'
    && cursorCompare(message, scope.anchor) > 0);
  return {
    anchorFound,
    humanReplyObserved,
    observedHead: messages.at(-1) ?? scope.anchor,
    messagesDigest: digest(messages),
  };
}

function sameScope(record: ProofRecord, expected: ProofScope): boolean {
  return record.appId === expected.appId
    && record.chatId === expected.chatId
    && record.rootMessageId === expected.rootMessageId
    && record.sessionId === expected.sessionId
    && record.capabilityDigest === expected.capabilityDigest
    && cursorCompare(record.anchor, expected.anchor) === 0;
}

export class UrgentHistoryProofStore {
  private readonly records = new Map<string, ProofRecord>();
  private readonly now: () => number;
  private readonly bootId: string;
  private readonly capacity: number;

  constructor(options: { now?: () => number; bootId?: string; capacity?: number } = {}) {
    this.now = options.now ?? Date.now;
    this.bootId = options.bootId ?? 'process';
    this.capacity = options.capacity ?? 1024;
  }

  private sweep(): void {
    const now = this.now();
    for (const [proofId, record] of this.records) {
      if (record.expiresAtMs <= now || record.daemonBootId !== this.bootId) {
        this.records.delete(proofId);
      }
    }
  }

  create(input: ProofScope & {
    observedHead: HistoryCursor;
    messagesDigest: string;
    complete: true;
    requestId?: string;
    scanStartedAtMs?: number;
    scanCompletedAtMs?: number;
  }): { proofId: string; proofDigest: string } {
    this.sweep();
    if (this.records.size >= this.capacity) {
      throw new Error('history proof ledger capacity exhausted');
    }
    const proofId = `utph_${randomBytes(32).toString('base64url')}`;
    const now = this.now();
    const body = {
      ...input,
      daemonBootId: this.bootId,
      requestId: input.requestId ?? proofId,
      scanStartedAtMs: input.scanStartedAtMs ?? now,
      scanCompletedAtMs: input.scanCompletedAtMs ?? now,
      expiresAtMs: now + 30_000,
    };
    const proofDigest = digest(body);
    this.records.set(proofId, { proofId, proofDigest, ...body });
    return { proofId, proofDigest };
  }

  read(proofId: string, proofDigest: string): ProofRecord {
    this.sweep();
    const record = this.records.get(proofId);
    if (!record || record.proofDigest !== proofDigest) {
      throw new Error('HISTORY_PROOF_UNPROVEN');
    }
    return structuredClone(record);
  }

  consume(proofId: string, proofDigest: string, expected: ProofScope): ProofRecord {
    const record = this.read(proofId, proofDigest);
    if (!sameScope(record, expected)) throw new Error('HISTORY_PROOF_UNPROVEN');
    this.records.delete(proofId);
    return record;
  }

  revokeSession(sessionId: string): void {
    for (const [proofId, record] of this.records) {
      if (record.sessionId === sessionId) this.records.delete(proofId);
    }
  }

  revokeCapability(sessionId: string, capabilityDigest: string): void {
    for (const [proofId, record] of this.records) {
      if (record.sessionId === sessionId && record.capabilityDigest === capabilityDigest) {
        this.records.delete(proofId);
      }
    }
  }
}

export async function scanUrgentHistory(
  scope: ProofScope,
  deps: {
    listPage: (token?: string) => Promise<{
      items: HistoryMessage[];
      nextToken?: string;
      complete: boolean;
    }>;
    store: UrgentHistoryProofStore;
    requestId?: string;
    now?: () => number;
  },
): Promise<{
  complete: true;
  anchorFound: true;
  observedHead: HistoryCursor;
  proofId: string;
  proofDigest: string;
}> {
  const now = deps.now ?? Date.now;
  const scanStartedAtMs = now();
  const messages: HistoryMessage[] = [];
  const tokens = new Set<string>();
  let token: string | undefined;
  let complete = false;
  for (let page = 0; page < 100; page += 1) {
    const result = await deps.listPage(token);
    messages.push(...result.items);
    complete = result.complete;
    if (complete) break;
    if (!result.nextToken || tokens.has(result.nextToken)) {
      throw new Error('HISTORY_VISIBILITY_UNKNOWN');
    }
    tokens.add(result.nextToken);
    token = result.nextToken;
  }
  if (!complete) throw new Error('HISTORY_VISIBILITY_UNKNOWN');
  const evidence = evaluateUrgentHistory(scope, messages);
  const anchorFound = evidence.anchorFound;
  if (!anchorFound) throw new Error('HISTORY_VISIBILITY_UNKNOWN');
  if (evidence.humanReplyObserved) {
    throw new Error('HUMAN_REPLY_OBSERVED');
  }
  const observedHead = evidence.observedHead;
  const scanCompletedAtMs = now();
  const proof = deps.store.create({
    ...scope,
    observedHead,
    messagesDigest: evidence.messagesDigest,
    complete: true,
    requestId: deps.requestId,
    scanStartedAtMs,
    scanCompletedAtMs,
  });
  return { complete: true, anchorFound: true, observedHead, ...proof };
}
