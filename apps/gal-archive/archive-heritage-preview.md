# Independent heritage archive — offline preview

This independent data domain stores unbound predecessor/successor exchanges and cross-cycle learning assessments, not Gal AI canonical messages, not any cycle's six tabs. No fake cycle ID. An assessment is a reference to its question, answer and response rows; historical cycle labels are reference-only strings, never inferred UUIDs. An unscored assessment remains unscored.

The Node planner archive-heritage-preview.cjs takes independently acquired sourceBytes and candidateBytes (Buffer), plus a trusted separate approval with accepted:true, reviewId, manager, chatId, count, sourceSha256 and candidateSha256. Optional assessment approval binds assessmentClassification and assessment:{sourceIds,referencedCycles}. It never upgrades original pending review flags. The trusted approval must be established independently, not copied from the candidate. This first profile supports the observed all-real-chat unbound candidate format; other categories, partial sources, scored assessments and multiple assessment groups require further evidence/contracts, not forced conversion.

Checks: exact original bytes hash, completed display evidence, scanner row validity, unique IDs, ordered indices, embedded sourceText equality, full realChatLogs and exact per-row coverage, UTF-16/codepoint ranges and hashes, null cycle binding. Nonempty other tabs reject instead of silently dropping. Cross-cycle assessment links are ordered user/assistant/user, with independently approved labels, null score, referenceOnly. The output is an additive proposal for a separate store, with one stable chat/source identity per row. Identical existing records are idempotent; conflicting identity/content blocks. Unrelated records remain unchanged; empty cycle sections never touch existing cycles. No writes are performed. Output is preview-only, importable:false and canonical:false.

## Production gates (not implemented)

- A dedicated heritage exchange view, independent of the cycle selector, with participant and assessment browsing.
- Separate storage collection; no synthetic world or cycle record. Prefer a distinct IndexedDB store in the archive database, with migration and all openers audited. Alternative isolated store needs explicit complete-backup and restore support.
- Complete-backup/export/import compatibility, cloud sync scope, Firebase rules and per-user access must be independently reviewed before enabling persistence.
- A production import preview must verify independently authorized source/candidate hashes, snapshot freshness, atomic additive transaction, backup/readback/rollback and idempotence. Never overwrite cycle tabs.
- Real private files are only replayed privately; GitHub fixtures and CI logs use synthetic data exclusively.
- Do not publish or integrate until these gates and the separate user approval for real import are met. The offline proposal is not a website import bundle.
