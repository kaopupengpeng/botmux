import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { computeInputHash } from '../src/utils/canonical-input-hash.js';

let dir = '';
vi.mock('../src/config.js', () => ({ config: { session: { get dataDir() { return dir; } } } }));
vi.mock('../src/utils/logger.js', () => ({ logger: { info: vi.fn(), debug: vi.fn(), error: vi.fn() } }));
vi.mock('../src/core/dashboard-events.js', () => ({ dashboardEventBus: { publish: vi.fn() } }));

const params = {
  name: 'managed', schedule: '30m',
  parsed: { kind: 'once' as const, runAt: '2026-07-26T10:00:00Z', display: '30m' },
  prompt: 'callback', workingDir: '/tmp', chatId: 'oc_test',
};
const metadata = {
  schema: 'botmux.urgent-tier.task-metadata/v1',
  manager_domain: 'ndbflow.urgent-tier.schedule/v1',
  provider_contract: 'botmux.urgent-tier-provider/v1',
  provider_interface_revision: 1,
  callback_contract: 'ndbflow.urgent-tier.callback/v2',
  callback_contract_revision: 2,
  provider_task_id: `utp_${'1'.repeat(40)}`,
  creator_session_id: '11111111-1111-4111-8111-111111111111',
  creator_app_id: 'cli_test', chat_id: 'oc_test', root_message_id: '',
  project_id: 'project', run_id: '22222222-2222-4222-8222-222222222222',
  family_id: 'a'.repeat(64), generation: 0, tier: 'app' as const,
  deadline_utc_ms: 1_785_000_000_000, action_id: 'b'.repeat(64), spec_digest: 'c'.repeat(64),
};

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'utp-schedule-')); vi.resetModules(); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('managed urgent schedule', () => {
  it('preserves ordinary canonical hash', async () => {
    const { canonicalScheduleInput } = await import('../src/services/schedule-store.js');
    expect(computeInputHash(canonicalScheduleInput(params)))
      .toBe('sha256:5d9d9b4382e59df06565ceaee598325b3f96df191a9eb9f401af483e43546c5a');
  });

  it('returns identical managed task and conflicts on metadata drift', async () => {
    const { createTask, getTask, IdempotencyConflictError } = await import('../src/services/schedule-store.js');
    const managed = { schema: 'botmux.schedule-managed/v1' as const,
      manager_domain: 'ndbflow.urgent-tier.schedule/v1' as const, metadata };
    const first = createTask({ ...params, id: metadata.provider_task_id, managed });
    expect(createTask({ ...params, id: metadata.provider_task_id, managed })).toEqual(first);
    expect(getTask(first.id)?.managed?.metadata).toEqual(metadata);
    expect(() => createTask({ ...params, id: metadata.provider_task_id,
      managed: { ...managed, metadata: { ...metadata, generation: 1 } } }))
      .toThrow(IdempotencyConflictError);
  });

  it('rejects namespace crossover', async () => {
    const { createTask } = await import('../src/services/schedule-store.js');
    expect(() => createTask({ ...params, id: metadata.provider_task_id })).toThrow(/managed/);
    expect(() => createTask({ ...params, id: 'ordinary1',
      managed: { schema: 'botmux.schedule-managed/v1',
        manager_domain: 'ndbflow.urgent-tier.schedule/v1', metadata } })).toThrow(/utp_/);
  });
});
