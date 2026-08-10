# Facebook Factory Secure Pairing Design

**Date:** 2026-08-10  
**Status:** Approved  
**Scope:** Local authentication and automatic reconnection between SEOSONA Content Companion and SEOSONA Flow.

## 1. Objective

Remove the configuration split that lets the Flow settings page create a local MCP token while the runtime bridge reads a different storage key. After one explicit local pairing action, Flow, Content Companion, and the Content extension must reconnect predictably, reject mismatched credentials, and expose a health receipt that proves mutual authentication.

The Facebook Factory continues to create draft packages only. Publishing, scheduling, Facebook credentials, and provider-account automation remain out of scope.

## 2. Selected Approach

Use the existing Flow-generated cryptographically random token as the single Flow MCP shared secret.

1. Flow settings creates the token and stores the token record in the existing local token list.
2. In the same atomic storage write, Flow activates `seosonaLocalMcp` with loopback-only host, configured port, enabled state, and the new token.
3. The live Flow bridge observes changes to `seosonaLocalMcp`, closes the old socket, reloads configuration, and reconnects. A stale socket must never remain trusted after a token change.
4. Content Companion receives the same token only through `SEOSONA_LOCAL_MCP_TOKEN` and passes it to the official Flow MCP child process.
5. Content extension authentication remains separate. `SEOSONA_CONTENT_COMPANION_TOKEN` is entered into Chrome session storage and is never persisted in durable Content Library records.

This keeps the trust boundary explicit: the Flow token protects Flow MCP; the Companion token protects the Content loopback API.

## 3. Rejected Alternatives

- **No-auth loopback:** rejected because another local process could impersonate the MCP server or drive the connected extension.
- **One token for every boundary:** rejected because compromise of the Content extension session would also grant direct Flow MCP access.
- **Automatic token copying from Node into Chrome storage:** rejected because it requires a privileged browser-control channel and weakens the extension boundary.
- **Polling storage on an interval:** rejected because `chrome.storage.onChanged` provides deterministic, lower-cost reconnection.

## 4. Runtime Contracts

### Flow pairing

`seosonaLocalMcp` contains:

```json
{
  "enabled": true,
  "host": "127.0.0.1",
  "port": 8765,
  "token": "(redacted)"
}
```

Only `127.0.0.1` is accepted. Port must be an integer from 1 through 65535. Token must contain at least 16 characters. Secrets must never appear in logs, receipts, committed fixtures, or error messages.

### Bridge lifecycle

When `seosonaLocalMcp` changes, the bridge must:

1. invalidate server trust immediately;
2. cancel pending reconnect work;
3. close the current WebSocket;
4. reload and validate configuration;
5. reconnect only when enabled;
6. require the new mutual-auth handshake before honoring commands.

Unrelated storage changes must not reconnect the bridge.

### Companion health

Health remains fail-closed. A ready response requires Flow contract compatibility, extension connection, provider readiness, and authenticated MCP transport. `auth:none` is not sufficient for live acceptance.

## 5. Quality and Failure Handling

- A judged passing asset becomes `asset_ready`.
- A judged failing asset may create at most two prompt revisions.
- An unjudged asset is archived and becomes `asset_needs_review`; it is never reported as ready.
- Token mismatch, missing token, server proof failure, provider login loss, quota exhaustion, and Content Library write failure have stable terminal or resumable states.
- Retry never changes `client_ref` for transport failures. Only a judged visual rejection creates the next revision.

## 6. Acceptance

Automated gates must prove:

- token creation activates the bridge configuration atomically;
- token rotation reconnects once and invalidates old trust;
- unrelated storage updates do not reconnect;
- invalid host, port, or short token fail closed;
- Companion refuses a missing Flow MCP token;
- Content packages never contain either secret;
- simulated batches of 1, 5, and 20 remain deterministic;
- live acceptance uses an authenticated bridge, generates a small real batch, and reads every asset receipt back from Content Library.

If the provider cannot judge an asset, live acceptance may finish as `needs_review`, but it must still prove authentication, archive integrity, and readback. It may not claim `ready`.

## 7. Change Isolation

Flow implementation is developed in a clean linked worktree. The owner's unmerged Flow files remain untouched. Integration uses a dedicated commit and a non-force push only after targeted Flow tests, MCP contracts, Content tests, doctors, secret scans, and cross-project audit pass. Known baseline failures caused by artifacts absent from the committed Flow tree are recorded separately and are not masked with fabricated files.
