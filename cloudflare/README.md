# Cloudflare Containers deployment with Supabase

Field Data runs as one Cloudflare Container behind a Worker and Durable Object.
The container disk is ephemeral. Durable state is external:

- Database: Supabase PostgreSQL through the Supavisor session pooler with TLS.
- Media and encrypted manual backups: a private Supabase Storage bucket through
  the server-side S3 endpoint.
- XLSForm conversion: the internal Field Data Form Compiler, powered by the maintained `pyxform` engine.
- Enketo: an external Enketo service.
- Email: an external SMTP service.

Supabase Auth does not replace ODK Central authentication in this deployment.
ODK remains the system of record for users, roles, projects and submissions.

## 1. Create a dedicated Supabase project

Use a dedicated project rather than sharing a database with another production
application. In the SQL editor, create a private schema for ODK:

```sql
create schema if not exists field_data;
revoke all on schema field_data from public, anon, authenticated;
```

Field Data connects with `PGOPTIONS=-c search_path=field_data,extensions,public`, so ODK
tables and migrations are created outside Supabase's Data API-exposed `public`
schema. Do not add `field_data` to the Data API's exposed schemas.

From **Connect**, copy the session-pooler values:

- `PGHOST`: the `*.pooler.supabase.com` host
- `PGPORT`: `5432` for session mode
- `PGDATABASE`: `postgres`
- `PGUSER`: normally `postgres.<project-ref>`
- `PGPASSWORD`: the project database password

Use session mode, not transaction mode. ODK is a long-running service and uses
database sessions, migrations and transactions that should not be routed
through transaction pooling.

## 2. Create private Storage

Create a private bucket named `field-data-production`. Set a bucket upload limit
appropriate for media and encrypted database backups.

In **Storage > S3**, generate server-side S3 access keys and copy:

- endpoint: `https://<project-ref>.storage.supabase.co/storage/v1/s3`
- region: the project's region
- access key ID
- secret access key

S3 access keys bypass Storage RLS and must remain Cloudflare secrets. They are
never sent to the browser. The application continues to enforce ODK
authorization before every media or backup operation.

## 3. Configure Cloudflare

Replace the public placeholders in `wrangler.jsonc`, including:

- `DOMAIN`
- `SYSADMIN_EMAIL`
- `SUPABASE_S3_ENDPOINT`
- `SUPABASE_STORAGE_BUCKET`
- `SUPABASE_REGION`
- `ENKETO_URL`
- SMTP settings

Add secrets:

```bash
npx wrangler secret put PGHOST
npx wrangler secret put PGPORT
npx wrangler secret put PGUSER
npx wrangler secret put PGPASSWORD
npx wrangler secret put SUPABASE_S3_ACCESS_KEY_ID
npx wrangler secret put SUPABASE_S3_SECRET_ACCESS_KEY
npx wrangler secret put FIELD_DATA_BACKUP_PASSPHRASE
npx wrangler secret put FIELD_DATA_WEBHOOK_ENCRYPTION_KEY
npx wrangler secret put ENKETO_API_KEY
npx wrangler secret put EMAIL_PASSWORD
```

No public PyXForm host is required. The compiler is built into the container, listens only on `127.0.0.1:5001`, and is supervised with the Central and nginx processes. `FORM_COMPILER_MAX_BYTES` defaults to 25 MiB and can be adjusted in `wrangler.jsonc`.

The backup passphrase must contain at least 16 characters. Keep it in a
separate password manager; encrypted backups cannot be restored without it.

The webhook encryption key must be exactly 32 random bytes encoded as base64
or 64 hexadecimal characters.

## 4. Validate and deploy

Docker must be running and building Linux AMD64 images.

```bash
npm clean-install
npm run check
npm run deploy
npx wrangler containers list
npx wrangler tail
```

After first deployment, wait for provisioning and verify `/healthz`.

For a repeatable live test, create a dedicated ODK system-administrator account
with a strong unique password. Add its credentials as the GitHub environment
secrets `LIVE_SMOKE_EMAIL` and `LIVE_SMOKE_PASSWORD` in a protected
`production` environment. Run the **Field Data validation** workflow manually,
supply the deployed HTTPS URL, and leave the backup option off for the routine
test. The workflow signs in, verifies the database and Supabase Storage health
probes, uploads/downloads/deletes a small media fixture, and signs out.

Enable the backup option for a supervised release check. It queues an encrypted
backup, waits for the cron worker, and verifies that the completed artifact can
be downloaded. The backup remains in the backup history. Restore tests remain a
separate operator task and must always target an isolated database.

## 5. Production protection

- Enable Supabase daily database backups and Point-in-Time Recovery where the
  selected plan supports it.
- Keep the Storage bucket private.
- Store Cloudflare and Supabase credentials only in their secret stores.
- Restore the latest database and encrypted application backup into an
  isolated environment at least monthly.
- Review Supabase database, Auth and Storage logs after each deployment.

## 6. Manual backup jobs and recovery

The backup endpoint requires the ODK `backup.run` permission. It returns HTTP
202 after queuing a job. Repeated requests reuse a pending or running job. Cron
starts the backup runner every minute; use Refresh on the backup page to check
its status. Only successful backups can be downloaded.

The runner serializes uploads with a PostgreSQL session advisory lock, records
interrupted jobs as failed, and limits each dump/upload to 30 minutes. Keep
Supavisor in session mode. Ensure cron is running inside the container and keep
`FIELD_DATA_BACKUP_PASSPHRASE` configured on the server.

Application dumps include only the `field_data` schema. They do not include
Supabase-managed schemas or the separate Storage objects. Preserve media objects
separately and test them together with database recovery.

For recovery, use an isolated empty PostgreSQL database with the required
`citext` and `pg_trgm` extensions. Decrypt the downloaded file with OpenSSL
(`enc -d -chacha20 -pbkdf2`, supplying the passphrase through a protected prompt
or environment), then restore the custom-format dump with `pg_restore
--exit-on-error --no-owner --no-acl` into that isolated database. Verify users,
projects, submissions and media access before any production cutover. Do not
use the legacy whole-database restore helper against Supabase: it is disabled
for schema-scoped deployments because it can drop unrelated objects.

Run the compiler contract checks from `cloudflare/form-compiler`:

```bash
python -m pip install -r requirements.txt
python -m unittest -v test_app.py
```

Run focused server regression checks from `central/server`:

```bash
node --test test/field-data/hardening.cjs
```
