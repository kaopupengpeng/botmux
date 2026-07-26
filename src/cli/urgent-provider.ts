import { readFileSync } from 'node:fs';
import { config } from '../config.js';
import { fetchDaemonIpc } from '../core/daemon-ipc-auth.js';
import { readManagedOriginCapability } from '../core/managed-origin-capability.js';
import { findOnlineDaemon } from '../utils/daemon-discovery.js';

async function readStdin(): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  if (chunks.length === 0) return {};
  const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('urgent provider stdin must be one JSON object');
  }
  return value as Record<string, unknown>;
}

export async function cmdUrgentProvider(command: string): Promise<void> {
  const payload = await readStdin();
  const sessionId = process.env.BOTMUX_SESSION_ID;
  const appId = process.env.BOTMUX_LARK_APP_ID;
  const daemonPort = Number(process.env.BOTMUX_DAEMON_IPC_PORT)
    || (appId ? findOnlineDaemon(appId)?.ipcPort : undefined);
  if (!daemonPort) throw new Error('urgent provider daemon unavailable');
  const capability = readManagedOriginCapability(
    process.env.SESSION_DATA_DIR ?? config.session.dataDir,
    sessionId,
  )?.capability;
  const body = JSON.stringify({
    ...payload,
    ...(sessionId ? { sessionId } : {}),
    ...(capability ? { originCapability: capability } : {}),
  });
  const path = `/api/urgent-provider/${encodeURIComponent(command)}`;
  let response: Response;
  try {
    response = await fetchDaemonIpc(daemonPort, path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    });
  } catch {
    response = await fetch(`http://127.0.0.1:${daemonPort}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    });
  }
  const text = await response.text();
  process.stdout.write(text || '{}');
  if (!response.ok) process.exitCode = 2;
}
