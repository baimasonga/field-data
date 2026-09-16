import { Container } from '@cloudflare/containers';

export class FieldDataContainer extends Container {
  defaultPort = 8080;
  requiredPorts = [8080, 8383];
  sleepAfter = '10m';
  pingEndpoint = '/healthz';
  envVars = {
    DOMAIN: this.env.DOMAIN,
    SYSADMIN_EMAIL: this.env.SYSADMIN_EMAIL,
    PGHOST: this.env.PGHOST,
    PGPORT: this.env.PGPORT || '5432',
    PGDATABASE: this.env.PGDATABASE || 'postgres',
    PGUSER: this.env.PGUSER,
    PGPASSWORD: this.env.PGPASSWORD,
    PGSSLMODE: 'require',
    PGOPTIONS: this.env.PGOPTIONS || '-c search_path=field_data,public',
    DB_POOL_SIZE: this.env.DB_POOL_SIZE || '5',
    EMAIL_FROM: this.env.EMAIL_FROM || `no-reply@${this.env.DOMAIN}`,
    EMAIL_HOST: this.env.EMAIL_HOST,
    EMAIL_PORT: this.env.EMAIL_PORT || '587',
    EMAIL_SECURE: this.env.EMAIL_SECURE || 'false',
    EMAIL_IGNORE_TLS: this.env.EMAIL_IGNORE_TLS || 'false',
    EMAIL_USER: this.env.EMAIL_USER || '',
    EMAIL_PASSWORD: this.env.EMAIL_PASSWORD || '',
    OIDC_ENABLED: this.env.OIDC_ENABLED || 'false',
    OIDC_ISSUER_URL: this.env.OIDC_ISSUER_URL || '',
    OIDC_CLIENT_ID: this.env.OIDC_CLIENT_ID || '',
    OIDC_CLIENT_SECRET: this.env.OIDC_CLIENT_SECRET || '',
    SENTRY_DSN_FRONTEND: this.env.SENTRY_DSN_FRONTEND || '',
    SUPABASE_S3_ENDPOINT: this.env.SUPABASE_S3_ENDPOINT,
    SUPABASE_S3_ACCESS_KEY_ID: this.env.SUPABASE_S3_ACCESS_KEY_ID,
    SUPABASE_S3_SECRET_ACCESS_KEY: this.env.SUPABASE_S3_SECRET_ACCESS_KEY,
    SUPABASE_STORAGE_BUCKET: this.env.SUPABASE_STORAGE_BUCKET,
    SUPABASE_REGION: this.env.SUPABASE_REGION,
    PYXFORM_HOST: this.env.PYXFORM_HOST,
    PYXFORM_PORT: this.env.PYXFORM_PORT || '443',
    PYXFORM_PROTOCOL: this.env.PYXFORM_PROTOCOL || 'https',
    ENKETO_URL: this.env.ENKETO_URL,
    ENKETO_API_KEY: this.env.ENKETO_API_KEY,
    FIELD_DATA_STORAGE_MODE: 'object',
    FIELD_DATA_OBJECT_PREFIX: 'field-data/',
    FIELD_DATA_UPLOAD_MAX_BYTES: this.env.FIELD_DATA_UPLOAD_MAX_BYTES || '26214400',
    FIELD_DATA_BACKUP_PASSPHRASE: this.env.FIELD_DATA_BACKUP_PASSPHRASE,
    FIELD_DATA_WEBHOOK_ENCRYPTION_KEY: this.env.FIELD_DATA_WEBHOOK_ENCRYPTION_KEY,
    HTTPS_PORT: '443',
    SSL_TYPE: 'upstream',
    SESSION_LIFETIME: this.env.SESSION_LIFETIME || '86400'
  };

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
