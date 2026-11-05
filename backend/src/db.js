const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'calendar.db');

let db;

function getDb() {
  if (!db) {
    if (DB_PATH !== ':memory:') fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
  }
  return db;
}

// Rows are never hard-deleted: a delete sets is_deleted = 1 and bumps
// updated_at so every other device learns about it on its next pull.
//
// updated_at is a server-assigned, strictly increasing ISO timestamp (see
// nowIso) and is the sync cursor. client_updated_at is the device's own edit
// time and is only used to pick a winner when two devices edit the same row
// (last write wins).
function initDb() {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS calendars (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#3b82f6',
      is_default INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_deleted INTEGER NOT NULL DEFAULT 0,
      client_updated_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_calendars_user_updated ON calendars(user_id, updated_at);

    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      calendar_id TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      location TEXT NOT NULL DEFAULT '',
      start TEXT NOT NULL,
      end TEXT NOT NULL,
      all_day INTEGER NOT NULL DEFAULT 0,
      color TEXT,
      rrule TEXT,
      exdates TEXT NOT NULL DEFAULT '[]',
      reminders TEXT NOT NULL DEFAULT '[]',
      is_deleted INTEGER NOT NULL DEFAULT 0,
      client_updated_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_events_user_updated ON events(user_id, updated_at);
    CREATE INDEX IF NOT EXISTS idx_events_calendar ON events(calendar_id);
  `);
}

// Strictly increasing across calls, so `updated_at > cursor` can never skip a
// row that was written in the same millisecond as the previous one.
let lastMs = 0;
function nowIso() {
  lastMs = Math.max(Date.now(), lastMs + 1);
  return new Date(lastMs).toISOString();
}

module.exports = { getDb, initDb, nowIso };
