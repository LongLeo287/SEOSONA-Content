# SEOSONA Content — Writing Intelligence Local-First Hybrid Design

**Date:** 2026-08-12  
**Status:** Design approved in brainstorming; pending written-spec review before implementation planning  
**Repository:** `LongLeo287/SEOSONA-Content`

## 1. Product definition

SEOSONA Content is a **Writing Intelligence System** for researching, planning, writing, editing, auditing, optimizing, repurposing, and learning from written content.

The product is deliberately narrower than a universal marketing/media operating system. It does **not** own video rendering, image generation pipelines, ad account management, CRM, CMS hosting, or full social publishing infrastructure. It may write content intended for those systems.

Canonical product loop:

```text
Research -> Brief -> Write -> Edit -> Audit -> Optimize -> Repurpose -> Learn
```

SRT/transcript support remains in scope because transcript is a textual source and a writing/editing substrate. SEOSONA may identify exact transcript segments for short-form cuts and export timecode-aware artifacts, but it is not a general-purpose NLE or video-generation system.

## 2. Approved architectural decisions

1. **Scope:** writing/content only.
2. **Primary UX:** Web Studio and Browser Extension are equal first-class surfaces.
3. **Data model:** local-first; the user's machine is the source of truth.
4. **Web Studio:** local web application served from localhost.
5. **Extension:** contextual writing copilot plus browser-AI provider adapter.
6. **Provider architecture:** provider-neutral. Browser automation, API providers, and later local models all implement the same provider contract.
7. **Auto-routing priorities, in order:**
   1. highest expected output quality;
   2. zero incremental cost to SEOSONA/user workflow;
   3. operational stability;
   4. latency/speed.
8. **FREE semantics:** an already-available browser AI session/subscription is treated as zero incremental SEOSONA cost. A local model is also zero incremental provider cost. An API is zero-cost only when its current configured account/quota makes the specific request non-billable. Paid API execution requires explicit user permission or an explicit budget policy.
9. **Manual override:** users can lock a workflow/stage/provider and override Auto Router decisions.
10. **Writer and Auditor are separate concerns:** generation must not be treated as self-validation.

## 3. Product surfaces

### 3.1 Local Web Studio

The Local Web Studio is the deep-work workspace for:

- projects and campaigns;
- Brand Brain management;
- source/evidence management;
- research and briefing;
- long-form drafting;
- revision history;
- claim/evidence review;
- audits and repair loops;
- repurposing;
- transcript/SRT work;
- provider configuration and routing receipts.

It is served locally, for example through `http://127.0.0.1:<port>`, and talks only to the Local Content Runtime through authenticated loopback interfaces.

### 3.2 Browser Extension

The extension has two explicit responsibilities.

**Responsibility A — Contextual Copilot**

While the user is in a CMS, product page, web editor, blog, research page, or other browser surface, the extension can:

- capture selected text or page context with user intent/permission;
- send that context to an existing local project;
- audit selected text;
- rewrite, shorten, expand, clarify, de-slop, or adapt brand voice;
- fact/claim check against project evidence;
- create a new content item from page context;
- repurpose a page or selected content;
- insert an approved result back into a supported editor.

**Responsibility B — Browser AI Provider Adapter**

The extension may automate logged-in AI web applications such as supported ChatGPT, Gemini, Claude, or Grok web sessions. This adapter is a provider implementation, not the Writing Core.

The existing selector fallback, streaming detection, tab activation, retry, and response extraction work should be preserved behind this adapter boundary.

### 3.3 Shared state

Web Studio and Extension never maintain independent canonical business state. Both read/write through the Local Content Runtime.

```text
Local Web Studio -----\
                      > Local Content Runtime -> Local Data Store
Browser Extension ----/
```

## 4. Local Content Runtime

The Local Content Runtime is the local source of truth and orchestration boundary.

Core responsibilities:

- project lifecycle;
- Brand Brain;
- source ingestion metadata;
- content artifacts and revisions;
- evidence/claim records;
- workflow jobs and checkpoints;
- evaluation/audit results;
- provider registry and routing;
- browser-extension bridge;
- local web API;
- export/import;
- audit receipts.

The runtime must not require cloud availability for core writing workflows.

### 4.1 Recommended local storage boundary

Logical stores:

```text
Local Runtime
|- metadata / relational state
|- content artifacts / source files
|- search/index state
|- job/event state
|- provider receipts
|- audit/evaluation results
`- secret references (actual secrets live in OS credential storage)
```

Project files must not contain plaintext API keys or browser credentials.

## 5. Writing product model

The system has six top-level user-facing studios/capability families:

1. **Write** — create new content.
2. **Research** — gather, organize, and qualify source material/evidence.
3. **Edit** — rewrite/shorten/expand/clarify/de-slop/brand-adapt while preserving facts and claim strength.
4. **Audit** — independently assess factuality, claims, brand, audience, quality, SEO/GEO, readability, duplication, and target fit.
5. **Repurpose** — transform one approved/source-backed content artifact into another content job.
6. **Transcript** — turn SRT/VTT/transcripts into exact-source writing and repurposing workflows.

These are capability families, not six separate engines. They reuse the same domain core.

## 6. Content Job Packs

A **Content Job Pack** defines what is being written, its required structure, specialized schema, rules, evaluators, and definition of done.

Initial job families:

### 6.1 Social Content

Examples: post, caption, thread, community post, carousel copy, pinned comment, title/description copy.

Platform/target packs adapt the final output without owning the writing core.

### 6.2 Blog / Article

Includes:

- search/audience intent;
- research brief;
- outline and heading architecture;
- evidence/citations;
- fact/claim checks;
- editorial quality;
- SEO on-page;
- GEO/AI-search considerations;
- content refresh and stale-fact review.

### 6.3 Product Content

Includes:

- product title;
- short/long description;
- feature/benefit copy;
- technical bullets;
- FAQ;
- comparison copy;
- SEO metadata;
- marketplace/channel adaptation.

Technical product facts are source-of-truth records. The writer must not convert a factual feature into an unverified benefit claim.

### 6.4 Landing / Sales Copy

Includes headline, subheadline, value proposition, problem, mechanism, proof, benefits, objections, comparison, offer, FAQ, and CTA. SEOSONA writes and audits copy; it does not own frontend/page rendering.

### 6.5 Advertising Copy

Includes angle, hook, primary text, headline, description, CTA, UGC-style script, and variants. Advertising jobs are distinct from organic social jobs because policy and claim-risk requirements differ.

### 6.6 Email / Newsletter

Includes subject, preheader, opening, body, CTA, and optional message sequences. SEOSONA writes content; it does not become a full lifecycle messaging platform.

### 6.7 Script Writing

Includes short-form script, YouTube long-form script, talking-head, explainer, podcast outline, and UGC script. Specialized evaluators may score hook, information density, spoken naturalness, retention structure, CTA, and estimated duration.

### 6.8 Transcript / SRT

Includes:

- exact transcript/timecode validation;
- highlight extraction;
- non-linear segment selection;
- short-form cut planning;
- clean transcript;
- quotes;
- chapters;
- blog/social/newsletter/script repurposing;
- title/description generation;
- existing cut/export formats where still useful.

For transcript-derived cuts, raw subtitle text and source timecodes remain authoritative and must not be silently rewritten.

## 7. Shared Writing Core

All Content Job Packs compose reusable capabilities instead of maintaining separate engines.

```text
Sources / Brand / Audience
          |
          v
     Research Engine
          |
          v
 Evidence + Claims
          |
          v
      Brief Engine
          |
          v
   Structure Planner
          |
          v
     Writing Engine
          |
          v
      Edit Engine
          |
          v
 Independent Auditors
          |
          v
   Target Adaptation
          |
          v
   Approved Artifact
          |
          v
 Performance / User Feedback
```

Core modules should include:

- `research`
- `evidence`
- `claims`
- `brand`
- `audience`
- `strategy`
- `brief`
- `structure`
- `generation`
- `editing`
- `evaluation`
- `repurpose`
- `transcript`
- `providers`
- `workflow-runtime`

## 8. Core and specialized IRs

Do not create one giant universal content object.

Shared contracts:

- `SourceArtifact`
- `Locator`
- `EvidenceIR`
- `Claim`
- `AudienceContext`
- `BrandContext`
- `BriefIR`
- `ContentIR`
- `EvaluationResult`
- `ProviderReceipt`
- `Revision`

Specialized extensions may include:

- `ArticleIR`
- `ProductContentIR`
- `LandingCopyIR`
- `AdCopyIR`
- `EmailIR`
- `ScriptIR`
- `TranscriptIR`
- `CueIR`

`ContentIR` represents semantic content and intent. A specialized IR adds only fields required by that job type.

## 9. Evidence and claim integrity

Evidence integrity is a first-class invariant.

Every material claim should be representable with:

```text
claim text
claim type
strength
supporting evidence refs
source locator
confidence
status
```

Suggested statuses:

- `SUPPORTED`
- `PARTIALLY_SUPPORTED`
- `UNSUPPORTED`
- `CONTRADICTED`
- `NEEDS_REVIEW`

Editing operations must preserve claim strength unless the user explicitly requests and evidence supports a change.

For high-risk or unsupported claims, the system must never invent evidence merely to make the copy stronger.

## 10. Provider-neutral architecture

Writing Core must not import provider-specific behavior.

```text
Writing Core
    |
    v
Provider Gateway
    |
    +-- BrowserAutomationAdapter
    +-- ApiProviderAdapter(s)
    `-- LocalModelAdapter (later)
```

A provider request is expressed in capabilities and constraints, not by hard-coding a vendor into job logic.

Conceptual request:

```text
ProviderTask
- taskType: WRITE | EDIT | AUDIT | EXTRACT | STRUCTURE | ...
- contentJob
- requiredCapabilities[]
- contextBundle
- outputContract
- privacyPolicy
- costPolicy
- timeoutPolicy
- providerPreference
```

Conceptual response:

```text
ProviderResult
- status
- output
- providerId
- model/session descriptor
- startedAt/completedAt
- attempts
- cost classification
- parse/validation status
- warnings
- receipt
```

## 11. Provider adapters

### 11.1 Browser Automation Adapter

Uses the browser extension to control a supported logged-in AI web session.

It must expose machine-level states such as:

- `READY`
- `AUTH_REQUIRED`
- `BUSY`
- `RATE_LIMITED`
- `UI_CHANGED`
- `CONTENT_BLOCKED`
- `TIMEOUT`
- `COMPLETED`

The adapter owns selectors, DOM interaction, streaming completion detection, retry rules, and extraction. The Writing Core only sees the provider contract.

### 11.2 API Adapter

Uses an explicit configured API credential.

It owns:

- request translation;
- model selection inside allowed policy;
- structured output support;
- rate limits;
- retry/backoff;
- usage/cost receipts;
- provider errors.

API credentials must be retrieved through secure local secret storage.

### 11.3 Local Model Adapter

Not required for first implementation, but the provider contract must allow it later without changing Writing Core.

## 12. Auto Router

Auto Router is optional; manual selection always wins.

### 12.1 Priority order

The router evaluates candidates in this order:

1. **Quality** — expected quality for the exact task/content-job/capability mix.
2. **Zero incremental cost** — prefer a qualifying provider/session that does not create additional billable usage.
3. **Stability** — prefer healthy adapters with lower recent failure/retry rates.
4. **Speed** — among otherwise acceptable candidates, prefer lower expected latency.

This is lexicographic policy, not a naive weighted average: a substantially lower-quality candidate should not win merely because it is faster.

### 12.2 Quality signals

Quality may be estimated from:

- task capability fit;
- job-specific golden eval results;
- user's accepted/rejected outputs;
- repair rate;
- evaluator scores;
- format/schema compliance;
- recent provider performance.

The router must distinguish observed quality from static marketing labels.

### 12.3 Cost classes

Suggested runtime classes:

- `ZERO_INCREMENTAL` — already-available browser session/subscription or local model; no additional SEOSONA provider charge for the specific job.
- `FREE_QUOTA` — API request confirmed to fit a configured non-billable/free quota.
- `PAID_ALLOWED` — billable API use is permitted by explicit user policy/budget.
- `PAID_BLOCKED` — provider is technically available but may not be used automatically.
- `UNKNOWN_COST` — cost cannot be determined; do not auto-route as free.

A subscription that the user already pays for may be treated as zero incremental cost for routing, but SEOSONA must not claim the underlying service itself is universally free.

### 12.4 Stability signals

Track per adapter/provider:

- availability;
- auth health;
- timeout rate;
- UI-selector health for browser adapters;
- parse/schema failure rate;
- rate-limit events;
- retry count;
- recent success window.

### 12.5 Fallback behavior

Default zero-incremental policy:

```text
1. Select highest-quality healthy ZERO_INCREMENTAL candidate.
2. If unavailable, try next qualifying ZERO_INCREMENTAL candidate.
3. Try FREE_QUOTA API candidate if verified available.
4. If only billable API remains:
   - use it only when PAID_ALLOWED policy is active;
   - otherwise stop and ask the user to permit paid execution or choose a provider.
```

The system must never silently incur paid API usage merely because browser automation failed.

## 13. Manual provider control

Users can set provider policy at multiple levels:

- global default;
- project;
- workflow;
- stage;
- one execution.

Examples:

```text
Draft -> Claude Web
Audit -> API Provider A
Rewrite -> Auto
Brand-sensitive workflow -> never send to provider X
Paid API -> disabled
```

Manual provider locks override Auto Router.

## 14. Browser extension interaction model

Typical contextual flow:

```text
User selects text on a page
-> Extension shows SEOSONA actions
-> User chooses Audit / Rewrite / Repurpose / Add as Source
-> Extension sends explicit context to Local Runtime
-> Runtime resolves project + brand + evidence + provider
-> Workflow runs
-> Extension shows Current vs Suggested
-> User accepts/rejects/edits
-> Accepted revision is persisted locally
-> Optional explicit Replace writes into the page editor
```

Page capture must be permissioned and scoped. The extension should not silently ingest an entire browsing session.

## 15. Web Studio interaction model

Typical deep-writing flow:

```text
Project
-> Sources
-> Audience / Brand
-> Brief
-> Outline / Structure
-> Draft
-> Claims / Evidence review
-> Independent Audit
-> Repair / Edit
-> Target adaptation
-> Approve
-> Export / Copy / Send to Extension
```

Web Studio should make provenance visible without forcing every user to operate at expert complexity.

## 16. Workflow runtime

Generalize the existing resumable/event-driven orchestration primitives instead of discarding them.

A workflow needs:

- job id;
- stage state;
- immutable context snapshot reference;
- provider attempts;
- checkpoints;
- cancellation;
- retry policy;
- failure classification;
- output validation;
- audit receipts.

The existing Facebook-specific orchestration/state primitives should be treated as migration seeds for a generic content-job runtime, not copied into every workflow.

## 17. Error handling

Errors are typed and actionable.

Examples:

- source unavailable;
- evidence missing;
- provider unavailable;
- authentication required;
- browser selector/UI drift;
- timeout;
- rate limit;
- invalid structured output;
- content policy block;
- unsupported job capability;
- paid provider blocked by policy;
- transcript/timecode mismatch.

Recovery should distinguish retryable failures from hard failures. Provider fallback must not weaken evidence/claim requirements.

## 18. Security and privacy

Local-first is a data ownership decision, not a claim that content never leaves the machine. When a browser AI or external API is selected, the explicit task context is sent to that external provider.

Requirements:

- canonical project data stored locally;
- loopback APIs authenticated;
- restrictive CORS/origin policy;
- no plaintext API secrets in project files;
- use OS credential/keychain storage for secrets;
- explicit provider/data-sharing policy;
- configurable provider deny-list for sensitive brands/projects;
- provenance receipt records which provider received which task context class;
- prompt-injection defenses for ingested page/source content;
- page content is data, not executable instruction.

## 19. Evaluation model

Generation and evaluation are separate stages/modules.

Shared evaluator dimensions may include:

- factuality;
- evidence support;
- claim strength preservation;
- brand fit;
- audience fit;
- structure;
- readability;
- concision;
- AI-slop/repetition;
- originality/duplication;
- CTA quality;
- job-specific requirements;
- SEO/GEO when applicable;
- platform/target fit when applicable.

Each Content Job Pack defines which evaluators are mandatory, optional, or irrelevant.

## 20. Learning loop

Local learning should record signals such as:

- accept;
- reject;
- edit distance;
- user manual rewrite;
- audit repair;
- preferred provider by job;
- final approved wording;
- optional imported performance outcomes.

These signals update Brand Memory and provider/job quality estimates. They must not silently convert one brand's preferences into another brand's rules.

## 21. Migration from the current repository

Use a strangler migration; do not rebuild from zero.

Preserve and generalize:

- SRT parser/serializer/timecode validation;
- exact-transcript guardrails;
- provider browser automation;
- selector fallback/overrides;
- stable-response detection;
- retry/backoff;
- job history concepts;
- current knowledge blocks;
- factCheck / claimStrength / editingRules / concision / deslop / SEO/GEO knowledge;
- reusable prompt/flow concepts;
- resumable state/orchestration primitives.

Reframe:

- `SEOSONA SRT Studio` -> one Transcript content workflow, not product identity;
- provider content scripts -> `BrowserAutomationAdapter` implementations;
- Facebook-specific content orchestration -> generic workflow runtime plus Social Content Job Pack;
- monolithic knowledge prompt composition -> structured Core/Job/Brand/Target context composition.

## 22. V1 boundaries

V1 should prove the architecture with the smallest coherent slice.

Required V1 capabilities:

1. Local Content Runtime.
2. Local Web Studio shell connected to runtime.
3. Existing Extension connected to the same runtime.
4. Project + Brand + Source + Content + Revision persistence.
5. Provider Gateway contract.
6. Browser Automation Adapter using existing supported web providers.
7. Provider manual selection.
8. Auto Router with quality -> zero incremental cost -> stability -> speed policy.
9. Paid API hard-block by default.
10. One API Adapter to prove provider neutrality.
11. Write/Edit/Audit flow.
12. At least three Content Job Packs proving different schemas:
    - Blog/Article;
    - Product Content;
    - Transcript/SRT.
13. Independent audit results.
14. Provider/job receipts and retry/failure reporting.

Social and additional writing jobs can migrate after the core contracts are stable.

## 23. Explicit non-goals for V1

- cloud sync/team collaboration;
- hosted SaaS backend;
- full publishing automation;
- ad-account management;
- full CMS;
- video rendering/generation;
- image generation pipeline;
- model marketplace;
- complex autonomous multi-agent swarm;
- billing system;
- enterprise RBAC;
- training/fine-tuning models.

These non-goals prevent the local writing core from being diluted before its contracts are proven.

## 24. Testing strategy

Minimum test classes:

- IR/schema contract tests;
- local persistence tests;
- workflow reducer/state transition tests;
- provider contract tests;
- browser adapter fixture tests;
- API adapter mock/contract tests;
- Auto Router policy tests;
- explicit no-paid-API-without-permission tests;
- evidence/claim preservation tests;
- editing claim-strength regression tests;
- SRT exact transcript/timecode regression tests;
- Content Job Pack golden tests;
- extension-runtime authenticated bridge tests;
- prompt-injection/adversarial source tests;
- provider fallback and retry tests;
- cancellation/resume tests.

## 25. Definition of done for the architecture

The design is proven when:

1. The same Blog job can run through a browser AI provider or API provider without changing Blog domain logic.
2. A user can start/edit a project in Local Web Studio and continue contextually from the Extension using the same local state.
3. Auto Router prefers the best observed qualifying zero-incremental provider and never silently incurs paid API cost.
4. Manual provider locks are honored.
5. Provider failure can fall back without losing project/workflow state.
6. Writer and Auditor can use different providers.
7. Product writing cannot silently invent claims beyond source facts/evidence.
8. SRT cut workflows preserve authoritative raw transcript and exact source timecodes.
9. New writing job types can be added as Content Job Packs without changing Provider Gateway or Local Runtime core contracts.
10. New provider adapters can be added without changing Writing Core or existing Content Job Pack logic.

## 26. Design principle summary

The key boundary is:

> **SEOSONA owns writing intelligence, context, evidence, workflow, evaluation, and local state. AI vendors are replaceable workers. Browser Extension and Local Web Studio are replaceable/equal surfaces over the same local runtime.**

This keeps the product focused on content writing while preserving the strongest existing assets in the repository: transcript integrity, browser AI automation, knowledge blocks, evaluation logic, and resumable workflows.