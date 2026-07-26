# Urgent-tier Provider Interface

## Status

Design-only prerequisite for NDBFlow urgent-tier. Implementation is not
released until this document receives an independent botmux-repository review.

Frozen upstream inputs:

- NDBFlow design commit:
  `3b7b438ca08b33c18ee63925cdd7d954240a9d01`;
- accepted NDBFlow design SHA-256:
  `fcb8d2984b10d7288861b8fd29ffb2c0d0d3952eb7b6798972f1cf59dd2b84ac`;
- prerequisite source SHA-256:
  `c8473b52f11352f4bfa9502723544e55db2b168b28ea9210b7853683ac51e4f5`;
- NDBFlow dev-lead review:
  `REVIEW-PASS / DESIGN_ACCEPTED / BOTMUX_PREREQUISITE_REVIEW_RELEASED`;
- review packet:
  `/data00/home/shijinpeng.6/NDBFlow/gap-analysis/urgent-tier-production-adapter-design-review-v4.md`;
- review packet SHA-256:
  `a4a2ad1aeea384e29e8ce44ea1516c1641ac7135b14edd026c014de9865d4050`.

## Goal

Expose a credential-free, session-authenticated local provider contract that
lets NDBFlow:

- send canonical decision anchors as the runtime `pm-project` bot;
- invoke native Feishu App/SMS/Phone urgent APIs;
- scan complete topic history with authoritative sender types;
- create, observe, and remove exact schedule tasks;
- authenticate deferred callbacks without exposing bot credentials.

The public contract is:

```text
botmux.urgent-tier-provider/v1
```

## Trust Boundary

Botmux remains the sole owner of:

- application credential resolution;
- registered Lark client construction;
- live session and runtime-role resolution;
- Lark message and urgent API calls;
- schedule-store mutation;
- deferred-run session creation;
- provider-owned history proofs and task metadata.

NDBFlow must not read `bots.json`, internal `send-cred.json` files, app secrets,
tokens, or private botmux modules.

## CLI and Daemon Surface

The CLI reads one JSON object from stdin and writes one JSON object to stdout:

```text
botmux urgent-provider capabilities
botmux urgent-provider callback-authenticate
botmux urgent-provider history-scan
botmux urgent-provider send-anchor
botmux urgent-provider send-urgent
botmux urgent-provider schedule-ensure
botmux urgent-provider schedule-observe
botmux urgent-provider schedule-remove
```

The CLI is a thin client for authenticated local daemon IPC. It never loads
bot credentials itself.

## Session Authentication

Urgent mutations require both:

1. the existing host IPC transport authentication; and
2. a valid managed-origin capability for the exact live session.

The daemon:

1. resolves the live session from the exact session ID;
2. validates the rotating session capability;
3. rejects receiver or unmanaged sessions;
4. overwrites caller route fields with daemon-owned app/chat/topic identity;
5. resolves the runtime role and requires `pm-project`;
6. selects only that session's registered Lark client.

Node-wide host authentication without a valid session capability cannot perform
an urgent mutation.

## Capabilities

`capabilities` is non-mutating and returns:

```json
{
  "ok": true,
  "contract": "botmux.urgent-tier-provider/v1",
  "botmux_version": "semver",
  "interface_revision": 1,
  "identity_binding": "managed-origin-session",
  "anchor_idempotency": "lark-message-uuid",
  "urgent_operations": ["app", "sms", "phone"],
  "history_cursor": "lark-create-time-message-id/v1",
  "history_proof": "botmux.urgent-tier.history-proof/v1",
  "task_metadata": "botmux.urgent-tier.task-metadata/v1",
  "schedule_metadata_roundtrip": true,
  "schedule_callback_envelope": "botmux.deferred-run/v1",
  "provider_timeout_ms": {
    "recommended": 5000,
    "min": 100,
    "max": 10000,
    "provenance": "botmux.urgent-tier-provider/v1"
  }
}
```

Missing or changed required fields fail closed before mutation.

## Canonical Task Metadata

Every managed schedule stores this exact 19-field object:

```json
{
  "schema": "botmux.urgent-tier.task-metadata/v1",
  "manager_domain": "ndbflow.urgent-tier.schedule/v1",
  "provider_contract": "botmux.urgent-tier-provider/v1",
  "provider_interface_revision": 1,
  "callback_contract": "ndbflow.urgent-tier.callback/v2",
  "callback_contract_revision": 2,
  "provider_task_id": "provider task ID",
  "creator_session_id": "session that created the task",
  "creator_app_id": "verified creator app ID",
  "chat_id": "daemon-owned chat ID",
  "root_message_id": "",
  "project_id": "project directory identity",
  "run_id": "run UUID",
  "family_id": "schedule family digest",
  "generation": 0,
  "tier": "app",
  "deadline_utc_ms": 1234567890,
  "action_id": "action digest",
  "spec_digest": "schedule spec digest"
}
```

The root, claims, and metadata objects use exact allowlists. Unknown, omitted,
duplicated, mistyped, or out-of-range fields are invalid.

Canonical JSON uses UTF-8, Unicode code-point key ordering, no insignificant
whitespace, decimal integers, and no floats, nulls, arrays, or nested metadata
values.

The metadata digest is:

```text
digest("botmux.urgent-tier.task-metadata/v1",
       [canonical_task_metadata_json])
```

`digest` is:

```text
SHA256(frame(domain UTF-8)
       || frame(U32(1))
       || frame(each field))
```

`frame` is a big-endian U32 length followed by bytes.

## Callback Authentication

`callback-authenticate` performs provider-only Phase A before NDBFlow state is
read. It validates:

- managed-origin capability and live callback session;
- task/execution identity from the deferred envelope;
- daemon-owned app/chat/topic identity;
- runtime `pm-project` role;
- complete provider-owned task metadata.

It returns:

```json
{
  "ok": true,
  "contract": "botmux.urgent-tier-provider/v1",
  "claims": {
    "execution_id": "daemon deferred execution ID",
    "callback_session_id": "live callback session ID",
    "app_id": "daemon-owned callback app ID",
    "chat_id": "daemon-owned callback chat ID",
    "root_message_id": "",
    "runtime_role": "pm-project",
    "provider_interface_revision": 1,
    "task_metadata": {
      "schema": "botmux.urgent-tier.task-metadata/v1",
      "manager_domain": "ndbflow.urgent-tier.schedule/v1",
      "provider_contract": "botmux.urgent-tier-provider/v1",
      "provider_interface_revision": 1,
      "callback_contract": "ndbflow.urgent-tier.callback/v2",
      "callback_contract_revision": 2,
      "provider_task_id": "provider task ID",
      "creator_session_id": "session that created the task",
      "creator_app_id": "verified creator app ID",
      "chat_id": "daemon-owned chat ID",
      "root_message_id": "",
      "project_id": "project directory identity",
      "run_id": "run UUID",
      "family_id": "schedule family digest",
      "generation": 0,
      "tier": "app",
      "deadline_utc_ms": 1234567890,
      "action_id": "action digest",
      "spec_digest": "schedule spec digest"
    },
    "task_metadata_digest": "64 lowercase hexadecimal characters"
  },
  "claims_digest": "64 lowercase hexadecimal characters"
}
```

The claims digest is:

```text
digest("botmux.urgent-tier.callback-claims/v1", [
  execution_id UTF-8,
  callback_session_id UTF-8,
  app_id UTF-8,
  chat_id UTF-8,
  root_message_id UTF-8,
  runtime_role UTF-8,
  U32(provider_interface_revision),
  raw 32-byte task_metadata_digest
])
```

Botmux recomputes both digests before returning. Caller-supplied project/run
values do not enter Phase A. Any failure returns the same
`CALLBACK_ORIGIN_UNPROVEN` class and exposes no task metadata.

## History Proof

The stable cursor is:

```text
(create_time_ms, message_id)
```

`history-scan` paginates the exact chat/topic in deterministic order until the
provider reports a complete current head. Each message includes authoritative
sender type and identity.

The response includes:

- expected anchor cursor and `anchor_found`;
- ordered messages after the anchor;
- observed head cursor;
- provider scan start/completion times;
- request identity;
- canonical proof digest;
- opaque proof ID.

The complete proof is stored in a bounded, expiring, owner-only daemon ledger.
Conditional writes accept only the opaque proof ID plus expected digest. The
daemon reloads and validates the proof; caller-provided messages, cursors, or
timestamps never substitute for the ledger.

## Conditional Writes and External Race

Before every non-initial anchor or native urgent call, botmux performs a final
complete history recheck. It writes only when:

- the expected anchor remains present;
- no human message follows it;
- current head equals the accepted head;
- ordering and visibility remain complete.

An advanced or uncertain head denies the write.

This is not atomic with Lark's subsequent write API. The provider receipt
records the accepted proof, final recheck, mutation request, mutation interval,
and result identity.

After every successful write, NDBFlow performs another complete scan. The
provider supports these outcomes:

- no human and complete visibility;
- human observed, with reply cursor and bounded race classification;
- uncertain visibility.

Uncertain visibility cannot be represented as success.

One tier uses two non-reusable proofs:

1. prior-anchor proof protects the fresh-anchor write;
2. fresh-anchor proof protects the urgent write.

## Native Urgent Operations

`send-urgent` maps exactly:

- `app` → `urgent_app`;
- `sms` → `urgent_sms`;
- `phone` → `urgent_phone`.

The daemon proves the selected bot sent the anchor and the single target is in
the conversation. A non-empty invalid-target list is failure.

## Schedule Operations

`schedule-ensure` creates one exact task under the authenticated `pm-project`
session. The stored task metadata is the canonical object above.

The deferred-run envelope binds:

- provider task and execution ID;
- callback session;
- app/chat/topic;
- family and spec digest;
- creation time.

`schedule-observe` returns complete canonical metadata. `schedule-remove`
requires exact task ID and metadata equality. Missing, duplicated, partially
visible, or mismatched tasks are uncertainty; broad deletion is forbidden.

## Tests

The independent implementation must prove:

- one session can use only its bound app;
- node-wide auth without managed-origin session auth is denied;
- caller route and metadata fields cannot override daemon identity;
- callback failure is generic regardless of NDBFlow run existence;
- exact metadata schema and both digest domains match fixed vectors;
- unknown/omitted/duplicate/type/range/digest mutations fail;
- history proof forgery, rebinding, and expiry fail;
- unchanged head allows a conditional write;
- advanced or uncertain head denies a write;
- immediate post-write human reply is observable;
- schedule metadata round-trips exactly;
- callback envelope and task metadata remain equal;
- responses and logs contain no credentials.

## Release Gate

After independent review, implementation, tests, and review, publish the exact
reviewed botmux commit to the local live daemon. Then run only the non-mutating
capability probe.

NDBFlow implementation remains blocked until that probe returns the exact
`botmux.urgent-tier-provider/v1` contract.
