# Cloudflare Containers deployment with Supabase

Field Data runs as one Cloudflare Container behind a Worker and Durable Object.
The container disk is ephemeral. Durable state is external:

- Database: Supabase PostgreSQL through the Supavisor session pooler with TLS.
- Media and encrypted manual backups: a private Supabase Storage bucket through
  the server-side S3 endpoint.
- XLSForm conversion: an external `pyxform-http` service.
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

Field Data connects with `PGOPTIONS=-c search_path=field_data,public`, so ODK
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
- `PYXFORM_HOST`
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

After first deployment, wait for provisioning and verify `/healthz`. Then sign
in and confirm the dashboard reports both database and file storage as healthy.
Upload and download a test media file, create an encrypted manual backup, and
delete the test file.

## 5. Production protection

- Enable Supabase daily database backups and Point-in-Time Recovery where the
  selected plan supports it.
- Keep the Storage bucket private.
- Store Cloudflare and Supabase credentials only in their secret stores.
- Restore the latest database and encrypted application backup into an
  isolated environment at least monthly.
- Review Supabase database, Auth and Storage logs after each deployment.
