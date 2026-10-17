#!/bin/bash -eu
set -o pipefail
shopt -s inherit_errexit

# Sourced by the cron scripts. Opens fd 3 and fd 4 on the container's own
# stdout and stderr (PID 1's), so job output reaches the container log.
# Where those cannot be reopened, as on Cloudflare where PID 1 writes to a
# socket and opening /proc/1/fd/1 fails with "No such device or address",
# fall back to the script's own output instead of failing before the job runs.
{ exec 3>/proc/1/fd/1; } 2>/dev/null || exec 3>&1
{ exec 4>/proc/1/fd/2; } 2>/dev/null || exec 4>&2
