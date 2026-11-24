# Record storage migration — preparation only
This branch adds the lossless record codec and change planner. It does NOT activate record writes, change security rules or migrate production. The old client still uses the legacy workspace.
## Required activation work
1. Freeze legacy writes with deployed rules while retaining reads. Export latest server revision and local unsaved changes separately.
2. Stage records in a new generation with individually scoped device/product/movement documents. Validate unique IDs, byte sizes, totals and exact round trip. Never publish the provided historical export over newer cloud state.
3. Implement atomic transactions with per-record preconditions, a generation pointer, duplicate IMEI constraints, and a durable local pending-change queue. Avoid a growing global index; separate order metadata where needed. Security rules must enforce authorised access and immutable audit records. Reject stale legacy clients.
4. Adapt CSV imports to check sales history before stock-in, require exact catalogue match or explicit selection, and report success only after committed server write. Preserve original purchase dates for recovery entries.
5. Update nightly backup to read a consistent record generation and verify complete recovery. Test against emulator including concurrency, rollback, failed imports and access revocation.
6. Deploy rules and app in a controlled cutover; retain legacy main and versions as read-only recovery. Do not activate until all checks pass.
