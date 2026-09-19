import { env } from 'cloudflare:workers';
import { Container } from '@cloudflare/containers';

// A cold start runs database migrations and boots the ODK service before port
// 8383 listens, which takes far longer than the 20s the container library
// allows by default when it waits for ports.
const BOOT_TIMEOUT_MS = 10 * 60 * 1000;

export class FieldDataContainer extends Container {
  #boot = null;

  defaultPort = 8080;
  requiredPorts = [8080, 8383];
  sleepAfter = '10m';
  pingEndpoint = '/healthz';
  envVars = {
    DOMAIN: env.DOMAIN,
    SYSADMIN_EMAIL: env.SYSADMIN_EMAIL,
    PGHOST: env.PGHOST,
    PGPORT: env.PGPORT || '5432',
    PGDATABASE: env.PGDATABASE || 'postgres',
    PGUSER: env.PGUSER,
    PGPASSWORD: env.PGPASSWORD,
    PGSSLMODE: 'require',
    PGOPTIONS: env.PGOPTIONS || '-c search_path=field_data,public',
    DB_POOL_SIZE: env.DB_POOL_SIZE || '5',
    EMAIL_FROM: env.EMAIL_FROM || `no-reply@${env.DOMAIN}`,
    EMAIL_HOST: env.EMAIL_HOST,
    EMAIL_PORT: env.EMAIL_PORT || '587',
    EMAIL_SECURE: env.EMAIL_SECURE || 'false',
    EMAIL_IGNORE_TLS: env.EMAIL_IGNORE_TLS || 'false',
    EMAIL_USER: env.EMAIL_USER || '',
    EMAIL_PASSWORD: env.EMAIL_PASSWORD || '',
    OIDC_ENABLED: env.OIDC_ENABLED || 'false',
    OIDC_ISSUER_URL: env.OIDC_ISSUER_URL || '',
    OIDC_CLIENT_ID: env.OIDC_CLIENT_ID || '',
    OIDC_CLIENT_SECRET: env.OIDC_CLIENT_SECRET || '',
    SENTRY_DSN_FRONTEND: env.SENTRY_DSN_FRONTEND || '',
    SUPABASE_S3_ENDPOINT: env.SUPABASE_S3_ENDPOINT,
    SUPABASE_S3_ACCESS_KEY_ID: env.SUPABASE_S3_ACCESS_KEY_ID,
    SUPABASE_S3_SECRET_ACCESS_KEY: env.SUPABASE_S3_SECRET_ACCESS_KEY,
    SUPABASE_STORAGE_BUCKET: env.SUPABASE_STORAGE_BUCKET,
    SUPABASE_REGION: env.SUPABASE_REGION,
    FORM_COMPILER_MAX_BYTES: env.FORM_COMPILER_MAX_BYTES || '26214400',
    FIELD_DATA_STORAGE_MODE: 'object',
    FIELD_DATA_OBJECT_PREFIX: 'field-data/',
    FIELD_DATA_UPLOAD_MAX_BYTES: env.FIELD_DATA_UPLOAD_MAX_BYTES || '26214400',
    FIELD_DATA_BACKUP_PASSPHRASE: env.FIELD_DATA_BACKUP_PASSPHRASE,
    FIELD_DATA_WEBHOOK_ENCRYPTION_KEY: env.FIELD_DATA_WEBHOOK_ENCRYPTION_KEY,
    FIELD_DATA_ADMIN_PASSWORD: env.FIELD_DATA_ADMIN_PASSWORD || '',
    HTTPS_PORT: '443',
    SSL_TYPE: 'upstream',
    SESSION_LIFETIME: env.SESSION_LIFETIME || '86400'
  };

  async fetch(request) {
    // `containerFetch()` starts the container with the default port timeout, so
    // do the start here instead with a budget that matches a real cold boot.
    this.#boot ??= this.startAndWaitForPorts({
      cancellationOptions: { portReadyTimeoutMS: BOOT_TIMEOUT_MS }
    }).catch((error) => {
      this.#boot = null;
      throw error;
    });
    await this.#boot;
    return super.fetch(request);
  }

  onStart() {
    console.log('Field Data container started');
  }

  onStop({ exitCode, reason }) {
    console.log('Field Data container stopped', { exitCode, reason });
  }

  onError(error) {
    console.error('Field Data container error', error);
    throw error;
  }
}

const primary = (env) => env.FIELD_DATA_CONTAINER.getByName('field-data-primary');

export default {
  fetch(request, env) {
    return primary(env).fetch(request);
  },

  async scheduled(controller, env, ctx) {
    ctx.waitUntil(primary(env).fetch(new Request('https://field-data.internal/healthz')));
  }
};
