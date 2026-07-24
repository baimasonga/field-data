#!/bin/bash -eu
set -o pipefail

required=(
  DOMAIN SYSADMIN_EMAIL PGHOST PGDATABASE PGUSER PGPASSWORD
  S3_SERVER S3_ACCESS_KEY S3_SECRET_KEY S3_BUCKET_NAME
  FIELD_DATA_BACKUP_PASSPHRASE FIELD_DATA_WEBHOOK_ENCRYPTION_KEY
  PYXFORM_HOST ENKETO_URL ENKETO_API_KEY
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
export S3_OBJECT_PREFIX="${S3_OBJECT_PREFIX:-odk/}"
export PYXFORM_PORT="${PYXFORM_PORT:-443}"
export PYXFORM_PROTOCOL="${PYXFORM_PROTOCOL:-https}"
export SESSION_LIFETIME="${SESSION_LIFETIME:-86400}"
export DB_POOL_SIZE="${DB_POOL_SIZE:-10}"
export HTTPS_PORT=443

printf '%s' "$ENKETO_API_KEY" > /etc/secrets/enketo-api-key

export ENKETO_ORIGIN="${ENKETO_URL%/-}"
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
  kill -TERM "${service_pid:-}" "${nginx_pid:-}" 2>/dev/null || true
  wait "${service_pid:-}" "${nginx_pid:-}" 2>/dev/null || true
}
trap shutdown TERM INT

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
wait -n "$service_pid" "$nginx_pid"
status=$?
shutdown
exit "$status"
