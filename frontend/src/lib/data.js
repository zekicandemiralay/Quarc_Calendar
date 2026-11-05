import { db } from './db';
import { requestSync } from './sync';

const uuid = () => crypto.randomUUID();
const nowIso = () => new Date().toISOString();

export const EVENT_COLORS = [
  '#e5484d', '#f76b15', '#f5a524', '#30a46c', '#12a594', '#3e63dd',
  '#7c66dc', '#d6409f', '#8b8d98', '#6e56cf', '#0091ff', '#a18072',
];

// ---- Mutations ---------------------------------------------------------------
// Every write: (1) apply to the local tables, (2) queue it in the outbox,
// (3) nudge the sync engine. (1)+(2) happen in one transaction, so a crash
// can never leave a change applied locally but missing from the queue.

async function write(table, row, op = 'upsert') {
  const clientTs = nowIso();
  const stored = { ...row, client_updated_at: clientTs };
  await db.transaction('rw', db[table], db.outbox, async () => {
    await db[table].put(stored);
    await db.outbox.put({
      key: `${table}:${row.id}`,
      table,
      id: row.id,
      op,
      data: op === 'delete' ? null : stored,
      client_updated_at: clientTs,
    });
  });
  requestSync();
  return stored;
}

// ---- Events ------------------------------------------------------------------

export function blankEvent(fields = {}) {
  const now = nowIso();
  return {
    id: uuid(),
    calendar_id: '',
    title: '',
    description: '',
    location: '',
    start: now,
    end: now,
    all_day: 0,
    color: null,
    rrule: null,
    exdates: [],
    reminders: [],
    is_deleted: 0,
    created_at: now,
    ...fields,
  };
}

export const saveEvent = (ev) => write('events', { ...ev, is_deleted: 0 });

export async function deleteEvent(id) {
  const existing = await db.events.get(id);
  if (!existing) return;
  await write('events', { ...existing, is_deleted: 1 }, 'delete');
}

/** Save several events as one logical operation (series splits touch two rows). */
export async function saveEvents(list) {
  for (const ev of list) await saveEvent(ev);
}

// ---- Calendars ---------------------------------------------------------------

export const saveCalendar = (cal) => write('calendars', { ...cal, is_deleted: 0 });

export async function createCalendar({ name, color }) {
  const count = await db.calendars.where('is_deleted').equals(0).count();
  return saveCalendar({
    id: uuid(), name, color, is_default: 0, sort_order: count,
    is_deleted: 0, created_at: nowIso(),
  });
}

export async function deleteCalendar(id) {
  const existing = await db.calendars.get(id);
  if (!existing) return;
  const events = await db.events.where('calendar_id').equals(id).filter((e) => !e.is_deleted).toArray();
  for (const ev of events) await write('events', { ...ev, is_deleted: 1 }, 'delete');
  await write('calendars', { ...existing, is_deleted: 1 }, 'delete');
}

/**
 * Make sure the user has somewhere to put events. Called after the first sync
 * attempt: a brand-new account (or a device that is offline from the start)
 * gets a "Personal" calendar. The id is derived from the user id so every
 * device creates the SAME calendar instead of one each; its client timestamp is
 * the epoch so whatever the server already has always wins the merge.
 */
export async function ensureDefaultCalendar(user) {
  // Count includes deleted calendars (tombstones): if any row exists, the
  // account already has a calendar history and we must not invent a new one.
  if ((await db.calendars.count()) > 0) return;
  const id = `cal-${String(user.id).replace(/[^A-Za-z0-9_-]/g, '_')}`.slice(0, 64);
  const row = {
    id, name: 'Personal', color: EVENT_COLORS[5], is_default: 1, sort_order: 0,
    is_deleted: 0, created_at: nowIso(), client_updated_at: '1970-01-01T00:00:01.000Z',
  };
  await db.transaction('rw', db.calendars, db.outbox, async () => {
    await db.calendars.put(row);
    await db.outbox.put({
      key: `calendars:${id}`, table: 'calendars', id, op: 'upsert', data: row,
      client_updated_at: row.client_updated_at,
    });
  });
  requestSync();
}
