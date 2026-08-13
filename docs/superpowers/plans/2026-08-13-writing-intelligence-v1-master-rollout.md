# Writing Intelligence V1 Master Rollout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Roll SEOSONA Content from the current SRT/Facebook-centric Chrome extension into a local-first Writing Intelligence V1 without breaking the existing extension while the new Runtime, provider-neutral execution, Writing Core, and two first-class surfaces come online.

**Architecture:** Use a strangler migration. First establish a canonical Local Runtime and portable domain contracts; then add Provider Gateway with Browser Automation and API adapters; then build provider-neutral Writing Core and three V1 Job Packs; finally connect Local Web Studio and contextual Extension to the same state and run cross-surface acceptance. Legacy Facebook/media modules stay operational but isolated until separately retired.

**Tech Stack:** Existing JavaScript/Node.js codebase, Node ESM for new Runtime modules, browser-safe JavaScript for Chrome MV3, Node built-in `node:test`, native HTTP/fetch, existing MCP dependency retained only where legacy integrations still require it. No cloud backend or frontend framework is required for V1.

## Global Constraints

- Scope is writing/content only.
- Canonical product loop: Research -> Brief -> Write -> Edit -> Audit -> Optimize -> Repurpose -> Learn.
- Local machine is the source of truth.
- Local Web Studio and Browser Extension are equal first-class clients of one Local Runtime.
- Browser Extension has two separate roles: contextual writing copilot and Browser AI Provider Adapter.
- Provider architecture is neutral: Browser Automation + API in V1, Local Model contract-ready for later.
- Auto Router priority is lexicographic: quality -> zero incremental cost -> stability -> speed.
- Existing logged-in browser AI sessions/subscriptions are `ZERO_INCREMENTAL` for SEOSONA routing.
- Paid API execution is blocked by default; no silent paid fallback.
- Manual provider lock always overrides Auto Router.
- Writer and Auditor are independent stages and may use different providers.
- Product facts cannot become unsupported benefits/claims.
- SRT raw transcript and exact source timecodes remain authoritative.
- No cloud sync/team collaboration, hosted SaaS backend, full publishing, ad-account management, full CMS, video/image generation, model marketplace, billing, enterprise RBAC, or model training in V1.
- Existing user-visible extension behavior is preserved until a tested replacement is accepted.
- Every production behavior change follows red -> green -> refactor, with focused commits and fresh verification before completion claims.

---

## Child plans and ownership

### Plan A — Local Runtime and Data Model

File:
`docs/superpowers/plans/2026-08-12-local-runtime-data-model-implementation.md`

Owns:
- Runtime process/server.
- Workspace/Project/Brand/Source/Content/Revision canonical state.
- Immutable blobs/revisions/source snapshots.
- generic JobState and ContextSnapshot.
- authenticated loopback API.

Must be substantially complete before Plans C/D rely on canonical persistence.

### Plan B — Provider Gateway, Browser Automation, and API

File:
`docs/superpowers/plans/2026-08-12-provider-gateway-browser-api-implementation.md`

Owns:
- `ProviderTask` / `ProviderResult` contracts.
- provider registry, health, observed quality.
- manual locks and Auto Router.
- Browser Runtime bridge + Extension BrowserAutomationAdapter.
- one API HTTP adapter proof.
- attempts, fallback, receipts and paid blocking.

Depends on Plan A's Runtime HTTP/store contracts. Pure contracts/router tasks can start after Plan A Task 2.

### Plan C — Writing Core and V1 Job Packs

File:
`docs/superpowers/plans/2026-08-13-writing-core-job-packs-implementation.md`

Owns:
- Writing IRs, evidence, claims, brief, structured context.
- Writer, Editor, independent Evaluator.
- Target Adaptation and Repurpose lineage.
- Article, Product, Transcript/SRT Job Packs.
- Write/Edit/Audit workflow and Writing API.

Depends on stable Plan A domain interfaces and Plan B Provider Gateway contract. Pure IR/evidence/job-pack tasks can start in parallel once those interfaces are frozen.

### Plan D — Local Web Studio, Extension Surfaces, and Migration

File:
`docs/superpowers/plans/2026-08-13-web-studio-extension-migration-implementation.md`

Owns:
- Local Studio UX/client.
- secure Extension pairing/session.
- contextual actions and guarded page replacement.
- side-panel migration.
- feedback signals.
- Transcript UI/export migration.
- legacy Facebook/media isolation and portability cleanup.
- cross-surface V1 acceptance.

Depends on Plans A-C endpoints/contracts; its early static Studio shell and pure UI state can begin earlier.

---

## Release dependency graph

```text
Baseline tests
    |
    v
A1 Contracts/IDs ----------------------+
    |                                  |
    v                                  v
A2 Store/Domain/Runtime API        B1 Provider Contracts/Router
    |                                  |
    +--------------------+-------------+
                         |
                         v
                 B2 Browser/API Gateway
                         |
          +--------------+--------------+
          |                             |
          v                             v
   C1 Writing IR/Core             D1 Studio Shell/State
          |
          v
   C2 Article/Product/SRT
          |
          v
   C3 Writer/Edit/Audit Workflow
          |                             |
          +--------------+--------------+
                         v
                D2 Runtime-backed Surfaces
                         |
                         v
                 D3 Migration + Acceptance
                         |
                         v
                 Writing Intelligence V1
```

---

### Task 1: Freeze baseline and run all existing tests before migration

**Files:**
- No production changes.
- Existing `package.json`, `tests/facebook-*.test.*` are baseline inputs.

**Interfaces:**
- Produces a recorded baseline of current deterministic tests before generic test runner changes.

- [ ] **Step 1: Run current test suite on a clean worktree**

Run:

```bash
npm test
npm run seosona:doctor
```

Record exact failures as pre-existing; do not fix unrelated behavior under a migration task.

- [ ] **Step 2: Run syntax checks on current extension entrypoints**

Run:

```bash
node --check extension/background.js
node --check extension/lib/facebook-state.js
node --check extension/lib/facebook-orchestrator.js
```

- [ ] **Step 3: Confirm the current repository state before implementation commits**

Run:

```bash
git status --short
git log -5 --oneline
```

If user-owned dirty changes exist, use the required isolated-worktree workflow before implementation.

- [ ] **Step 4: Do not commit baseline-only execution**

This task is a release gate, not a source change.

---

### Task 2: Execute Plan A through canonical Runtime acceptance

**Files:**
- Follow exactly: `docs/superpowers/plans/2026-08-12-local-runtime-data-model-implementation.md`.

**Interfaces:**
- Required outputs before this task is accepted:
  - portable record contracts;
  - atomic local store;
  - Project/Brand/Source/Content/Revision services;
  - generic JobState;
  - immutable ContextSnapshot;
  - authenticated `127.0.0.1` Runtime server;
  - all legacy tests still green.

- [ ] **Step 1: Execute Plan A tasks 1-8 in order**

Use each task's focused test and commit gate; do not collapse commits into one implementation dump.

- [ ] **Step 2: Run Plan A acceptance commands**

```bash
npm run runtime:verify
npm test
```

- [ ] **Step 3: Gate**

Do not start Runtime-dependent UI persistence work until a process restart preserves the same project/content/revision IDs and source hashes.

---

### Task 3: Execute Provider contracts/router while Runtime core stabilizes

**Files:**
- Follow Plan B Tasks 1-3:
  `docs/superpowers/plans/2026-08-12-provider-gateway-browser-api-implementation.md`.

**Interfaces:**
- Required outputs:
  - neutral provider contracts;
  - provider registry/health/quality signals;
  - manual locks;
  - quality -> free -> stability -> speed Auto Router;
  - explicit paid-API block tests.

- [ ] **Step 1: Execute Plan B Tasks 1-3**

These tasks may run after Plan A record contracts are frozen; they do not require browser integration yet.

- [ ] **Step 2: Run routing gate**

```bash
node --test tests/provider-contracts.test.mjs tests/provider-router.test.mjs
```

- [ ] **Step 3: Gate**

No browser/API adapter is considered “preferred” by static vendor reputation. Quality is observed/job-scoped; tests must prove paid/unknown-cost candidates cannot slip through free routing.

---

### Task 4: Execute Provider browser bridge, BrowserAutomationAdapter, API adapter, and Gateway

**Files:**
- Follow Plan B Tasks 4-10.

**Interfaces:**
- Required outputs:
  - Runtime<->Extension browser job lease/result bridge;
  - generic BrowserAutomationAdapter preserving current ChatGPT/Gemini/Claude/Grok mechanisms;
  - legacy `srt:*` aliases still functional during migration;
  - one API adapter implementing the same contract;
  - Provider Gateway attempts/fallback/receipts;
  - route-preview/settings endpoints.

- [ ] **Step 1: Execute Plan B Tasks 4-10 in order**

The browser bridge requires Plan A authenticated server. The API adapter can be built/tested with mocked HTTP before any live credential is configured.

- [ ] **Step 2: Run provider gate**

```bash
npm run providers:verify
npm test
```

- [ ] **Step 3: Prove provider neutrality**

Submit the same fake `ProviderTask` through a browser fake and API fake and assert equivalent normalized `ProviderResult` contracts; only adapter/receipt metadata differs.

- [ ] **Step 4: Gate**

Simulated browser failure with only `PAID_BLOCKED`/`UNKNOWN_COST` API candidates must end in a typed blocked result, not a paid request.

---

### Task 5: Execute Writing contracts, evidence/claims, structured packs, and the three V1 Job Packs

**Files:**
- Follow Plan C Tasks 1-8:
  `docs/superpowers/plans/2026-08-13-writing-core-job-packs-implementation.md`.

**Interfaces:**
- Required outputs:
  - shared Writing IRs;
  - evidence/claim integrity;
  - structured ContextBundle/prompt composer;
  - Content Job Pack registry;
  - ArticleIR/ProductContentIR/TranscriptIR;
  - exact SRT Runtime parser/selection validation.

- [ ] **Step 1: Execute Plan C Tasks 1-4**

Freeze common contracts before pack implementations.

- [ ] **Step 2: Execute Article and Product packs**

Run their golden/fidelity tests before introducing Writer orchestration.

- [ ] **Step 3: Execute SRT parser and Transcript pack**

Treat exact raw transcript/timecodes as release-blocking invariants.

- [ ] **Step 4: Run pack gate**

```bash
node --test tests/writing-contracts.test.mjs tests/writing-evidence-claims.test.mjs tests/writing-context-prompt.test.mjs tests/job-pack-*.test.mjs
```

- [ ] **Step 5: Gate**

A Product draft with an unsupported benefit and a Transcript cut with modified raw text/timecode must both fail deterministic validation without requiring a model judge.

---

### Task 6: Execute Writer, Editor, independent Auditor, Target Adaptation, Repurpose, and resumable workflow

**Files:**
- Follow Plan C Tasks 9-14.

**Interfaces:**
- Required outputs:
  - provider-neutral Writer;
  - fact-preserving Editor;
  - independent Evaluation engine;
  - text-only Target Adapter;
  - content lineage;
  - resumable Write/Edit/Audit workflow;
  - Writing API and golden acceptance.

- [ ] **Step 1: Execute Writer + Editor**

Prove no provider-vendor branch exists in pack/domain logic.

- [ ] **Step 2: Execute independent Evaluator**

Writer provider and Auditor provider must be independently routable/manual-lockable.

- [ ] **Step 3: Execute target/repurpose/workflow/API tasks**

Persist stage checkpoints before advancing.

- [ ] **Step 4: Run Writing Core gate**

```bash
npm run writing:verify
npm run providers:verify
npm run runtime:verify
npm test
```

- [ ] **Step 5: Gate**

Same Article job must run through browser fake and API fake without changing Article/Writer domain code.

---

### Task 7: Execute early Studio shell/state in parallel with late Writing Core tasks

**Files:**
- Follow Plan D Tasks 1-4:
  `docs/superpowers/plans/2026-08-13-web-studio-extension-migration-implementation.md`.

**Interfaces:**
- Required outputs:
  - same-origin Studio assets;
  - pure Studio state;
  - Projects/Sources/Brand views;
  - Content/Audit/Transcript/Provider views consuming Runtime APIs.

- [ ] **Step 1: Execute Plan D Tasks 1-2 after Runtime static serving exists**

These can run before final Writing workflow implementation because they rely on API client/view contracts and fake responses.

- [ ] **Step 2: Execute Plan D Tasks 3-4 after corresponding Runtime APIs stabilize**

Do not invent browser-local IDs or copy canonical state into a separate Studio store.

- [ ] **Step 3: Run Studio gate**

```bash
node --test tests/studio-state.test.mjs tests/studio-server.test.mjs
```

- [ ] **Step 4: Gate**

Restarting/reloading Studio must reload canonical project/revision state from Runtime; browser memory is not the source of truth.

---

### Task 8: Execute Extension pairing, contextual actions, guarded page replacement, and side-panel migration

**Files:**
- Follow Plan D Tasks 5-8.

**Interfaces:**
- Required outputs:
  - revocable pairing + short-lived Runtime session;
  - RuntimeClient;
  - contextual action payloads;
  - `activeTab` guarded page read/replace;
  - Current vs Suggested review;
  - explicit Accept/Reject/Apply;
  - legacy SRT UI still accessible until migrated.

- [ ] **Step 1: Execute secure pairing/session task**

Run security tests before exposing generic context actions.

- [ ] **Step 2: Execute contextual action contract + page adapter**

No persistent `<all_urls>` permission.

- [ ] **Step 3: Execute side-panel migration**

Generic actions use Runtime; Provider Adapter remains a separate execution concern.

- [ ] **Step 4: Run Extension gate**

```bash
node --test tests/extension-runtime-client.test.cjs tests/extension-context-actions.test.cjs tests/context-editor-contract.test.cjs tests/migration-contract.test.mjs
```

- [ ] **Step 5: Gate**

A stale page target must return `PAGE_CONTENT_CHANGED`; it must never silently replace text that changed after the suggestion was generated.

---

### Task 9: Execute feedback learning, Transcript migration, legacy isolation, and portability cleanup

**Files:**
- Follow Plan D Tasks 9-12.

**Interfaces:**
- Required outputs:
  - brand/project-scoped ObservedSignal records;
  - Runtime-canonical SRT analysis/export input;
  - writing-core import boundary scanner;
  - Facebook/media compatibility isolation;
  - no committed developer-specific `.mcp.json` path.

- [ ] **Step 1: Execute feedback signals**

Verify observations never auto-promote to factual/hard brand rules.

- [ ] **Step 2: Migrate Transcript UI/export source**

Keep useful existing export formats; gate them on validated Runtime source.

- [ ] **Step 3: Enforce architecture boundary**

Run:

```bash
npm run architecture:boundary
```

- [ ] **Step 4: Remove machine-specific tracked MCP configuration**

Runtime/core cannot depend on a developer's absolute path.

- [ ] **Step 5: Gate**

All Runtime source files pass the writing boundary scanner and all deterministic legacy tests still pass.

---

### Task 10: Run cross-surface V1 acceptance

**Files:**
- Follow Plan D Task 13.
- Create/update only files specified by that task.

**Interfaces:**
- Produces `npm run v1:verify` as deterministic release gate.

- [ ] **Step 1: Run complete deterministic gate**

```bash
npm run v1:verify
```

Expected: PASS for Runtime, Providers, Writing Core, Studio/Extension contracts, boundaries, SRT regression, and deterministic legacy regression.

- [ ] **Step 2: Run V1 Definition-of-Done checks explicitly**

Verify all ten:

```text
1. Same Blog job runs Browser or API without Blog domain changes.
2. Studio and Extension see the same Project/Content/Revision IDs.
3. Auto Router prefers highest observed qualifying quality, then zero incremental cost, stability, speed.
4. Auto Router never silently uses paid API.
5. Manual provider locks are honored.
6. Provider failure/fallback preserves workflow/context state.
7. Writer and Auditor can use different providers.
8. Product content cannot invent unsupported product claims.
9. SRT cut workflows preserve exact raw transcript/timecodes.
10. New Job Packs/Provider Adapters can be registered without changing Runtime/Gateway core contracts.
```

- [ ] **Step 3: Run optional live Browser Automation acceptance**

With one already logged-in web provider, execute a harmless test Writing Job and verify bridge/receipt behavior. If authentication/session is unavailable, record `EXTERNAL_AUTH_GATE`; do not bypass automated gates.

- [ ] **Step 4: Run optional configured API acceptance**

Only when an explicit non-billable or `PAID_ALLOWED` policy is configured. Record returned cost class/receipt. Do not create billable traffic merely to prove the adapter works.

- [ ] **Step 5: Inspect `git diff` and run secret/path scans before release claim**

At minimum search tracked changes for:

```text
sk-
api_key
Authorization: Bearer <literal>
C:/Users/
/Users/
/home/
```

Review matches rather than blindly treating documentation/test literals as secrets.

---

### Task 11: Update product documentation only after V1 acceptance passes

**Files:**
- `README.md`
- `runtime/README.md`
- `runtime/providers/README.md`
- `docs/migration/facebook-legacy-boundary.md`

**Interfaces:**
- Documentation describes actual passing behavior, not planned capability.

- [ ] **Step 1: Ensure README product identity is Writing Intelligence**

Opening description must not present SEOSONA primarily as SRT Studio or Facebook Factory.

- [ ] **Step 2: Document provider cost semantics precisely**

Use “zero incremental SEOSONA/provider cost for an already-available browser session” rather than claiming third-party services are universally free.

- [ ] **Step 3: Document local-first privacy boundary**

State that canonical data is local, but selected context leaves the machine when a browser/API provider is used.

- [ ] **Step 4: Re-run documentation-linked commands**

Every command shown in README must exist in `package.json` and pass or have its external prerequisite stated.

- [ ] **Step 5: Commit documentation**

```bash
git add README.md runtime/README.md runtime/providers/README.md docs/migration/facebook-legacy-boundary.md
git commit -m "docs: describe writing intelligence v1"
```

---

## Parallelization rules

Safe parallel work:
- Plan A record contracts and Plan B pure provider contracts after names/types are frozen.
- Plan B API adapter tests and browser adapter extraction after ProviderTask/Result schema is frozen.
- Plan C Article/Product/Transcript packs after common Writing IR/Job Pack interfaces are frozen.
- Plan D Studio shell/state while Plan C workflow endpoints are still being implemented, using fake API responses.

Do not parallelize across these mutable boundaries:
- `runtime/http/server.mjs` endpoint integration from multiple tasks without coordination.
- `extension/background.js` browser-provider migration and contextual action migration simultaneously without a shared branch owner.
- `extension/sidepanel/app.js` Transcript migration and contextual UI refactor simultaneously without sequencing.
- `package.json` script edits from independent tasks without rebasing/merging consciously.

---

## Commit/review strategy

Each child task ends in its own focused commit. After each subsystem plan:

```text
Plan A -> review Runtime contracts/data/security
Plan B -> review routing/cost/fallback/provider boundaries
Plan C -> review evidence/claims/SRT/job-pack correctness
Plan D -> review UX permissions/pairing/migration
```

Before final integration, request independent code review, resolve valid findings, then run `npm run v1:verify` again from the integrated branch. Do not force-push over user-owned changes.

---

## Master self-review checklist

- Spec coverage: all V1 required capabilities and all ten Definition-of-Done items map to a child task/release gate.
- Non-goal coverage: no phase introduces cloud state, publishing, media generation, billing, RBAC, or agent swarm.
- Placeholder scan: child plans contain exact files/interfaces/tests; this master specifies exact child paths, dependencies and release commands rather than re-specifying implementation with vague “do later” steps.
- Type consistency: canonical IDs/IRs/ProviderTask/ProviderResult/ContextSnapshot/Revision/EvaluationResult/ObservedSignal names are consistent across Plans A-D.
- Migration safety: existing Facebook/SRT/browser automation code is preserved until replacement acceptance, then isolated rather than promoted into Writing Core.
