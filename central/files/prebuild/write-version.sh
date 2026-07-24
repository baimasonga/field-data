#!/bin/bash
set -e

if [[ -n "${APP_VERSION:-}" ]]; then
  VERSION="$APP_VERSION"
elif [[ -f VERSION ]]; then
  VERSION=$(cat VERSION)
elif git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  VERSION="v2026.2.0-field-data+$(git rev-parse --short=12 HEAD)"
else
  echo "APP_VERSION or a VERSION file is required when Git metadata is unavailable." >&2
  exit 1
fi

mkdir -p /tmp
echo "$VERSION" > /tmp/version.txt
echo "Frontend version: $VERSION"
