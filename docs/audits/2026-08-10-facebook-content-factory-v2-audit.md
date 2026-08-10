# SEOSONA Facebook Content Factory V2 Audit

**Review date:** 2026-08-10

**Scope:** SEOSONA OS policy/context, SEOSONA Content control plane and Companion, SEOSONA Flow MCP image worker, SEOSONA Video BrandKit.

**Runtime boundary:** draft packages only; no Facebook publishing, scheduling, OAuth, or credentials.

## Verdict

The implementation is structurally ready for V1 use. All offline and simulated acceptance gates pass. Flow token creation now activates the exact bridge configuration atomically, token rotation invalidates old trust and reconnects once, and Content rejects `auth:none` before capabilities or generation. An authenticated loopback MCP contract passed with mutual token enforcement. Earlier live probing confirmed the Flow 1.1 bridge, an attached extension, a ready Google Flow project, stable `client_ref` idempotency, and one real generated image. The remaining live gate is an authenticated Content-to-Companion browser run: the automation environment blocked loading the worktree extensions into the signed-in Chrome profile, so no authenticated Content Library batch was fabricated or reported as passed.

There are no open P0 or P1 implementation issues. Two P2 gates remain: perform the one-time runtime token pairing and run one authenticated local acceptance batch through Content Companion, then reconcile Flow's generated inventory artifacts after the owner's current unmerged Flow work is finalized.

The former Video dependency-hygiene issue is closed. HyperFrames and its companion packages were upgraded from 0.7.24 to 0.7.104 without a forced major update; the production dependency audit now reports zero known vulnerabilities, the integration audit passes, and a strict draft render produced a valid ten-second MP4.

Independent review passes found concurrency, evidence, MV3 lifecycle, taxonomy, portability, and release-gate defects. All in-scope P1/P2 findings were fixed before integration. Live acceptance then found that MCP image generation incorrectly depended on the user-facing Pipeline Queue toggle; Flow commit `d7e6161` removed that coupling, added a regression test, and the same live `client_ref` subsequently generated exactly one image. Claim text must equal the canonical evidence claim and appear verbatim as its own sentence in copy; V1 does not authorize factual paraphrases through heuristic similarity. Visual work runs asynchronously in Companion and is polled by Chrome alarms. Provider leases refresh on each retry/ack and recover stale jobs. Cancellation is checked after long boundaries. Infrastructure/archive/library failures halt the batch. Brand voice has an independent copy-QA verdict. Review-required images remain archived, runtime paths remain stripped, filenames cannot collide, Flow 1.1 is committed, and release audit fails closed.

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
| Content tests | 76/76 passed, including rejection of `auth:none`, canonical verbatim claim enforcement, brand QA, auth/replay, asynchronous Companion jobs, MV3 alarm resume, refreshed provider lease, Flow handshake, quality retry, package traversal/collision, halt, cancel race, and simulated batches of 1, 5, and 20 |
| Content doctor | Connected; all checks passed |
| Cross-project release audit | Strict mode passed 7/7 with explicit OS, Video, and Flow roots; missing roots fail release verification |
| OS contracts | 9/9 passed, including the live Video BrandKit digest, configurable batch policy, and 13-record verified evidence packet |
| OS doctor | Healthy; connector, language, security (44 tests), capability bridge, and knowledge checks passed |
| Video BrandKit | Valid; all 48 manifest assets checked and tracked in the release merge; canonical digest matched OS |
| Video doctor | Connected; all checks passed |
| Video dependency and render compatibility | HyperFrames 0.7.104; production audit reports 0 vulnerabilities; integration audit and strict ten-second draft MP4 render passed |
| Flow static | JavaScript syntax, 22 JSON files, and all declared HTML/manifest resources passed |
| Flow queue regression | 1/1 targeted test passed; a live image succeeded after the fix |
| Flow secure pairing | 5/5 focused tests passed for atomic activation, validation, token rotation, single reconnect, unrelated storage changes, and queue independence |
| Flow full unit suite on the owner's dirty worktree | 1,376/1,380 passed; four failures are generated inventory/package-manifest drift caused by the current unmerged Flow file set, tracked as FCF-027 rather than rewritten by this integration |
| Flow MCP contracts | Normalization, validation, quality, authenticated integration, persistence/idempotency, and quality backfill passed; production dependency audit reports 0 vulnerabilities |
| Flow MCP source state | Contract 1.1.0 and quality tests committed in `f5044ae`; UI-toggle independence committed in `d7e6161` |
| Flow doctor | Connected; all checks passed |
| Live provider acceptance | Partial: the earlier run connected the extension, confirmed provider readiness, created a project, and generated image `83660185-216d-432c-bdde-6b1ed0459db8` once. The new authenticated browser run was withheld because the environment blocked loading worktree extensions into the signed-in Chrome profile; authenticated Companion package readback remains pending |

## Security and Portability Review

- Extension host permissions cover only supported AI providers and local loopback; there is no Facebook host permission.
- Companion rejects non-loopback configuration, non-allowlisted origins, missing/invalid tokens, and nonce replay.
- Secrets stay in runtime environment or Chrome session storage and are absent from durable receipts.
- Durable references use `seosona-brand://` and `content-library://`; physical paths are injected through environment variables.
- Flow visual cancellation uses the Companion-owned MCP process and can cancel its active pending job without exposing an internal Flow job ID.
- Asset and package writers reject path traversal and non-image extensions, generate collision-safe asset names, and use atomic JSON writes.

## Remaining Actions

1. In Flow Settings, create the local MCP token once and copy its one-time value into the Companion runtime `SEOSONA_LOCAL_MCP_TOKEN`; Flow now activates and reconnects the bridge automatically.
2. Run one authenticated Content batch at the requested size, require judged visual results or explicit review state, and read every package back from Content Library in a browser environment that permits loading the release extension.
3. After the current Flow worktree changes are intentionally integrated, regenerate and review the repository inventory/package artifacts so the full Flow unit suite returns to green.

The machine-readable registry is `2026-08-10-facebook-content-factory-v2-issues.json` in this directory.
