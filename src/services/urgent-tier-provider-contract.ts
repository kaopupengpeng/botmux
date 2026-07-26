import { createHash } from 'node:crypto';

export const TASK_METADATA_SCHEMA = 'botmux.urgent-tier.task-metadata/v1';
export const MANAGER_DOMAIN = 'ndbflow.urgent-tier.schedule/v1';
export const PROVIDER_CONTRACT = 'botmux.urgent-tier-provider/v1';
export const CALLBACK_CONTRACT = 'ndbflow.urgent-tier.callback/v2';

export interface UrgentTaskMetadata {
  schema: typeof TASK_METADATA_SCHEMA;
  manager_domain: typeof MANAGER_DOMAIN;
  provider_contract: typeof PROVIDER_CONTRACT;
  provider_interface_revision: 1;
  callback_contract: typeof CALLBACK_CONTRACT;
  callback_contract_revision: 2;
  provider_task_id: string;
  creator_session_id: string;
  creator_app_id: string;
  chat_id: string;
  root_message_id: string;
  project_id: string;
  run_id: string;
  family_id: string;
  generation: number;
  tier: 'app' | 'sms' | 'phone';
  deadline_utc_ms: number;
  action_id: string;
  spec_digest: string;
}

export interface UrgentCallbackClaims {
  execution_id: string;
  callback_session_id: string;
  app_id: string;
  chat_id: string;
  root_message_id: string;
  runtime_role: 'pm-project';
  provider_interface_revision: 1;
  task_metadata_digest: string;
}

const TASK_KEYS = [
  'schema', 'manager_domain', 'provider_contract', 'provider_interface_revision',
  'callback_contract', 'callback_contract_revision', 'provider_task_id',
  'creator_session_id', 'creator_app_id', 'chat_id', 'root_message_id',
  'project_id', 'run_id', 'family_id', 'generation', 'tier', 'deadline_utc_ms',
  'action_id', 'spec_digest',
] as const;

const HEX64 = /^[0-9a-f]{64}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const ID = /^[A-Za-z0-9._-]{1,128}$/u;
const TASK_ID = /^utp_[0-9a-f]{40}$/u;

function frame(value: Buffer): Buffer {
  const prefix = Buffer.alloc(4);
  prefix.writeUInt32BE(value.length);
  return Buffer.concat([prefix, value]);
}

function u32(value: number): Buffer {
  const out = Buffer.alloc(4);
  out.writeUInt32BE(value);
  return out;
}

function digest(domain: string, fields: Buffer[]): string {
  const bytes = Buffer.concat([
    frame(Buffer.from(domain, 'utf8')),
    frame(u32(1)),
    ...fields.map(frame),
  ]);
  return createHash('sha256').update(bytes).digest('hex');
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('task metadata must be an object');
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>): void {
  const actual = Object.keys(value);
  const missing = TASK_KEYS.filter(key => !(key in value));
  const unknown = actual.filter(key => !(TASK_KEYS as readonly string[]).includes(key));
  if (missing.length) throw new Error(`missing task metadata fields: ${missing.join(',')}`);
  if (unknown.length) throw new Error(`unknown task metadata fields: ${unknown.join(',')}`);
}

function stringField(value: Record<string, unknown>, key: string, pattern = ID): string {
  const field = value[key];
  if (typeof field !== 'string' || !pattern.test(field)) {
    throw new Error(`invalid ${key}`);
  }
  return field;
}

function integerField(value: Record<string, unknown>, key: string): number {
  const field = value[key];
  if (!Number.isSafeInteger(field) || Number(field) < 0) {
    throw new Error(`${key} must be a non-negative safe integer`);
  }
  return Number(field);
}

export function validateTaskMetadata(value: unknown): UrgentTaskMetadata {
  const input = record(value);
  exactKeys(input);
  if (input.schema !== TASK_METADATA_SCHEMA
    || input.manager_domain !== MANAGER_DOMAIN
    || input.provider_contract !== PROVIDER_CONTRACT
    || input.provider_interface_revision !== 1
    || input.callback_contract !== CALLBACK_CONTRACT
    || input.callback_contract_revision !== 2) {
    throw new Error('task metadata protocol constant mismatch');
  }
  const root = input.root_message_id;
  if (typeof root !== 'string' || (root !== '' && !/^om_[A-Za-z0-9_-]+$/u.test(root))) {
    throw new Error('invalid root_message_id');
  }
  const tier = input.tier;
  if (tier !== 'app' && tier !== 'sms' && tier !== 'phone') {
    throw new Error('invalid tier');
  }
  return {
    schema: TASK_METADATA_SCHEMA,
    manager_domain: MANAGER_DOMAIN,
    provider_contract: PROVIDER_CONTRACT,
    provider_interface_revision: 1,
    callback_contract: CALLBACK_CONTRACT,
    callback_contract_revision: 2,
    provider_task_id: stringField(input, 'provider_task_id', TASK_ID),
    creator_session_id: stringField(input, 'creator_session_id', UUID),
    creator_app_id: stringField(input, 'creator_app_id'),
    chat_id: stringField(input, 'chat_id', /^oc_[A-Za-z0-9_-]+$/u),
    root_message_id: root,
    project_id: stringField(input, 'project_id'),
    run_id: stringField(input, 'run_id', UUID),
    family_id: stringField(input, 'family_id', HEX64),
    generation: integerField(input, 'generation'),
    tier,
    deadline_utc_ms: integerField(input, 'deadline_utc_ms'),
    action_id: stringField(input, 'action_id', HEX64),
    spec_digest: stringField(input, 'spec_digest', HEX64),
  };
}

function canonical(value: Record<string, unknown>): string {
  return `{${Object.keys(value).sort().map(key =>
    `${JSON.stringify(key)}:${JSON.stringify(value[key])}`).join(',')}}`;
}

export function canonicalTaskMetadata(value: unknown): string {
  return canonical(validateTaskMetadata(value) as unknown as Record<string, unknown>);
}

export function taskMetadataDigest(value: unknown): string {
  return digest(TASK_METADATA_SCHEMA, [Buffer.from(canonicalTaskMetadata(value), 'utf8')]);
}

export function callbackClaimsDigest(value: UrgentCallbackClaims): string {
  if (value.runtime_role !== 'pm-project' || value.provider_interface_revision !== 1
    || !HEX64.test(value.task_metadata_digest)) {
    throw new Error('invalid callback claims');
  }
  return digest('botmux.urgent-tier.callback-claims/v1', [
    Buffer.from(value.execution_id, 'utf8'),
    Buffer.from(value.callback_session_id, 'utf8'),
    Buffer.from(value.app_id, 'utf8'),
    Buffer.from(value.chat_id, 'utf8'),
    Buffer.from(value.root_message_id, 'utf8'),
    Buffer.from(value.runtime_role, 'utf8'),
    u32(value.provider_interface_revision),
    Buffer.from(value.task_metadata_digest, 'hex'),
  ]);
}

export function parseTaskMetadataJson(raw: string): UrgentTaskMetadata {
  // The accepted metadata schema is flat, so a bounded exact-key scan detects
  // duplicates before JSON.parse would silently keep the last value.
  for (const key of TASK_KEYS) {
    const count = [...raw.matchAll(new RegExp(`"${key}"\\s*:`, 'gu'))].length;
    if (count > 1) throw new Error(`duplicate key: ${key}`);
  }
  const object = JSON.parse(raw);
  return validateTaskMetadata(object);
}
