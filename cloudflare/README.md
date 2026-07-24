# Cloudflare Containers deployment

Field Data runs as one Cloudflare Container behind a Worker/Durable Object. The
container serves the built frontend and the ODK API. Persistent state must live
outside the container:

- PostgreSQL: a managed, internet-reachable PostgreSQL service with TLS.
- Media, ODK blobs, and encrypted backups: Cloudflare R2 through its S3 API.
- XLSForm conversion: an external `pyxform-http` service.
- Enketo: an external Enketo service. ODK Web Forms remains available in the
  frontend, but Central still expects Enketo configuration for compatibility.
- Email: an external SMTP service.

Cloudflare Container disks are ephemeral. Do not point production media or
backups at the local filesystem.

## 1. Configure public values

Edit `wrangler.jsonc` and replace every placeholder in `vars`, especially:

- `DOMAIN`
- `SYSADMIN_EMAIL`
- `R2_ACCOUNT_ID`
- `S3_BUCKET_NAME`
- `PYXFORM_HOST`
- `ENKETO_URL`
- SMTP settings

Create the R2 bucket named in `S3_BUCKET_NAME`.

## 2. Add secrets

Run each command and paste the real value when Wrangler prompts:

```bash
npx wrangler secret put PGHOST
npx wrangler secret put PGPORT
npx wrangler secret put PGDATABASE
npx wrangler secret put PGUSER
npx wrangler secret put PGPASSWORD
npx wrangler secret put S3_ACCESS_KEY
npx wrangler secret put S3_SECRET_KEY
npx wrangler secret put FIELD_DATA_BACKUP_PASSPHRASE
npx wrangler secret put ENKETO_API_KEY
npx wrangler secret put EMAIL_PASSWORD
```

The backup passphrase must contain at least 16 characters. Store it in a
separate password manager: encrypted backup files cannot be restored without
it.

## 3. Validate and deploy

Docker must be running and building Linux AMD64 images.

```bash
npm clean-install
npm run check
npm run deploy
npx wrangler containers list
npx wrangler tail
```

After the first deployment, allow several minutes for the image to be
provisioned. Add the Worker route or custom domain only after `/healthz`
returns `200`.
