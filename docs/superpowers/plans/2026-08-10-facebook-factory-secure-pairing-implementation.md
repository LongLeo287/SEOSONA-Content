# Facebook Factory Secure Pairing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Flow token creation activate the real local MCP bridge, reconnect safely after token rotation, and make Content reject unauthenticated Flow health before generation.

**Architecture:** A small browser-safe Flow pairing module owns validation and the atomic storage update. The existing Flow settings page calls that module, while the existing bridge listens for the one relevant storage key and restarts its trust lifecycle. Content keeps its separate Companion boundary and adds authenticated Flow health as a hard preflight requirement.

**Tech Stack:** Chrome Extension Manifest V3, browser-safe JavaScript, `chrome.storage.local`, WebSocket mutual HMAC authentication, Node.js ESM, Node test runner, local MCP contract 1.1.x.

## Global Constraints

- Flow MCP host is exactly `127.0.0.1`.
- Flow MCP port is an integer from 1 through 65535; default is 8765.
- Flow MCP token contains at least 16 characters and never appears in logs, receipts, errors, or committed fixtures.
- Content Companion authentication remains a separate token kept in Chrome session storage.
- `auth:none` fails Content live preflight.
- Unjudged assets remain archived as `asset_needs_review` and never become `asset_ready`.
- The owner's dirty Flow worktree is read-only; implementation occurs in the isolated branch.
- Every behavior change follows red, green, refactor.

---

### Task 1: Atomic Flow Pairing Configuration

**Files:**
- Create: `src/core/LocalMcpPairing.js`
- Create: `tests/unit/local-mcp-pairing.test.mjs`
- Modify: `pages/settings.html`
- Modify: `config/page-scripts.json`
- Modify: `scripts/settings-page.js`

**Interfaces:**
- Produces: `window.SEOSONA_LocalMcpPairing.normalize(current): {enabled,host,port,token}`.
- Produces: `window.SEOSONA_LocalMcpPairing.activate(storageArea, {list,token,current}): Promise<object>`.
- Consumes: `chrome.storage.local`, the newly generated token, the current local MCP configuration, and the updated local token list.

- [ ] **Step 1: Write the failing behavioral test**

Create a VM-backed test that loads `LocalMcpPairing.js`, supplies a real in-memory storage double, calls `activate`, and asserts one storage write contains both the token list and:

```js
{
  enabled: true,
  host: '127.0.0.1',
  port: 8765,
  token: 'test-token-at-least-16-characters'
}
```

Add negative cases for a short token, non-loopback host, and invalid port. The production mutation caught is a split or unsafe storage write.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test tests/unit/local-mcp-pairing.test.mjs`

Expected: FAIL because `src/core/LocalMcpPairing.js` does not exist.

- [ ] **Step 3: Implement the minimal pairing module**

Use an IIFE browser module with no DOM or network dependency. `activate` validates first, then performs exactly one `storageArea.set({local_mcp_tokens:list,seosonaLocalMcp:config})` call and returns the redacted config `{enabled,host,port,hasToken:true}`.

- [ ] **Step 4: Wire settings token creation**

Load the module immediately before `settings-page.js`. Change `_createLocalMcpToken` to read `local_mcp_tokens` and `seosonaLocalMcp`, append the token record, then call `SEOSONA_LocalMcpPairing.activate`. Preserve the existing one-time plaintext display; do not log the token.

- [ ] **Step 5: Verify GREEN and page resources**

Run:

```text
node --test tests/unit/local-mcp-pairing.test.mjs
npm run check:html
npm run check:static
```

- [ ] **Step 6: Commit**

Commit message: `feat(mcp): activate generated local token`.

---

### Task 2: Trust-Safe Bridge Reconnection

**Files:**
- Modify: `scripts/local-mcp-bridge.js`
- Create: `tests/unit/local-mcp-bridge-reconnect.test.mjs`

**Interfaces:**
- Produces: `LocalMcpBridge.restartFromStorage(): Promise<void>`.
- Consumes: `chrome.storage.onChanged`, `_loadCfg`, the current WebSocket, and the existing reconnect timer.

- [ ] **Step 1: Write the failing lifecycle test**

Load the real bridge in a VM with in-memory Chrome storage and a fake WebSocket. Trigger a `local` storage change for `seosonaLocalMcp` and assert the old socket closes, `_serverTrusted` becomes false, configuration reloads, and exactly one new connection starts. Trigger an unrelated key and assert there is no reconnect. The production mutation caught is leaving an authenticated stale socket alive after rotation.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test tests/unit/local-mcp-bridge-reconnect.test.mjs`

Expected: FAIL because the bridge has no storage-change lifecycle.

- [ ] **Step 3: Implement minimal restart behavior**

Bind one `chrome.storage.onChanged` listener during `init`. On the relevant local change, clear the reconnect timer, invalidate trust and nonce, close the current socket, load validated configuration, and connect only when enabled. Ignore unrelated areas and keys. Prevent the old socket's `onclose` callback from scheduling a second connection during the controlled restart.

- [ ] **Step 4: Verify GREEN and existing MCP tests**

Run:

```text
node --test tests/unit/local-mcp-bridge-reconnect.test.mjs
node --test tests/unit/mcp-flow-queue-toggle.test.mjs
npm --prefix mcp-local run test:contracts
```

- [ ] **Step 5: Commit**

Commit message: `fix(mcp): reconnect bridge after token rotation`.

---

### Task 3: Authenticated Content Preflight

**Files:**
- Modify: `scripts/companion/facebook-runner.mjs`
- Modify: `tests/facebook-flow-contract.test.mjs`
- Modify: `docs/facebook-group-factory-v1.md`

**Interfaces:**
- Extends: `preflightFlow({flow,ratio}): {contractVersion,capabilities,provider,auth}`.
- Consumes: Flow `health.data.auth`.
- Produces: stable `FLOW_AUTH_REQUIRED` error with `retryable:false` when auth is not `token`.

- [ ] **Step 1: Write the failing preflight test**

Add `auth:'token'` to successful health fixtures. Add a fixture with `auth:'none'` and assert preflight rejects with `code === 'FLOW_AUTH_REQUIRED'`, without calling generation. The production mutation caught is treating a no-auth loopback bridge as ready.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test tests/facebook-flow-contract.test.mjs`

Expected: FAIL because the current preflight accepts `auth:none`.

- [ ] **Step 3: Implement the minimal auth gate**

After contract compatibility and before capabilities/provider work, require `health.data.auth === 'token'`. Return `auth:'token'` in the preflight receipt. Do not include the token value.

- [ ] **Step 4: Update the operator guide**

Document the one-time sequence: create the Flow local token, copy it once into the runtime `SEOSONA_LOCAL_MCP_TOKEN`, start Companion, then use Content connection check. State that Flow reconnects automatically after rotation and `needs_review` is a valid fail-closed quality result.

- [ ] **Step 5: Verify GREEN and full Content suite**

Run:

```text
node --test tests/facebook-flow-contract.test.mjs
npm test
npm run seosona:doctor
```

- [ ] **Step 6: Commit**

Commit message: `fix(content): require authenticated Flow bridge`.

---

### Task 4: Acceptance, Audit, and Non-Force Integration

**Files:**
- Modify: `docs/audits/2026-08-10-facebook-content-factory-v2-audit.md`
- Modify: `docs/audits/2026-08-10-facebook-content-factory-v2-issues.json`

**Interfaces:**
- Consumes: Flow pairing tests, MCP contract receipts, Content suite, doctors, strict cross-project audit, and live Companion receipts.
- Produces: final status for `FCF-005` and preserves `FCF-027` until the owner's artifact set is intentionally integrated.

- [ ] **Step 1: Run scoped Flow verification**

Run pairing/reconnect tests, `check:static`, MCP contracts, doctor, security secret scan, and production dependency audit. Record the committed-tree baseline failures caused by missing generated artifacts separately; do not fabricate them.

- [ ] **Step 2: Run Content verification**

Run `npm test`, doctor, strict cross-project audit with portable environment roots, and secret/path scans.

- [ ] **Step 3: Run live authenticated acceptance**

Rotate to a fresh runtime-only token, confirm Flow health reports `auth:'token'`, start Companion with both local tokens, run a small Content batch, poll to terminal state, and read each package and asset receipt from Content Library. Accept `needs_review` only when the asset is archived and quality says `judged:false`.

- [ ] **Step 4: Update audit evidence**

Close `FCF-005` only if authenticated readback succeeds. Keep it open with the exact failing boundary otherwise. Keep `FCF-027` open until the owner's unmerged Flow artifact work is reconciled.

- [ ] **Step 5: Review diffs and secrets**

Run `git diff --check`, inspect every changed file, and scan for credentials, absolute machine paths, image binary, provider URLs, and generated local state.

- [ ] **Step 6: Integrate and push**

Commit each repository separately, fetch `origin/main`, integrate without force and without overwriting the owner's dirty Flow worktree, rerun the release gates from the integrated commits, then push.
