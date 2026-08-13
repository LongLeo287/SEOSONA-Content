# Writing Core and V1 Job Packs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the shared Writing Intelligence Core and prove it with three different V1 Content Job Packs: Blog/Article, Product Content, and Transcript/SRT.

**Architecture:** Writing Core composes versioned context, evidence, claims, brief, structure, provider execution, editing, independent evaluation, target adaptation, and revision persistence. Job Packs define schema, structure, specialized rules, evaluators, and definition of done; they do not fork the provider/runtime stack. Existing knowledge blocks and prompt assets are migration inputs, but prompts are composed from structured packs rather than one monolithic prompt.

**Tech Stack:** Node.js ESM Runtime, existing browser-safe SRT parser logic migrated into Runtime modules, `node:test`, Provider Gateway from the provider plan, Local Runtime persistence from the runtime plan. No agent framework or new model SDK in this slice.

## Global Constraints

- Product scope is writing/content only.
- Canonical loop is Research -> Brief -> Write -> Edit -> Audit -> Optimize -> Repurpose -> Learn.
- Writer and Auditor are separate stages and may use different providers.
- Source text is untrusted data, never executable instruction.
- Material claims must remain traceable to evidence and preserve claim strength through editing.
- Unsupported claims must never receive fabricated evidence or invented certainty.
- Product facts/specifications are authoritative; benefits and commercial claims require support.
- Transcript/SRT raw text and exact source timecodes are authoritative for transcript-derived cuts.
- Raw transcript must never be silently corrected in authoritative fields.
- Content Job Packs must be addable without changing Provider Gateway or Local Runtime contracts.
- Provider choice must remain outside Blog/Product/Transcript domain logic.
- V1 includes Blog/Article, Product Content, Transcript/SRT; Social/Email/Landing/Ads/Script remain contract-ready but not required for release.
- Every behavior change follows red -> green -> refactor and ends with a focused commit.

---

## File map

**Create**
- `runtime/writing/contracts.mjs` — shared Writing IR validators and enums.
- `runtime/writing/context-builder.mjs` — structured ContextBundle assembly.
- `runtime/writing/research.mjs` — source/evidence research packet composition.
- `runtime/writing/evidence.mjs` — evidence classification and support resolution.
- `runtime/writing/claims.mjs` — claim extraction/status/strength comparison.
- `runtime/writing/brief.mjs` — BriefIR builder.
- `runtime/writing/structure.mjs` — pack-driven structure planning.
- `runtime/writing/prompt-composer.mjs` — structured provider prompt composition.
- `runtime/writing/writer.mjs` — provider-neutral draft execution.
- `runtime/writing/editor.mjs` — fact-preserving edit operations.
- `runtime/writing/evaluator.mjs` — independent evaluator execution and deterministic checks.
- `runtime/writing/repurpose.mjs` — lineage-preserving content transformation.
- `runtime/writing/target-adapter.mjs` — text/output-contract adaptation only.
- `runtime/writing/job-packs/registry.mjs`
- `runtime/writing/job-packs/article.mjs`
- `runtime/writing/job-packs/product.mjs`
- `runtime/writing/job-packs/transcript.mjs`
- `runtime/writing/transcript/srt.mjs`
- `runtime/workflows/write-edit-audit.mjs`
- `tests/writing-contracts.test.mjs`
- `tests/writing-evidence-claims.test.mjs`
- `tests/writing-context-prompt.test.mjs`
- `tests/writing-edit-audit.test.mjs`
- `tests/job-pack-article.test.mjs`
- `tests/job-pack-product.test.mjs`
- `tests/job-pack-transcript.test.mjs`
- `tests/writing-workflow.test.mjs`
- `tests/fixtures/transcript-exact.srt`

**Modify**
- `runtime/domain/content-service.mjs` — persist claim/evaluation/lineage records exposed by Writing Core.
- `runtime/http/server.mjs` — mount writing endpoints after workflow is stable.
- `runtime/providers/gateway.mjs` — consumed as an interface only; no job-specific branching added.
- `extension/lib/srt-parser.js` — keep legacy API; only bug fixes shared back after Runtime SRT tests prove parity.
- `package.json` — add writing-focused verification script.
- `README.md` — describe the three V1 packs after acceptance.

**Reference/migrate, do not delete in early tasks**
- `extension/lib/knowledge.js`
- `extension/lib/prompts-content.js`
- `extension/lib/prompts-flows.js`
- `extension/lib/prompts-longform.js`
- `extension/lib/prompts-repurpose.js`
- `extension/lib/prompts-research.js`
- `knowledge-src/15-factCheck.md`
- `knowledge-src/16-claimStrength.md`
- `knowledge-src/17-editingRules.md`
- `knowledge-src/18-concision.md`
- `knowledge-src/19-seoOnPage.md`
- `knowledge-src/20-geoAiSearch.md`
- `knowledge-src/22-deslop.md`
- `knowledge-src/23-audienceResearch.md`
- `knowledge-src/24-contentStrategy.md`
- `knowledge-src/25-auditRubric.md`

---

### Task 1: Define shared Writing IR contracts

**Files:**
- Create: `runtime/writing/contracts.mjs`
- Create: `tests/writing-contracts.test.mjs`

**Interfaces:**
- `assertSourceArtifact(value)`
- `assertEvidenceIR(value)`
- `assertClaim(value)`
- `assertAudienceContext(value)`
- `assertBrandContext(value)`
- `assertBriefIR(value)`
- `assertContentIR(value)`
- `assertEvaluationResult(value)`
- `assertRevisionPayload(value)`
- `CLAIM_STATUSES = ['SUPPORTED','PARTIALLY_SUPPORTED','UNSUPPORTED','CONTRADICTED','NEEDS_REVIEW']`
- `EVIDENCE_TYPES = ['FACT','CLAIM','QUOTE','STATISTIC','OPINION','INFERENCE']`

- [x] **Step 1: Write failing IR contract tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { assertClaim, assertContentIR } from '../runtime/writing/contracts.mjs';

test('claim requires proposition, strength, status and evidence refs', () => {
  assert.throws(() => assertClaim({ claimId: 'claim_1' }), /proposition/);
  const claim = assertClaim({
    claimId: 'claim_1',
    proposition: 'The product weighs 1 kg.',
    type: 'FACT',
    strength: 'EXACT',
    status: 'SUPPORTED',
    evidenceRefs: ['evidence_1'],
    confidence: 1
  });
  assert.equal(claim.status, 'SUPPORTED');
});

test('ContentIR is semantic content, not provider output metadata', () => {
  assert.throws(() => assertContentIR({ contentId: 'content_1', jobType: 'article', providerId: 'chatgpt-web' }), /provider/i);
});
```

- [x] **Step 2: Run and verify missing-module failures**

Run: `node --test tests/writing-contracts.test.mjs`

- [x] **Step 3: Implement strict validators and structured-clone return values**

`ContentIR` fields are limited to semantic writing data such as `contentId`, `jobType`, `language`, `fields`, `sourceRefs`, `claimRefs`, `targetRef`, and `metadata`. Provider/session fields belong in `ProviderReceipt`.

- [x] **Step 4: Add specialized-extension validation hooks**

Expose:

```js
export function assertSpecializedContent(base, specializedValidator) {
  const content = assertContentIR(base);
  return specializedValidator(content);
}
```

Do not introduce a single giant union containing every future field.

- [x] **Step 5: Run and commit**

```bash
node --test tests/writing-contracts.test.mjs
git add runtime/writing/contracts.mjs tests/writing-contracts.test.mjs
git commit -m "feat(writing): define shared writing contracts"
```

---

### Task 2: Classify evidence and resolve claim support deterministically

**Files:**
- Create: `runtime/writing/evidence.mjs`
- Create: `runtime/writing/claims.mjs`
- Create: `tests/writing-evidence-claims.test.mjs`

**Interfaces:**
- `classifyEvidenceCandidate(candidate): EvidenceIR`
- `resolveClaimSupport(claim, evidenceById): { status, supportingEvidenceRefs, reasons }`
- `compareClaimStrength(before, after): { changed, direction, reason }`
- `assertClaimStrengthPreserved(beforeClaims, afterClaims, evidenceById): { ok, issues }`

- [x] **Step 1: Write failing tests for evidence classes**

Cover exact statistic, verbatim quote, factual statement, source claim, opinion, and inference. Classification input must retain source locator and source ID.

- [x] **Step 2: Write failing support-status tests**

Required cases:

```text
same proposition + authoritative evidence -> SUPPORTED
partial numeric/text match -> PARTIALLY_SUPPORTED
no evidence -> UNSUPPORTED
evidence contradicts proposition -> CONTRADICTED
ambiguous source/locator -> NEEDS_REVIEW
```

- [x] **Step 3: Implement deterministic support resolver first**

The resolver does not call a model. It operates on already-normalized claim/evidence relations and explicit comparison metadata.

Example:

```js
if (!claim.evidenceRefs?.length) return { status: 'UNSUPPORTED', supportingEvidenceRefs: [], reasons: ['NO_EVIDENCE'] };
if (claim.evidenceRefs.some(id => evidenceById[id]?.relation === 'CONTRADICTS')) return { status: 'CONTRADICTED', supportingEvidenceRefs: [], reasons: ['CONTRADICTING_EVIDENCE'] };
```

- [x] **Step 4: Implement claim-strength preservation**

Use an ordered vocabulary:

```js
const STRENGTH = ['QUALIFIED','LIKELY','DIRECT','EXACT','ABSOLUTE'];
```

An edit that increases strength without newly supporting evidence yields issue `CLAIM_STRENGTH_INCREASE_UNSUPPORTED`.

- [x] **Step 5: Run and commit**

```bash
node --test tests/writing-evidence-claims.test.mjs
git add runtime/writing/evidence.mjs runtime/writing/claims.mjs tests/writing-evidence-claims.test.mjs
git commit -m "feat(writing): protect evidence and claim strength"
```

---

### Task 3: Build structured context instead of a giant prompt

**Files:**
- Create: `runtime/writing/context-builder.mjs`
- Create: `runtime/writing/prompt-composer.mjs`
- Create: `tests/writing-context-prompt.test.mjs`

**Interfaces:**
- `buildContextBundle({ corePack, jobPack, brandContext, audienceContext, brief, evidence, targetPack, userInstruction })`
- `composeProviderInput(bundle, operation): { system, sections, outputContract, promptDigest }`
- Section order is stable: `CORE_RULES`, `JOB_RULES`, `BRAND`, `AUDIENCE`, `BRIEF`, `EVIDENCE`, `TARGET`, `USER_TASK`, `OUTPUT_CONTRACT`.

- [x] **Step 1: Write failing composition tests**

Prove each pack remains a separately addressable/versioned section, source content appears only under `EVIDENCE`/source sections, and source text containing “ignore previous instructions” remains quoted/marked as untrusted data rather than entering `CORE_RULES`.

- [x] **Step 2: Implement ContextBundle with explicit revision fields**

```js
{
  corePack: { id, version, rules },
  jobPack: { id, version, rules, outputContract },
  brand: { revision, ... },
  audience: { revision, ... },
  brief: { revision, ... },
  evidence: [{ evidenceId, sourceId, locator, type, text }],
  target: { id, revision, rules },
  userInstruction
}
```

- [x] **Step 3: Implement prompt composer with stable serialization**

Each section is delimited and source/evidence strings are escaped/serialized as data. `promptDigest` is SHA-256 of the canonical composed input; the complete prompt is not required in `ProviderReceipt`.

- [x] **Step 4: Migrate only reusable knowledge rules into structured pack inputs**

Create a test fixture mapping the current knowledge blocks to Core/Job/Audit categories. Do not concatenate all of `knowledge.js` blindly. The initial Core Pack should reference exact writing rules needed by V1: fact check, claim strength, editing rules, concision, deslop, audience research, content strategy, audit rubric.

- [x] **Step 5: Run and commit**

```bash
node --test tests/writing-context-prompt.test.mjs
git add runtime/writing/context-builder.mjs runtime/writing/prompt-composer.mjs tests/writing-context-prompt.test.mjs
git commit -m "feat(writing): compose structured writing context"
```

---

### Task 4: Implement Content Job Pack registry and common interface

**Files:**
- Create: `runtime/writing/job-packs/registry.mjs`
- Modify: `tests/writing-contracts.test.mjs`

**Interfaces:**

Every pack implements:

```js
{
  id,
  version,
  jobType,
  requiredBriefFields,
  outputContract,
  structureRules,
  requiredEvaluators,
  buildBrief(input),
  validateDraft(contentIR, context),
  definitionOfDone(contentIR, evaluations)
}
```

Registry API:

```js
registerJobPack(pack)
getJobPack(jobType)
listJobPacks()
```

- [x] **Step 1: Write failing registry tests**

Reject duplicate IDs/versions, missing output contract, missing evaluators, unknown job type, and provider-specific fields in a pack.

- [x] **Step 2: Implement registry and pack validator**

Pack code may declare capability requirements (`long-context`, `structured-output`) but must not name a provider vendor.

- [x] **Step 3: Run and commit**

```bash
node --test tests/writing-contracts.test.mjs
git add runtime/writing/job-packs/registry.mjs tests/writing-contracts.test.mjs
git commit -m "feat(writing): add content job pack registry"
```

---

### Task 5: Implement Blog/Article Job Pack

**Files:**
- Create: `runtime/writing/job-packs/article.mjs`
- Create: `runtime/writing/research.mjs`
- Create: `runtime/writing/brief.mjs`
- Create: `runtime/writing/structure.mjs`
- Create: `tests/job-pack-article.test.mjs`

**Interfaces:**
- `ArticleIR.fields = { title, slug?, metaTitle?, metaDescription?, outline, sections, body }`
- Brief requires: `objective`, `audience`, `intent`, `angle`, `language`, `evidencePolicy`.
- Required evaluators: `factuality`, `claim-support`, `structure`, `brand`, `audience`, `readability`; `seo` and `geo` enabled when target/brief requests them.

- [x] **Step 1: Write failing ArticleIR and brief tests**

Test required title/body/outline, heading hierarchy, unsupported citation reference, stale-evidence warning, and SEO fields remaining optional unless target requires them.

- [x] **Step 2: Implement article brief builder**

```js
buildBrief(input) {
  return {
    objective: requireText(input.objective),
    audience: input.audience,
    intent: requireText(input.intent),
    angle: requireText(input.angle),
    language: input.language || 'vi-VN',
    evidencePolicy: input.evidencePolicy || 'SOURCE_BACKED'
  };
}
```

- [x] **Step 3: Implement structure planner from pack rules**

The generic `structure.mjs` accepts pack rules; Article pack supplies heading hierarchy and required section rules. Do not bake article headings into generic Core.

- [x] **Step 4: Implement deterministic article validation**

Validate schema, evidence refs, required headings, duplicated headings, empty sections, and target field constraints before model-based evaluation.

- [x] **Step 5: Run and commit**

```bash
node --test tests/job-pack-article.test.mjs
git add runtime/writing/job-packs/article.mjs runtime/writing/research.mjs runtime/writing/brief.mjs runtime/writing/structure.mjs tests/job-pack-article.test.mjs
git commit -m "feat(writing): add article job pack"
```

---

### Task 6: Implement Product Content Job Pack with fact fidelity

**Files:**
- Create: `runtime/writing/job-packs/product.mjs`
- Create: `tests/job-pack-product.test.mjs`

**Interfaces:**
- `ProductContentIR.fields = { title, shortDescription?, longDescription, features, benefits, specs, faq?, metaTitle?, metaDescription? }`
- Product source-of-truth facts are explicit `ProductFact[] = { factId, name, value, unit?, sourceRef, locator }`.
- `validateProductClaims(content, productFacts, evidence): { ok, issues }`.

- [x] **Step 1: Write failing product-fidelity tests**

Required cases:

```text
exact feature copied from ProductFact -> pass
numeric spec changed -> block NUMERIC_FACT_MISMATCH
feature transformed into unsupported benefit -> block UNSUPPORTED_BENEFIT
supported benefit with evidence -> pass
price/availability/offer absent from source -> block INVENTED_COMMERCIAL_FACT
FAQ answer introduces unsupported claim -> block
```

- [x] **Step 2: Implement ProductContentIR validator**

`specs[]` retain source refs/units. Normalization may change presentation (`1 kg` vs `1000 g`) only if a tested deterministic unit conversion explicitly supports it; otherwise exact source value is required in V1.

- [x] **Step 3: Implement claim/fact gate**

Every feature/spec claim maps to a ProductFact or Evidence record. `benefits[]` require explicit support relation; absence of support is not auto-repaired by inventing evidence.

- [x] **Step 4: Run and commit**

```bash
node --test tests/job-pack-product.test.mjs tests/writing-evidence-claims.test.mjs
git add runtime/writing/job-packs/product.mjs tests/job-pack-product.test.mjs
git commit -m "feat(writing): add source faithful product content pack"
```

---

### Task 7: Port SRT parsing into Runtime and lock exact transcript invariants

**Files:**
- Create: `runtime/writing/transcript/srt.mjs`
- Create: `tests/job-pack-transcript.test.mjs`
- Create: `tests/fixtures/transcript-exact.srt`
- Reference: `extension/lib/srt-parser.js`

**Interfaces:**
- `parseSrt(raw): CueIR[]`
- `serializeSrt(cues): string`
- `timeToMs(value): number|null`
- `msToTime(ms): string`
- `validateTranscriptSelection({ cues, selections }): { ok, issues }`
- CueIR: `{ cueId, index, startMs, endMs, rawText }`.

- [x] **Step 1: Create an exact regression fixture**

The fixture must include Vietnamese diacritics, punctuation, a deliberate spelling/jargon error, multiline cue, comma/dot millisecond forms, and adjacent cues.

- [x] **Step 2: Write failing parse/serialize invariance tests**

```js
const cues = parseSrt(raw);
assert.equal(cues[0].rawText, '...exact fixture text...');
assert.equal(cues[0].startMs, expectedStart);
assert.equal(cues[0].endMs, expectedEnd);
```

Test that authoritative `rawText` is never spell-corrected or normalized in returned CueIR.

- [x] **Step 3: Port the pure parser logic into ESM**

Preserve the legacy parser behavior where correct, but expose `rawText` instead of generic `text` in Runtime contracts. Keep normalization helpers separate and never use normalization as authoritative output.

- [x] **Step 4: Add selection validation**

A cut selection must reference exact cue IDs/start/end and exact raw transcript text. Non-linear ordering is allowed, but invented/merged timestamps or modified raw text yield `TRANSCRIPT_SOURCE_MISMATCH`.

- [x] **Step 5: Run parity tests against the legacy parser on compatible fixtures**

Import legacy `srt-parser.js` through a VM/browser-safe harness only if needed; otherwise compare expected cue arrays generated from the same fixture. Do not modify the legacy parser until Runtime parity is green.

- [x] **Step 6: Commit**

```bash
node --test tests/job-pack-transcript.test.mjs
git add runtime/writing/transcript/srt.mjs tests/job-pack-transcript.test.mjs tests/fixtures/transcript-exact.srt
git commit -m "feat(writing): preserve exact srt transcript sources"
```

---

### Task 8: Implement Transcript/SRT Job Pack

**Files:**
- Create: `runtime/writing/job-packs/transcript.mjs`
- Modify: `tests/job-pack-transcript.test.mjs`

**Interfaces:**
- `TranscriptIR = { sourceId, cues, durationMs, language?, metadata? }`
- Supported V1 operations: `HIGHLIGHTS`, `SHORT_CUT`, `CLEAN_TRANSCRIPT`, `QUOTES`, `CHAPTERS`, `REPURPOSE_ARTICLE`.
- `SHORT_CUT` output contains `selections[] = { cueIds, sourceStartMs, sourceEndMs, rawTranscript, editorOverlay? }`.

- [x] **Step 1: Write failing operation-schema tests**

`SHORT_CUT` must reject freeform timecodes. `CLEAN_TRANSCRIPT` may produce corrected display text but must retain source cue references. `QUOTES` must retain exact quote text unless explicitly marked `paraphrase`.

- [x] **Step 2: Implement pack output contracts**

Do not make every transcript operation share one oversized schema; define operation-specific field validators under the Transcript pack.

- [x] **Step 3: Implement final source validation gate**

Before persisting an approved transcript-derived cut, resolve every `cueId` back to `TranscriptIR`, reconstruct `rawTranscript`, and compare exact start/end. Any mismatch blocks completion.

- [x] **Step 4: Run and commit**

```bash
node --test tests/job-pack-transcript.test.mjs
git add runtime/writing/job-packs/transcript.mjs tests/job-pack-transcript.test.mjs
git commit -m "feat(writing): add transcript intelligence job pack"
```

---

### Task 9: Implement provider-neutral Writer and fact-preserving Editor

**Files:**
- Create: `runtime/writing/writer.mjs`
- Create: `runtime/writing/editor.mjs`
- Create: `tests/writing-edit-audit.test.mjs`

**Interfaces:**
- `createWriter({ gateway, packRegistry, contentService, contextBuilder, promptComposer })`.
- `writer.write({ projectId, jobType, brief, contextSnapshotId, providerPolicy }): Promise<{content, revision, providerResult}>`.
- `editor.edit({ contentId, revisionId, operation, instruction?, providerPolicy }): Promise<{revision, issues, providerResult}>`.
- Edit operations: `REWRITE`, `SHORTEN`, `EXPAND`, `SIMPLIFY`, `PROFESSIONALIZE`, `CLARIFY`, `DESLOP`, `FIX_REPETITION`, `IMPROVE_TRANSITIONS`, `IMPROVE_HOOK`, `IMPROVE_CTA`, `FIX_TERMINOLOGY`.

- [ ] **Step 1: Write failing writer tests using a fake Provider Gateway**

Prove Article and Product packs send the same ProviderTask shape with different `contentJob/outputContract`; switching fake provider IDs requires no Writer code branch.

- [ ] **Step 2: Implement Writer orchestration**

Flow:

```text
get job pack -> build/validate brief -> build context -> compose input -> gateway.execute -> parse output against pack contract -> deterministic pack validation -> persist ContentItem/Revision/Claims
```

Invalid provider output is not persisted as approved content; store failed attempt/receipt through Gateway only.

- [ ] **Step 3: Write failing edit claim-strength tests**

A rewrite that turns “may help” into “guarantees” without new evidence must be blocked or returned with `NEEDS_REVIEW`; exact product numbers and transcript raw fields cannot be changed by generic edit operations.

- [ ] **Step 4: Implement Editor with pre/post claim comparison**

For immutable authoritative fields (`ProductFact`, Transcript `rawText/timecodes`), the provider receives them as constraints but Editor also restores/blocks changes deterministically after output parsing.

- [ ] **Step 5: Run and commit**

```bash
node --test tests/writing-edit-audit.test.mjs tests/job-pack-product.test.mjs tests/job-pack-transcript.test.mjs
git add runtime/writing/writer.mjs runtime/writing/editor.mjs tests/writing-edit-audit.test.mjs
git commit -m "feat(writing): add provider neutral writer and editor"
```

---

### Task 10: Implement independent Evaluation/Audit engine

**Files:**
- Create: `runtime/writing/evaluator.mjs`
- Modify: `tests/writing-edit-audit.test.mjs`

**Interfaces:**
- `createEvaluator({ gateway, packRegistry, contentService, deterministicEvaluators })`.
- `evaluate({ contentId, revisionId, evaluatorSet, providerPolicy }): Promise<EvaluationResult[]>`.
- Deterministic evaluators execute before model evaluators.
- Required dimensions available: `factuality`, `claim-support`, `claim-strength`, `brand`, `audience`, `structure`, `readability`, `concision`, `deslop`, `redundancy`, `cta`, `seo`, `geo`, `target-fit`, `job-specific`.

- [ ] **Step 1: Write failing independence tests**

Prove writer provider may be `chatgpt-web` while auditor provider is `api-v1`; evaluator receives the persisted revision and frozen context, not the Writer's private chain/state.

- [ ] **Step 2: Implement deterministic evaluator registry**

At minimum V1 deterministic checks include schema, unsupported claims, product fact fidelity, transcript exactness, required fields, duplicate headings/sections, and target hard constraints.

- [ ] **Step 3: Implement model evaluator execution**

Create an `AUDIT` ProviderTask with an evaluation output contract. Persist each result as immutable `EvaluationResult`; do not mutate the revision being scored.

- [ ] **Step 4: Define repair actions explicitly**

Findings may return `repairAction` values such as `REWRITE_SECTION`, `QUALIFY_CLAIM`, `ADD_EVIDENCE`, `RESTORE_SOURCE_FACT`, `HUMAN_REVIEW`; evaluator does not silently edit content.

- [ ] **Step 5: Run and commit**

```bash
node --test tests/writing-edit-audit.test.mjs
git add runtime/writing/evaluator.mjs tests/writing-edit-audit.test.mjs
git commit -m "feat(writing): add independent content audit engine"
```

---

### Task 11: Implement text-only Target Adaptation and Repurpose lineage

**Files:**
- Create: `runtime/writing/target-adapter.mjs`
- Create: `runtime/writing/repurpose.mjs`
- Modify: `tests/writing-workflow.test.mjs`

**Interfaces:**
- `adaptToTarget({ content, targetSpec }): { content, issues }`.
- TargetSpec fields: `destinationType`, `surface`, `outputFormat`, `fieldSet`, `lengthRules`, `formatRules`, `discoveryRules`, `linkRules`, `ctaRules`, `locale`, `revision`.
- `repurpose({ fromContentId, fromRevisionId, toJobType, briefOverrides, providerPolicy })` creates a new ContentItem and `ContentLineage` edge.

- [ ] **Step 1: Write failing target tests**

Hard text limit can block/shorten only through an explicit edit; a recommendation yields WARN, not BLOCK. No media generation/publishing field appears in the output.

- [ ] **Step 2: Implement target validator/adaptor**

Deterministic transformations may normalize formatting/field serialization. Semantic shortening/rewrite goes through Editor so claim preservation checks remain active.

- [ ] **Step 3: Write failing repurpose lineage test**

Article -> Transcript is invalid without transcript source; Transcript -> Article is valid and retains source/content lineage. Product -> Social contract may be registry-ready but not required in V1.

- [ ] **Step 4: Implement lineage persistence**

New content gets a new `contentId`; never overwrite the source artifact.

- [ ] **Step 5: Run and commit**

```bash
node --test tests/writing-workflow.test.mjs
git add runtime/writing/target-adapter.mjs runtime/writing/repurpose.mjs tests/writing-workflow.test.mjs
git commit -m "feat(writing): adapt and repurpose content with lineage"
```

---

### Task 12: Assemble Write -> Edit -> Audit workflow with resumable stages

**Files:**
- Create: `runtime/workflows/write-edit-audit.mjs`
- Create: `tests/writing-workflow.test.mjs`
- Modify: `runtime/domain/job-state.mjs`

**Interfaces:**
- `createWriteEditAuditWorkflow({ jobState, writer, editor, evaluator, contentService })`.
- Stage types: `BRIEF`, `WRITE`, `DETERMINISTIC_VALIDATE`, `AUDIT`, `REPAIR_OPTIONAL`, `TARGET_ADAPT`, `COMPLETE`.
- Workflow checkpoints include `contentId`, `revisionId`, `evaluationIds`, and provider attempt refs; no prompt bodies in job state.

- [ ] **Step 1: Write failing happy-path workflow test**

Use fake Gateway providers and a temp store. Assert project -> article content -> immutable revision -> independent audit -> completed job.

- [ ] **Step 2: Write failing recovery tests**

Cover provider timeout then fallback, invalid draft output, audit `REVIEW_REQUIRED`, cancellation, restart from persisted checkpoint, and manual provider lock on the Audit stage.

- [ ] **Step 3: Implement workflow around generic JobState**

No Facebook draft/visual statuses are permitted. Each completed stage persists a checkpoint before moving on.

- [ ] **Step 4: Prove the same workflow runs all three V1 packs**

Run one Article, one Product, and one Transcript operation using fake provider adapters. Only the pack/schema/evaluators differ.

- [ ] **Step 5: Run and commit**

```bash
node --test tests/writing-workflow.test.mjs
git add runtime/workflows/write-edit-audit.mjs runtime/domain/job-state.mjs tests/writing-workflow.test.mjs
git commit -m "feat(writing): orchestrate resumable write edit audit flow"
```

---

### Task 13: Expose Writing Runtime endpoints

**Files:**
- Modify: `runtime/http/server.mjs`
- Create: `tests/writing-server.test.mjs`

**Interfaces:**
- `GET /v1/job-packs`
- `POST /v1/projects/:projectId/briefs`
- `POST /v1/projects/:projectId/write`
- `POST /v1/content/:contentId/edit`
- `POST /v1/content/:contentId/audit`
- `POST /v1/content/:contentId/repurpose`
- `POST /v1/projects/:projectId/transcripts`
- `GET /v1/jobs/:jobId`
- `POST /v1/jobs/:jobId/resume`
- `POST /v1/jobs/:jobId/cancel`

- [ ] **Step 1: Write failing authenticated HTTP tests with fake Gateway**

Cover creation, invalid job type, invalid revision, provider blocked, audit result retrieval, transcript source mismatch, and job resume.

- [ ] **Step 2: Mount thin handlers only**

HTTP handlers validate request shape, call domain/workflow service, map typed errors to status codes, and return IDs/results. Do not compose prompts or evaluate claims inside route code.

- [ ] **Step 3: Run and commit**

```bash
node --test tests/writing-server.test.mjs
git add runtime/http/server.mjs tests/writing-server.test.mjs
git commit -m "feat(writing): expose writing workflow api"
```

---

### Task 14: V1 Writing Core golden acceptance

**Files:**
- Create: `tests/fixtures/article-golden.json`
- Create: `tests/fixtures/product-golden.json`
- Create: `tests/fixtures/transcript-golden.json`
- Modify: `package.json`
- Modify: `README.md`

**Interfaces:**
- Produces `npm run writing:verify`.
- Golden fixtures are source/evidence/input/output expectations, not provider snapshots that depend on a live vendor response.

- [ ] **Step 1: Create three deterministic golden cases**

Article: evidence-backed Vietnamese article with heading/SEO checks.

Product: catalog facts with one tempting unsupported benefit that must be blocked.

Transcript: exact SRT selection with non-linear cues and immutable raw text/timecodes.

- [ ] **Step 2: Add `writing:verify`**

```json
"writing:verify": "node --test tests/writing-*.test.mjs tests/job-pack-*.test.mjs"
```

- [ ] **Step 3: Run provider-neutrality acceptance**

Against fake adapters, execute the same Article job once through `browser-fake` and once through `api-fake`; compare normalized ContentIR schema and assert Writer/Article pack code paths contain no provider branch.

- [ ] **Step 4: Run all regression suites**

```bash
npm run writing:verify
npm run providers:verify
npm run runtime:verify
npm test
```

Expected: all legacy and new tests PASS.

- [ ] **Step 5: Document V1 pack boundaries and commit**

```bash
git add tests/fixtures package.json README.md
git commit -m "docs(writing): verify three v1 content job packs"
```

---

## Plan self-review checklist

- Spec coverage: shared Writing Core, structured packs, evidence classification, claim status/strength, Article/Product/Transcript specialized IRs, Writer/Editor/Auditor separation, target adaptation, repurpose lineage, exact SRT guardrails, three V1 packs, and provider neutrality are covered.
- Deferred to surfaces plan: Web Studio UI, Extension contextual capture/replace, user accept/reject UX, provider settings UI.
- Placeholder scan: every V1 pack has an explicit schema/interface/test set; no future job type is required to implement V1.
- Type consistency: `ContentIR`, `EvidenceIR`, `Claim`, `BriefIR`, `EvaluationResult`, `ContextSnapshot`, `ProviderTask`, `ProviderResult`, `ContentItem`, `Revision`, and `ContentLineage` match the Runtime/Provider plans.
