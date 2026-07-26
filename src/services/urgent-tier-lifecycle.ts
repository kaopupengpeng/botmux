interface UrgentAuthorizationLifecycle {
  revokeCapability: (sessionId: string, capabilityDigest: string) => void;
  revokeSession: (sessionId: string) => void;
}

let lifecycle: UrgentAuthorizationLifecycle | undefined;

export function registerUrgentAuthorizationLifecycle(
  next: UrgentAuthorizationLifecycle | undefined,
): void {
  lifecycle = next;
}

export function notifyUrgentCapabilityRetired(
  sessionId: string,
  capabilityDigest: string,
): void {
  lifecycle?.revokeCapability(sessionId, capabilityDigest);
}

export function notifyUrgentSessionRetired(sessionId: string): void {
  lifecycle?.revokeSession(sessionId);
}
