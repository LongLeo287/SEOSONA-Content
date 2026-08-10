# SEOSONA Facebook Content Factory V2 Audit

**Review date:** 2026-08-10

**Scope:** SEOSONA OS policy/context, SEOSONA Content control plane and Companion, SEOSONA Flow MCP image worker, SEOSONA Video BrandKit.

**Runtime boundary:** draft packages only; no Facebook publishing, scheduling, OAuth, or credentials.

## Verdict

The implementation is structurally ready for V1 use. All offline and simulated acceptance gates pass. The remaining live gate is environmental: the audit shell had no Companion token, Flow MCP token, runtime paths, extension connection, or provider session, so a real image-provider batch was not fabricated or reported as passed.

There are no open P0 or P1 implementation issues. Two P2 gates remain: populate the OS evidence packet for factual content and run one authenticated local acceptance batch.

One non-blocking P3 dependency-hygiene issue remains outside the V1 runtime: SEOSONA Video's HyperFrames 0.7.24 dependency tree reports 13 transitive advisories. V1 reads only validated static BrandKit assets from Video, so this does not expose the Content Factory runtime. It should be handled as a separate compatibility upgrade instead of forcing a breaking package update during this integration.

Independent review passes found concurrency, evidence, MV3 lifecycle, taxonomy, portability, and release-gate defects. All in-scope P1/P2 findings were fixed before integration. Claim text must equal the canonical evidence claim and appear verbatim as its own sentence in copy; V1 does not authorize factual paraphrases through heuristic similarity. Visual work runs asynchronously in Companion and is polled by Chrome alarms. Provider leases refresh on each retry/ack and recover stale jobs. Cancellation is checked after long boundaries. Infrastructure/archive/library failures halt the batch. Brand voice has an independent copy-QA verdict. Review-required images remain archived, runtime paths remain stripped, filenames cannot collide, Flow 1.1 is committed, and release audit fails closed.

## Verified Architecture

1. OS owns the versioned brand, group, policy, and evidence sources. Batch size defaults to 5 and is constrained to 1 through 20; publishing remains explicitly unsupported.
2. Content owns idea generation, Vietnamese copy, evidence and brand gates, immutable context snapshots, state, retries, and final package indexing.
3. The background service worker persists every transition and resumes idea, copy, and visual work after the UI closes or the worker restarts. Long Flow work lives in an idempotent Companion job; the worker uses short submit/poll requests and `chrome.alarms`. Provider records have deadline/tab-liveness leases, and concurrent resume/result operations are serialized.
4. Companion accepts only allowlisted extension origins with a bearer token and single-use nonce. It exposes health, context, visual, cancel, and package endpoints.
5. Companion negotiates Flow contract 1.1.x through health, capabilities, and provider readiness. Its stable visual job ID prevents duplicate generation across worker or Companion restart. Transport retries keep the same client reference; only judged quality failures create revisions, at most twice.
6. Flow remains the pixel worker through its official local MCP process. Content does not access Flow's privileged executor bridge directly.
7. Video remains the physical BrandKit owner. The canonical digest, version 1.0.0, Be Vietnam Pro typography, palette, components, negative rules, and 48 referenced assets validate against OS.
8. Content Library stores portable batch/context/draft files, the archived image, and a provenance receipt. Chrome storage contains only copy, state, previews, and logical references, never image binary.

## Verification Receipts

| Gate | Result |
|---|---|
| Content tests | 75/75 passed, including canonical verbatim claim enforcement, brand QA, auth/replay, asynchronous Companion jobs, MV3 alarm resume, refreshed provider lease, Flow handshake, quality retry, package traversal/collision, halt, cancel race, and simulated batches of 1, 5, and 20 |
| Content doctor | Connected; all checks passed |
| Cross-project release audit | Strict mode passed 7/7 with explicit OS, Video, and Flow roots; missing roots fail release verification |
| OS contracts | 7/7 passed, including the live Video BrandKit digest and configurable batch policy |
| OS doctor | Healthy; connector, language, security (44 tests), capability bridge, and knowledge checks passed |
| Video BrandKit | Valid; all 48 manifest assets checked and tracked in the release merge; canonical digest matched OS |
| Video doctor | Connected; all checks passed |
| Video dependency audit | 13 transitive advisories remain (5 moderate, 8 high); tracked as non-runtime P3 FCF-025 |
| Flow static | 541 JavaScript files, 22 JSON files, and all declared HTML/manifest resources passed |
| Flow unit | 1,345 passed |
| Flow MCP contracts | Normalization, validation, quality, integration, persistence/idempotency, and quality backfill passed |
| Flow MCP source state | Contract 1.1.0 and its quality tests committed in `f5044ae` |
| Flow doctor | Connected; all checks passed |
| Live provider acceptance | Pending external runtime configuration; not claimed as passed |

## Security and Portability Review

- Extension host permissions cover only supported AI providers and local loopback; there is no Facebook host permission.
- Companion rejects non-loopback configuration, non-allowlisted origins, missing/invalid tokens, and nonce replay.
- Secrets stay in runtime environment or Chrome session storage and are absent from durable receipts.
- Durable references use `seosona-brand://` and `content-library://`; physical paths are injected through environment variables.
- Flow visual cancellation uses the Companion-owned MCP process and can cancel its active pending job without exposing an internal Flow job ID.
- Asset and package writers reject path traversal and non-image extensions, generate collision-safe asset names, and use atomic JSON writes.

## Remaining Actions

1. Add reviewed evidence records to the OS evidence packet before expecting factual or numerical Facebook posts.
2. Start the local Companion with the documented environment values, ensure the Flow extension/provider is ready, and complete one real batch with asset readback.
3. Upgrade and compatibility-test the Video HyperFrames dependency tree separately; do not use a forced major update without render regression tests.

The machine-readable registry is `2026-08-10-facebook-content-factory-v2-issues.json` in this directory.
