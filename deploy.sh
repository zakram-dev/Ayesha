#!/usr/bin/env bash
# Zero-downtime deploy for the Ayesha site. Run on the Pi from the repo folder: ./deploy.sh
#
# The new container starts beside the live one on the same port (host networking + SO_REUSEPORT),
# and the live one is only stopped once the new one is serving. If anything fails, the live
# container is left running or started again.
set -euo pipefail
cd "$(dirname "$0")"

name=ayesha-gift
next=ayesha-gift-next
image=ayesha-ayesha
port=8081
revision=$(git rev-parse --short HEAD)

log() { printf '\n==> %s\n' "$*"; }

# wait_for_log <container> <regex> <seconds>
wait_for_log() {
  local deadline=$((SECONDS + $3))
  until docker logs "$1" 2>&1 | grep -qE "$2"; do
    [ "$(docker inspect -f '{{.State.Running}}' "$1" 2>/dev/null)" = true ] || return 1
    [ "$SECONDS" -lt "$deadline" ] || return 1
    sleep 0.1
  done
}

restore_live() {
  docker logs "$next" 2>&1 | tail -20 || true
  docker rm -f "$next" >/dev/null 2>&1 || true
  if docker inspect "$name" >/dev/null 2>&1; then
    docker update --restart=unless-stopped "$name" >/dev/null
    docker start "$name" >/dev/null
  fi
}

log "Building $image at $revision"
docker image inspect "$image:latest" >/dev/null 2>&1 && docker tag "$image:latest" "$image:previous"
docker build -t "$image:latest" .
image_id=$(docker image inspect -f '{{.Id}}' "$image:latest")

log "Starting $next beside the live container"
docker rm -f "$next" >/dev/null 2>&1 || true
docker run -d --name "$next" --network host --restart unless-stopped \
  --env-file .env \
  -e HOST=:: -e PORT="$port" -e DATABASE_PATH=/app/data/ayesha.sqlite -e APP_REVISION="$revision" \
  -v "$PWD/data:/app/data" \
  "$image_id" >/dev/null

if ! wait_for_log "$next" 'server running|waiting for it to be released' 30; then
  log "New container failed to start; the live site was not touched"
  restore_live
  exit 1
fi

if docker inspect "$name" >/dev/null 2>&1; then
  log "Stopping the old container once its open requests finish"
  docker update --restart=no "$name" >/dev/null
  docker stop "$name" >/dev/null
fi

if ! wait_for_log "$next" 'server running' 30; then
  log "New container did not take over; starting the old one again"
  restore_live
  exit 1
fi

log "Checking health"
if ! health=$(curl -fsS --max-time 5 "http://127.0.0.1:$port/api/health") || [[ "$health" != *"\"$revision\""* ]]; then
  log "Health check failed (${health:-no response}); starting the old one again"
  restore_live
  exit 1
fi
echo "$health"

docker rm "$name" >/dev/null 2>&1 || true
docker rename "$next" "$name"
log "Deployed $revision as $name (previous image kept as $image:previous)"
