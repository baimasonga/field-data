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
export DB_POOL_SIZE="${DB_POOL_SIZE:-5}"
export HTTPS_PORT=443

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

nginx -g 'daemon off;' &
nginx_pid=$!
wait -n "$compiler_pid" "$service_pid" "$nginx_pid"
status=$?
shutdown
exit "$status"
