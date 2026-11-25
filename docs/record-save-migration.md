# Record storage release

The application uses `phone_count_generations/main-v2` and saves only changed records. Its marker must be `active`; there is no fallback to legacy full-inventory writes.

## Implemented safeguards
- Per-record comparisons reject conflicting edits while independent device edits can be rebased onto newer inventory.
- Pending edits are journalled locally before network writes and restored after reload. The first upgrade also preserves the old local inventory in IndexedDB.
- Each transaction changes at most eight records, preserving the previous value in immutable audit documents. Larger device-only edits run in resumable batches; structural operations must fit one transaction.
- CSV imports commit one valid row at a time and stop with an accurate saved count on failure. Previously sold IMEIs cannot silently become new stock.
- Backups page through every record, reject mixed revisions, and verify a lossless reconstruction before updating recovery pointers.
- Active record storage makes the legacy workspace read-only through Firebase rules. Existing access restrictions and revocation remain enforced.

## Controlled activation
1. Run `npm test` and `npm run test:rules`.
2. Read the current legacy workspace and preserve its full document including update time. Prepare authorised corrections against that exact revision, never against an old export.
3. Stage the complete generation with state `staging`; verify all records from the server and compare the reconstructed inventory exactly. Keep source and corrected recovery files separately.
4. Deploy the tested rules. They still allow legacy saves while the generation is not active.
5. Activate the staged marker only in an atomic commit that verifies the legacy document's unchanged update time. If the source changed, reconcile and re-stage before proceeding.
6. Release this application through the existing GitHub deployment, verify a real save and reload, and run the nightly backup workflow with `INVENTORY_STORAGE=records`.

Do not roll back to legacy writes after record storage has accepted edits: reconcile those edits first. Retain the legacy workspace and versions as recovery evidence.

## Validation
60 application, import, backup and concurrency tests pass. Eight Firebase emulator tests cover authorised administrators and editors, immutable history, bounded record batches, legacy freeze, unauthorised reads and revoked access. Production activation and verification remain deployment steps; a code commit alone does not complete them.
