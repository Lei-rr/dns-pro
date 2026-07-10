#!/bin/sh
set -eu

DATA_DIR="${DATA_DIR:-/app/data}"

mkdir -p "$DATA_DIR/saas"

exec "$@"
