#!/bin/sh
set -eu

mkdir -p /app/data/saas /app/data/jobs
exec "$@"
