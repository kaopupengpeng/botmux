import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  notifyUrgentCapabilityRetired,
  notifyUrgentSessionRetired,
  registerUrgentAuthorizationLifecycle,
} from '../src/services/urgent-tier-lifecycle.js';

describe('urgent authorization lifecycle', () => {
  beforeEach(() => {
    registerUrgentAuthorizationLifecycle(undefined);
  });

  it('forwards capability rotation and session retirement to the provider ledger', () => {
    const revokeCapability = vi.fn();
    const revokeSession = vi.fn();
    registerUrgentAuthorizationLifecycle({ revokeCapability, revokeSession });

    notifyUrgentCapabilityRetired('session-1', 'a'.repeat(64));
    notifyUrgentSessionRetired('session-1');

    expect(revokeCapability).toHaveBeenCalledWith('session-1', 'a'.repeat(64));
    expect(revokeSession).toHaveBeenCalledWith('session-1');
  });

  it('is inert before provider registration', () => {
    expect(() => notifyUrgentSessionRetired('session-1')).not.toThrow();
    expect(() => notifyUrgentCapabilityRetired('session-1', 'a'.repeat(64))).not.toThrow();
  });
});
