# SEOSONA Facebook Content Factory V2 Audit

**Review date:** 2026-08-10

**Scope:** SEOSONA OS policy/context, SEOSONA Content control plane and Companion, SEOSONA Flow MCP image worker, SEOSONA Video BrandKit.

**Runtime boundary:** draft packages only; no Facebook publishing, scheduling, OAuth, or credentials.

## Verdict

The implementation is structurally ready for V1 use. All offline and simulated acceptance gates pass. The remaining live gate is environmental: the audit shell had no Companion token, Flow MCP token, runtime paths, extension connection, or provider session, so a real image-provider batch was not fabricated or reported as passed.

There are no open P0 or P1 implementation issues. Two P2 gates remain: populate the OS evidence packet for factual content and run one authenticated local acceptance batch.

Independent review initially found four P1 release blockers. All four were fixed before integration: unmapped factual claim signals are blocked, review-required images are archived, runtime paths are stripped from Companion/orchestrator receipts, and the required Flow 1.1 contract is committed rather than existing only as working-tree state.

## Verified Architecture

1. OS owns the versioned brand, group, policy, and evidence sources. Batch size defaults to 5 and is constrained to 1 through 20; publishing remains explicitly unsupported.
2. Content owns idea generation, Vietnamese copy, evidence and brand gates, immutable context snapshots, state, retries, and final package indexing.
3. The background service worker persists every transition and resumes idea, copy, and visual work after the UI closes or the worker restarts.
4. Companion accepts only allowlisted extension origins with a bearer token and single-use nonce. It exposes health, context, visual, cancel, and package endpoints.
5. Companion negotiates Flow contract 1.1.x through health, capabilities, and provider readiness. Transport retries keep the same client reference; only judged quality failures create revisions, at most twice.
6. Flow remains the pixel worker through its official local MCP process. Content does not access Flow's privileged executor bridge directly.
7. Video remains the physical BrandKit owner. The canonical digest, version 1.0.0, Be Vietnam Pro typography, palette, components, negative rules, and 48 referenced assets validate against OS.
8. Content Library stores portable batch/context/draft files, the archived image, and a provenance receipt. Chrome storage contains only copy, state, previews, and logical references, never image binary.

## Verification Receipts

| Gate | Result |
|---|---|
| Content tests | Passed, including contracts, auth/replay, Flow handshake, quality retry, package traversal, state, cancel, resume, and simulated batches of 1, 5, and 20 |
| Content doctor | Connected; all checks passed |
| Cross-project audit | 7/7 passed with explicit OS, Video, and Flow roots |
| OS contracts | 6 passed; live BrandKit test skipped only in the standalone command because its environment variable was not set; the cross-project digest audit passed |
| OS doctor | Exit 0; pre-existing warnings for missing `.clauderules` and `.cursorrules` |
| Video BrandKit | Valid; 48 assets checked; canonical digest matched OS |
| Video doctor | Connected; all checks passed |
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
- Asset and package writers reject path traversal and use atomic JSON writes.

## Remaining Actions

1. Add reviewed evidence records to the OS evidence packet before expecting factual or numerical Facebook posts.
2. Start the local Companion with the documented environment values, ensure the Flow extension/provider is ready, and complete one real batch with asset readback.
3. Optionally restore the two missing OS connector files to remove doctor warnings.

The machine-readable registry is `2026-08-10-facebook-content-factory-v2-issues.json` in this directory.
