import { afterEach, describe, expect, it } from 'vitest';
import {
  startIpcServer,
  type IpcServerHandle,
} from '../src/core/dashboard-ipc-server.js';

let handle: IpcServerHandle | undefined;

afterEach(async () => {
  await handle?.close();
  handle = undefined;
});

async function post(command: string, raw: string): Promise<Response> {
  handle = await startIpcServer({ port: 0, host: '127.0.0.1' });
  return fetch(`http://127.0.0.1:${handle.port}/api/urgent-provider/${command}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: raw,
  });
}

describe('urgent provider daemon IPC raw schema', () => {
  it('serves canonical capabilities without issuing authority', async () => {
    const response = await post('capabilities', '{}');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      contract: 'botmux.urgent-tier-provider/v1',
      probe_issues_authorization: false,
    });
  });

  it.each([
    ['unknown field', '{"attacker":true}'],
    [
      'duplicate field',
      '{"sessionId":"s","operation":"status","capability":"group_read","projectId":"p","probeOnly":true,"operation":"start"}',
    ],
  ])('rejects %s before runtime dispatch', async (_name, raw) => {
    const command = raw === '{"attacker":true}' ? 'capabilities' : 'session-authenticate';
    const response = await post(command, raw);
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: 'URGENT_PROVIDER_INPUT_INVALID',
    });
  });
});
