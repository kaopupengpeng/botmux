import { describe, expect, it } from 'vitest';
import {
  authenticateUrgentCallback,
  type UrgentCallbackAuthDeps,
} from '../src/services/urgent-tier-provider-auth.js';
import {
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
  creator_app_id: 'cli-1',
  chat_id: 'oc_test',
  root_message_id: '',
  project_id: 'project-1',
  run_id: '22222222-2222-4222-8222-222222222222',
  family_id: 'a'.repeat(64),
  generation: 0,
  tier: 'app',
  deadline_utc_ms: 1_785_000_000_000,
  action_id: 'b'.repeat(64),
  spec_digest: 'c'.repeat(64),
};

function deps(overrides: Partial<UrgentCallbackAuthDeps> = {}): UrgentCallbackAuthDeps {
  return {
    verifyManagedOrigin: () => true,
    resolveCallbackSession: () => ({
      sessionId: 'callback-session',
      appId: 'cli-1',
      chatId: 'oc_test',
      rootMessageId: '',
      role: 'pm-project',
      active: true,
      receiver: false,
    }),
    readTaskMetadata: () => metadata,
    ...overrides,
  };
}

describe('urgent callback Phase A', () => {
  it('returns complete authenticated task metadata and both digests', () => {
    const result = authenticateUrgentCallback({
      sessionId: 'callback-session',
      executionId: 'exec-1',
      providerTaskId: metadata.provider_task_id,
      familyId: metadata.family_id,
      specDigest: metadata.spec_digest,
    }, deps());
    expect(result.claims.task_metadata).toEqual(metadata);
    expect(result.claims.task_metadata_digest).toBe(taskMetadataDigest(metadata));
    expect(result.claims_digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it.each([
    ['origin', { verifyManagedOrigin: () => false }],
    ['wrong role', { resolveCallbackSession: () => ({
      sessionId: 'callback-session', appId: 'cli-1', chatId: 'oc_test',
      rootMessageId: '', role: 'dev-lead', active: true, receiver: false,
    }) }],
    ['receiver', { resolveCallbackSession: () => ({
      sessionId: 'callback-session', appId: 'cli-1', chatId: 'oc_test',
      rootMessageId: '', role: 'pm-project', active: true, receiver: true,
    }) }],
    ['missing task', { readTaskMetadata: () => undefined }],
    ['task mismatch', { readTaskMetadata: () => ({ ...metadata, chat_id: 'oc-other' }) }],
  ])('fails generically for %s', (_name, override) => {
    expect(() => authenticateUrgentCallback({
      sessionId: 'callback-session',
      executionId: 'exec-1',
      providerTaskId: metadata.provider_task_id,
      familyId: metadata.family_id,
      specDigest: metadata.spec_digest,
    }, deps(override as Partial<UrgentCallbackAuthDeps>)))
      .toThrow('CALLBACK_ORIGIN_UNPROVEN');
  });
});
