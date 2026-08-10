# Facebook Content Factory V2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make SEOSONA Content generate a configurable-size Facebook Group batch automatically, negotiate the official Flow MCP contract, resume safely, and persist complete portable packages in Content Library.

**Architecture:** SEOSONA OS owns versioned policy/evidence/brand context. Content owns idea/copy/QA/state, its background worker drives an event-based batch, the local Companion authenticates loopback requests and adapts Content to Flow MCP, and Flow remains a read-only visual worker. Durable files use logical or relative references; machine paths and secrets remain runtime-only.

**Tech Stack:** Chrome Extension Manifest V3, browser-safe JavaScript, Node.js ESM, Node test runner, MCP SDK 1.30.0, local HTTP loopback, Flow MCP contract 1.1.x.

## Global Constraints

- Default batch size is 5, but `requestedCount` is validated against OS-owned minimum and maximum.
- No Facebook publishing, scheduling, OAuth, or Facebook credentials.
- Flow is called only through its official stdio MCP server with `SEOSONA_LOCAL_MCP_TOKEN`.
- No image binary data in Chrome storage.
- A failed judged image may be regenerated at most twice; an unjudged image is never ready.
- Existing dirty Content and Flow worktrees are user-owned and must not be overwritten.
- Every production behavior change follows red → green → refactor.
- Push is non-force and occurs only after fresh cross-project verification.

---

### Task 1: OS-owned configurable batch policy

**Files:**
- Modify: `../facebook-content-policy/3_MEMORY/projects/seosona-content/facebook-group-factory/content-policy.v1.json`
- Create: `../facebook-content-policy/3_MEMORY/projects/seosona-content/facebook-group-factory/content-policy.test.mjs`

**Interfaces:**
- Produces: `policy.batchSize = { default: number, min: number, max: number }`.
- Consumed by: `FacebookFactory.resolveBatchSize(policy, requestedCount)`.

- [ ] **Step 1: Write the failing policy contract test**

```js
assert.deepEqual(policy.policy.batchSize, { default: 5, min: 1, max: 20 });
assert.equal(policy.policy.cadencePerWeek, 5);
```

- [ ] **Step 2: Run the test and verify it fails because `batchSize` is absent**

Run: `node --test 3_MEMORY/projects/seosona-content/facebook-group-factory/content-policy.test.mjs`

- [ ] **Step 3: Add the minimal versioned batch policy without changing the no-publish boundary**

- [ ] **Step 4: Run the new test, the BrandKit reference tests, and OS doctor**

- [ ] **Step 5: Commit OS policy change**

---

### Task 2: Variable idea generation and deterministic state contracts

**Files:**
- Modify: `extension/lib/facebook-factory.js`
- Modify: `extension/lib/facebook-batch.js`
- Create: `extension/lib/facebook-state.js`
- Modify: `tests/facebook-batch.test.cjs`
- Modify: `tests/facebook-contracts.test.cjs`
- Create: `tests/facebook-state.test.cjs`

**Interfaces:**
- Produces: `resolveBatchSize(policy, requestedCount): number`.
- Produces: `buildIdeaPrompt({ count, snapshot }): string`.
- Produces: `parseIdeaResponse(text, expectedCount): Array<{title, angle}>`.
- Produces: `FacebookState.create(batch)` and `FacebookState.transition(batch, event)`.
- Consumes: OS `policy.batchSize` and immutable context snapshot.

- [ ] **Step 1: Write failing tests for default, minimum, maximum, invalid count, exact idea count, duplicate ideas, legal transitions, illegal transitions, and terminal-state protection**

- [ ] **Step 2: Run focused tests and confirm the expected missing-function failures**

- [ ] **Step 3: Implement minimal pure functions and a browser-safe state reducer**

`createWeeklyBatch` accepts generated ideas and creates exactly their count; it keeps `clientRef = batchId/postId/r1`.

- [ ] **Step 4: Fix `nextAssetAction` so judged/pass assets return `asset_ready`, judged/fail assets retry only for allowed actions, and unjudged assets require review**

- [ ] **Step 5: Run focused and full Content tests**

- [ ] **Step 6: Commit pure batch/state contracts**

---

### Task 3: Flow MCP negotiation, errors, and progress-aware client

**Files:**
- Modify: `scripts/companion/facebook-mcp-client.mjs`
- Modify: `scripts/companion/facebook-runner.mjs`
- Create: `tests/facebook-flow-contract.test.mjs`
- Modify: `tests/facebook-companion.test.mjs`

**Interfaces:**
- Produces: `FlowMcpError` with `code`, `message`, and `retryable`.
- Produces: `preflightFlow({ flow, ratio }): { contractVersion, capabilities, provider }`.
- Extends: `FlowMcpClient.callTool(name, args, { onprogress }?)`.
- Extends: `FlowMcpClient.listTools()` and `FlowMcpClient.readResource(uri)`.
- Consumes: Flow `health`, `list_capabilities`, `get_provider_status`, `gen_image`, `cancel_job`.

- [ ] **Step 1: Write failing tests against the real Flow 1.1 response shapes**

The readiness fixture is `{data:{providers:[{provider:'flow',ready:true,reason:'ok'}]}}`; health must report `extension_connected:true` and `contract_version:'1.1.0'`; capabilities must contain the requested ratio.

- [ ] **Step 2: Verify failures expose the current readiness-shape bug and missing handshake**

- [ ] **Step 3: Implement health/version/capability/readiness negotiation and preserve Flow error codes**

- [ ] **Step 4: Add bounded `EXTENSION_BUSY` retry, no retry for login/quota/project errors, and one capability refresh for validation errors**

- [ ] **Step 5: Verify same `client_ref` is reused for transport/busy retries; only judged visual-quality failure creates a new revision**

- [ ] **Step 6: Run Content Flow tests and Flow MCP contract suite**

- [ ] **Step 7: Commit Flow adapter change**

---

### Task 4: Portable Content Library packages

**Files:**
- Modify: `scripts/companion/facebook-library.mjs`
- Modify: `tests/facebook-library.test.mjs`
- Create: `tests/facebook-library-package.test.mjs`

**Interfaces:**
- Produces: `content-library://<batch>/<draft>/<file>` logical refs.
- Produces: `writeBatchPackage({ libraryRoot, batch, snapshot, draft }): PackageReceipt`.
- Consumes: archived Flow asset and verified DraftPackage.

- [ ] **Step 1: Write failing tests proving receipts contain no absolute path or provider session URL**

- [ ] **Step 2: Write failing package tests for `batch.json`, `context.snapshot.json`, `draft.json`, traversal rejection, and deterministic readback**

- [ ] **Step 3: Implement atomic JSON writes and logical file refs**

- [ ] **Step 4: Run library tests and inspect generated fixtures**

- [ ] **Step 5: Commit portable library support**

---

### Task 5: Companion health and package endpoints

**Files:**
- Modify: `scripts/companion/facebook-companion.mjs`
- Modify: `tests/facebook-companion-server.test.mjs`
- Modify: `tests/facebook-context-resolution.test.mjs`

**Interfaces:**
- Produces: `GET /v1/health` with Companion version, Flow contract version, extension readiness, provider readiness and context revision.
- Produces: `POST /v1/library/package` for durable batch/draft snapshots.
- Keeps: authenticated `GET /v1/context`, `POST /v1/flow/generate`, `POST /v1/flow/cancel`.

- [ ] **Step 1: Write failing authenticated endpoint tests and negative auth/replay tests**

- [ ] **Step 2: Implement cached preflight with a short TTL and stable error responses `{error:{code,message,retryable}}`**

- [ ] **Step 3: Wire package writer and ensure request bodies stay under the configured limit**

- [ ] **Step 4: Run server and full Content tests**

- [ ] **Step 5: Commit Companion API change**

---

### Task 6: Event-driven background orchestration and non-technical UI

**Files:**
- Create: `extension/lib/facebook-orchestrator.js`
- Modify: `extension/background.js`
- Modify: `extension/sidepanel/app.js`
- Modify: `extension/sidepanel/index.html`
- Modify: `extension/sidepanel/styles.css`
- Create: `tests/facebook-orchestrator.test.cjs`
- Modify: `tests/facebook-contracts.test.cjs`

**Interfaces:**
- Produces background messages: `facebook:startBatch`, `facebook:getBatch`, `facebook:resumeBatch`, `facebook:cancelBatch`.
- Emits: `facebook:batchUpdate`.
- Persists: `srtFacebookBatchLast` after every transition.
- Consumes: provider job results and Companion endpoints.

- [ ] **Step 1: Write a failing orchestrator test for start → ideas → copy → QA → visual → package → completed**

- [ ] **Step 2: Add failing cases for blocked claim, unjudged asset, cancellation, restart/resume and one draft failing without losing other drafts**

- [ ] **Step 3: Implement the dependency-injected orchestrator and import it in the service worker**

- [ ] **Step 4: Replace manual five-topic UI with requested-count control, health status and start/resume/cancel actions**

- [ ] **Step 5: Run syntax, unit and manifest/resource checks**

- [ ] **Step 6: Commit orchestration/UI change**

---

### Task 7: Cross-project audit, acceptance, merge, and push

**Files:**
- Create: `docs/audits/2026-08-10-facebook-content-factory-v2-audit.md`
- Create: `docs/audits/2026-08-10-facebook-content-factory-v2-issues.json`
- Modify: `docs/facebook-group-factory-v1.md`
- Modify: `package.json`

**Interfaces:**
- Produces: machine-readable issue registry with `id`, `severity`, `status`, `evidence`, `owner`, `gate`.
- Produces: `npm run facebook:audit` and `npm run facebook:verify`.

- [ ] **Step 1: Add failing audit assertions for OS context, Video BrandKit, Flow contract and Content package outputs**

- [ ] **Step 2: Implement the audit runner using portable environment inputs**

- [ ] **Step 3: Run Content full tests/doctor/audit, OS policy/BrandKit tests/doctor, Video BrandKit tests/doctor, Flow static/unit/MCP contract suites**

- [ ] **Step 4: Run fake end-to-end for batch sizes 1, 5 and the configured maximum**

- [ ] **Step 5: Attempt live acceptance with the existing logged-in Flow extension; record the exact external gate if unavailable**

- [ ] **Step 6: Review every diff, run secret/path scans, classify and close P0/P1 issues**

- [ ] **Step 7: Request independent code review and address valid findings**

- [ ] **Step 8: Merge isolated branches into local main while preserving user changes, verify again, fetch remote refs, integrate non-destructively, and push without force**
