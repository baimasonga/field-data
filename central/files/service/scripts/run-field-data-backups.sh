#!/bin/bash -eu
set -o pipefail
cd /usr/odk
. ./container-output.sh
/usr/local/bin/node lib/bin/run-field-data-backups.js >&3 2>&4
