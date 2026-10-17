#!/bin/bash -eu
set -o pipefail
cd /usr/odk
. ./container-output.sh

# Each run leaves a row in cron_log, so whether cron fires at all, and why the
# runner fails when it does, can be read from the database: the container log
# is not readable from every place this is deployed from. Recording must never
# stop the runner itself.
schema="${FIELD_DATA_DB_SCHEMA:-public}"
record() {
  psql --no-password --quiet --set=ON_ERROR_STOP=1 \
    --set=schema="$schema" --set=job=operations --set=outcome="$1" --set=detail="$2" \
    >/dev/null 2>&1 <<'SQL' || true
    create table if not exists :"schema".cron_log (
      id bigserial primary key,
      at timestamptz not null default clock_timestamp(),
      job text not null,
      outcome text not null,
      detail text not null);
    insert into :"schema".cron_log (job, outcome, detail) values (:'job', :'outcome', :'detail');
    delete from :"schema".cron_log where at < clock_timestamp() - interval '7 days';
SQL
}

record started "cron started the operations runner"
errors=$(mktemp)
status=0
if /usr/local/bin/node lib/bin/run-field-data-operations.js >&3 2>"$errors"; then
  record succeeded "operations runner finished"
else
  status=$?
  record failed "exit $status: $(tail -c 500 "$errors" | tr '\n' ' ')"
fi
cat "$errors" >&4 || true
rm -f "$errors"
# The runner's own status, so cron and manual callers still see a failure.
exit "$status"
