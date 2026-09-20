#!/bin/bash
set -euo pipefail
cd /usr/odk
/usr/local/bin/node lib/bin/run-field-data-xls-reports.js >/proc/1/fd/1 2>/proc/1/fd/2
