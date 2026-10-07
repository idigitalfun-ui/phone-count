# Inventory backups

GitHub Actions checks Firebase nightly at 01:17 UTC (02:17 in Ireland during summer, 01:17 during winter). An unchanged inventory creates no snapshot and no backup commit. The check itself must still run to detect changes.

Only one new snapshot is allowed per UTC date, including manual runs and reruns. Changes made after that snapshot wait until the following night. A failed job that never publishes a snapshot can be retried. Jobs are serialized and fetch the current inventory-backups branch before checking its last snapshot.

The inventory-backups branch keeps at most three snapshot files in backups/phone-count/snapshots. Older snapshot files are removed as a new snapshot is committed. latest.json and latest-nonempty.json are small pointers, not additional inventory copies. Git commit history remains recoverable; this does not permanently erase old Git history.

The content hash ignores object-key order and meta.lastSaved. Invalid inventories and missing revisions fail without publishing. Empty inventory cannot replace an existing usable backup. If legacy empty snapshots exist, retention reserves one of the three slots for the last usable recovery point.

Activation requires the repository Actions secret GOOGLE_SERVICE_ACCOUNT_JSON containing the dedicated read-only Firebase service account key. Never commit the key or paste it into chat. Verify activation with a manual workflow run, then another unchanged run; the second must create no new snapshot or commit.
