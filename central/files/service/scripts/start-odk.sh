#!/bin/bash -eu
set -o pipefail
shopt -s inherit_errexit

# Check for illegal DB_SSL environment variable.
if ! [[ "${DB_SSL-}" = null ]]; then
  echo "!!!"
  echo "!!! You have the DB_SSL variable defined (in your .env file, probably)."
  echo "!!! This variable is no longer supported from Central 2026.1 onwards."
  echo "!!! There is a new way of configuring SSL for your database, please see:"
  echo "!!!"
  echo "!!!   https://docs.getodk.org/central-install-digital-ocean/#using-a-custom-database-server"
  echo "!!!"
  echo "!!! Please refer to the Central 2026.1.0 release notes for more information on this change."
  echo "!!!"
  echo "!!! ODK Central backend will not start until this issue is resolved."
  echo "!!!"
  sleep 60 # reduce resource waste from quick restart and instant failure
  exit 1
fi
unset DB_SSL

# Serialize (as a raw env block) the environment set up by docker, for later
# availability to processes running with a reset environment (such as cronjobs).
# See https://github.com/getodk/central/issues/1747 .
# See `man 5 proc_pid_environ` .
# The location is overridable because not every container runtime mounts
# /dev/shm; the crontab is rendered with the same path.
envblock="${ODK_ENVBLOCK:-/dev/shm/docker-envblock}"
mkdir -p "$(dirname "$envblock")"
cp --preserve=mode,ownership /proc/self/environ "$envblock"


echo "generating local service configuration.."

ENKETO_API_KEY=$(cat /etc/secrets/enketo-api-key) \
BASE_URL=$( [ "${HTTPS_PORT}" = 443 ] && echo https://"${DOMAIN}" || echo https://"${DOMAIN}":"${HTTPS_PORT}" ) \
/scripts/envsub.awk \
    < /usr/share/odk/config.json.template \
    > /usr/odk/config/local.json

SENTRY_RELEASE="$(cat sentry-versions/server)"
export SENTRY_RELEASE
# shellcheck disable=SC2089
SENTRY_TAGS="{ \"version.central\": \"$(cat sentry-versions/central)\", \"version.client\": \"$(cat sentry-versions/client)\" }"
# shellcheck disable=SC2090
export SENTRY_TAGS

echo "waiting for PostgreSQL to become connectable to..."
while ! (psql --no-password --quiet --command "" > /dev/null 2>&1 || (echo "sleeping 1 second waiting for a database connection"; false)); do sleep 1; done

echo "running migrations.."
node ./lib/bin/run-migrations

# Logs based on SENTRY_RELEASE and SENTRY_TAGS env variables
echo "logging server upgrade.."
node ./lib/bin/log-upgrade

echo "starting cron.."
# Confirm the job environment exists before accepting the container as ready.
# Never print its contents: the block holds database and storage credentials.
if [[ ! -s "$envblock" || ! -r "$envblock" ]]; then
  echo "cron environment block is missing or unreadable." >&2
  exit 1
fi
if ! grep -Fq -- "$envblock" /etc/cron.d/odk; then
  echo "cron configuration does not refer to the current environment block." >&2
  exit 1
fi
cron -f &
cron_pid=$!
# cron may exit immediately on startup errors while the API continues to work.
sleep 1
if ! kill -0 "$cron_pid" 2>/dev/null; then
  echo "cron terminated during startup; scheduled jobs are unavailable." >&2
  wait "$cron_pid" || true
  exit 1
fi
echo "cron process started; worker execution requires separate verification."

is_cgroup2() {
  [ -f /sys/fs/cgroup/cgroup.controllers ]
}

get_memory_limit() {
  local memtot fallback_memtot

  if [ -r /proc/meminfo ]; then
    fallback_memtot=$(awk '/MemTotal/ {print $2 * 1024}' /proc/meminfo)
  else
    fallback_memtot=0
  fi

  if is_cgroup2; then
    if [ -r /sys/fs/cgroup/memory.max ]; then
      memtot=$(cat /sys/fs/cgroup/memory.max)
    else
      memtot="max"
    fi
    if [ "$memtot" = "max" ]; then
      memtot=$fallback_memtot
    fi
  else
    # cgroup v1
    if [ -r /sys/fs/cgroup/memory/memory.limit_in_bytes ]; then
      memtot=$(cat /sys/fs/cgroup/memory/memory.limit_in_bytes)
    else
      memtot=$fallback_memtot
    fi
  fi

  # Force memtot to be an integer (not scientific notation e+09)
  printf "%.0f\n" "$memtot"
}

determine_worker_count() {
  local memtot=$1
  if [ "$memtot" -gt 1100000 ]; then
    echo 4
  else
    echo 1
  fi
}

MEMTOT=$(get_memory_limit)
WORKER_COUNT=$(determine_worker_count "$MEMTOT")
export WORKER_COUNT
echo "using $WORKER_COUNT worker(s) based on available memory ($MEMTOT).."

echo "starting server."
exec npx --no pm2-runtime ./pm2.config.js
