import { lstatSync } from 'node:fs';

export function verifyUrgentNodeAuthority(
  dataDir: string,
  secretPath: string,
  uid = process.getuid?.(),
): boolean {
  if (uid === undefined) return false;
  try {
    const data = lstatSync(dataDir);
    const secret = lstatSync(secretPath);
    return data.isDirectory()
      && !data.isSymbolicLink()
      && data.uid === uid
      && (data.mode & 0o022) === 0
      && secret.isFile()
      && !secret.isSymbolicLink()
      && secret.uid === uid
      && (secret.mode & 0o777) === 0o600;
  } catch {
    return false;
  }
}
