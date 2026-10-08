#!/bin/bash -eu
set -o pipefail
cd /usr/odk
/usr/local/bin/node lib/bin/run-field-data-exports.js >/proc/1/fd/1 2>/proc/1/fd/2
