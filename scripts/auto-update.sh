#!/usr/bin/env bash
# 在目标主机安装 dns-pro 自动更新任务。
#
# 更新方向是「目标机主动拉取」：镜像由 GitHub Actions 在 v* 标签上构建并推送到
# GHCR（公开包），目标机匿名即可拉取，因此本脚本与 CI 之间不需要共享任何凭据，
# CI 也不需要反向登录目标机。
#
# 用法（在目标主机执行一次即可，之后由 cron 接管）：
#   bash scripts/auto-update.sh
#
# 可选环境变量：
#   CONTAINER_MATCH  现有容器名/镜像的匹配片段，默认 dns-pro
#   SCHEDULE         cron 计划表达式，默认每 5 分钟
#   GHCR_IMAGE       目标镜像，默认 ghcr.io/lei-rr/dns-pro:latest
#   HEALTH_PORT      健康检查端口，默认 2001
#   HEALTH_PATH      健康检查路径，默认 /api/health
set -euo pipefail

CONTAINER_MATCH="${CONTAINER_MATCH:-dns-pro}"
SCHEDULE="${SCHEDULE:-*/5 * * * *}"
GHCR_IMAGE="${GHCR_IMAGE:-ghcr.io/lei-rr/dns-pro:latest}"
HEALTH_PORT="${HEALTH_PORT:-2001}"
HEALTH_PATH="${HEALTH_PATH:-/api/health}"
RUNNER=/usr/local/bin/dns-pro-auto-update
CRON_FILE=/etc/cron.d/dns-pro-auto-update
LOG_FILE=/var/log/dns-pro-auto-update.log

log() { printf '==> %s\n' "$*"; }
die() { printf '!! %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" = 0 ] || die "需要 root 权限（要写 /usr/local/bin 与 /etc/cron.d）"
command -v docker >/dev/null || die "未找到 docker"
docker compose version >/dev/null 2>&1 || die "未找到 docker compose v2"

cid="$(docker ps -a --format '{{.ID}}\t{{.Image}}\t{{.Names}}' \
  | grep -F "$CONTAINER_MATCH" | head -1 | cut -f1)"
[ -n "$cid" ] || die "未找到名称或镜像含 '$CONTAINER_MATCH' 的容器，可用 CONTAINER_MATCH=xxx 指定"

workdir="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$cid" 2>/dev/null || true)"
service="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.service"}}' "$cid" 2>/dev/null || true)"
[ -n "$workdir" ] && [ -d "$workdir" ] \
  || die "该容器不是 compose 部署（缺 com.docker.compose.project.working_dir 标签）"

cd "$workdir"
if [ -f compose.yaml ]; then
  composefile=compose.yaml
  override=compose.override.yaml
elif [ -f docker-compose.yml ]; then
  composefile=docker-compose.yml
  override=docker-compose.override.yml
elif [ -f docker-compose.yaml ]; then
  composefile=docker-compose.yaml
  override=docker-compose.override.yml
else
  die "$workdir 下未找到 compose 文件"
fi

svc="${service:-$(docker compose config --services 2>/dev/null | head -1)}"
[ -n "$svc" ] || die "无法确定 compose service 名称"

# 自动更新只能跟随 :latest 这类浮动标签。原文件若钉死版本号，写一个 override 覆盖它；
# 不改动原文件，想停掉自动更新删掉 override 即可。
if grep -qE '^[[:space:]]*image:[[:space:]]*[^[:space:]]*:latest[[:space:]]*$' "$composefile"; then
  log "原 compose 已声明 :latest"
else
  printf 'services:\n  %s:\n    image: %s\n' "$svc" "$GHCR_IMAGE" > "$override"
  log "原 compose 未用 :latest，已写入 $override 指向 $GHCR_IMAGE"
fi

cat > "$RUNNER" <<EOF
#!/usr/bin/env bash
# 由 scripts/auto-update.sh 生成：拉取最新镜像、重建容器、健康检查。
set -euo pipefail
cd '$workdir'

echo "[\$(date '+%F %T')] 检查更新"
docker inspect -f "[\$(date '+%F %T')] 更新前：{{.Config.Image}} ({{.Image}})" \\
  "\$(docker compose ps -q '$svc')" 2>/dev/null || true

docker compose pull -q '$svc'
docker compose up -d '$svc'

for _ in \$(seq 1 30); do
  if docker exec "\$(docker compose ps -q '$svc')" node -e \\
    "fetch('http://127.0.0.1:${HEALTH_PORT}${HEALTH_PATH}').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))" \\
    >/dev/null 2>&1; then
    echo "[\$(date '+%F %T')] 健康检查通过"
    docker image prune -f >/dev/null 2>&1 || true
    exit 0
  fi
  sleep 2
done

echo "[\$(date '+%F %T')] !! 健康检查 60 秒未通过，最近日志："
docker logs --tail 40 "\$(docker compose ps -q '$svc')" 2>&1 || true
exit 1
EOF
chmod +x "$RUNNER"
log "已安装更新器：$RUNNER"

printf 'SHELL=/bin/bash\nPATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin\n%s root %s >> %s 2>&1\n' \
  "$SCHEDULE" "$RUNNER" "$LOG_FILE" > "$CRON_FILE"
chmod 644 "$CRON_FILE"
log "已安装定时任务：$CRON_FILE（$SCHEDULE）"

log "立即执行一次"
"$RUNNER" || log "首次执行未通过健康检查，详见 $LOG_FILE"

log "当前容器："
docker ps --filter "name=$CONTAINER_MATCH" --format '{{.Names}}\t{{.Image}}\t{{.Status}}'
