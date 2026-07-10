#!/bin/sh
set -eu

mkdir -p /app/data/saas

exec "$@"
