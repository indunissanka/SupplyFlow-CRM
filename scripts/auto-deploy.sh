#!/bin/bash
# Auto-deploy: pull latest code, rebuild Docker image, restart container
# Usage: bash scripts/auto-deploy.sh
# Can be triggered manually or via GitHub webhook

set -e

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG="$APP_DIR/backups/deploy.log"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG"; }

cd "$APP_DIR"

log "=== Auto-deploy started ==="

# Pull latest code
log "Pulling latest code..."
git pull origin main 2>&1 | tee -a "$LOG"

# Rebuild and restart Docker container
log "Rebuilding Docker image..."
sudo docker compose build --no-cache app 2>&1 | tee -a "$LOG"

log "Restarting container..."
sudo docker compose up -d app 2>&1 | tee -a "$LOG"

log "Waiting for container to be healthy..."
for i in $(seq 1 30); do
  STATUS=$(sudo docker inspect --format='{{.State.Health.Status}}' mango-crm 2>/dev/null || echo "unknown")
  if [ "$STATUS" = "healthy" ]; then
    log "Container is healthy."
    break
  fi
  sleep 2
done

log "=== Deploy complete ==="
sudo docker ps | grep mango-crm | tee -a "$LOG"
