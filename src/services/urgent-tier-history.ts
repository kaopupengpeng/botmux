import { createHash, randomBytes } from 'node:crypto';

export interface HistoryCursor {
  create_time_ms: number;
  message_id: string;
}

export interface HistoryMessage extends HistoryCursor {
  sender_type: 'bot' | 'user';
}

interface ProofScope {
  appId: string;
  chatId: string;
  rootMessageId: string;
  anchor: HistoryCursor;
}

interface ProofRecord extends ProofScope {
  proofId: string;
  proofDigest: string;
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

function sameScope(record: ProofRecord, expected: ProofScope): boolean {
  return record.appId === expected.appId
    && record.chatId === expected.chatId
    && record.rootMessageId === expected.rootMessageId
    && cursorCompare(record.anchor, expected.anchor) === 0;
}

export class UrgentHistoryProofStore {
  private readonly records = new Map<string, ProofRecord>();
  private readonly now: () => number;

  constructor(options: { now?: () => number } = {}) {
    this.now = options.now ?? Date.now;
  }

  create(input: ProofScope & {
    observedHead: HistoryCursor;
    messagesDigest: string;
    complete: true;
  }): { proofId: string; proofDigest: string } {
    const proofId = `utph_${randomBytes(32).toString('base64url')}`;
    const body = { ...input, expiresAtMs: this.now() + 30_000 };
    const proofDigest = digest(body);
    this.records.set(proofId, { proofId, proofDigest, ...body });
    return { proofId, proofDigest };
  }

  read(proofId: string, proofDigest: string): ProofRecord {
    const record = this.records.get(proofId);
    if (!record || record.expiresAtMs <= this.now() || record.proofDigest !== proofDigest) {
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
  },
): Promise<{
  complete: true;
  anchorFound: true;
  observedHead: HistoryCursor;
  proofId: string;
  proofDigest: string;
}> {
  const messages: HistoryMessage[] = [];
  const tokens = new Set<string>();
  let token: string | undefined;
  let complete = false;
  for (let page = 0; page < 100; page += 1) {
    const result = await deps.listPage(token);
    for (const message of result.items) {
      if (message.sender_type !== 'bot' && message.sender_type !== 'user') {
        throw new Error('HISTORY_VISIBILITY_UNKNOWN');
      }
      messages.push(message);
    }
    complete = result.complete;
    if (complete) break;
    if (!result.nextToken || tokens.has(result.nextToken)) {
      throw new Error('HISTORY_VISIBILITY_UNKNOWN');
    }
    tokens.add(result.nextToken);
    token = result.nextToken;
  }
  if (!complete) throw new Error('HISTORY_VISIBILITY_UNKNOWN');
  for (let i = 1; i < messages.length; i += 1) {
    if (cursorCompare(messages[i - 1], messages[i]) >= 0) {
      throw new Error('HISTORY_VISIBILITY_UNKNOWN');
    }
  }
  const anchorFound = messages.some(message => cursorCompare(message, scope.anchor) === 0);
  if (!anchorFound) throw new Error('HISTORY_VISIBILITY_UNKNOWN');
  if (messages.some(message => message.sender_type === 'user'
    && cursorCompare(message, scope.anchor) > 0)) {
    throw new Error('HUMAN_REPLY_OBSERVED');
  }
  const observedHead = messages.at(-1) ?? scope.anchor;
  const proof = deps.store.create({
    ...scope,
    observedHead,
    messagesDigest: digest(messages),
    complete: true,
  });
  return { complete: true, anchorFound: true, observedHead, ...proof };
}
