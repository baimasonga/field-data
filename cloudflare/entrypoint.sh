#!/bin/bash -eu
set -o pipefail

required=(
  DOMAIN SYSADMIN_EMAIL PGHOST PGPORT PGDATABASE PGUSER PGPASSWORD
  SUPABASE_S3_ENDPOINT SUPABASE_S3_ACCESS_KEY_ID
  SUPABASE_S3_SECRET_ACCESS_KEY SUPABASE_STORAGE_BUCKET SUPABASE_REGION
  FIELD_DATA_BACKUP_PASSPHRASE FIELD_DATA_WEBHOOK_ENCRYPTION_KEY
)
for variable in "${required[@]}"; do
  if [[ -z "${!variable:-}" || "${!variable}" == replace-with-* ]]; then
    echo "Required environment variable $variable is missing or still a placeholder." >&2
    exit 1
  fi
done

export DB_SSL=null
export NODE_OPTIONS="${NODE_OPTIONS:-}"
export PGAPPNAME="${PGAPPNAME:-field-data}"
export PGSSLMODE=require
export FIELD_DATA_DB_SCHEMA=field_data
export PGOPTIONS="-c search_path=field_data,extensions,public"
export EMAIL_FROM="${EMAIL_FROM:-no-reply@$DOMAIN}"
export EMAIL_PORT="${EMAIL_PORT:-587}"
export EMAIL_SECURE="${EMAIL_SECURE:-false}"
export EMAIL_IGNORE_TLS="${EMAIL_IGNORE_TLS:-false}"
export EMAIL_USER="${EMAIL_USER:-}"
export EMAIL_PASSWORD="${EMAIL_PASSWORD:-}"
export OIDC_ENABLED="${OIDC_ENABLED:-false}"
export OIDC_ISSUER_URL="${OIDC_ISSUER_URL:-}"
export OIDC_CLIENT_ID="${OIDC_CLIENT_ID:-}"
export OIDC_CLIENT_SECRET="${OIDC_CLIENT_SECRET:-}"
export SENTRY_ORG_SUBDOMAIN="${SENTRY_ORG_SUBDOMAIN:-o130137}"
export SENTRY_KEY="${SENTRY_KEY:-}"
export SENTRY_PROJECT="${SENTRY_PROJECT:-1298632}"
export SENTRY_TRACE_RATE="${SENTRY_TRACE_RATE:-0}"
export SENTRY_DSN_FRONTEND="${SENTRY_DSN_FRONTEND:-}"
export PYXFORM_HOST=127.0.0.1
export PYXFORM_PORT=5001
export PYXFORM_PROTOCOL=http
export FORM_COMPILER_MAX_BYTES="${FORM_COMPILER_MAX_BYTES:-26214400}"
export SESSION_LIFETIME="${SESSION_LIFETIME:-86400}"
export DB_POOL_SIZE="${DB_POOL_SIZE:-3}"
export HTTPS_PORT=443
export BASE_URL="https://$DOMAIN"
# The native Supabase adapter reads SUPABASE_* directly. These optional
# legacy blob-store fields must still exist for strict template rendering.
export S3_SERVER="${S3_SERVER:-}"
export S3_ACCESS_KEY="${S3_ACCESS_KEY:-}"
export S3_SECRET_KEY="${S3_SECRET_KEY:-}"
export S3_BUCKET_NAME="${S3_BUCKET_NAME:-}"
export S3_OBJECT_PREFIX="${S3_OBJECT_PREFIX:-}"

# `start-odk.sh` serializes the container environment for cron jobs and aborts
# the whole boot if it cannot write the block. Cloudflare's container runtime
# does not mount /dev/shm, so resolve a writable location before starting
# anything and point both the script and the crontab at it.
envblock_dir=""
for candidate in /dev/shm /run/field-data /tmp; do
  if mkdir -p "$candidate" 2>/dev/null && [[ -w "$candidate" ]]; then
    envblock_dir="$candidate"
    break
  fi
done
if [[ -z "$envblock_dir" ]]; then
  echo "No writable directory available for the cron environment block." >&2
  exit 1
fi
export ODK_ENVBLOCK="$envblock_dir/docker-envblock"

sed "s#/dev/shm/docker-envblock#$ODK_ENVBLOCK#g" \
  < /usr/share/odk/crontab.template \
  > /etc/cron.d/odk
chmod 0644 /etc/cron.d/odk

/scripts/envsub.awk \
  < /usr/share/odk/cloudflare-nginx.conf.template \
  > /etc/nginx/conf.d/field-data.conf

/scripts/envsub.awk \
  < /usr/share/odk/config.json.template \
  > /usr/odk/config/local.json

OIDC_ENABLED="$OIDC_ENABLED" SENTRY_DSN_FRONTEND="$SENTRY_DSN_FRONTEND" \
  /scripts/envsub.awk \
  < /usr/share/nginx/html/client-config.json.template \
  > /usr/share/nginx/html/client-config.json 2>/dev/null || \
  printf '{"oidcEnabled":%s,"sentryDsn":"%s"}\n' "$OIDC_ENABLED" "$SENTRY_DSN_FRONTEND" \
    > /usr/share/nginx/html/client-config.json

shutdown() {
  kill -TERM "${compiler_pid:-}" "${service_pid:-}" "${nginx_pid:-}" 2>/dev/null || true
  wait "${compiler_pid:-}" "${service_pid:-}" "${nginx_pid:-}" 2>/dev/null || true
}
trap shutdown TERM INT

# Bind the public port first. The backend needs minutes to run migrations and
# boot, and Cloudflare gives up on a container that has not opened its port,
# so /healthz has to answer while the rest of the stack is still coming up.
nginx -g 'daemon off;' &
nginx_pid=$!

cd /opt/field-data-form-compiler
./venv/bin/gunicorn \
  --bind 127.0.0.1:5001 --workers 1 --threads 2 \
  --timeout 120 --graceful-timeout 30 --access-logfile - --error-logfile - \
  app:application &
compiler_pid=$!

until curl --silent --fail http://127.0.0.1:5001/healthz >/dev/null; do
  if ! kill -0 "$compiler_pid" 2>/dev/null; then
    wait "$compiler_pid"
    exit $?
  fi
  sleep 1
done

cd /usr/odk
./start-odk.sh &
service_pid=$!

until nc -z 127.0.0.1 8383; do
  if ! kill -0 "$service_pid" 2>/dev/null; then
    wait "$service_pid"
    exit $?
  fi
  sleep 1
done

# Cloudflare containers offer no shell, so the first administrator cannot be
# created by hand the way a Docker deployment would. Create it here, once: an
# account that already exists is never touched, so a password set or a role
# granted later survives the next boot. A failure here must not take down a
# server that is otherwise working.
# The container log is not readable from every place this is deployed from, so
# the outcome of the bootstrap is also written to a table anyone with database
# access can read. Failing to record it must never fail the boot.
note() {
  local outcome=$1 detail=$2
  echo "bootstrap: $detail"
  psql --no-password --quiet \
    --set=schema="$FIELD_DATA_DB_SCHEMA" --set=outcome="$outcome" \
    --set=detail="$detail" --command '
      create table if not exists :"schema".bootstrap_log (
        id bigserial primary key,
        at timestamptz not null default clock_timestamp(),
        outcome text not null,
        detail text not null);
      insert into :"schema".bootstrap_log (outcome, detail)
      values (:'"'"'outcome'"'"', :'"'"'detail'"'"');' >/dev/null 2>&1 || true
}

bootstrap_admin() {
  local existing probe

  # Say what we have before using it. The value never appears, only whether it
  # is there and how long, which is the difference between "the secret never
  # arrived" and "the secret is wrong".
  if [[ -n "${FIELD_DATA_ADMIN_PASSWORD:-}" ]]; then
    echo "bootstrap: FIELD_DATA_ADMIN_PASSWORD is set (${#FIELD_DATA_ADMIN_PASSWORD} characters)."
  else
    echo "bootstrap: FIELD_DATA_ADMIN_PASSWORD is not set."
  fi
  echo "bootstrap: looking for $SYSADMIN_EMAIL in schema $FIELD_DATA_DB_SCHEMA."

  # Schema-qualified rather than relying on PGOPTIONS reaching the server: the
  # connection goes through a pooler, and an unqualified name here fails with
  # an error this function used to swallow.
  probe=$(psql --no-password --quiet --tuples-only --no-align \
    --set=email="$SYSADMIN_EMAIL" --set=schema="$FIELD_DATA_DB_SCHEMA" \
    --command 'select 1 from :"schema".users where email = :'"'"'email'"'"' limit 1' 2>&1) \
    || { note failed "could not query for an existing administrator: $probe"
         return 1; }
  existing=$probe

  if [[ -n "$existing" ]]; then
    note exists "$SYSADMIN_EMAIL already exists; leaving it untouched."
    return 0
  fi

  if [[ -z "${FIELD_DATA_ADMIN_PASSWORD:-}" ]]; then
    note failed "no account exists for $SYSADMIN_EMAIL and FIELD_DATA_ADMIN_PASSWORD is not set, so nobody can log in."
    return 0
  fi

  # The server refuses a password under ten characters, or over the seventy-two
  # bytes bcrypt reads, and it refuses it inside the same transaction that
  # creates the account. So a password that is a character too short leaves no
  # user, no half-made record and nothing in the database to explain itself.
  # Say it here instead, where the reason is still to hand.
  if (( ${#FIELD_DATA_ADMIN_PASSWORD} < 10 )); then
    note failed "FIELD_DATA_ADMIN_PASSWORD is ${#FIELD_DATA_ADMIN_PASSWORD} characters; the server requires at least 10, so no administrator was created."
    return 1
  fi
  if (( $(printf %s "$FIELD_DATA_ADMIN_PASSWORD" | wc -c) > 72 )); then
    note failed "FIELD_DATA_ADMIN_PASSWORD is longer than the 72 bytes bcrypt reads, so no administrator was created."
    return 1
  fi

  # odk-cmd reads the password through an interactive prompt library, which
  # needs a usable stdin and hides the reason for any failure. Call the tasks
  # it wraps instead: they read the environment and print the real error.
  node -e 'const { run } = require("/usr/odk/lib/task/task");
    const { createUser } = require("/usr/odk/lib/task/account");
    run(createUser(process.env.SYSADMIN_EMAIL, process.env.FIELD_DATA_ADMIN_PASSWORD));' \
    || { note failed "creating $SYSADMIN_EMAIL failed; the reason is on the line above this one."
         return 1; }
  node -e 'const { run } = require("/usr/odk/lib/task/task");
    const { promoteUser } = require("/usr/odk/lib/task/account");
    run(promoteUser(process.env.SYSADMIN_EMAIL));' \
    || { note failed "promoting $SYSADMIN_EMAIL failed; the reason is on the line above this one."
         return 1; }
  note created "created administrator $SYSADMIN_EMAIL."
}

bootstrap_admin || echo "Administrator bootstrap failed; the server keeps running." >&2

wait -n "$compiler_pid" "$service_pid" "$nginx_pid"
status=$?
shutdown
exit "$status"
