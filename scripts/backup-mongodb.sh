#!/usr/bin/env sh
# MongoDB backup script for SL CRM
# Runs daily via cron; keeps 7 days of backups.
set -e

# Load .env from project root (if present)
ENV_FILE="$(cd "$(dirname "$0")/.." && pwd)/.env"
if [ -f "$ENV_FILE" ]; then
  set -o allexport
  . "$ENV_FILE"
  set +o allexport
fi

MONGO_URI="${MONGODB_URI:-mongodb://localhost:27017}"
DB_NAME="${MONGODB_DB_NAME:-crmmango}"
BACKUP_ROOT="${BACKUP_DIR:-/app/backups}"
RETENTION_DAYS=7
STAMP=$(date +%Y%m%d_%H%M%S)
DEST="$BACKUP_ROOT/$STAMP"

mkdir -p "$DEST"

echo "[$(date)] Starting backup of '$DB_NAME' -> $DEST"

mongodump \
  --uri="$MONGO_URI" \
  --db="$DB_NAME" \
  --gzip \
  --out="$DEST"

# Include uploads directory (PDFs, images, documents)
UPLOADS_SRC="$(cd "$(dirname "$0")/.." && pwd)/uploads"
if [ -d "$UPLOADS_SRC" ]; then
  echo "[$(date)] Copying uploads/ ($(du -sh "$UPLOADS_SRC" | cut -f1))"
  cp -r "$UPLOADS_SRC" "$DEST/"
fi

ARCHIVE="$BACKUP_ROOT/${STAMP}.tar.gz"
tar -czf "$ARCHIVE" -C "$BACKUP_ROOT" "$STAMP"
rm -rf "$DEST"

SIZE=$(du -sh "$ARCHIVE" | cut -f1)
echo "[$(date)] Backup complete: ${STAMP}.tar.gz ($SIZE)"

# Prune old backups
PRUNED=$(find "$BACKUP_ROOT" -maxdepth 1 -name "*.tar.gz" -mtime +"$RETENTION_DAYS" -print -delete | wc -l)
echo "[$(date)] Pruned $PRUNED backup(s) older than ${RETENTION_DAYS} days"
