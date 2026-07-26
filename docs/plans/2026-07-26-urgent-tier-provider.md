# Urgent-tier Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the reviewed `botmux.urgent-tier-provider/v1` daemon/CLI provider without exposing credentials or weakening session identity.

**Architecture:** The CLI is a credential-free daemon IPC client. The daemon authenticates the managed-origin session, owns exact task metadata and history-proof ledgers, and performs conditional Lark/schedule operations with the session's registered bot client.

**Tech Stack:** TypeScript, Node.js 22, Vitest, botmux daemon IPC, Feishu Node SDK.

## Global Constraints

- Do not implement until the botmux-repository design review passes.
- Do not expose credentials, bot config, `bots.json`, or `send-cred.json`.
- Require managed-origin session authentication and runtime `pm-project`.
- Use exact schemas and reject unknown/duplicate/omitted/mistyped fields.
- Keep App/SMS/Phone native mappings exact.
- Do not claim atomic no-urgent-after-reply semantics.
- Do not deploy to the live daemon until implementation review passes.
- Do not tag or publish an npm release without separate user approval.
- Implement only in this dedicated feature worktree/branch after design
  review-pass.

---

### Task 1: Canonical Provider Contracts

**Files:**
- Create: `src/services/urgent-tier-provider-contract.ts`
- Create: `test/urgent-tier-provider-contract.test.ts`

**Interfaces:**
- Produces: `canonicalTaskMetadata(value)`, `taskMetadataDigest(value)`, `callbackClaimsDigest(value)`, exact TypeScript types and validators.

- [ ] **Step 1: Write failing fixed-vector tests**

Cover all 19 metadata fields, exact allowlists, duplicate-key JSON rejection,
canonical UTF-8 JSON, and both digest domains. Add one mutation case per field.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm vitest run --project unit test/urgent-tier-provider-contract.test.ts`

Expected: FAIL because the contract module does not exist.

- [ ] **Step 3: Implement the minimal codec**

Use big-endian U32 framing and SHA-256. Parse raw JSON with duplicate-key
detection before schema validation. Reject arrays, floats, nulls, nested
metadata, unknown keys, invalid IDs, and invalid tier values.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `pnpm vitest run --project unit test/urgent-tier-provider-contract.test.ts`

Expected: all fixed vectors and mutation cases PASS.

- [ ] **Step 5: Commit**

Commit message: `feat(urgent-provider): 定义任务元数据与摘要契约`

---

### Task 2: Ordinary Session Scope and Authorization

**Files:**
- Modify: `src/im/lark/client.ts`
- Create: `src/services/urgent-tier-session-auth.ts`
- Create: `src/services/urgent-tier-authorization-store.ts`
- Test: `test/urgent-tier-session-auth.test.ts`
- Test: `test/urgent-tier-authorization-store.test.ts`

**Interfaces:**
- Produces: `authenticateUrgentSession(input, deps)` and
  `authenticateUrgentNodeRead(input, deps)`.
- Produces: `issueUrgentAuthorization`, `consumeUrgentAuthorization`,
  `revokeUrgentAuthorization`, and session/capability invalidation hooks.

- [ ] **Step 1: Write failing ordinary-session tests**

Cover PTY and tmux sessions plus one non-default CLI/backend combination.
Cover receiver/adopt/unmanaged/stale/wrong-role sessions, route overrides,
node-wide HMAC without session capability, bot membership, target membership,
tenant-key absence, operation/capability mismatch, proof expiry, and generic
failure/oracle resistance.

Add authority tests for caller field modification plus recomputed digest,
unknown ID, cross-route/target/project use, expiry, second use, explicit
revocation, capability rotation, session close, daemon restart, node/group
substitution, ledger capacity without unexpired eviction, unsafe host-secret
owner/mode/symlink, data-directory ownership, and probe-only no-issuance.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
pnpm vitest run --project unit \
  test/urgent-tier-session-auth.test.ts \
  test/urgent-tier-authorization-store.test.ts
```

Expected: FAIL because ordinary session auth and its opaque ledger do not
exist.

- [ ] **Step 3: Implement exact scope proofs**

Use daemon live-session state, managed-origin capability, runtime role,
registered-client membership probes, and `/bot/v3/info` tenant key. Return
exact informational `session-proof/v1` plus a CSPRNG opaque ID. Implement the
bounded in-memory single-use ledger, 30-second TTL, daemon-boot and capability
generation binding, invalidation hooks, atomic consume, separate host-only
node-read proof using verified daemon UID/data-dir/0600 host-secret ownership,
and probe-only mode. Never allow proof substitution. Do not use Lark
`allowedUsers` as node authority.

- [ ] **Step 4: Run focused tests and verify GREEN**

Expected: PASS without message/urgent mutation.

- [ ] **Step 5: Commit**

Commit message: `feat(urgent-provider): 认证普通会话与节点只读权限`

---

### Task 3: Session-authenticated Callback Claims

**Files:**
- Create: `src/services/urgent-tier-provider-auth.ts`
- Modify: `src/core/daemon-ipc-session-auth.ts`
- Test: `test/urgent-tier-provider-auth.test.ts`

**Interfaces:**
- Consumes: canonical metadata and digest functions from Task 1.
- Produces: `authenticateUrgentCallback(input, deps)` returning complete claims or generic `CALLBACK_ORIGIN_UNPROVEN`.

- [ ] **Step 1: Write failing oracle-resistance tests**

Prove stale/foreign capabilities, receiver sessions, wrong runtime role,
task-envelope mismatch, and malformed metadata all return the same public
failure. Prove no test can distinguish missing local NDBFlow run state.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm vitest run --project unit test/urgent-tier-provider-auth.test.ts`

Expected: FAIL because callback authentication is absent.

- [ ] **Step 3: Implement provider-only authentication**

Resolve the live session, validate managed-origin capability, require
`pm-project`, load provider-owned task metadata, recompute both digests, and
return exact claims. Never accept caller project/run fields as proof.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `pnpm vitest run --project unit test/urgent-tier-provider-auth.test.ts`

Expected: PASS with one generic public failure class.

- [ ] **Step 5: Commit**

Commit message: `feat(urgent-provider): 绑定回调会话与完整任务声明`

---

### Task 4: Owner-only History-proof Ledger

**Files:**
- Create: `src/services/urgent-tier-history-proof-store.ts`
- Create: `src/services/urgent-tier-history.ts`
- Test: `test/urgent-tier-history-proof.test.ts`

**Interfaces:**
- Produces: `scanUrgentHistory`, `createHistoryProof`, `readHistoryProof`, `consumeHistoryProof`.

- [ ] **Step 1: Write failing proof tests**

Cover deterministic cursor order, pagination completion, authoritative
`sender_type`, anchor withdrawal, unknown sender type, repeated page tokens,
proof expiry, proof rebinding, symlink/mode rejection, and ledger bounds.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm vitest run --project unit test/urgent-tier-history-proof.test.ts`

Expected: FAIL because the proof store and scanner are absent.

- [ ] **Step 3: Implement the proof store and scanner**

Store proofs in daemon-owned `0700/0600` state using atomic write/read-back.
Bind proof ID to session/app/chat/topic/anchor/digest/expiry. Return uncertainty
for incomplete visibility.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `pnpm vitest run --project unit test/urgent-tier-history-proof.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

Commit message: `feat(urgent-provider): 持久化历史可见性证明`

---

### Task 5: Conditional Anchor and Native Urgent Writes

**Files:**
- Create: `src/services/urgent-tier-delivery.ts`
- Modify: `src/im/lark/client.ts`
- Test: `test/urgent-tier-delivery.test.ts`

**Interfaces:**
- Consumes: authenticated session and daemon-held proof.
- Produces: `sendConditionalAnchor`, `sendConditionalUrgent`, provider mutation receipts.

- [ ] **Step 1: Write failing race tests**

Cover unchanged head, advanced head, uncertain final recheck, message UUID
replay, App/SMS/Phone exact endpoint mapping, invalid target, post-write reply,
and receipt mutation intervals.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm vitest run --project unit test/urgent-tier-delivery.test.ts`

Expected: FAIL because conditional delivery is absent.

- [ ] **Step 3: Implement conditional writes**

Reload proof from the daemon ledger, perform a final complete recheck, deny on
head change/uncertainty, execute the exact Lark operation, and return bounded
receipts. Do not expose credentials or raw upstream errors.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `pnpm vitest run --project unit test/urgent-tier-delivery.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

Commit message: `feat(urgent-provider): 加入条件锚点与原生加急`

---

### Task 6: Managed Schedule Envelope and Deferred Identity

**Files:**
- Modify: `src/services/schedule-store.ts`
- Modify: `src/core/scheduler.ts`
- Modify: `src/core/types.ts`
- Test: `test/urgent-tier-provider-schedule.test.ts`

**Interfaces:**
- Produces: exact managed ensure/observe/remove operations and deferred-run claims while preserving the ordinary canonical hash.

- [ ] **Step 1: Write failing metadata round-trip tests**

Freeze pre-change ordinary canonical-hash vectors, then cover exact 19-field
storage, `utp_` namespace, managed-domain digest, idempotent ensure, metadata
conflict, exact remove, creator/callback session distinction, reload/migration,
quarantine byte preservation across ordinary mutations, and deferred envelope
binding.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm vitest run --project unit test/urgent-tier-provider-schedule.test.ts`

Expected: FAIL because urgent task metadata is not stored.

- [ ] **Step 3: Implement exact managed schedules**

Add optional `botmux.schedule-managed/v1`. Keep ordinary
`canonicalScheduleInput()` untouched. Use the separate managed canonical domain
and reject cross-namespace rows. Quarantine malformed managed rows as
non-executable while preserving their raw bytes through ordinary mutations and
legacy normalization. Preserve full valid metadata into deferred run identity
and require exact observation/removal.

- [ ] **Step 4: Run focused and existing scheduler tests**

Run:

```bash
pnpm vitest run --project unit \
  test/urgent-tier-provider-schedule.test.ts \
  test/scheduler.test.ts \
  test/schedule-store.test.ts \
  test/schedule-store-idempotency.test.ts \
  test/deferred-schedule-settlement.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

Commit message: `feat(urgent-provider): 冻结调度任务与延迟回调身份`

---

### Task 7: Daemon IPC and CLI Wiring

**Files:**
- Create: `src/cli/urgent-provider.ts`
- Modify: `src/cli.ts`
- Modify: `src/core/dashboard-ipc-server.ts`
- Test: `test/urgent-tier-provider-ipc.test.ts`

**Interfaces:**
- Produces: all twelve `botmux urgent-provider` commands and authenticated daemon routes.

- [ ] **Step 1: Write failing route and schema tests**

Cover capabilities, ordinary session authentication, node-read authentication,
authorization consume/revoke,
callback authentication, history scan, conditional writes, schedule
operations, unknown fields, oversize bodies, malformed JSON, and credential
redaction.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm vitest run --project unit test/urgent-tier-provider-ipc.test.ts`

Expected: FAIL because routes/CLI do not exist.

- [ ] **Step 3: Implement thin CLI and route handlers**

Keep credential resolution and Lark calls in the daemon. Bind route identity
from the authenticated session. Return one JSON envelope per command.

- [ ] **Step 4: Run focused auth/IPC tests**

Run:

```bash
pnpm vitest run --project unit \
  test/urgent-tier-provider-ipc.test.ts \
  test/urgent-tier-session-auth.test.ts \
  test/daemon-ipc-session-auth.test.ts \
  test/v3-daemon-ipc-auth.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

Commit message: `feat(urgent-provider): 接入受认证守护进程命令面`

---

### Task 8: Full Verification, PR Review, and Reviewed Local Publication

**Files:**
- Modify: `docs/design/2026-07-26-urgent-tier-provider-interface.md`
- Create: `docs/runbook-urgent-tier-provider.md`

**Interfaces:**
- Produces: review evidence, local publication runbook, non-mutating capability probe.

- [ ] **Step 1: Run targeted suites**

Run every new focused test plus scheduler/auth/Lark regression suites.

- [ ] **Step 2: Run broad verification**

Run:

```bash
pnpm test
pnpm build
```

Expected: PASS with zero failures.

- [ ] **Step 3: Record cross-cutting impact**

Document Linux/macOS, CLI/backend/session-type impact and confirm ordinary
messages/schedules remain unchanged.

- [ ] **Step 4: Request independent implementation review**

Freeze commit and test output. Do not deploy before review-pass.

- [ ] **Step 5: Push the feature branch and create a botmux PR**

Use a Chinese PR description with change, reason, cross-platform/CLI/backend/
session impact, and exact test evidence. Do not tag, publish npm, merge, or
deploy.

- [ ] **Step 6: Wait for PR/review acceptance of the exact commit**

Record the reviewed commit and rollback checkout. Do not live-deploy a moving
branch.

- [ ] **Step 7: Publish reviewed commit locally**

After explicit review-pass:

```bash
pnpm switch:here
pnpm daemon:restart
```

Verify the global shim and daemon resolve the reviewed commit. Preserve the
rollback command:

```bash
cd /data00/home/shijinpeng.6/code/botmux
pnpm switch:here
pnpm daemon:restart
```

- [ ] **Step 8: Run non-mutating capability and readiness probes**

Run `botmux urgent-provider capabilities`, ordinary `session-authenticate`,
bot membership, and target membership readiness from the verified
`pm-project` session with `probe_only=true`. Confirm no `proof_id` or reusable
authorization is returned. Do not send anchors or urgent actions.

- [ ] **Step 9: Commit documentation**

Commit message: `docs(urgent-provider): 记录验证与本地发布流程`
