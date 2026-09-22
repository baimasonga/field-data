# Sync protocol contract

## Operation envelope

Include operation ID, aggregate ID, aggregate version/base version, tenant/project, actor/device, schema version, type, created-at, logical ordering metadata, payload hash, dependencies, encryption/signature metadata, and payload/reference.

## Transfer manifest

Include package ID, sender, intended server/project, operation IDs, chunk IDs/hashes/sizes, total bytes, priority, created/expiry times, protocol version, custody policy, and signature. Do not expose sensitive field values in relay-visible metadata.

## Server application

Validate identity, authorization, signature, project scope, schema, dependencies, and hashes. Persist an inbox receipt and application result idempotently. Return per-operation outcomes and a durable acknowledgement token.

## Backpressure and storage

Set quotas by project and priority, reserve space for critical manifests, pause noncritical capture gracefully, and expose cleanup candidates. Never evict unacknowledged original evidence silently.

## Observability

Measure age/size of outboxes, time to first receipt, time to full evidence, retries, dedupe rate, conflicts, rejected operations, corrupted chunks, relay hops, storage pressure, and protocol/client versions.
