---
name: build-offline-field-sync
description: Design, implement, harden, review, or test offline-first synchronization for field-data systems. Use for local-first capture, progressive and resumable uploads, encrypted store-and-forward data mule networking, phone-to-phone relay, physical courier mode, chain of custody, conflict handling, idempotency, partial media sync, bandwidth adaptation, and recovery from intermittent or absent connectivity.
---

# Build Offline Field Sync

Assume the network is absent, expensive, intermittent, reordered, and duplicated. The authoritative user experience begins with a durable local write. Read [references/features.md](references/features.md) and [references/sync-protocol.md](references/sync-protocol.md).

## Workflow

1. Trace every entity from local creation through server acknowledgement and downstream processing.
2. Define ownership and conflict rules per entity; do not use one generic merge strategy.
3. Assign stable client-generated IDs and append-only operation IDs before network activity.
4. Persist changes and an outbox transactionally on device. A UI success state must not depend on network receipt.
5. Separate compact manifests/critical fields from large media chunks and derived artifacts.
6. Authenticate, encrypt, checksum, resume, retry with jitter, and deduplicate every transfer.
7. Surface states honestly: local, queued, relayed, partially uploaded, server acknowledged, verified, conflicted, rejected.
8. Test with forced process death, clock skew, storage pressure, device transfer, corrupted chunks, reordering, duplication, and long offline periods.

## Sync invariants

- At-least-once transport plus idempotent application; never depend on exactly-once networking.
- Acknowledgement means a durable server commit, not merely socket receipt.
- Never delete local evidence until durable acknowledgement and retention policy permit it.
- Encrypt relay packages end to end so relay devices cannot read content.
- Sign custody transfers and bind them to package hashes, sender/receiver keys, and timestamps/nonces.
- Use content hashes and chunk manifests for media; verify assembled content before promotion.
- Treat tombstones and revocations as versioned operations.
- Keep schema and protocol versions negotiable for older field clients.

## Conflict policy

Choose explicitly by data type: immutable append for evidence; server policy for permissions; optimistic concurrency for reviews; set-union or domain merge for tags; human reconciliation for competing edits to material claims. Preserve both versions and provenance when automatic resolution could destroy meaning.

## Acceptance gate

Demonstrate capture fully offline, progressive transfer over a poor link, interruption/resume, duplicate replay, relay via another device, server acknowledgement, downstream processing, and safe local cleanup. Prove that repeated delivery never duplicates business effects.
