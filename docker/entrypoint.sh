#!/bin/sh
set -eu

# 数据目录必须可写（宿主机挂载卷需属于 UID 1000，或使用命名卷）
if ! mkdir -p /app/data/saas 2>/dev/null || [ ! -w /app/data ]; then
  echo "错误：/app/data 不可写。请执行 chown -R 1000:1000 <宿主机数据目录> 后重启容器。" >&2
  exit 1
fi
umask 077
exec "$@"
