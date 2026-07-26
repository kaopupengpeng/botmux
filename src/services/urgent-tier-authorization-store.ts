import { randomBytes, timingSafeEqual } from 'node:crypto';

export type UrgentProofType = 'group' | 'node';

export interface UrgentAuthorizationRecord {
  proofType: UrgentProofType;
  proof: Record<string, unknown>;
  proofDigest: string;
  daemonBootId: string;
  sessionId: string;
  capabilityDigest: string;
  operation: string;
  capability: string;
  projectId: string;
  targetOpenId: string;
  appId: string;
  chatId: string;
  rootMessageId: string;
  issuedAtMs: number;
  expiresAtMs: number;
  maxUses: 1;
  useCount: 0 | 1;
}

interface StoredAuthorization extends UrgentAuthorizationRecord {
  proofId: string;
}

export class UrgentAuthorizationError extends Error {
  constructor(message = 'SESSION_AUTHORIZATION_UNPROVEN') {
    super(message);
    this.name = 'UrgentAuthorizationError';
  }
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const input = value as Record<string, unknown>;
  return `{${Object.keys(input).sort().map(key =>
    `${JSON.stringify(key)}:${canonical(input[key])}`).join(',')}}`;
}

function sameString(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function exactRecord(stored: StoredAuthorization, expected: UrgentAuthorizationRecord): boolean {
  return stored.proofType === expected.proofType
    && sameString(stored.proofDigest, expected.proofDigest)
    && sameString(canonical(stored.proof), canonical(expected.proof))
    && stored.daemonBootId === expected.daemonBootId
    && stored.sessionId === expected.sessionId
    && stored.capabilityDigest === expected.capabilityDigest
    && stored.operation === expected.operation
    && stored.capability === expected.capability
    && stored.projectId === expected.projectId
    && stored.targetOpenId === expected.targetOpenId
    && stored.appId === expected.appId
    && stored.chatId === expected.chatId
    && stored.rootMessageId === expected.rootMessageId
    && stored.issuedAtMs === expected.issuedAtMs
    && stored.expiresAtMs === expected.expiresAtMs
    && stored.maxUses === expected.maxUses;
}

export class UrgentAuthorizationStore {
  private readonly records = new Map<string, StoredAuthorization>();
  private bootId: string;
  private readonly now: () => number;
  private readonly capacity: number;

  constructor(options: { bootId: string; now?: () => number; capacity?: number }) {
    this.bootId = options.bootId;
    this.now = options.now ?? Date.now;
    this.capacity = options.capacity ?? 1024;
  }

  private sweep(): void {
    const now = this.now();
    for (const [id, record] of this.records) {
      if (record.expiresAtMs <= now || record.useCount >= record.maxUses
        || record.daemonBootId !== this.bootId) {
        this.records.delete(id);
      }
    }
  }

  issue(record: UrgentAuthorizationRecord): { proofId: string } {
    this.sweep();
    if (record.daemonBootId !== this.bootId || record.expiresAtMs <= this.now()
      || record.maxUses !== 1 || record.useCount !== 0) {
      throw new UrgentAuthorizationError();
    }
    if (this.records.size >= this.capacity) {
      throw new Error('urgent authorization ledger capacity exhausted');
    }
    let proofId = '';
    do {
      proofId = `utpa_${randomBytes(32).toString('base64url')}`;
    } while (this.records.has(proofId));
    this.records.set(proofId, structuredClone({ ...record, proofId }));
    return { proofId };
  }

  consume(proofId: string, expected: UrgentAuthorizationRecord): UrgentAuthorizationRecord {
    this.sweep();
    if (!/^utpa_[A-Za-z0-9_-]{43}$/u.test(proofId)) {
      throw new UrgentAuthorizationError();
    }
    const record = this.records.get(proofId);
    if (!record || !exactRecord(record, expected) || record.expiresAtMs <= this.now()
      || record.useCount !== 0 || record.daemonBootId !== this.bootId) {
      throw new UrgentAuthorizationError();
    }
    // Burn before returning authority.
    this.records.delete(proofId);
    return structuredClone(expected);
  }

  consumeIssued(
    proofId: string,
    input: {
      proofType: UrgentProofType;
      proof: Record<string, unknown>;
      proofDigest: string;
      operation: string;
      capability: string;
      projectId: string;
      targetOpenId: string;
      appId: string;
      chatId: string;
      rootMessageId: string;
      sessionId: string;
    },
    validateCurrentAuthority: (record: Readonly<UrgentAuthorizationRecord>) => boolean,
  ): UrgentAuthorizationRecord {
    this.sweep();
    const record = this.records.get(proofId);
    if (!record
      || record.proofType !== input.proofType
      || !sameString(record.proofDigest, input.proofDigest)
      || !sameString(canonical(record.proof), canonical(input.proof))
      || record.operation !== input.operation
      || record.capability !== input.capability
      || record.projectId !== input.projectId
      || record.targetOpenId !== input.targetOpenId
      || record.appId !== input.appId
      || record.chatId !== input.chatId
      || record.rootMessageId !== input.rootMessageId
      || record.sessionId !== input.sessionId
      || record.daemonBootId !== this.bootId
      || record.expiresAtMs <= this.now()
      || record.useCount !== 0
      || !validateCurrentAuthority(record)) {
      throw new UrgentAuthorizationError(
        input.proofType === 'node'
          ? 'NODE_READ_AUTHORIZATION_UNPROVEN'
          : 'SESSION_AUTHORIZATION_UNPROVEN',
      );
    }
    this.records.delete(proofId);
    const { proofId: _proofId, ...authority } = record;
    return structuredClone(authority);
  }

  revoke(proofId: string): { ok: true } {
    this.records.delete(proofId);
    return { ok: true };
  }

  revokeSession(sessionId: string): void {
    for (const [id, record] of this.records) {
      if (record.sessionId === sessionId) this.records.delete(id);
    }
  }

  revokeCapability(sessionId: string, capabilityDigest: string): void {
    for (const [id, record] of this.records) {
      if (record.sessionId === sessionId && record.capabilityDigest === capabilityDigest) {
        this.records.delete(id);
      }
    }
  }

  setBootId(bootId: string): void {
    if (bootId !== this.bootId) {
      this.bootId = bootId;
      this.records.clear();
    }
  }
}
