import { chmodSync, mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { verifyUrgentNodeAuthority } from '../src/services/urgent-tier-node-authority.js';

let root = '';
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'utp-node-')); chmodSync(root, 0o700); });
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('urgent node-read authority', () => {
  it('requires same-owner safe data dir and 0600 regular secret', () => {
    const secret = join(root, '.dashboard-secret');
    writeFileSync(secret, 'secret', { mode: 0o600 });
    expect(verifyUrgentNodeAuthority(root, secret)).toBe(true);
    chmodSync(secret, 0o644);
    expect(verifyUrgentNodeAuthority(root, secret)).toBe(false);
  });

  it('rejects symlink secret and group/world-writable data dir', () => {
    const target = join(root, 'target');
    writeFileSync(target, 'secret', { mode: 0o600 });
    const link = join(root, 'link');
    symlinkSync(target, link);
    expect(verifyUrgentNodeAuthority(root, link)).toBe(false);
    chmodSync(root, 0o777);
    expect(verifyUrgentNodeAuthority(root, target)).toBe(false);
  });

  it('rejects a directory in place of the secret', () => {
    const secret = join(root, 'secret-dir');
    mkdirSync(secret, { mode: 0o700 });
    expect(verifyUrgentNodeAuthority(root, secret)).toBe(false);
  });

  it('rejects a different daemon uid at issuance or consume time', () => {
    const secret = join(root, '.dashboard-secret');
    writeFileSync(secret, 'secret', { mode: 0o600 });
    expect(verifyUrgentNodeAuthority(root, secret, process.getuid!() + 1)).toBe(false);
  });
});
