import {
  callbackClaimsDigest,
  taskMetadataDigest,
  validateTaskMetadata,
  type UrgentTaskMetadata,
} from './urgent-tier-provider-contract.js';

interface CallbackSession {
  sessionId: string;
  appId: string;
  chatId: string;
  rootMessageId: string;
  role: string;
  active: boolean;
  receiver: boolean;
}

export interface UrgentCallbackAuthDeps {
  verifyManagedOrigin: (sessionId: string) => boolean;
  resolveCallbackSession: (sessionId: string) => CallbackSession | undefined;
  readTaskMetadata: (providerTaskId: string) => UrgentTaskMetadata | undefined;
}

export function authenticateUrgentCallback(
  input: {
    sessionId: string;
    executionId: string;
    providerTaskId: string;
    familyId: string;
    specDigest: string;
  },
  deps: UrgentCallbackAuthDeps,
): {
  ok: true;
  contract: 'botmux.urgent-tier-provider/v1';
  claims: {
    execution_id: string;
    callback_session_id: string;
    app_id: string;
    chat_id: string;
    root_message_id: string;
    runtime_role: 'pm-project';
    provider_interface_revision: 1;
    task_metadata: UrgentTaskMetadata;
    task_metadata_digest: string;
  };
  claims_digest: string;
} {
  try {
    const session = deps.resolveCallbackSession(input.sessionId);
    if (!session || !session.active || session.receiver || session.role !== 'pm-project'
      || !deps.verifyManagedOrigin(input.sessionId)) {
      throw new Error();
    }
    const metadata = validateTaskMetadata(deps.readTaskMetadata(input.providerTaskId));
    if (metadata.provider_task_id !== input.providerTaskId
      || metadata.family_id !== input.familyId
      || metadata.spec_digest !== input.specDigest
      || metadata.creator_app_id !== session.appId
      || metadata.chat_id !== session.chatId
      || metadata.root_message_id !== session.rootMessageId) {
      throw new Error();
    }
    const metadataDigest = taskMetadataDigest(metadata);
    const claimInput = {
      execution_id: input.executionId,
      callback_session_id: session.sessionId,
      app_id: session.appId,
      chat_id: session.chatId,
      root_message_id: session.rootMessageId,
      runtime_role: 'pm-project' as const,
      provider_interface_revision: 1 as const,
      task_metadata_digest: metadataDigest,
    };
    return {
      ok: true,
      contract: 'botmux.urgent-tier-provider/v1',
      claims: {
        ...claimInput,
        task_metadata: metadata,
      },
      claims_digest: callbackClaimsDigest(claimInput),
    };
  } catch {
    throw new Error('CALLBACK_ORIGIN_UNPROVEN');
  }
}
