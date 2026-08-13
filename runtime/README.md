# SEOSONA Content Local Runtime

The Local Runtime is the canonical state owner for SEOSONA Content V1.

## Boundary

- Canonical state is local.
- Studio and Extension are clients of the same Runtime.
- Raw source snapshots and content revisions are immutable.
- Multi-record content/revision updates use a recoverable transaction journal.
- Secrets are references only; provider secret storage is implemented in the Provider Gateway slice.
- No cloud sync or publishing is part of Runtime V1.
- External AI execution is not owned by this slice; Browser/API adapters plug into the Provider Gateway.

## Start

Set the fixed Chrome extension ID and a local Runtime token of at least 32 characters:

```bash
SEOSONA_CONTENT_EXTENSION_ID=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
SEOSONA_CONTENT_RUNTIME_TOKEN=replace-with-a-local-secret-at-least-32-chars \
npm run runtime:start
```

Optional configuration:

```text
SEOSONA_CONTENT_RUNTIME_ROOT   default ./.seosona-content
SEOSONA_CONTENT_RUNTIME_PORT   default 43118
```

The server binds only to `127.0.0.1`.

## Authentication

Browser Extension requests require:

- exact configured `chrome-extension://<id>` Origin;
- `Authorization: Bearer <runtime-token>`;
- a unique `x-seosona-nonce` per request.

The Local Web Studio is served from the Runtime origin and uses an HttpOnly, SameSite=Strict session cookie. API requests from another Origin are rejected.

## Storage

V1 uses a file-backed `WorkspaceStore` so domain contracts do not expose absolute machine paths. Records live under the local Runtime root; binary/raw snapshots are addressed by SHA-256 and returned as portable `seosona-local://...` references.

Immutable record conflicts fail closed. Pending transaction journals are completed before later reads/writes, so a process interruption cannot silently leave a content pointer and revision lineage permanently half-committed.

## Verification

```bash
npm run runtime:verify
```

The Runtime suite covers record contracts, immutable/concurrent writes, transaction recovery, source/evidence/claim lineage, ContextSnapshot hashing, resumable JobState, authenticated loopback HTTP, and restart acceptance.
