#!/usr/bin/env bash
# 在目标主机上把 dns-pro 升级到 $IMAGE 指向的镜像。
# 由 .github/workflows/deploy.yml 通过 `ssh ... "IMAGE=... bash -s" < 本文件` 送入执行。
#
# 必需环境变量：
#   IMAGE   形如 ghcr.io/lei-rr/dns-pro:latest（生产跟随 latest 标签）
# 可选环境变量：
#   CONTAINER_MATCH  现有容器名/镜像的匹配片段，默认 dns-pro
#   HEALTH_PORT      健康检查端口，默认 2001（与 server/app/config.ts 的默认端口一致）
#   HEALTH_PATH      健康检查路径，默认 /api/health
set -euo pipefail

: "${IMAGE:?IMAGE 未设置}"
CONTAINER_MATCH="${CONTAINER_MATCH:-dns-pro}"
HEALTH_PORT="${HEALTH_PORT:-2001}"
HEALTH_PATH="${HEALTH_PATH:-/api/health}"

log() { printf '==> %s\n' "$*"; }
fail() { printf '::error::%s\n' "$*" >&2; exit 1; }

# 容器内不含 curl/wget（见 scripts/maintenance-contract.test.ts 的部署契约），
# 因此健康检查走容器内的 node，而不是宿主机的 HTTP 客户端。
health_check() {
  local cid
  cid="$(find_container)"
  [ -n "$cid" ] || return 1
  docker exec "$cid" node -e \
    "fetch('http://127.0.0.1:${HEALTH_PORT}${HEALTH_PATH}').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))" \
    >/dev/null 2>&1
}

find_container() {
  docker ps -a --format '{{.ID}}\t{{.Image}}\t{{.Names}}' \
    | grep -F "$CONTAINER_MATCH" | head -1 | cut -f1
}

log "目标镜像: $IMAGE"

log "拉取镜像"
docker pull "$IMAGE" || fail "镜像拉取失败。若 GHCR 包为私有，请先在目标主机执行一次 docker login ghcr.io。"

cid="$(find_container)"
if [ -z "$cid" ]; then
  printf '现有容器（用于确认匹配片段 CONTAINER_MATCH）：\n' >&2
  docker ps -a --format '{{.Names}}\t{{.Image}}\t{{.Status}}' >&2
  fail "未找到名称或镜像含 '$CONTAINER_MATCH' 的容器，无法自动升级"
fi

log "现有容器: $(docker inspect -f '{{.Name}} <- {{.Config.Image}}' "$cid")"

workdir="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$cid" 2>/dev/null || true)"
service="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.service"}}' "$cid" 2>/dev/null || true)"

if [ -n "$workdir" ] && [ -d "$workdir" ]; then
  log "compose 项目: $workdir（service=${service:-未标注}）"
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
    fail "$workdir 下未找到 compose 文件"
  fi

  svc="${service:-$(docker compose config --services 2>/dev/null | head -1)}"
  [ -n "$svc" ] || fail "无法确定 compose service 名称"

  # 生产跟随 :latest。原文件已声明 :latest 就直接拉取；若钉了旧版本（如 :1.2.3），
  # 写 override 指向 $IMAGE —— 不动原文件，回滚删掉 override 即可。
  if grep -qE '^[[:space:]]*image:[[:space:]]*[^[:space:]]*:latest[[:space:]]*$' "$composefile"; then
    log "原 compose 已声明 :latest，直接拉取"
  else
    printf 'services:\n  %s:\n    image: %s\n' "$svc" "$IMAGE" > "$override"
    log "原 compose 未用 :latest，写入 $override：service=$svc → $IMAGE"
  fi

  docker compose pull "$svc"
  docker compose up -d "$svc"
else
  log "非 compose 部署，按现有容器配置重建"
  name="$(docker inspect -f '{{.Name}}' "$cid" | sed 's|^/||')"
  restart="$(docker inspect -f '{{.HostConfig.RestartPolicy.Name}}' "$cid")"
  netmode="$(docker inspect -f '{{.HostConfig.NetworkMode}}' "$cid")"
  ports="$(docker inspect -f '{{range $p, $b := .HostConfig.PortBindings}}{{range $b}}-p {{.HostIp}}:{{.HostPort}}:{{$p}} {{end}}{{end}}' "$cid")"
  vols="$(docker inspect -f '{{range .Mounts}}{{if eq .Type "bind"}}-v {{.Source}}:{{.Destination}} {{end}}{{end}}' "$cid")"
  # 过滤基础镜像自带的环境变量，只保留用户显式注入的部分
  envs="$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$cid" \
    | grep -vE '^(PATH|HOSTNAME|HOME|PWD|SHLVL|TERM|NODE_VERSION|YARN_VERSION|_)=.*' \
    | sed 's/^/-e /' | tr '\n' ' ')"

  docker rm -f "$cid" >/dev/null
  # shellcheck disable=SC2086
  docker run -d --name "$name" \
    --restart "${restart:-unless-stopped}" \
    --network "${netmode:-bridge}" \
    $ports $vols $envs \
    "$IMAGE"
fi

log "等待健康检查（127.0.0.1:${HEALTH_PORT}${HEALTH_PATH}）"
for i in $(seq 1 30); do
  if health_check; then
    log "健康检查通过（第 ${i} 次）"
    docker ps --filter "name=$CONTAINER_MATCH" --format '{{.Names}}\t{{.Image}}\t{{.Status}}'
    exit 0
  fi
  sleep 2
done

printf '::error::健康检查 60 秒内未通过，最近日志：\n' >&2
docker logs --tail 60 "$(find_container)" >&2 || true
exit 1
