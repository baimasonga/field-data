#!/bin/bash -eu
set -o pipefail
shopt -s inherit_errexit

cd /usr/odk
. ./container-output.sh
/usr/local/bin/node lib/bin/run-analytics.js >&3 2>&4
