# CAT-FINAL-001 — archaeology revision importer (offline design / phase 1)

This module is intentionally not loaded by the production site. No actual site or Firebase data is read or written by its tests. The ordinary importer remains unchanged. R3 is not final yet.

## Revision bundle contract

- format: gal-predecessor-revision-bundle; version: 1; revisionId: unique stable batch ID.
- sources: array of {sha256, sourceText}. Exact UTF-8 original JSON text, including BOM if present, from every old/new source digest. The hashes are recalculated, not trusted.
- targets: array of {beforeSha256, candidate, operations}. Each candidate is a full normal V2 pack with exact worldKey, cycleId, cycleTitle, chatId and manager. beforeSha256 is SHA-256 of the actual cycle read-back, using the module's canonical JSON (object keys sorted, arrays ordered, UTF-8).
- operations: each {field, sourceId, action, old}. field is one of pilotMessages, quizLogs, casinoLogs, realChatLogs, rejectedEvents. action is add / replace / remove. old is null only for addition, otherwise {text, index, sourceSha256, rowSha256}; rowSha256 hashes the entire actual existing row including manual images. New values come from the validated candidate, not arbitrary patch text.
- Every missing/changed owned row requires explicit operation. Foreign/unbound rows are retained, no inferred ownership or whole-page replacement. Removal with manual images or unknown metadata stops the entire plan. Replacements retain existing images and manual fields; changed source attachment references stop. Original source references of removals remain in durable R2 backup.
- Easter eggs are legacy unstructured text, not source-keyed rows. Phase 1 blocks changed egg blocks; do not force a whole-field overwrite. If R3 requires this, design an independent exact old block + source evidence operation before activating.

## Storage adapter contract / next integration gate

The pure module exports inspect, apply, restore, canonical, digest. inspect returns all before/after rows and target snapshots without writing. apply re-reads, re-plans, compares approved preview, writes durable immutable backup then verifies its read-back, calls CAS, and verifies persisted cycles and receipt. restore requires exact post-apply hashes and immutable backup; intervening edits cause conflict. Same revision ID and identical committed snapshot is no-op; a restored ID or altered bundle cannot be reused.

Adapter API (not registered in live website yet):
read(): all actual cycles from IndexedDB, not cached JS records.
receipt(revisionId), backup(revisionId, backup), readBackup(revisionId): persistent, immutable backup and receipt storage, no overwrite of different backup.
cas(targets, receipt, expectedReceipt): compare exact before snapshots and receipt in one readwrite transaction; write all target cycles and new receipt atomically, no normal merge path, abort on ANY conflict. In production, use dedicated IDB backup/receipt stores and version migration, require old tabs closed and verified backup. For multi-target changes do not split writes per cycle. No sync events until read-back and user authorization.

Cloud is not the same transaction domain as IndexedDB. Current pushCloud writes cycle chunks and manifest separately; updatedAt alone is not sufficient to protect concurrent edits. Production activation requires read actual remote R2 with server-only reads and verified chunk reconstruction, compare with actual local R2, backup both; lock/disable ordinary sync while the revision is pending; atomic compare-and-write of all target cloud manifests and chunks (reject if Firestore transaction limits exceeded), and read-back; durable pending journal and guarded recovery if either local/cloud phase fails. Never report cloud completion from local completion. Do not silently push entire stale cycles. Do not enable live application until these gates and actual R3 approval are satisfied.

Tests use only invented generic fixtures, a mock atomic adapter, and the unchanged normal importer. No private chat or real data in Git. Real R2 snapshot, final R3, and independent verification are required before live activation.
