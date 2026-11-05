import Dexie from 'dexie';

// Local, offline-first copy of the user's calendar. The UI only ever reads and
// writes THIS database; lib/sync.js mirrors it with the server in the
// background whenever a connection is available.
//
//   events / calendars  full copies of the server rows (including tombstones,
//                       is_deleted = 1, so deletions can sync)
//   outbox              one pending mutation per row, keyed 'table:id'. A
//                       later edit of the same row replaces the earlier entry.
//   meta                small key/value store: sync cursor, owning user id...
export const db = new Dexie('quarc-calendar');

db.version(1).stores({
  events: 'id, calendar_id, is_deleted',
  calendars: 'id, is_deleted',
  outbox: 'key',
  meta: 'key',
});

export async function getMeta(key, fallback = null) {
  const row = await db.meta.get(key);
  return row ? row.value : fallback;
}

export function setMeta(key, value) {
  return db.meta.put({ key, value });
}

export async function clearLocalData() {
  await Promise.all([db.events.clear(), db.calendars.clear(), db.outbox.clear(), db.meta.clear()]);
}
