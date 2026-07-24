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
    PGDATABASE: this.env.PGDATABASE || 'odk',
    PGUSER: this.env.PGUSER || 'odk',
    PGPASSWORD: this.env.PGPASSWORD,
    PGSSLMODE: this.env.PGSSLMODE || 'require',
    DB_POOL_SIZE: this.env.DB_POOL_SIZE || '10',
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
    S3_SERVER: `https://${this.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    S3_ACCESS_KEY: this.env.S3_ACCESS_KEY,
    S3_SECRET_KEY: this.env.S3_SECRET_KEY,
    S3_BUCKET_NAME: this.env.S3_BUCKET_NAME,
    S3_OBJECT_PREFIX: this.env.S3_OBJECT_PREFIX || 'odk/',
    S3_REGION: 'auto',
    PYXFORM_HOST: this.env.PYXFORM_HOST,
    PYXFORM_PORT: this.env.PYXFORM_PORT || '443',
    PYXFORM_PROTOCOL: this.env.PYXFORM_PROTOCOL || 'https',
    ENKETO_URL: this.env.ENKETO_URL,
    ENKETO_API_KEY: this.env.ENKETO_API_KEY,
    FIELD_DATA_STORAGE_MODE: 'object',
    FIELD_DATA_OBJECT_PREFIX: 'field-data/',
    FIELD_DATA_UPLOAD_MAX_BYTES: this.env.FIELD_DATA_UPLOAD_MAX_BYTES || '26214400',
    FIELD_DATA_BACKUP_PASSPHRASE: this.env.FIELD_DATA_BACKUP_PASSPHRASE,
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
