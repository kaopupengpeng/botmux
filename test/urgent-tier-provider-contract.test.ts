import { describe, expect, it } from 'vitest';
import {
  callbackClaimsDigest,
  canonicalTaskMetadata,
  parseTaskMetadataJson,
  taskMetadataDigest,
  type UrgentTaskMetadata,
} from '../src/services/urgent-tier-provider-contract.js';

const metadata: UrgentTaskMetadata = {
  schema: 'botmux.urgent-tier.task-metadata/v1',
  manager_domain: 'ndbflow.urgent-tier.schedule/v1',
  provider_contract: 'botmux.urgent-tier-provider/v1',
  provider_interface_revision: 1,
  callback_contract: 'ndbflow.urgent-tier.callback/v2',
  callback_contract_revision: 2,
  provider_task_id: 'utp_0123456789abcdef0123456789abcdef01234567',
  creator_session_id: '11111111-1111-4111-8111-111111111111',
  creator_app_id: 'cli_test',
  chat_id: 'oc_test',
  root_message_id: 'om_test',
  project_id: 'project-test',
  run_id: '22222222-2222-4222-8222-222222222222',
  family_id: 'a'.repeat(64),
  generation: 0,
  tier: 'app',
  deadline_utc_ms: 1_785_000_000_000,
  action_id: 'b'.repeat(64),
  spec_digest: 'c'.repeat(64),
};

describe('urgent-tier provider contract', () => {
  it('canonicalizes all 19 fields and creates stable domain-separated digests', () => {
    const canonical = canonicalTaskMetadata(metadata);
    expect(Object.keys(JSON.parse(canonical))).toEqual([...Object.keys(metadata)].sort());
    expect(taskMetadataDigest(metadata)).toMatch(/^[0-9a-f]{64}$/);
    expect(callbackClaimsDigest({
      execution_id: 'exec-1',
      callback_session_id: '33333333-3333-4333-8333-333333333333',
      app_id: metadata.creator_app_id,
      chat_id: metadata.chat_id,
      root_message_id: metadata.root_message_id,
      runtime_role: 'pm-project',
      provider_interface_revision: 1,
      task_metadata_digest: taskMetadataDigest(metadata),
    })).toMatch(/^[0-9a-f]{64}$/);
  });

  it.each([
    ['provider_task_id', 'utp_1123456789abcdef0123456789abcdef01234567'],
    ['creator_session_id', '44444444-4444-4444-8444-444444444444'],
    ['creator_app_id', 'cli_other'],
    ['chat_id', 'oc_other'],
    ['root_message_id', 'om_other'],
    ['project_id', 'project-other'],
    ['run_id', '55555555-5555-4555-8555-555555555555'],
    ['family_id', 'd'.repeat(64)],
    ['generation', 1],
    ['tier', 'sms'],
    ['deadline_utc_ms', 1_785_000_000_001],
    ['action_id', 'e'.repeat(64)],
    ['spec_digest', 'f'.repeat(64)],
  ] as const)('changing %s changes task identity', (key, value) => {
    expect(taskMetadataDigest({ ...metadata, [key]: value }))
      .not.toBe(taskMetadataDigest(metadata));
  });

  it.each([
    ['schema', 'wrong'],
    ['manager_domain', 'wrong'],
    ['provider_contract', 'wrong'],
    ['provider_interface_revision', 2],
    ['callback_contract', 'wrong'],
    ['callback_contract_revision', 3],
  ] as const)('rejects changed protocol constant %s', (key, value) => {
    expect(() => taskMetadataDigest({ ...metadata, [key]: value })).toThrow();
  });

  it('rejects unknown, missing, duplicate, float, and nested fields', () => {
    expect(() => taskMetadataDigest({ ...metadata, unknown: true })).toThrow(/unknown/);
    const { action_id: _removed, ...missing } = metadata;
    expect(() => taskMetadataDigest(missing)).toThrow(/missing/);
    expect(() => parseTaskMetadataJson(
      JSON.stringify(metadata).replace('"tier":"app"', '"tier":"app","tier":"sms"'),
    )).toThrow(/duplicate/);
    expect(() => taskMetadataDigest({ ...metadata, generation: 0.5 })).toThrow(/integer/);
    expect(() => taskMetadataDigest({ ...metadata, project_id: { nested: true } })).toThrow();
  });
});
