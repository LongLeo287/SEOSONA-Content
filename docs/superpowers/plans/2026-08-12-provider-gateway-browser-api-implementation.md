# Provider Gateway, Browser Automation, and API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make browser automation and one official API adapter interchangeable workers behind a provider-neutral Gateway with manual locks, quality-first free routing, typed health, receipts, retry, and paid-API blocking.

**Architecture:** The Local Runtime owns provider configuration, routing, attempts, and receipts. The Browser Automation Adapter is a bridge from Runtime to the existing MV3 background/content-script engine; existing selectors, prompt insertion, stable-response detection, retry, and model switching stay inside the extension adapter. An API adapter implements the same `ProviderTask -> ProviderResult` contract and proves that Writing Core is vendor-neutral.

**Tech Stack:** Node.js ESM Runtime, browser-safe JavaScript in Chrome MV3, existing `node:test`, native `fetch`, OS/runtime environment secret indirection for the first API adapter. No provider SDK dependency is required for V1 unless the chosen API cannot be implemented cleanly over HTTP.

## Global Constraints

- Writing Core must never import browser DOM selectors or provider-vendor modules.
- Manual provider lock always overrides Auto Router.
- Auto Router order is lexicographic: quality -> zero incremental cost -> stability -> speed.
- Existing logged-in browser AI sessions/subscriptions count as `ZERO_INCREMENTAL` for SEOSONA routing.
- API cost classes are `FREE_QUOTA`, `PAID_ALLOWED`, `PAID_BLOCKED`, or `UNKNOWN_COST` unless the provider is explicitly zero-incremental.
- `UNKNOWN_COST` is never treated as free.
- Paid API execution is blocked by default and must never occur silently after browser failure.
- Provider failure/fallback must preserve the same job/context snapshot and evidence requirements.
- Browser adapter owns DOM selectors, tab focus, model UI, streaming completion and UI-drift errors.
- Provider receipts must never contain API keys, browser cookies, bearer tokens, or full sensitive prompts.
- Browser provider support must remain usable while migration proceeds.
- Every behavior change follows red -> green -> refactor and ends in a focused commit.

---

## File map

**Create**
- `runtime/providers/contracts.mjs` — provider task/result/status/cost schemas.
- `runtime/providers/registry.mjs` — configured providers + observed health/quality state.
- `runtime/providers/router.mjs` — manual-lock and Auto Router selection.
- `runtime/providers/gateway.mjs` — attempt/fallback orchestration and receipt creation.
- `runtime/providers/browser-bridge-adapter.mjs` — Runtime adapter using extension bridge.
- `runtime/providers/api-http-adapter.mjs` — first generic OpenAI-compatible-style HTTP adapter contract implementation; exact vendor endpoint configured at runtime.
- `runtime/providers/quality-signals.mjs` — rolling provider+job signals.
- `runtime/http/extension-bridge.mjs` — pending browser-provider job queue/result exchange endpoints.
- `extension/lib/provider-registry.js` — browser provider catalog independent of SRT naming.
- `extension/lib/browser-provider-adapter.js` — browser-side adapter around existing tab/content-script execution.
- `tests/provider-contracts.test.mjs`
- `tests/provider-router.test.mjs`
- `tests/provider-gateway.test.mjs`
- `tests/provider-browser-bridge.test.mjs`
- `tests/provider-api-adapter.test.mjs`
- `tests/browser-provider-adapter.test.cjs`

**Modify**
- `runtime/http/server.mjs` — mount provider/bridge endpoints.
- `runtime/domain/job-state.mjs` — consume typed provider-attempt events if not already generic enough.
- `extension/background.js` — route generic `provider:*` messages while preserving legacy `srt:*` aliases during migration.
- `extension/content/common.js` — accept generic provider job messages while preserving legacy aliases.
- `extension/lib/models.js` — expose model capability metadata through the generic browser adapter, not Writing Core.
- `extension/manifest.json` — no new broad host permissions; retain explicit provider hosts + localhost.
- `package.json` — add provider-focused verify script.

---

### Task 1: Define provider-neutral contracts

**Files:**
- Create: `runtime/providers/contracts.mjs`
- Create: `tests/provider-contracts.test.mjs`

**Interfaces:**
- `assertProviderTask(value): ProviderTask`
- `assertProviderResult(value): ProviderResult`
- `COST_CLASSES = new Set(['ZERO_INCREMENTAL','FREE_QUOTA','PAID_ALLOWED','PAID_BLOCKED','UNKNOWN_COST'])`
- `BROWSER_STATES = new Set(['READY','AUTH_REQUIRED','BUSY','RATE_LIMITED','UI_CHANGED','CONTENT_BLOCKED','TIMEOUT','COMPLETED','UNAVAILABLE'])`
- `TASK_TYPES = new Set(['WRITE','EDIT','AUDIT','RESEARCH','EXTRACT','STRUCTURE','REPURPOSE'])`

ProviderTask shape:

```js
{
  taskId,
  taskType,
  contentJob,
  requiredCapabilities: [],
  contextSnapshotId,
  contextBundle,
  outputContract,
  privacyPolicy,
  costPolicy,
  timeoutMs,
  providerPreference
}
```

ProviderResult shape:

```js
{
  status: 'COMPLETED' | 'FAILED' | 'BLOCKED',
  output,
  providerId,
  modelSession,
  startedAt,
  completedAt,
  costClass,
  parseStatus,
  warnings: [],
  error: null | { code, message, retryable },
  receipt
}
```

- [x] **Step 1: Write failing schema tests**

Test missing task ID, invalid task type, invalid cost class, provider-specific DOM field rejection at Core contract boundary, and successful structured task/result validation.

- [x] **Step 2: Run focused test and verify failure**

Run: `node --test tests/provider-contracts.test.mjs`

- [x] **Step 3: Implement strict contract validators**

Reject fields named `selector`, `tabId`, `chrome`, `cookie`, or `apiKey` inside the top-level provider task contract to prevent layer leakage. Provider-specific adapters can keep those internally.

- [x] **Step 4: Run and commit**

```bash
node --test tests/provider-contracts.test.mjs
git add runtime/providers/contracts.mjs tests/provider-contracts.test.mjs
git commit -m "feat(providers): define neutral provider contracts"
```

---

### Task 2: Implement provider registry and observed quality/health signals

**Files:**
- Create: `runtime/providers/registry.mjs`
- Create: `runtime/providers/quality-signals.mjs`
- Modify: `tests/provider-contracts.test.mjs`
- Create: `tests/provider-router.test.mjs`

**Interfaces:**
- `createProviderRegistry(initial = [])` with `upsert`, `get`, `list`, `updateHealth`, `recordQualitySignal`.
- Provider record fields: `providerId`, `adapterType`, `capabilities`, `costClass`, `enabled`, `authStatus`, `health`, `qualityByJob`, `latencyMs`.
- Quality signal fields: `providerId`, `contentJob`, `taskType`, `goldenEval`, `accept`, `reject`, `repair`, `schemaCompliance`, `evaluatorScore`, `at`.

- [x] **Step 1: Write failing tests for seed browser providers and rolling observations**

Seed IDs:

```text
chatgpt-web
claude-web
gemini-web
grok-web
api-v1
```

Browser providers start with `ZERO_INCREMENTAL`, but `qualityByJob` must be empty/unknown rather than invented ratings.

- [x] **Step 2: Implement registry without static quality marketing claims**

`recordQualitySignal()` updates a bounded rolling window and exposes normalized comparison data only after at least one observation. No provider gets an arbitrary hardcoded “best” score.

- [x] **Step 3: Add health state updates**

Health includes `availability`, `auth`, `timeoutRate`, `rateLimitRate`, `selectorHealth`, `parseFailureRate`, `retryRate`, `lastUpdatedAt`.

- [x] **Step 4: Run tests and commit**

```bash
node --test tests/provider-router.test.mjs
git add runtime/providers/registry.mjs runtime/providers/quality-signals.mjs tests/provider-router.test.mjs
git commit -m "feat(providers): track provider health and quality"
```

---

### Task 3: Implement manual locks and quality-first Auto Router

**Files:**
- Create: `runtime/providers/router.mjs`
- Modify: `tests/provider-router.test.mjs`

**Interfaces:**
- `routeProvider({ task, providers, policy }): { providerId, reason, considered }`
- Policy contains `manualLocks`, `paidApi`, `denyProviders`, and optional minimum-health rules.
- Manual lock precedence: run -> stage -> workflow -> project -> global.

- [x] **Step 1: Write failing routing tests for the exact policy**

Required cases:

```text
manual lock beats Auto
provider deny-list beats quality
higher observed quality beats lower quality even when slower
ZERO_INCREMENTAL beats paid only after quality eligibility is satisfied
healthy ZERO_INCREMENTAL candidate beats equally-qualified FREE_QUOTA candidate
FREE_QUOTA can be selected when no qualifying ZERO_INCREMENTAL provider exists
PAID_BLOCKED cannot be selected automatically
UNKNOWN_COST cannot be treated as free
PAID_ALLOWED is selectable only when explicit paidApi=true
speed is only the final tie-breaker
```

- [x] **Step 2: Implement candidate filtering**

Filter disabled, denied, missing required capabilities, unhealthy, auth-required, and policy-disallowed candidates before sorting.

- [x] **Step 3: Implement lexicographic comparator**

Conceptual key:

```js
[
  -qualityRank(candidate, task),
  costRank(candidate.costClass, policy),
  stabilityRank(candidate.health),
  Number(candidate.latencyMs || Infinity)
]
```

Quality eligibility must use observed/job capability signals and must not allow a known materially lower-quality provider to win solely because it is free.

- [x] **Step 4: Run and commit**

```bash
node --test tests/provider-router.test.mjs
git add runtime/providers/router.mjs tests/provider-router.test.mjs
git commit -m "feat(providers): add quality first auto router"
```

---

### Task 4: Add Runtime <-> Extension browser job bridge

**Files:**
- Create: `runtime/http/extension-bridge.mjs`
- Create: `tests/provider-browser-bridge.test.mjs`
- Modify: `runtime/http/server.mjs`

**Interfaces:**
- `POST /v1/provider/browser/jobs` — Runtime enqueues browser task metadata/payload.
- `GET /v1/provider/browser/jobs/next` — authenticated Extension claims the next task.
- `POST /v1/provider/browser/jobs/:taskId/lease` — renew active lease.
- `POST /v1/provider/browser/jobs/:taskId/result` — submit typed result.
- `POST /v1/provider/browser/jobs/:taskId/cancel` — Runtime marks task cancelled; Extension observes on next lease/result call.
- Claim is idempotent by `taskId`; one active lease owner.

- [x] **Step 1: Write failing queue/lease tests**

Cover valid extension auth, wrong origin/token, claim-once behavior, lease expiry, result idempotency, cancellation, and no browser credentials in persisted queue records.

- [x] **Step 2: Implement an in-process V1 queue behind an interface**

Create `createBrowserJobBridge({ now, leaseMs = 30000 })`. Queue state may be file-persisted via Runtime store in this task or immediately in Task 6; tests must prove restart behavior before plan completion.

- [x] **Step 3: Mount endpoints behind existing Runtime extension auth**

Do not allow Studio cookies to claim browser provider jobs; this endpoint is extension-only.

- [x] **Step 4: Run and commit**

```bash
node --test tests/provider-browser-bridge.test.mjs
git add runtime/http/extension-bridge.mjs runtime/http/server.mjs tests/provider-browser-bridge.test.mjs
git commit -m "feat(providers): bridge runtime browser jobs to extension"
```

---

### Task 5: Extract a generic BrowserAutomationAdapter from current SRT background logic

**Files:**
- Create: `extension/lib/provider-registry.js`
- Create: `extension/lib/browser-provider-adapter.js`
- Create: `tests/browser-provider-adapter.test.cjs`
- Modify: `extension/background.js`
- Modify: `extension/lib/models.js`

**Interfaces:**
- `BrowserProviderRegistry.get(providerId)` returns provider label/base URL/matches/scripts/model support.
- `BrowserProviderAdapter.create(deps)` exposes `start(task)`, `abort(taskId)`, `status(taskId)`, `normalizeResult(result)`.
- Generic provider IDs map to existing page names:
  - `chatgpt-web -> chatgpt`
  - `gemini-web -> gemini`
  - `claude-web -> claude`
  - `grok-web -> grok`
- Legacy `srt:runJob`, `srt:abortJob`, `srt:jobResult` remain aliases until migration acceptance.

- [ ] **Step 1: Write failing pure adapter tests with mocked Chrome dependencies**

Test invalid provider, preparing/running/done state, retryable error normalization, abort, lease expiry, and model match resolution.

- [ ] **Step 2: Move provider metadata out of `background.js`**

`PROVIDERS` becomes `BrowserProviderRegistry`. Do not change host permissions or content-script selectors in this step.

- [ ] **Step 3: Wrap existing `handleRunJob` behavior behind adapter dependencies**

Dependencies include `findProviderTab`, `ensureProviderTab`, `sendMessage`, `jobStore`, `broadcast`, `sleep`, `now`. Keep DOM/tab-specific behavior extension-side.

- [ ] **Step 4: Add generic messages**

```text
provider:runBrowserJob
provider:abortBrowserJob
provider:getBrowserJob
provider:listBrowserProviders
```

Legacy SRT messages call the same implementation.

- [ ] **Step 5: Run existing content-script/background contract tests and new adapter tests**

```bash
node --test tests/browser-provider-adapter.test.cjs tests/facebook-*.test.cjs
```

- [ ] **Step 6: Commit**

```bash
git add extension/lib/provider-registry.js extension/lib/browser-provider-adapter.js extension/background.js extension/lib/models.js tests/browser-provider-adapter.test.cjs
git commit -m "refactor(extension): isolate browser ai provider adapter"
```

---

### Task 6: Connect Extension polling/lease loop to Runtime bridge

**Files:**
- Modify: `extension/background.js`
- Modify: `extension/manifest.json`
- Modify: `tests/browser-provider-adapter.test.cjs`
- Modify: `tests/provider-browser-bridge.test.mjs`

**Interfaces:**
- Extension Runtime config uses loopback URL + ephemeral/session bearer token.
- Background alarm `seosona-provider-bridge-poll` checks `/v1/provider/browser/jobs/next` while Runtime integration is enabled.
- Claimed task is executed by `BrowserProviderAdapter`; lease renewed during long response; normalized result posted back.

- [ ] **Step 1: Write failing tests for poll -> claim -> execute -> result**

Test Runtime unavailable, no pending job, job success, typed provider error, cancelled job, and service-worker restart with leased job recovery.

- [ ] **Step 2: Add Runtime config separate from Facebook Companion config**

Use keys such as:

```text
seosonaRuntime = { url: 'http://127.0.0.1:43118' }
seosonaRuntimeToken in chrome.storage.session
```

Validate loopback URL exactly. Do not reuse a public/cloud URL.

- [ ] **Step 3: Implement short polling via `chrome.alarms`**

Do not use a permanently open port as a correctness requirement. If no task exists, return cheaply. Alarm cadence must respect Chrome extension constraints.

- [ ] **Step 4: Preserve no-secret persistence**

Token remains session-only; browser cookies are never read or copied by SEOSONA.

- [ ] **Step 5: Run tests and commit**

```bash
node --test tests/browser-provider-adapter.test.cjs tests/provider-browser-bridge.test.mjs
git add extension/background.js extension/manifest.json tests/browser-provider-adapter.test.cjs tests/provider-browser-bridge.test.mjs
git commit -m "feat(extension): execute runtime browser provider jobs"
```

---

### Task 7: Make content-script messages provider-generic while preserving existing DOM engine

**Files:**
- Modify: `extension/content/common.js`
- Create or modify: `tests/browser-provider-adapter.test.cjs`

**Interfaces:**
- Accept `provider:submitAndWait` and `provider:abort` in addition to legacy `srt:submitAndWait` / `srt:abort`.
- Return normalized error codes:
  - `AUTH_REQUIRED`
  - `UI_CHANGED`
  - `RATE_LIMITED`
  - `CONTENT_BLOCKED`
  - `TIMEOUT`
  - `SUBMIT_LOST`
  - `ABORTED`
  - `COMPLETED`
- Preserve `modelState`, `chatUrl`, elapsed time internally for receipt metadata.

- [ ] **Step 1: Add tests around normalization boundaries**

Do not attempt full browser DOM E2E in `node:test`; expose/test pure `normalizeBrowserResult(raw)` in `browser-provider-adapter.js` and keep DOM functions fixture-tested by existing selectors/contracts.

- [ ] **Step 2: Add generic aliases without rewriting insertion/stream detection**

The current `insertText`, `submitPrompt`, `selectModel`, stable-cycle extraction and selector override mechanisms remain intact.

- [ ] **Step 3: Run and commit**

```bash
node --test tests/browser-provider-adapter.test.cjs
git add extension/content/common.js extension/lib/browser-provider-adapter.js tests/browser-provider-adapter.test.cjs
git commit -m "refactor(extension): expose generic browser provider messages"
```

---

### Task 8: Implement one API adapter proving provider neutrality

**Files:**
- Create: `runtime/providers/api-http-adapter.mjs`
- Create: `tests/provider-api-adapter.test.mjs`

**Interfaces:**
- `createApiHttpAdapter({ providerId, endpoint, model, credentialProvider, fetchImpl, costResolver })`.
- `.execute(task): Promise<ProviderResult>`.
- `credentialProvider(): Promise<string>` retrieves secret material at execution time.
- `costResolver(responseMeta, task): CostClass` must return an allowed class; `UNKNOWN_COST` stays blocked for Auto unless explicit manual execution policy permits it.

- [ ] **Step 1: Write failing HTTP adapter tests with mocked fetch**

Cover bearer injection, structured request mapping, HTTP 429 -> retryable `RATE_LIMITED`, 401 -> `AUTH_REQUIRED`, malformed JSON -> `INVALID_PROVIDER_OUTPUT`, timeout/AbortController, receipt redaction, and cost classification.

- [ ] **Step 2: Implement adapter without vendor logic in Writing Core**

Use a small configured request mapping:

```js
{
  model,
  input: [{ role: 'user', content: task.contextBundle.prompt }],
  response_format: task.outputContract?.jsonSchema ? { type: 'json_schema', json_schema: task.outputContract.jsonSchema } : undefined
}
```

If the chosen vendor's official endpoint differs, keep the vendor translation inside this adapter file or a vendor-specific child adapter; never leak it into Gateway/Core.

- [ ] **Step 3: Implement credential indirection**

V1 may read a credential through an injected environment-backed provider in CLI/runtime startup, but persisted `ProviderConfig` stores only `secretRef`. Do not write secret values to `.seosona-content`.

- [ ] **Step 4: Run and commit**

```bash
node --test tests/provider-api-adapter.test.mjs
git add runtime/providers/api-http-adapter.mjs tests/provider-api-adapter.test.mjs
git commit -m "feat(providers): add api adapter contract proof"
```

---

### Task 9: Implement Provider Gateway attempts, fallback, and receipts

**Files:**
- Create: `runtime/providers/gateway.mjs`
- Create: `tests/provider-gateway.test.mjs`
- Modify: `runtime/domain/job-state.mjs`
- Modify: `runtime/storage/workspace-store.mjs` if provider-attempt persistence hooks are not yet generic.

**Interfaces:**
- `createProviderGateway({ registry, router, adapters, attemptStore, receiptStore, now })`.
- `gateway.execute(task, policy): Promise<ProviderResult>`.
- Creates one `ProviderAttempt` per selected provider and one immutable `ProviderReceipt` per completed attempt.
- Fallback reuses same `taskId`/`contextSnapshotId`; attempt IDs change.

- [ ] **Step 1: Write failing Gateway tests**

Cases: manual browser success; browser retryable failure -> next zero-incremental browser; all browser unavailable -> FREE_QUOTA API; only paid API -> `PAID_PROVIDER_BLOCKED`; explicitly allowed paid API; non-retryable content block does not blindly retry same provider; receipt contains context class/digest but no secret/full prompt.

- [ ] **Step 2: Implement attempt loop**

Pseudo-code:

```js
const excluded = new Set();
while (true) {
  const route = routeProvider({ task, providers: registry.list(), policy: { ...policy, excluded } });
  if (!route) throw providerError('NO_ELIGIBLE_PROVIDER');
  const attempt = await attemptStore.start(task, route.providerId);
  const result = await adapters.get(route.providerId).execute(task);
  await attemptStore.finish(attempt.attemptId, result);
  await receiptStore.write(redactReceipt(task, result, attempt));
  if (result.status === 'COMPLETED') return result;
  if (!result.error?.retryable) return result;
  excluded.add(route.providerId);
}
```

- [ ] **Step 3: Feed observed health/quality only after finalized attempts/evaluations**

Transport success updates stability. Content quality is updated by evaluator/user signals later; Gateway must not label any textual output “high quality” merely because the HTTP/browser call succeeded.

- [ ] **Step 4: Run tests and commit**

```bash
node --test tests/provider-gateway.test.mjs tests/provider-router.test.mjs tests/provider-api-adapter.test.mjs tests/provider-browser-bridge.test.mjs
git add runtime/providers/gateway.mjs runtime/domain/job-state.mjs tests/provider-gateway.test.mjs
git commit -m "feat(providers): orchestrate routed provider attempts"
```

---

### Task 10: Provider endpoints, settings, and acceptance

**Files:**
- Modify: `runtime/http/server.mjs`
- Modify: `package.json`
- Create: `runtime/providers/README.md`
- Modify: `README.md`

**Interfaces:**
- `GET /v1/providers` — configuration + redacted health/capabilities.
- `PATCH /v1/providers/:providerId` — enable/cost policy/manual settings, never raw secrets.
- `POST /v1/providers/route-preview` — returns selected provider/reason without execution.
- `POST /v1/provider-tasks` — executes through Gateway for later Writing Core integration.

- [ ] **Step 1: Add server tests for provider listing, route preview, paid blocking, and task execution with fake adapters**

- [ ] **Step 2: Add `npm run providers:verify`**

```json
"providers:verify": "node --test tests/provider-*.test.mjs tests/browser-provider-adapter.test.cjs"
```

- [ ] **Step 3: Run complete provider acceptance**

With fake adapters prove:

```text
same ProviderTask -> browser adapter output
same ProviderTask -> API adapter output
no task/domain code changes between the two
fallback preserves contextSnapshotId
paid API cannot run automatically by default
```

For live browser acceptance, use an already logged-in provider only if available; if not, record the external gate rather than weakening tests.

- [ ] **Step 4: Run full regression suite**

```bash
npm run providers:verify
npm test
```

- [ ] **Step 5: Commit**

```bash
git add runtime/http/server.mjs runtime/providers/README.md README.md package.json tests/provider-*.test.mjs
git commit -m "docs(providers): verify browser and api gateway"
```

---

## Plan self-review checklist

- Spec coverage: provider-neutral contract, Browser Automation Adapter, API Adapter, manual locks, quality/free/stability/speed Auto Router, browser states, fallback, paid block, provider attempts/receipts and no-secret persistence are covered.
- Deferred: Writing prompts/evaluators belong in Writing Core plan; Studio settings UI belongs in Surfaces plan.
- Placeholder scan: API vendor is intentionally configuration-driven; the adapter interface and exact tests are defined and do not require a vendor decision to implement the provider-neutral layer.
- Type consistency: `ProviderTask`, `ProviderResult`, `ProviderAttempt`, `ProviderReceipt`, `providerId`, `contextSnapshotId`, and cost classes match the design/workbook.
