# Facebook Group Content Factory V1

This V1 creates a configurable number of Facebook Group draft packages per batch. The OS policy defaults to five and currently allows 1 through 20. It never publishes, schedules, or requests Facebook credentials.

## Boundaries

- SEOSONA Content is the control plane and only stores copy, job state, and provenance receipts. It never stores image binary data in Chrome storage.
- SEOSONA Video owns the canonical `brand-kit.v1.json` and asset manifest. SEOSONA OS stores only its portable logical URI, semantic version, and SHA-256 digest.
- The Companion verifies the physical BrandKit supplied through `SEOSONA_BRAND_KIT_FILE`, then freezes only the palette, font family, modes, components, allowed mascot assets, Flow boundary, and negative rules into the immutable batch snapshot.
- The local Content Companion listens on loopback, accepts only one configured Chrome extension origin, and requires both a bearer token and a single-use nonce.
- SEOSONA Flow remains the image worker. The Companion starts and calls its official stdio MCP server; Content never connects to Flow's executor WebSocket.
- The Content background service worker owns the resumable state machine. The side panel is only a simple start, status, resume, and cancel interface.

## Local setup

Set these environment variables in the shell that starts the Companion. Keep their values local; do not commit tokens or machine paths.

```text
SEOSONA_CONTENT_COMPANION_TOKEN=<a-long-random-local-token>
SEOSONA_CONTENT_EXTENSION_ID=<the-fixed-32-character-Chrome-extension-id>
SEOSONA_LOCAL_MCP_TOKEN=<the-same-token-configured-in-Flow>
SEOSONA_FLOW_MCP_COMMAND=node
SEOSONA_FLOW_MCP_SERVER=<path-to-seosona-flow/mcp-local/server.mjs>
SEOSONA_FLOW_DOWNLOAD_ROOT=<Flow-download-root>
SEOSONA_CONTENT_LIBRARY_ROOT=<local-content-library-root>
SEOSONA_CONTENT_CONTEXT_FILE=~/.seosona/3_MEMORY/projects/seosona-content/facebook-group-factory/context.v1.json
SEOSONA_BRAND_KIT_FILE=<path-to-SEOSONA-Video/7_ASSETS/brand/SEOSONA/brand-kit.v1.json>
```

The Companion refuses to load context when the BrandKit file is absent or its
version/hash differs from the OS reference. The physical path remains local and
is never written to OS policy, Content source, Chrome storage, or an asset
receipt.

Run `npm run facebook:companion`, open the extension, enter its loopback URL and Companion token, then select **Kiểm tra kết nối**. Choose the requested number of posts and select **Bắt đầu tự động**. Content generates the ideas itself; a manual five-topic list is no longer required.

The extension keeps the Companion URL locally but retains the Companion token only for the current browser session.

Every state transition is written to `srtFacebookBatchLast`. If Chrome or the side panel closes, **Chạy tiếp** resumes the stored idea, copy, or visual step. Provider transport retries preserve the same job reference. Only a judged visual-quality failure creates a new image revision.

The Flow extension must already be connected to a logged-in image provider and configured with `SEOSONA_LOCAL_MCP_TOKEN`. A visual that is judged failed is retried with a new `client_ref` revision no more than twice. An unjudged visual is always returned as `asset_needs_review`.

Every `VisualJob` carries the verified BrandKit reference, one approved mode,
one approved component, an explicit empty Flow asset allowlist, and all negative
rules. Flow receives a composed prompt for text-free imagery only. Vietnamese
copy, logos, statistics, citations, and UI labels remain the responsibility of
a deterministic compositor. The compositor and Facebook publishing are outside
V1.

## Output

For each draft, the Content Library receives `batch.json`, `context.snapshot.json`, `draft.json`, the archived image, and an asset receipt. Durable JSON uses `content-library://` references and never stores a machine-specific path, provider session URL, token, or image binary. Drafts with missing evidence, failed quality judgement, or incomplete providers remain clearly marked for review.

## Verification

- `npm test` runs the contract, security boundary, state, Companion, library, and orchestration tests.
- `npm run facebook:audit` checks the Content runtime, OS batch/no-publish policy, optional physical Video BrandKit, and optional Flow 1.1 contract.
- `npm run facebook:verify` runs Content tests, project doctor, and the audit in sequence.
