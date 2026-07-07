#!/bin/bash
set -e

VERSION="${APP_VERSION:-1.0.0}"

mkdir -p /tmp
echo "$VERSION" > /tmp/version.txt
echo "Frontend version: $VERSION"