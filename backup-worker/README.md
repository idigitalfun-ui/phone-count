# IDFL inventory backup worker

This is a separate Cloudflare Worker for the two Firebase projects. It runs every Sunday at 01:00 UTC, takes a read-only Firestore snapshot of each app, and keeps at most four backups per app (and nothing older than 31 days).

It intentionally has no public backup-download endpoint. The Firebase service-account JSON is a Cloudflare secret only; never add it to this repository.

## One-time setup

1. Sign in to Cloudflare with `npx wrangler login`.
2. Run `npx wrangler d1 create idfl-inventory-backups` and copy the returned database ID into `wrangler.jsonc`, created from `wrangler.jsonc.example`.
3. Run `npx wrangler d1 execute idfl-inventory-backups --remote --file schema.sql`.
4. In Google Cloud, create a dedicated service account such as `idfl-backups`. Give it the **Cloud Datastore Viewer** role in both the `phone-count` and `vapes-1a7d0` projects. Create one JSON key and keep the downloaded file private.
5. Run `npx wrangler secret put GOOGLE_SERVICE_ACCOUNT_JSON`, then paste the entire service-account JSON when prompted.
6. Run `npx wrangler deploy`.

The Worker only accepts scheduled work. Visiting its address returns 404 and cannot reveal a backup.
