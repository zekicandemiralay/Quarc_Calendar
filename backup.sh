#!/usr/bin/env bash
# ============================================================
#  Quarc Calendar — Data Backup
#  Run from the project directory:
#    bash backup.sh
#
#  Creates: ./backup_YYYYMMDD_HHMMSS/
#    calendar.db      — full SQLite database (calendars, events)
#    .env          — all secrets and config
# ============================================================
set -e

BACKUP_DIR="./backup_$(date +%Y%m%d_%H%M%S)"
mkdir -p "$BACKUP_DIR"

echo "Backing up to $BACKUP_DIR ..."

BACKEND=$(docker ps -q --filter "label=com.docker.compose.service=backend" | head -1)
if [ -z "$BACKEND" ]; then
  echo "ERROR: backend container not running. Start it first: docker compose up -d backend"
  exit 1
fi

# calendar.db runs in WAL mode — recent writes can sit in calendar.db-wal, which
# this script doesn't copy. Checkpoint it into the main file first so the
# backup is complete and doesn't depend on -wal/-shm files (also avoids
# SQLITE_CANTOPEN when something later opens this copy read-only).
echo "  · Checkpointing WAL into calendar.db ..."
docker exec "$BACKEND" node -e "require('/app/src/db').getDb().pragma('wal_checkpoint(TRUNCATE)')" 2>/dev/null || true

echo "  · Exporting calendar.db ..."
docker cp "$BACKEND:/app/data/calendar.db" "$BACKUP_DIR/calendar.db"


echo "  · Copying .env ..."
cp .env "$BACKUP_DIR/.env"

DB_SIZE=$(du -sh "$BACKUP_DIR/calendar.db" | awk '{print $1}')
echo ""
echo "Backup complete: $BACKUP_DIR"
echo "  calendar.db : $DB_SIZE"
echo ""
echo "Next: copy this folder to the new server."
echo "  scp -r $BACKUP_DIR user@new-server:~/Quarc_Calendar/"
