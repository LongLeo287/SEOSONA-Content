# Local Runtime and Data Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the local-first SEOSONA Content Runtime that owns canonical projects, brands, sources, content revisions, evidence, claims, workflow state, and authenticated loopback APIs.

**Architecture:** Add a new Node.js ESM runtime beside the existing extension/Companion instead of replacing them. V1 stores metadata as small atomic JSON records plus immutable source/content blobs behind a `WorkspaceStore` interface; the domain layer never exposes absolute paths, so a later SQLite adapter can replace storage without changing Writing Core or provider contracts. The Runtime binds only to loopback and serves the Local Web Studio from the same origin while the extension uses bearer-token + nonce authentication.

**Tech Stack:** Existing Node.js runtime, Node built-ins (`http`, `fs/promises`, `path`, `crypto`), ESM modules, `node:test`, Chrome MV3 client compatibility. No database/framework dependency in this slice.

## Global Constraints

- Scope is writing/content only; no video rendering, image generation, publishing automation, CRM, CMS hosting, or ad-account management.
- The user's machine is the source of truth.
- Web Studio and Browser Extension must read/write the same canonical project IDs and revisions through Local Runtime.
- Core writing workflows must not require cloud availability.
- Project files must never contain plaintext API keys or browser credentials.
- Canonical source snapshots and content revisions are immutable once created.
- Page/source content is untrusted data, never executable instruction.
- Writer and Auditor state must be representable separately.
- Existing extension/Facebook/SRT flows remain operational during strangler migration.
- Every production behavior change follows red -> green -> refactor and ends with a focused commit.

---

## File map

**Create**
- `runtime/index.mjs` — process entrypoint, port/root configuration, graceful shutdown.
- `runtime/lib/ids.mjs` — stable local IDs.
- `runtime/lib/atomic-json.mjs` — atomic JSON read/write helpers.
- `runtime/storage/workspace-store.mjs` — V1 file-backed record/blob store.
- `runtime/domain/records.mjs` — record validators and allowed entity types.
- `runtime/domain/workspace-service.mjs` — workspace/project/brand CRUD invariants.
- `runtime/domain/content-service.mjs` — sources, evidence, claims, content items, immutable revisions.
- `runtime/domain/job-state.mjs` — pure generic job reducer.
- `runtime/domain/context-snapshot.mjs` — frozen execution context snapshots.
- `runtime/http/auth.mjs` — extension bearer/nonce auth and same-origin Studio session auth.
- `runtime/http/router.mjs` — tiny method/path router.
- `runtime/http/server.mjs` — Runtime HTTP server and base endpoints.
- `tests/runtime-records.test.mjs`
- `tests/runtime-store.test.mjs`
- `tests/runtime-domain.test.mjs`
- `tests/runtime-job-state.test.mjs`
- `tests/runtime-server.test.mjs`

**Modify**
- `package.json:4-13` — run all tests and add Runtime start/verify scripts without removing legacy Facebook scripts.
- `.gitignore` — ignore local Runtime data root and runtime token files.

---

### Task 1: Expand the test runner without breaking legacy tests

**Files:**
- Modify: `package.json:4-13`
- Test: all existing `tests/facebook-*.test.*`

**Interfaces:**
- Produces: `npm test` running every `tests/*.test.cjs` and `tests/*.test.mjs` file.
- Produces: `npm run runtime:start` -> `node runtime/index.mjs`.
- Preserves: existing `facebook:*` scripts.

- [x] **Step 1: Add a failing package-script contract test**

Create `tests/package-scripts.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('package scripts keep legacy verification and expose generic test/runtime commands', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url)));
  assert.equal(pkg.scripts.test, 'node --test tests/*.test.cjs tests/*.test.mjs');
  assert.equal(pkg.scripts['runtime:start'], 'node runtime/index.mjs');
  assert.ok(pkg.scripts['facebook:verify']);
});
```

- [x] **Step 2: Run the focused test and verify it fails**

Run: `node --test tests/package-scripts.test.mjs`

Expected: FAIL because `test` is Facebook-only and `runtime:start` is absent.

- [x] **Step 3: Make the minimal package script change**

Set:

```json
{
  "test": "node --test tests/*.test.cjs tests/*.test.mjs",
  "runtime:start": "node runtime/index.mjs",
  "runtime:verify": "node --test tests/runtime-*.test.mjs"
}
```

Keep all existing `facebook:*` and `seosona:*` scripts.

- [x] **Step 4: Run focused and full tests**

Run:

```bash
node --test tests/package-scripts.test.mjs
npm test
```

Expected: PASS, including all legacy Facebook tests.

- [x] **Step 5: Commit**

```bash
git add package.json tests/package-scripts.test.mjs
git commit -m "test: generalize content test runner"
```

---

### Task 2: Define stable IDs and record contracts

**Files:**
- Create: `runtime/lib/ids.mjs`
- Create: `runtime/domain/records.mjs`
- Create: `tests/runtime-records.test.mjs`

**Interfaces:**
- Produces: `makeId(prefix, { now?, random? } = {}): string`.
- Produces: `assertRecord(type, value): object`.
- Produces allowed types: `workspace`, `project`, `brand`, `source`, `sourceBlock`, `evidence`, `claim`, `content`, `revision`, `job`, `jobStage`, `providerAttempt`, `providerReceipt`, `evaluation`, `contextSnapshot`, `providerConfig`, `signal`, `appliedPageEvent`.

- [x] **Step 1: Write failing contract tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeId } from '../runtime/lib/ids.mjs';
import { assertRecord } from '../runtime/domain/records.mjs';

test('makeId is prefix-scoped and portable', () => {
  const id = makeId('project', { now: () => 123, random: () => 'ABC-DEF' });
  assert.equal(id, 'project_123_abcdef');
  assert.match(id, /^[a-z]+_[a-z0-9_]+$/);
});

test('revision requires contentId and immutable payload', () => {
  assert.throws(() => assertRecord('revision', { revisionId: 'rev_1' }), /contentId/);
  const value = assertRecord('revision', {
    revisionId: 'revision_1', contentId: 'content_1', operation: 'CREATE', payload: { body: 'Hello' }, createdAt: '2026-08-12T00:00:00.000Z'
  });
  assert.equal(value.contentId, 'content_1');
});
```

- [x] **Step 2: Run and verify missing-module failures**

Run: `node --test tests/runtime-records.test.mjs`

- [x] **Step 3: Implement minimal portable IDs**

```js
export function makeId(prefix, { now = Date.now, random = crypto.randomUUID } = {}) {
  const safePrefix = String(prefix).toLowerCase().replace(/[^a-z0-9]+/g, '');
  const suffix = String(random()).toLowerCase().replace(/[^a-z0-9]+/g, '');
  if (!safePrefix || !suffix) throw new Error('ID prefix and random suffix are required.');
  return `${safePrefix}_${Number(now())}_${suffix}`;
}
```

Import `randomUUID` from `node:crypto` instead of relying on a global in production code.

- [x] **Step 4: Implement record validation with explicit required fields**

`assertRecord()` must reject unknown entity types and validate each primary/foreign key listed in `25_LOCAL_DATA_MODEL`. It returns a structured clone and never mutates input.

Example revision branch:

```js
if (type === 'revision') {
  requireString(value, 'revisionId');
  requireString(value, 'contentId');
  requireString(value, 'operation');
  requireObject(value, 'payload');
  requireString(value, 'createdAt');
}
```

- [x] **Step 5: Add tests for every V1 entity key and unknown-type rejection**

Run: `node --test tests/runtime-records.test.mjs`

Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add runtime/lib/ids.mjs runtime/domain/records.mjs tests/runtime-records.test.mjs
git commit -m "feat(runtime): define local record contracts"
```

---

### Task 3: Build atomic local storage with immutable blobs

**Files:**
- Create: `runtime/lib/atomic-json.mjs`
- Create: `runtime/storage/workspace-store.mjs`
- Create: `tests/runtime-store.test.mjs`
- Modify: `.gitignore`

**Interfaces:**
- Produces: `createWorkspaceStore({ rootDir }): WorkspaceStore`.
- `WorkspaceStore.put(type, scopeId, record): Promise<object>`.
- `WorkspaceStore.get(type, scopeId, id): Promise<object|null>`.
- `WorkspaceStore.list(type, scopeId): Promise<object[]>`.
- `WorkspaceStore.putBlob(scopeId, blobId, bytes): Promise<{blobRef,sha256,size}>`.
- `WorkspaceStore.readBlob(blobRef): Promise<Buffer>`.
- Record writes are atomic temp-file -> rename.
- Existing immutable `revision`, `sourceBlock`, `providerReceipt`, `contextSnapshot`, and blobs cannot be overwritten with different content.

- [ ] **Step 1: Write failing atomic-store tests using a temp directory**

Cover create/read/list, path traversal rejection, immutable overwrite rejection, same-content idempotent write, blob digest, and no absolute path returned in `blobRef`.

```js
const store = createWorkspaceStore({ rootDir });
await store.put('project', 'workspace_1', { projectId: 'project_1', workspaceId: 'workspace_1', name: 'A', status: 'active', createdAt: now });
assert.equal((await store.get('project', 'workspace_1', 'project_1')).name, 'A');
assert.deepEqual((await store.list('project', 'workspace_1')).map(x => x.projectId), ['project_1']);
```

- [ ] **Step 2: Run and verify failure**

Run: `node --test tests/runtime-store.test.mjs`

- [ ] **Step 3: Implement `writeJsonAtomic()`**

Use sibling temp files and rename:

```js
export async function writeJsonAtomic(file, value) {
  await mkdir(dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(value, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
  await rename(temp, file);
}
```

On error, unlink the temp file best-effort.

- [ ] **Step 4: Implement portable record/blob layout**

Use:

```text
<root>/workspaces/<workspaceId>/records/<type>/<id>.json
<root>/workspaces/<workspaceId>/blobs/<sha256>.bin
```

`blobRef` is `seosona-local://<workspaceId>/blobs/<sha256>`; callers never receive `<root>`.

- [ ] **Step 5: Enforce traversal and immutable-record rules**

Only IDs matching `/^[a-z][a-z0-9_:-]{1,159}$/` enter storage paths. For immutable types, existing different bytes produce `IMMUTABLE_RECORD_CONFLICT`.

- [ ] **Step 6: Ignore local Runtime data**

Add:

```gitignore
.seosona-content/
.runtime-token
```

- [ ] **Step 7: Run tests and commit**

```bash
node --test tests/runtime-store.test.mjs
git add runtime/lib/atomic-json.mjs runtime/storage/workspace-store.mjs tests/runtime-store.test.mjs .gitignore
git commit -m "feat(runtime): add atomic local workspace store"
```

---

### Task 4: Implement Workspace, Project, Brand, Source, Content and Revision services

**Files:**
- Create: `runtime/domain/workspace-service.mjs`
- Create: `runtime/domain/content-service.mjs`
- Create: `tests/runtime-domain.test.mjs`

**Interfaces:**
- Produces `createWorkspaceService({ store, now, idFactory })` with `createWorkspace`, `createProject`, `createBrand`, `getProject`, `listProjects`.
- Produces `createContentService({ store, now, idFactory })` with `addSource`, `addEvidence`, `addClaim`, `createContent`, `appendRevision`, `getContentHistory`.
- `ContentItem.currentRevisionId` is mutable metadata; `Revision` records are append-only.
- `SourceArtifact` stores an immutable blob ref/hash when raw bytes exist.

- [ ] **Step 1: Write failing domain tests**

Cover: project must reference existing workspace; project brand must be same workspace; source snapshot hash preserved; first content revision created atomically; later revisions point to parent; revision payload cannot be overwritten; project history remains available.

- [ ] **Step 2: Run focused tests and verify failures**

Run: `node --test tests/runtime-domain.test.mjs`

- [ ] **Step 3: Implement workspace/project/brand service**

Return records shaped like:

```js
{
  projectId,
  workspaceId,
  brandId: brandId || null,
  name,
  objective: objective || '',
  status: 'active',
  createdAt
}
```

Reject cross-workspace brand assignment with `SCOPE_MISMATCH`.

- [ ] **Step 4: Implement source persistence**

For raw source bytes, call `putBlob()` first and persist:

```js
{
  sourceId, projectId, kind, title, canonicalUrl: canonicalUrl || null,
  blobRef, sha256, retrievedAt, parserVersion
}
```

Never replace an existing source snapshot; page changes create a new `sourceId`.

- [ ] **Step 5: Implement content + revision append**

`createContent()` creates `ContentItem` plus revision `CREATE`. `appendRevision()` creates a new immutable `Revision`, then updates only `ContentItem.currentRevisionId/status`.

- [ ] **Step 6: Run tests and commit**

```bash
node --test tests/runtime-domain.test.mjs
git add runtime/domain/workspace-service.mjs runtime/domain/content-service.mjs tests/runtime-domain.test.mjs
git commit -m "feat(runtime): persist writing projects and revisions"
```

---

### Task 5: Generalize resumable workflow state from the Facebook reducer

**Files:**
- Create: `runtime/domain/job-state.mjs`
- Create: `tests/runtime-job-state.test.mjs`
- Reference only: `extension/lib/facebook-state.js`

**Interfaces:**
- Produces: `JobState.create({ jobId, projectId, workflowVersion, contentJob, contextSnapshotId, at })`.
- Produces: `JobState.transition(state, event)`.
- Legal events: `JOB_STARTED`, `STAGE_STARTED`, `STAGE_CHECKPOINTED`, `STAGE_COMPLETED`, `STAGE_FAILED`, `PROVIDER_ATTEMPT_STARTED`, `PROVIDER_ATTEMPT_COMPLETED`, `JOB_RESUMED`, `JOB_CANCELLED`, `JOB_COMPLETED`.
- Terminal states: `completed`, `cancelled`.

- [ ] **Step 1: Port the useful reducer invariants into new failing tests**

Test append-only history, illegal rollback, terminal protection, failed-stage resume, cancellation, and persisted checkpoint refs.

- [ ] **Step 2: Verify tests fail because generic reducer is absent**

Run: `node --test tests/runtime-job-state.test.mjs`

- [ ] **Step 3: Implement a pure reducer without Facebook/media concepts**

Example stage start:

```js
case 'STAGE_STARTED': {
  assert(['queued', 'running', 'failed'].includes(next.status), 'Job cannot start a stage from current state.');
  next.status = 'running';
  next.activeStage = { stageId: event.stageId, type: event.stageType, attempt: event.attempt || 1 };
  break;
}
```

`VISUAL_*`, `ASSET_*`, draft count, Facebook IDs, and companion concepts must not exist in this module.

- [ ] **Step 4: Run reducer tests and commit**

```bash
node --test tests/runtime-job-state.test.mjs
git add runtime/domain/job-state.mjs tests/runtime-job-state.test.mjs
git commit -m "feat(runtime): add generic resumable job reducer"
```

---

### Task 6: Freeze immutable ContextSnapshot records

**Files:**
- Create: `runtime/domain/context-snapshot.mjs`
- Modify: `tests/runtime-domain.test.mjs`

**Interfaces:**
- Produces: `createContextSnapshot({ project, brand, audience, sourceRefs, evidenceRefs, jobPack, targetPack, policy, providerPolicy }, deps)`.
- Snapshot includes `contextSnapshotId`, `hash`, source/evidence revision refs, job/target pack versions, and provider policy.
- Mid-job edits create a new snapshot; they never mutate the active snapshot.

- [ ] **Step 1: Write failing deterministic-hash and mutation tests**

The same canonical input must hash identically regardless of object key order; changing a source/evidence/job-pack revision must change the hash.

- [ ] **Step 2: Implement canonicalization + SHA-256**

```js
function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') return Object.keys(value).sort().reduce((o, key) => {
    o[key] = canonicalize(value[key]);
    return o;
  }, {});
  return value;
}
```

Persist snapshots as immutable records through `WorkspaceStore`.

- [ ] **Step 3: Run tests and commit**

```bash
node --test tests/runtime-domain.test.mjs
git add runtime/domain/context-snapshot.mjs tests/runtime-domain.test.mjs
git commit -m "feat(runtime): freeze execution context snapshots"
```

---

### Task 7: Add authenticated loopback server and base REST endpoints

**Files:**
- Create: `runtime/http/auth.mjs`
- Create: `runtime/http/router.mjs`
- Create: `runtime/http/server.mjs`
- Create: `runtime/index.mjs`
- Create: `tests/runtime-server.test.mjs`

**Interfaces:**
- Runtime binds `127.0.0.1` only; default port `43118` during migration.
- Extension auth: `Authorization: Bearer <runtime-token>` + unique `x-seosona-nonce`; exact configured `chrome-extension://<id>` origin only.
- Studio auth: Runtime serves Studio itself; first HTML response sets an `HttpOnly; SameSite=Strict; Path=/` session cookie. API requests with wrong `Origin` are rejected.
- Base endpoints:
  - `GET /v1/health`
  - `GET /v1/projects`
  - `POST /v1/projects`
  - `GET /v1/projects/:projectId`
  - `POST /v1/brands`
  - `POST /v1/projects/:projectId/sources`
  - `POST /v1/projects/:projectId/content`
  - `POST /v1/content/:contentId/revisions`
  - `GET /v1/content/:contentId`

- [ ] **Step 1: Write failing server tests**

Use `server.listen(0, '127.0.0.1')`. Cover loopback host, valid extension token+nonce, invalid token, nonce replay, disallowed origin, Studio session cookie, JSON size limit, unknown endpoint envelope, and create/read project round-trip.

- [ ] **Step 2: Reuse the proven Companion auth shape instead of copying media routes**

Port the generic ideas from `scripts/companion/facebook-companion.mjs:104-157`: bounded JSON body, exact allowlist, bearer token, replay-resistant nonce, stable `{error:{code,message,retryable}}` envelope.

- [ ] **Step 3: Implement tiny router**

```js
router.add('POST', /^\/v1\/projects$/, async ({ body }) => ({ status: 201, body: await workspaceService.createProject(body) }));
router.add('GET', /^\/v1\/content\/([^/]+)$/, async ({ match }) => ({ status: 200, body: await contentService.getContentHistory(match[1]) }));
```

Do not put domain logic in `server.mjs`.

- [ ] **Step 4: Implement Runtime entrypoint**

`runtime/index.mjs` reads:

```text
SEOSONA_CONTENT_RUNTIME_ROOT   default: ./.seosona-content
SEOSONA_CONTENT_RUNTIME_PORT   default: 43118
SEOSONA_CONTENT_EXTENSION_ID   required for extension bridge
SEOSONA_CONTENT_RUNTIME_TOKEN  required, minimum 32 characters
```

Bind only `127.0.0.1`, print one startup line to stderr, and close cleanly on SIGINT/SIGTERM.

- [ ] **Step 5: Run focused/full tests**

```bash
node --test tests/runtime-server.test.mjs
npm test
```

- [ ] **Step 6: Commit**

```bash
git add runtime/http runtime/index.mjs tests/runtime-server.test.mjs
git commit -m "feat(runtime): expose authenticated local content API"
```

---

### Task 8: Runtime slice acceptance and documentation

**Files:**
- Create: `runtime/README.md`
- Modify: `README.md`

**Interfaces:**
- Produces documented start command and data ownership/security boundary.
- Does not claim browser/API provider execution exists yet; that is the next plan.

- [ ] **Step 1: Add a runtime acceptance test**

Create one project, brand, source blob, content item, second revision, claim, evidence and context snapshot through domain services; restart the store/server against the same temp root; verify IDs, revision history and hashes survive.

- [ ] **Step 2: Run `npm run runtime:verify` and `npm test`**

Expected: all new and legacy tests PASS.

- [ ] **Step 3: Document the exact boundary**

`runtime/README.md` must state:

```text
Canonical state is local.
Studio and Extension are clients.
Raw source snapshots and revisions are immutable.
Secrets are references only and are implemented in the Provider plan.
No cloud sync or publishing is part of Runtime V1.
```

- [ ] **Step 4: Commit**

```bash
git add runtime/README.md README.md tests/runtime-domain.test.mjs
git commit -m "docs(runtime): document local source of truth"
```

---

## Plan self-review checklist

- Spec coverage: Local source of truth, shared state, immutable revisions/sources, context snapshots, resumable jobs, loopback auth, no plaintext secrets, exportable domain boundary are covered.
- Deliberately deferred to separate plans: provider execution/router, Writing Core/Job Packs, Studio UI, contextual Extension actions.
- Placeholder scan: no implementation step depends on an unspecified function/type.
- Type consistency: `workspaceId`, `projectId`, `brandId`, `sourceId`, `contentId`, `revisionId`, `jobId`, `contextSnapshotId` are used consistently across tasks.
