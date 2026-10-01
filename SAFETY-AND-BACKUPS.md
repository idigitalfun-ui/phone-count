# Inventory protection and nightly backups

The app must load a verified Firebase revision for the signed-in account before
it can save. Missing workspaces are never created automatically. Empty inventory,
empty movement history, shortened movement history and large bulk item losses
are blocked. Google and verified email/password login allow the two named
administrator accounts already present in Firebase Authentication.

Every successful cloud save atomically preserves the exact previous workspace
in phone_count_workspaces/main/versions/{revision}. Firestore rules require that
copy and deny modification or deletion of existing versions. Old app clients
that do not preserve history will be denied writes after these rules deploy.
Deploy the updated app and rules together and reload all open app tabs.

GitHub Actions runs at 01:17 UTC each night (02:17 BST, 01:17 GMT).
It commits a snapshot only if the inventory payload changed, on inventory-backups.
It retains every snapshot and a separate latest-nonempty pointer. It does not
restore inventory, overwrite main's phone_count_data.json or deploy the app.
GitHub scheduling can be delayed; per-save Firebase versions provide protection
between scheduled backups.

## Activation

1. Create the inventory-backups branch.
2. Set the repository Actions secret GOOGLE_SERVICE_ACCOUNT_JSON to a dedicated
   Google service account with Cloud Datastore Viewer on phone-count only.
   Put the credential in GitHub Settings > Secrets and variables > Actions;
   never paste it into a chat or commit it.
3. Merge the workflow onto main, run it manually, and verify the first snapshot
   and then an unchanged run before relying on nightly backups.
4. Publish firestore.rules and deploy index.html and public/index.html together.
5. Test Google login and the existing email/password user. Email verification is
   required; the app sends a verification email on an unverified login attempt.

Versions increase Firestore storage and read/write usage; monitor the project's
quota. They are intentionally not automatically purged. Administrator server
credentials bypass security rules, so these controls cannot protect against
misuse of those credentials.

The current empty cloud inventory is not restored by this change. Reconcile
recovery-input files and check for newer backups before restoring the older data.
