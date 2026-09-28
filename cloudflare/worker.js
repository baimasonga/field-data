import { env } from 'cloudflare:workers';
import { Container } from '@cloudflare/containers';

// A cold start runs database migrations and boots the ODK service before port
// 8383 listens, which takes far longer than the 20s the container library
// allows by default when it waits for ports.
const BOOT_TIMEOUT_MS = 10 * 60 * 1000;

// How long a request will wait for that boot before answering anyway. A person
// who has just opened the page is owed an answer in seconds; the boot carries
// on in the background and the next request picks it up.
const PATIENCE_MS = 20 * 1000;

// A backup signal, not the primary one. Matching the runtime's wording is a
// losing game -- three deploys produced three different sentences -- so the
// state of the container decides, and this only catches the case where the
// container came back up before we got around to asking.
const CONTAINER_UNAVAILABLE =
  /Error proxying request to container|Container suddenly disconnected|container is not running|container just exited|no container instance/i;

const STARTING_UP_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="10">
<title>Starting up</title>
<style>
  :root { color-scheme: dark; }
  body {
    margin: 0; min-height: 100vh; display: grid; place-items: center;
    background: #0c0c11; color: #e0e0ea; padding: 24px;
    font-family: 'Hanken Grotesk', system-ui, -apple-system, sans-serif;
  }
  main { max-width: 32rem; text-align: center; }
  h1 { font-size: 1.5rem; font-weight: 600; margin: 0 0 0.75rem; color: #f8f8fb; }
  p { margin: 0 0 0.5rem; line-height: 1.6; color: #adadbf; }
  .dot {
    display: inline-block; width: 0.5rem; height: 0.5rem; margin-right: 0.5rem;
    border-radius: 50%; background: #5d4ee0;
    animation: pulse 1.4s ease-in-out infinite;
  }
  @keyframes pulse { 0%, 100% { opacity: 0.3; } 50% { opacity: 1; } }
  @media (prefers-reduced-motion: reduce) { .dot { animation: none; } }
</style>
</head>
<body>
  <main>
    <h1><span class="dot"></span>Field Data is starting up</h1>
    <p>The server runs on demand and is waking now. This takes a minute or two
       after it has been idle or has just been updated.</p>
    <p>This page reloads by itself.</p>
  </main>
</body>
</html>`;

// An API caller wants a problem it can parse, not a page it would have to read.
const startingUp = (request) => {
  const wantsHtml = (request.headers.get('accept') || '').includes('text/html');
  return wantsHtml
    ? new Response(STARTING_UP_HTML, {
      status: 503,
      headers: { 'content-type': 'text/html; charset=utf-8', 'retry-after': '15' }
    })
    : new Response(JSON.stringify({
      message: 'The server is starting up. Try again in a moment.',
      code: 503.1
    }), {
      status: 503,
      headers: { 'content-type': 'application/json', 'retry-after': '15' }
    });
};

export class FieldDataContainer extends Container {
  #boot = null;

  defaultPort = 8080;
  // Only the port this proxies to. nginx binds 8080 first precisely so the site
  // can answer while the backend is still running migrations behind it; waiting
  // on 8383 here would throw that away and block every request for the whole
  // cold boot.
  requiredPorts = [8080];
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
    DB_POOL_SIZE: env.DB_POOL_SIZE || '3',
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

  // A deploy only repoints the container application at the new image: an
  // instance that is already running keeps the old one. Nothing retires it on
  // its own either, because the five minute cron ping means it never stays
  // idle long enough to hit sleepAfter. Retire it explicitly when the build it
  // was started from is no longer the deployed one.
  async #retireStaleContainer() {
    const deployed = env.CONTAINER_BUILD_ID || '';
    if (deployed === '') return;
    const running = await this.ctx.storage.get('containerBuildId');
    if (running === deployed) return;
    if (this.container.running) {
      console.log('Retiring container from build', running, 'for', deployed);
      await this.destroy();
      this.#boot = null;
    }
    await this.ctx.storage.put('containerBuildId', deployed);
  }

  async fetch(request) {
    await this.#retireStaleContainer();

    // A boot that has already resolved says the container started once, not
    // that it is running now. It stops on its own: after `sleepAfter`, when a
    // deploy retires it, when it crashes. Reusing a stale resolved promise
    // means never starting it again, and every request after that is proxied
    // at nothing. Forget the boot whenever the container is not up.
    if (!this.container.running) this.#boot = null;

    // `containerFetch()` starts the container with the default port timeout, so
    // do the start here instead with a budget that matches a real cold boot.
    this.#boot ??= this.startAndWaitForPorts({
      cancellationOptions: { portReadyTimeoutMS: BOOT_TIMEOUT_MS }
    }).catch((error) => {
      this.#boot = null;
      throw error;
    });

    // Waiting on the boot with no bound is how a cold start became a browser
    // hanging on a blank tab until Cloudflare gave up on it. Wait a little, then
    // say what is happening. The boot is memoised, so it is still running when
    // the page reloads.
    const late = Symbol('late');
    const waited = await Promise.race([
      this.#boot.then(() => null),
      scheduler.wait(PATIENCE_MS).then(() => late)
    ]);
    if (waited === late) return startingUp(request);

    // The container can still stop between the boot resolving and this proxy
    // being attempted, and the library reports that by throwing. Tell the
    // caller to come back rather than handing them a stack trace; the next
    // request finds it stopped and starts it.
    let response;
    try {
      response = await super.fetch(request);
    } catch (error) {
      console.log('Proxying failed, reporting as starting up:', String(error));
      this.#boot = null;
      return startingUp(request);
    }

    // nginx is up but the backend behind it is not yet, which it reports as a
    // bad gateway. That is the same "not ready" and deserves the same answer.
    if (response.status === 502 || response.status === 504) return startingUp(request);

    // A 500 here is either the application's own or the runtime reporting that
    // the container went away mid-request -- "Container suddenly disconnected",
    // "The container just exited", "Error proxying request to container", three
    // sentences from three deploys. Which one it is does not depend on the
    // wording: if the container is not running, nothing in it produced this.
    // That is a fact to read rather than a string to match, and the wording is
    // kept only as a second signal for when it has already come back up.
    if (response.status === 500) {
      const body = await response.text();
      if (!this.container.running || CONTAINER_UNAVAILABLE.test(body)) {
        console.log('Container was unavailable mid-request, reporting as starting up.');
        this.#boot = null;
        return startingUp(request);
      }
      // Any other 500 is the application's own and is passed through as it
      // came, headers and all.
      return new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers
      });
    }

    return response;
  }

  onStart() {
    console.log('Field Data container started');
  }

  onStop({ exitCode, reason }) {
    console.log('Field Data container stopped', { exitCode, reason });
    // Whatever stopped it, the next request has to start it again.
    this.#boot = null;
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
