# Local Web Studio, Extension Surfaces, and Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the two first-class product surfaces—Local Web Studio for deep writing and Browser Extension for contextual writing—over one Local Runtime, then migrate legacy SRT/provider behavior without breaking existing users.

**Architecture:** The Runtime serves a lightweight local Studio from the same loopback origin and remains canonical state owner. The Extension becomes a thin Runtime client for contextual capture/edit/audit/insert plus a separate Browser Automation Provider Adapter. Existing side-panel/SRT functionality is migrated incrementally: generic actions use Runtime first, while legacy Facebook/media code stays isolated until explicitly retired.

**Tech Stack:** Local Runtime HTTP server, vanilla HTML/CSS/ES modules for Studio V1, Chrome Manifest V3 side panel/service worker, browser `fetch`, `chrome.scripting`, `activeTab`, existing Node `node:test`. No hosted frontend or cloud state.

## Global Constraints

- Web Studio and Extension are two interfaces into one local Content Workspace.
- Neither surface owns a separate business database or writing engine.
- Runtime is the only canonical writer of Project/Source/Content/Revision/Evaluation state.
- Extension page capture and page mutation are user initiated and least privilege.
- No persistent `<all_urls>` host permission is required for V1 contextual actions; use `activeTab` plus explicit user action where page scripting is needed.
- Replacing text in a page/editor is always explicit; never silently overwrite page content.
- Current vs Suggested must be visible before replacement for rewrite/edit actions.
- Browser AI automation remains a Provider Adapter and must not become canonical state owner.
- Local-first does not mean provider-private: UI must show when task context will leave the machine for a browser/API provider.
- Paid API remains blocked by default.
- Existing SRT exactness and current browser AI provider support remain available through migration.
- No cloud sync, team collaboration, publishing automation, or full CMS in V1.
- Every behavior change follows red -> green -> refactor and ends with a focused commit.

---

## File map

**Create**
- `runtime/studio/index.html` — Studio shell.
- `runtime/studio/styles.css` — Studio layout and states.
- `runtime/studio/app.mjs` — page-level controller only.
- `runtime/studio/api-client.mjs` — same-origin Runtime API client.
- `runtime/studio/state.mjs` — pure Studio view state reducer.
- `runtime/studio/views/projects.mjs`
- `runtime/studio/views/project-workspace.mjs`
- `runtime/studio/views/sources.mjs`
- `runtime/studio/views/brand.mjs`
- `runtime/studio/views/content-editor.mjs`
- `runtime/studio/views/audit.mjs`
- `runtime/studio/views/providers.mjs`
- `runtime/studio/views/transcript.mjs`
- `extension/lib/runtime-client.js` — authenticated Runtime client for MV3.
- `extension/lib/context-actions.js` — pure action mapping/payload construction.
- `extension/content/context-editor.js` — dynamically injected selected/editor read/replace adapter.
- `tests/studio-state.test.mjs`
- `tests/studio-server.test.mjs`
- `tests/extension-runtime-client.test.cjs`
- `tests/extension-context-actions.test.cjs`
- `tests/context-editor-contract.test.cjs`
- `tests/migration-contract.test.mjs`

**Modify**
- `runtime/http/server.mjs` — serve Studio assets and pairing/session endpoints.
- `runtime/http/auth.mjs` — pairing-secret/session-token flow for Extension.
- `runtime/storage/workspace-store.mjs` — hashed pairing credential metadata if not already supported generically.
- `extension/manifest.json` — add `activeTab`; preserve explicit provider and localhost hosts.
- `extension/background.js` — Runtime connection, contextual action dispatch, provider bridge remains separate.
- `extension/sidepanel/index.html` — introduce Workspace/Context actions without deleting legacy views initially.
- `extension/sidepanel/app.js` — Runtime-backed project/actions UI adapter.
- `extension/sidepanel/styles.css` — contextual diff/status states.
- `README.md`
- `package.json`

**Legacy code kept isolated during migration**
- `extension/lib/facebook-*.js`
- `scripts/companion/facebook-*.mjs`
- old SRT UI code inside `extension/sidepanel/app.js`

---

### Task 1: Serve a same-origin Studio shell from Local Runtime

**Files:**
- Create: `runtime/studio/index.html`
- Create: `runtime/studio/styles.css`
- Create: `runtime/studio/app.mjs`
- Create: `runtime/studio/api-client.mjs`
- Modify: `runtime/http/server.mjs`
- Create: `tests/studio-server.test.mjs`

**Interfaces:**
- `GET /` -> Studio HTML.
- `GET /studio/app.mjs`, `/studio/styles.css`, `/studio/api-client.mjs` -> local assets.
- `createStudioApiClient({ fetchImpl = fetch })` exposes `health`, `listProjects`, `getProject`, `createProject`, `listProviders`, `runWrite`, `runEdit`, `runAudit`, `getJob`.
- Studio calls `/v1/*` with same-origin credentials; no API token is embedded in static JS.

- [x] **Step 1: Write failing static-serving and same-origin tests**

```js
const html = await fetch(`${base}/`).then(r => r.text());
assert.match(html, /SEOSONA Content/);
assert.match(html, /\/studio\/app\.mjs/);
assert.doesNotMatch(html, /Bearer|api[_-]?key/i);
```

Test path traversal (`/studio/../../package.json`) returns 404/400.

- [x] **Step 2: Implement explicit static asset map**

Do not expose arbitrary repo files. Map only the Studio files:

```js
const STUDIO_ASSETS = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/studio/app.mjs', ['app.mjs', 'text/javascript; charset=utf-8']],
  ['/studio/api-client.mjs', ['api-client.mjs', 'text/javascript; charset=utf-8']],
  ['/studio/styles.css', ['styles.css', 'text/css; charset=utf-8']]
]);
```

- [x] **Step 3: Create minimal semantic Studio shell**

HTML contains navigation targets `Projects`, `Sources`, `Brand`, `Content`, `Audit`, `Transcript`, `Providers` and one `<main id="studio-main">`. No duplicate business logic or fake data.

- [x] **Step 4: Run and commit**

```bash
node --test tests/studio-server.test.mjs
git add runtime/studio runtime/http/server.mjs tests/studio-server.test.mjs
git commit -m "feat(studio): serve local writing workspace"
```

---

### Task 2: Build pure Studio navigation/view state

**Files:**
- Create: `runtime/studio/state.mjs`
- Create: `tests/studio-state.test.mjs`
- Modify: `runtime/studio/app.mjs`

**Interfaces:**
- `createStudioState()` -> `{ route, selectedProjectId, selectedContentId, busy, error, notice }`.
- `reduceStudioState(state, event)` legal events: `ROUTE_CHANGED`, `PROJECT_SELECTED`, `CONTENT_SELECTED`, `REQUEST_STARTED`, `REQUEST_SUCCEEDED`, `REQUEST_FAILED`, `NOTICE_DISMISSED`.
- Browser history route format: `#/projects/:projectId/<section>`.

- [x] **Step 1: Write failing reducer tests**

Test project selection, route change, busy transition, failure cleanup, and no stale content selection after switching projects.

- [x] **Step 2: Implement pure reducer**

No DOM, fetch, provider or Runtime code in `state.mjs`.

- [x] **Step 3: Wire `app.mjs` to hash navigation and state renderer**

`app.mjs` imports views and passes only state + API client callbacks.

- [x] **Step 4: Run and commit**

```bash
node --test tests/studio-state.test.mjs
git add runtime/studio/state.mjs runtime/studio/app.mjs tests/studio-state.test.mjs
git commit -m "feat(studio): add workspace navigation state"
```

---

### Task 3: Implement Project, Source, and Brand Studio views

**Files:**
- Create: `runtime/studio/views/projects.mjs`
- Create: `runtime/studio/views/project-workspace.mjs`
- Create: `runtime/studio/views/sources.mjs`
- Create: `runtime/studio/views/brand.mjs`
- Modify: `runtime/studio/app.mjs`
- Modify: `runtime/studio/api-client.mjs`
- Modify: `tests/studio-state.test.mjs`

**Interfaces:**
- Project view: create/select project, shows brand and source counts.
- Sources view: add URL/plain text/file metadata supported by Runtime endpoints, list source provenance.
- Brand view edits structured writing fields: identity, products/services, voice, terminology, claims/evidence refs, audience vocabulary, approved/rejected examples, negative rules.
- Every mutation goes through Runtime API and refreshes canonical record from response.

- [x] **Step 1: Add view-model tests**

Export pure functions such as:

```js
projectListModel(projects)
sourceListModel(sources)
brandFormModel(brand)
```

Test empty/loading/error/data states and that source locators/verification status remain visible.

- [x] **Step 2: Implement project creation/selection UI**

Require `name`; `objective` optional. On create, navigate to returned `projectId` rather than generating an ID in browser.

- [x] **Step 3: Implement Source view**

Show source type, title, canonical URL/local ref, hash, retrieval time and evidence count. Do not render raw source HTML as trusted HTML; use text nodes/textContent.

- [x] **Step 4: Implement Brand view**

Use plain structured controls. Do not add visual brand-kit/media editing to V1 UI.

- [x] **Step 5: Run and commit**

```bash
node --test tests/studio-state.test.mjs tests/studio-server.test.mjs
git add runtime/studio/views runtime/studio/app.mjs runtime/studio/api-client.mjs tests/studio-state.test.mjs
git commit -m "feat(studio): manage local projects sources and brand"
```

---

### Task 4: Implement deep writing Content, Audit, Transcript, and Provider views

**Files:**
- Create: `runtime/studio/views/content-editor.mjs`
- Create: `runtime/studio/views/audit.mjs`
- Create: `runtime/studio/views/providers.mjs`
- Create: `runtime/studio/views/transcript.mjs`
- Modify: `runtime/studio/app.mjs`
- Modify: `runtime/studio/api-client.mjs`
- Modify: `tests/studio-state.test.mjs`

**Interfaces:**
- Content view: choose `article`, `product`, or `transcript`; create brief; run Write; view immutable revision timeline; run Edit; explicitly approve a revision.
- Audit view: show evaluator findings grouped by severity/dimension, evidence refs, repair action; Audit action does not rewrite automatically.
- Transcript view: upload/paste SRT, show cue/timecode table, run supported Transcript operations and exact-source validation result.
- Provider view: list provider ID/type/health/cost class/observed quality status, manual lock controls, paid API disabled by default, route preview.

- [x] **Step 1: Write pure view-model tests**

Test revision ordering, audit grouping, transcript cue display preserving exact raw text, provider cost labels, `PAID_BLOCKED` warning, and route-preview reason display.

- [x] **Step 2: Implement Content editor workflow**

Do not make a browser-local draft canonical. Textarea/form state is temporary; clicking Save/Edit calls Runtime and displays returned `revisionId`.

- [x] **Step 3: Implement Audit UI with no auto-repair side effect**

Each finding displays `dimension`, `verdict/severity`, `reason`, evidence refs and `repairAction`; repair requires a separate user action.

- [x] **Step 4: Implement Transcript UI**

Display raw cue text via `textContent`; timecodes from Runtime CueIR. Editor overlay/corrected caption is visually separate from authoritative raw transcript.

- [x] **Step 5: Implement Provider settings**

Manual locks may be set by project/workflow/stage where API supports them. Paid API toggle requires explicit user action and displays that it can incur provider charges.

- [x] **Step 6: Run and commit**

```bash
node --test tests/studio-state.test.mjs
git add runtime/studio/views runtime/studio/app.mjs runtime/studio/api-client.mjs tests/studio-state.test.mjs
git commit -m "feat(studio): add writing audit transcript provider workspace"
```

---

### Task 5: Add revocable Extension pairing and short-lived Runtime sessions

**Files:**
- Modify: `runtime/http/auth.mjs`
- Modify: `runtime/http/server.mjs`
- Modify: `runtime/storage/workspace-store.mjs`
- Create: `tests/runtime-pairing.test.mjs`
- Create: `extension/lib/runtime-client.js`
- Create: `tests/extension-runtime-client.test.cjs`

**Interfaces:**
- Same-origin Studio: `POST /v1/pairing/start` returns `{ code, expiresAt }`, one-time 8-character uppercase/base32 code, TTL 5 minutes.
- Extension unauthenticated exchange: `POST /v1/pairing/exchange` with exact allowed extension origin + code returns `{ credentialId, credentialSecret }` once.
- Runtime stores `sha256(credentialSecret)` + extension ID + created/revoked timestamps, never plaintext secret.
- Extension stores `credentialId` + `credentialSecret` in `chrome.storage.local` as a local Runtime pairing credential, not a provider/API credential.
- Extension: `POST /v1/session` with pairing credential returns short-lived bearer token; bearer token stays in `chrome.storage.session`.
- Existing extension request nonce rule remains required for bearer-authenticated calls.

- [x] **Step 1: Write failing pairing security tests**

Cover code expiry, one-time use, wrong extension origin, wrong code, secret hash storage, credential revocation, session expiry, replayed nonce, and no raw credential in Runtime project records.

- [x] **Step 2: Implement pairing code generation**

Use `randomBytes()` and an unambiguous alphabet such as `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`; persist only a hash of the one-time code while active.

- [x] **Step 3: Implement credential exchange + session minting**

Session token contains at least 256 bits of randomness, expires after a bounded duration (V1: 12 hours), and is stored server-side hashed or in an in-memory/session record suitable for revocation.

- [x] **Step 4: Implement `RuntimeClient`**

Methods:

```js
pair(code)
openSession()
request(path, { method='GET', body } = {})
health()
listProjects()
runAction(action, payload)
```

`request()` adds current bearer token + fresh random nonce. On `SESSION_EXPIRED`, call `openSession()` once and retry exactly once.

- [x] **Step 5: Run and commit**

```bash
node --test tests/runtime-pairing.test.mjs tests/extension-runtime-client.test.cjs
git add runtime/http/auth.mjs runtime/http/server.mjs runtime/storage/workspace-store.mjs extension/lib/runtime-client.js tests/runtime-pairing.test.mjs tests/extension-runtime-client.test.cjs
git commit -m "feat(extension): pair securely with local runtime"
```

---

### Task 6: Add generic contextual action contracts to Extension

**Files:**
- Create: `extension/lib/context-actions.js`
- Create: `tests/extension-context-actions.test.cjs`
- Modify: `extension/background.js`

**Interfaces:**
- Action IDs: `ADD_SOURCE`, `AUDIT_SELECTION`, `REWRITE_SELECTION`, `SHORTEN_SELECTION`, `EXPAND_SELECTION`, `CLARIFY_SELECTION`, `BRAND_VOICE_SELECTION`, `FACT_CHECK_SELECTION`, `REPURPOSE_PAGE`.
- `buildContextActionPayload({ action, selectionText, pageUrl, pageTitle, projectId }): object`.
- Quick-menu legacy IDs map to generic actions:
  - `quick_audit -> AUDIT_SELECTION`
  - `quick_rewrite -> REWRITE_SELECTION`
  - `quick_shorten -> SHORTEN_SELECTION`
  - `quick_expand -> EXPAND_SELECTION`
  - `quick_grammar -> CLARIFY_SELECTION` only if UI label is also updated; otherwise define a dedicated `GRAMMAR_SELECTION` action.

- [x] **Step 1: Write failing payload tests**

Reject empty selection for selection-only actions, missing project ID when action requires persistence, unsupported URL scheme, oversized selection beyond configured context limit, and unknown action.

- [x] **Step 2: Implement pure action mapping**

Payload contains page URL/title as provenance, but no DOM HTML and no unrelated browsing history.

- [x] **Step 3: Route current context menu through Runtime when paired**

On click: build payload -> save only a short pending UI reference if needed -> open side panel -> side panel/Background calls Runtime Writing API. If Runtime is unavailable, show a clear local-runtime unavailable state; do not silently fall back to a separate untracked content database.

- [x] **Step 4: Keep legacy actions isolated**

Legacy SRT/old direct provider flows remain callable from their old UI during migration but generic context menu actions use Runtime path after this task.

- [x] **Step 5: Run and commit**

```bash
node --test tests/extension-context-actions.test.cjs tests/extension-runtime-client.test.cjs
git add extension/lib/context-actions.js extension/background.js tests/extension-context-actions.test.cjs
git commit -m "feat(extension): route contextual writing actions to runtime"
```

---

### Task 7: Implement explicit page read/replace adapter with `activeTab`

**Files:**
- Create: `extension/content/context-editor.js`
- Create: `tests/context-editor-contract.test.cjs`
- Modify: `extension/manifest.json`
- Modify: `extension/background.js`

**Interfaces:**
- Add permission `activeTab`; do not add persistent `<all_urls>` host permission.
- Dynamic script messages:
  - `context:getSelection`
  - `context:getEditableTarget`
  - `context:replaceSelection`
  - `context:replaceField`
- Pure helpers exported for Node tests where possible: `classifyEditableElement`, `validateReplacement`, `buildEditableSnapshot`.

- [x] **Step 1: Write failing editor-contract tests**

Cover textarea, input, contenteditable, non-editable element, replacement length, original-text mismatch, and unsupported password/file inputs.

- [x] **Step 2: Add `activeTab` only**

Update manifest permissions. Provider hosts and localhost remain as explicit host permissions.

- [x] **Step 3: Implement target snapshot**

Snapshot contains a transient target descriptor and `originalText`. Do not persist DOM nodes/selectors as canonical project records.

- [x] **Step 4: Implement guarded replacement**

Before replacement, re-read current target text and compare with `originalText`. If changed, return `PAGE_CONTENT_CHANGED` and require the user to re-run/review; never overwrite stale text.

- [x] **Step 5: Run and commit**

```bash
node --test tests/context-editor-contract.test.cjs
git add extension/content/context-editor.js extension/manifest.json extension/background.js tests/context-editor-contract.test.cjs
git commit -m "feat(extension): add explicit contextual page replacement"
```

---

### Task 8: Refactor side panel into Runtime workspace/context companion without deleting legacy SRT UI

**Files:**
- Modify: `extension/sidepanel/index.html`
- Modify: `extension/sidepanel/app.js`
- Modify: `extension/sidepanel/styles.css`
- Create: `tests/migration-contract.test.mjs`

**Interfaces:**
- New top-level contextual states: `Not Paired`, `Runtime Offline`, `Project Required`, `Ready`, `Running`, `Review Result`, `Apply Result`.
- New controls: Runtime status, current project selector, quick action result, Current/Suggested diff, Accept, Reject, Apply to Page, Open in Studio.
- Old SRT Studio sections remain accessible under a `Legacy / Transcript` route until Runtime Transcript acceptance passes.

- [ ] **Step 1: Add migration contract test scanning sidepanel resources**

Assert new Runtime client/action assets are loaded and existing SRT parser/providers remain referenced until the retirement task.

- [ ] **Step 2: Add Runtime status/project header**

Side panel fetches canonical project list through `RuntimeClient`; it does not clone project records into local storage beyond selected `projectId` preference.

- [ ] **Step 3: Add Current vs Suggested review component**

Show immutable original selection and suggested revision. `Accept` records user signal/approved revision in Runtime; `Apply to Page` is a second explicit action invoking context-editor replacement.

- [ ] **Step 4: Add Open in Studio action**

Open `http://127.0.0.1:<configured-port>/#/projects/<projectId>/content/<contentId>` using Runtime-configured loopback URL only.

- [ ] **Step 5: Keep Browser Provider Adapter controls separate**

Provider execution status may be shown, but no provider response becomes canonical until Runtime workflow validates/persists it.

- [ ] **Step 6: Run and commit**

```bash
node --test tests/migration-contract.test.mjs tests/extension-*.test.cjs tests/context-editor-contract.test.cjs
git add extension/sidepanel tests/migration-contract.test.mjs
git commit -m "feat(extension): add runtime backed contextual companion"
```

---

### Task 9: Record Accept/Reject/Edit/Apply learning signals

**Files:**
- Modify: `runtime/domain/content-service.mjs`
- Modify: `runtime/http/server.mjs`
- Modify: `runtime/studio/views/content-editor.mjs`
- Modify: `extension/sidepanel/app.js`
- Create: `tests/feedback-signals.test.mjs`

**Interfaces:**
- `POST /v1/content/:contentId/signals`
- Signal types: `ACCEPT`, `REJECT`, `MANUAL_EDIT`, `AUDIT_REPAIR`, `APPLIED_TO_PAGE`, `PROVIDER_PREFERENCE`.
- `ObservedSignal` includes `signalId`, `projectId`, `brandId?`, `contentId`, `revisionId`, `providerId?`, `jobType`, `type`, `value`, `createdAt`.
- Signals are observations; none automatically becomes a factual Brand rule.

- [ ] **Step 1: Write failing signal-scope tests**

Prove a rejected phrase in Brand A does not alter Brand B, one rejection does not create a hard negative rule, and provider preference signal is scoped by job type.

- [ ] **Step 2: Implement append-only signal persistence**

No update/delete of historical signals through normal workflow API.

- [ ] **Step 3: Wire Studio/Extension actions**

Accept/reject and explicit page application produce signals after successful canonical action. A page replacement failure does not produce `APPLIED_TO_PAGE`.

- [ ] **Step 4: Run and commit**

```bash
node --test tests/feedback-signals.test.mjs
git add runtime/domain/content-service.mjs runtime/http/server.mjs runtime/studio/views/content-editor.mjs extension/sidepanel/app.js tests/feedback-signals.test.mjs
git commit -m "feat(learning): record scoped writing feedback signals"
```

---

### Task 10: Migrate Transcript/SRT UI to Runtime while preserving legacy exports

**Files:**
- Modify: `extension/sidepanel/app.js`
- Modify: `extension/lib/exporter.js`
- Modify: `runtime/studio/views/transcript.mjs`
- Modify: `tests/migration-contract.test.mjs`
- Modify: `tests/job-pack-transcript.test.mjs`

**Interfaces:**
- New Transcript analysis uses Runtime `TranscriptIR` and job APIs.
- Existing useful exports remain available where semantically valid: `.cut.srt`, `.cutlist.csv`, `.edl`, `.fcpxml`, `.captions.txt`, `.script.md`, `.metadata.txt`, `.project.json`.
- Export source must be approved Runtime revision/Transcript selection, not an unvalidated provider string.

- [ ] **Step 1: Add failing export-source tests**

A cut export must reject modified raw transcript/timecode mismatch. Non-cut writing exports may use corrected display text but retain provenance.

- [ ] **Step 2: Point SRT analysis actions at Runtime**

Legacy parser may still be used for immediate local preview, but canonical ingest/selection validation comes from Runtime and returned IDs.

- [ ] **Step 3: Adapt exporter input**

Create a small adapter from approved Runtime Transcript result to existing exporter shape; do not rewrite every export format in this task.

- [ ] **Step 4: Run and commit**

```bash
node --test tests/job-pack-transcript.test.mjs tests/migration-contract.test.mjs
git add extension/sidepanel/app.js extension/lib/exporter.js runtime/studio/views/transcript.mjs tests/job-pack-transcript.test.mjs tests/migration-contract.test.mjs
git commit -m "refactor(transcript): use runtime as canonical srt source"
```

---

### Task 11: Isolate Facebook/media legacy paths from the new writing core

**Files:**
- Modify: `extension/background.js`
- Modify: `package.json`
- Create: `docs/migration/facebook-legacy-boundary.md`
- Modify: `tests/migration-contract.test.mjs`

**Interfaces:**
- New Runtime/Provider/Writing modules never import `facebook-factory`, `facebook-batch`, visual Flow clients, or media asset packages.
- Legacy Facebook UI/actions remain behind `facebook:*` messages and existing companion process until separately retired.
- `npm run architecture:boundary` scans prohibited imports/identifiers in `runtime/`.

- [ ] **Step 1: Write failing boundary scanner**

Create `scripts/audit/writing-boundary-audit.mjs` that recursively scans `runtime/**/*.mjs` and fails on imports/references to:

```text
facebook-factory
facebook-batch
facebook-orchestrator
facebook-state
/v1/flow/
visualJob
ASSET_READY
```

Allow explanatory documentation comments only by scanning executable Runtime source files, not docs.

- [ ] **Step 2: Add package script**

```json
"architecture:boundary": "node scripts/audit/writing-boundary-audit.mjs"
```

- [ ] **Step 3: Move any accidental new-core legacy dependency behind adapters**

Do not delete legacy code merely to make scanner pass.

- [ ] **Step 4: Document legacy boundary**

State exactly which old files are compatibility-only and that future Social Job Pack migration must consume generic Runtime/Provider contracts rather than promote Facebook code into Core.

- [ ] **Step 5: Run and commit**

```bash
npm run architecture:boundary
npm test
git add scripts/audit/writing-boundary-audit.mjs package.json docs/migration/facebook-legacy-boundary.md tests/migration-contract.test.mjs extension/background.js
git commit -m "refactor: isolate legacy facebook media workflow"
```

---

### Task 12: Remove machine-specific project configuration from the portable path

**Files:**
- Modify: `.gitignore`
- Delete from tracked product configuration: `.mcp.json`
- Create: `docs/development/local-integrations.md`
- Modify: `tests/migration-contract.test.mjs`

**Interfaces:**
- Product Runtime does not depend on `.mcp.json` to start.
- Developer-local MCP configuration is explicitly local/untracked.
- No committed configuration contains `C:/Users/`, `/Users/<name>/`, `/home/<name>/`, or another developer-specific absolute path.

- [ ] **Step 1: Write failing portable-path test**

Scan committed text configuration files (`*.json`, `*.mjs`, `*.js`, selected docs exclusions) for known machine-specific path patterns. Explicit fixture strings in the test itself are excluded from scan.

- [ ] **Step 2: Stop tracking `.mcp.json` and ignore local copies**

Add `.mcp.json` to `.gitignore`. The user/developer may create their own local file; Runtime core cannot require it.

- [ ] **Step 3: Document local integration configuration**

`docs/development/local-integrations.md` explains that optional knowledge MCP integrations are developer/user-local and provider-specific; the product's Writing Core runs without them.

- [ ] **Step 4: Run and commit**

```bash
node --test tests/migration-contract.test.mjs
npm run architecture:boundary
git add .gitignore docs/development/local-integrations.md tests/migration-contract.test.mjs
git rm --cached .mcp.json
git commit -m "chore: remove machine specific mcp configuration"
```

---

### Task 13: End-to-end V1 acceptance across Studio and Extension

**Files:**
- Create: `tests/v1-acceptance.test.mjs`
- Modify: `package.json`
- Modify: `README.md`

**Interfaces:**
- `npm run v1:verify` executes Runtime, Provider, Writing, Studio/Extension contract, boundary and legacy tests.
- Acceptance proves shared state, not pixel-perfect UI.

- [ ] **Step 1: Build a fake-provider E2E harness**

Start Runtime on an ephemeral port/temp data root with fake browser/API adapters. Through HTTP APIs:

```text
create workspace/project/brand
add source
write Article
run independent Audit
edit/approve revision
read same revision through Studio API client contract
submit contextual Extension action against same project
verify new Revision and signal share canonical IDs
```

- [ ] **Step 2: Add Product and Transcript acceptance paths**

Product: unsupported benefit must not reach approved state.

Transcript: modified raw text/timecode must not reach approved cut/export state.

- [ ] **Step 3: Add provider-routing acceptance**

Browser fake preferred by observed quality/zero-incremental policy; browser unavailable -> eligible free API; only paid API -> blocked; explicit paid policy -> allowed.

- [ ] **Step 4: Add package script**

```json
"v1:verify": "npm run runtime:verify && npm run providers:verify && npm run writing:verify && node --test tests/studio-*.test.mjs tests/extension-*.test.cjs tests/context-editor-contract.test.cjs tests/feedback-signals.test.mjs tests/migration-contract.test.mjs tests/v1-acceptance.test.mjs && npm run architecture:boundary && npm run facebook:verify"
```

If legacy `facebook:verify` includes an external unavailable dependency in the actual environment, split its deterministic unit/audit portion from live acceptance before using it as a required local gate; never simply delete the regression gate.

- [ ] **Step 5: Run full verification and record exact external gates**

Run:

```bash
npm run v1:verify
```

All deterministic tests must pass. Live browser-provider acceptance is additional: if no logged-in web provider is available, record `EXTERNAL_AUTH_GATE` rather than weakening automated tests.

- [ ] **Step 6: Update README product identity**

README must lead with `SEOSONA Content — Writing Intelligence System`, explain Local Studio + Context Extension + Provider Gateway, and move SRT Studio/Facebook Factory descriptions under migrated/legacy capabilities rather than main identity.

- [ ] **Step 7: Commit**

```bash
git add tests/v1-acceptance.test.mjs package.json README.md
git commit -m "test: verify writing intelligence v1 across surfaces"
```

---

## Plan self-review checklist

- Spec coverage: Local Web Studio, equal first-class Extension, shared Runtime state, contextual capture, explicit replacement, Browser Provider bridge separation, provider settings, feedback learning, Transcript migration, least-privilege permissions, portability cleanup, and V1 acceptance are covered.
- Deferred: cloud sync, publishing, team collaboration, broader Content Job Packs, desktop packaging.
- Placeholder scan: pairing flow, Runtime client, contextual action IDs, page replacement contract, Studio sections and release gate are explicitly defined.
- Type consistency: `projectId`, `contentId`, `revisionId`, `providerId`, Runtime bearer/session, `ObservedSignal`, `EvaluationResult`, and Transcript source fields match the three preceding implementation plans.
