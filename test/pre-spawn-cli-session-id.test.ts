import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  createClaudeFamilyAdapter,
  type ClaudeFamilyVariant,
} from '../src/adapters/cli/claude-code.js';

function claudeFamilyAdapter(id: ClaudeFamilyVariant['id']) {
  return createClaudeFamilyAdapter({
    id,
    resumeBin: id,
    dataDir: `/tmp/${id}`,
    stateJsonPath: `/tmp/${id}.json`,
  }, '/bin/true');
}

describe('Claude-family pre-spawn CLI session identity', () => {
  it.each(['claude-code', 'seed', 'relay'] as const)(
    '%s exposes the native id that its fresh --session-id argv will use',
    (id) => {
      const adapter = claudeFamilyAdapter(id);

      expect(adapter.resolvePreSpawnCliSessionId?.({
        sessionId: 'botmux-fresh',
        resume: false,
      })).toBe('botmux-fresh');
    },
  );

  it('preserves the effective resume target instead of overwriting it with the botmux id', () => {
    const adapter = claudeFamilyAdapter('claude-code');

    expect(adapter.resolvePreSpawnCliSessionId?.({
      sessionId: 'botmux-current',
      resume: true,
      resumeSessionId: 'claude-rotated',
    })).toBe('claude-rotated');
  });

  it('publishes the deterministic id before spawn while retaining later rotation updates', () => {
    const source = readFileSync(new URL('../src/worker.ts', import.meta.url), 'utf8');
    const spawnCli = source.indexOf('async function spawnCli(');
    const preSpawnPersist = source.indexOf(
      'persistCliSessionId(preSpawnCliSessionId);',
      spawnCli,
    );
    const backendSpawn = source.indexOf('backend.spawn(spawnBin, spawnArgs, {', spawnCli);
    const rotationPersist = source.indexOf(
      'persistCliSessionId(result.cliSessionId);',
      backendSpawn,
    );

    expect(spawnCli).toBeGreaterThanOrEqual(0);
    expect(preSpawnPersist).toBeGreaterThan(spawnCli);
    expect(preSpawnPersist).toBeLessThan(backendSpawn);
    expect(rotationPersist).toBeGreaterThan(backendSpawn);
  });
});
