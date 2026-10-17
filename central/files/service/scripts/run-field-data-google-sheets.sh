#!/bin/bash
set -euo pipefail
cd /usr/odk
. ./container-output.sh
/usr/local/bin/node lib/bin/run-field-data-google-sheets.js >&3 2>&4
