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
botmux urgent-provider session-authenticate
botmux urgent-provider node-read-authenticate
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

## Ordinary Session Authentication

`session-authenticate` is the scope/authorization operation for NDBFlow
`config`, `start`, `stop`, `status`, history, delivery, and schedule calls that
originate in an ordinary current session.

Request:

```json
{
  "operation": "config",
  "capability": "group_write",
  "project_id": "project directory identity",
  "target_open_id": "optional target user"
}
```

Allowed operations are exactly:

```text
config
start
stop
status
history
send_anchor
send_urgent
schedule_ensure
schedule_observe
schedule_remove
```

Allowed capabilities are exactly `group_read` and `group_write`.
`target_open_id` is required only when target membership must be proven.

The fixed operation/capability matrix is:

```text
config             group_write
start              group_write
stop               group_write
status             group_read
history            group_read
send_anchor        group_write
send_urgent        group_write
schedule_ensure    group_write
schedule_observe   group_read
schedule_remove    group_write
```

Any other pair is invalid before identity lookup.

The daemon ignores caller app/chat/root/session/role/connector/tenant fields and
derives them from the authenticated live session. It requires:

- host IPC authentication;
- the exact live session's managed-origin capability;
- a non-receiver, non-adopt, managed active session;
- runtime role exactly `pm-project`;
- the session's app to be a current member of the session chat;
- the target to be a current human chat member when supplied;
- the project ID to pass the strict ID grammar.

Connector is the fixed value `lark`. Tenant provenance is the exact
`tenant_key` returned by an online `/bot/v3/info` call through the selected
registered client. A missing/malformed tenant key, membership uncertainty, or
provider error fails closed. The operation never returns credentials or
tenant-access tokens.

Response:

```json
{
  "ok": true,
  "contract": "botmux.urgent-tier-provider/v1",
  "proof": {
    "schema": "botmux.urgent-tier.session-proof/v1",
    "operation": "config",
    "capability": "group_write",
    "connector": "lark",
    "tenant_id": "verified tenant_key",
    "app_id": "daemon-owned app ID",
    "chat_id": "daemon-owned chat ID",
    "root_message_id": "",
    "session_id": "live session ID",
    "runtime_role": "pm-project",
    "project_id": "project directory identity",
    "bot_membership": "verified",
    "target_open_id": "",
    "target_membership": "not_requested",
    "provider_interface_revision": 1,
    "issued_at_ms": 1234567890,
    "expires_at_ms": 1234569999
  },
  "proof_digest": "64 lowercase hexadecimal characters"
}
```

The proof uses exact root/proof allowlists and the same canonical/framed digest
rules under domain `botmux.urgent-tier.session-proof/v1`. Target membership is
`verified` when a target is supplied and `not_requested` otherwise. The proof
is short-lived and bound to operation/capability/project/session/app/chat/root.

Every mutation route either consumes a valid matching unexpired proof or
atomically reruns the same daemon-owned checks. A proof for one operation,
capability, target, project, or route cannot authorize another.

All ordinary-session failures return generic
`SESSION_AUTHORIZATION_UNPROVEN`; they do not reveal whether a session, project,
chat membership, or target exists.

`status --all` is intentionally excluded from `session-authenticate`. It uses a
separate host-only `node-read` operation:

```text
botmux urgent-provider node-read-authenticate
```

`node-read-authenticate` requires host IPC authentication plus the botmux
owner/admin policy, returns only a short-lived
`botmux.urgent-tier.node-read-proof/v1`, and grants no group mutation.
Managed-origin group proofs never authorize node-wide status.

## Capabilities

`capabilities` is non-mutating and returns:

```json
{
  "ok": true,
  "contract": "botmux.urgent-tier-provider/v1",
  "botmux_version": "semver",
  "interface_revision": 1,
  "identity_binding": "managed-origin-session",
  "ordinary_session_auth": "botmux.urgent-tier.session-proof/v1",
  "node_read_auth": "botmux.urgent-tier.node-read-proof/v1",
  "bot_membership_probe": true,
  "target_membership_probe": true,
  "tenant_provenance": "lark-bot-info-tenant-key",
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
session. Managed task IDs use:

```text
utp_<first 40 lowercase hex chars of
     digest("botmux.urgent-tier.task-id/v1",
            [creator_app_id, chat_id, root_message_id,
             project_id, family_id])>
```

The `utp_` namespace is reserved for this manager and is disjoint from ordinary
8-character random IDs and `wf_` workflow IDs. Ordinary create paths reject
caller-supplied `utp_` IDs; managed create requires one.

`ScheduledTask` receives one optional envelope:

```json
{
  "managed": {
    "schema": "botmux.schedule-managed/v1",
    "manager_domain": "ndbflow.urgent-tier.schedule/v1",
    "metadata": "complete 19-field task metadata object",
    "metadata_digest": "task metadata digest"
  }
}
```

Ordinary tasks omit `managed`. For ordinary tasks,
`canonicalScheduleInput()` and its computed hash remain byte-for-byte and
behavior-for-behavior unchanged.

Managed create-or-return-identical uses a separate domain:

```text
digest("botmux.schedule-managed-input/v1", [
  canonicalScheduleInput(task) canonical JSON,
  managed schema UTF-8,
  manager_domain UTF-8,
  raw 32-byte metadata_digest
])
```

The daemon recomputes the metadata digest from the complete metadata before
computing the managed input digest. Same ID returns existing only when ordinary
canonical input, managed schema/domain, complete canonical metadata bytes, and
both managed digests match. Any difference in manager domain, metadata, prompt,
schedule, route, or callback identity is an idempotency conflict.

Load/migration rules:

- missing `managed` means ordinary legacy/current task and follows existing
  migration unchanged;
- `utp_` ID without a valid managed envelope is invalid and quarantined
  fail-closed rather than becoming ordinary;
- managed envelope on a non-`utp_` ID is invalid;
- unknown managed schema/domain, unknown/duplicate/missing metadata fields, or
  digest mismatch is invalid;
- there is no migration from ordinary tasks into managed tasks;
- valid managed tasks survive daemon restart with their envelope unchanged.

An invalid managed row is quarantined in memory as non-executable and remains
byte-preserved in the authoritative store. It is omitted from scheduler
execution and from ordinary task APIs, while `schedule-observe` reports a
generic managed-task-invalid result for its exact ID. Ordinary task mutations
must preserve quarantined raw rows unchanged; migration normalization is
suppressed while any quarantined row exists, so a legacy normalization write
cannot silently delete or rewrite it. Repair requires exact managed-task
replacement/removal through the urgent-provider route after authenticated
review; ordinary schedule commands cannot operate on `utp_` IDs.

The stored task metadata is the canonical object above.

The deferred-run envelope binds:

- provider task and execution ID;
- callback session;
- app/chat/topic;
- family and spec digest;
- creation time.

`schedule-observe` returns complete canonical metadata. `schedule-remove`
requires exact task ID and metadata equality. Missing, duplicated, partially
visible, or mismatched tasks are uncertainty; broad deletion is forbidden.

Deferred-run materialization copies the valid managed envelope unchanged into
the deferred execution identity. It does not change ordinary task banners,
delivery positions, repeat counters, catch-up, settlement, or recovery.

## Tests

The independent implementation must prove:

- one session can use only its bound app;
- ordinary `session-authenticate` proves connector/tenant/session/scope/role and
  bot/target membership without mutation;
- receiver/adopt/unmanaged/stale/wrong-role sessions fail generically;
- group proofs cannot authorize node-read and node-read proofs cannot authorize
  group mutation;
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
- ordinary schedule canonical hashes remain fixed against pre-change vectors;
- ordinary cron/relative/one-shot, route positions, and finite/infinite repeats
  retain behavior;
- `utp_` namespace cannot collide with ordinary or workflow IDs;
- managed metadata/domain/prompt/schedule/route changes conflict;
- malformed managed envelopes fail closed and valid envelopes survive reload;
- malformed managed rows are quarantined, byte-preserved, non-executable, and
  cannot be erased by ordinary mutation or legacy normalization;
- callback envelope and task metadata remain equal;
- responses and logs contain no credentials.

## Release Gate

After independent review, implementation, tests, and review, publish the exact
reviewed botmux commit to the local live daemon. Then run only the non-mutating
capability probe plus `session-authenticate` readiness for connector/tenant,
runtime role, bot membership, and target membership. The probe must not send a
message or urgent action.

NDBFlow implementation remains blocked until that probe returns the exact
`botmux.urgent-tier-provider/v1` contract.
