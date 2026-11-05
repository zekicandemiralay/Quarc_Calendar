const express = require('express');
const router = express.Router();
const { getDb, nowIso } = require('../db');

const PAGE_LIMIT = 1000;
const MAX_MUTATIONS = 500;

const str = (v, max, fallback = '') => (typeof v === 'string' ? v.slice(0, max) : fallback);
const bool = (v) => (v ? 1 : 0);
const jsonText = (v, fallback) => {
  if (v == null) return fallback;
  const text = typeof v === 'string' ? v : JSON.stringify(v);
  return text.length > 20000 ? fallback : text;
};
const validId = (v) => typeof v === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(v);
const validIso = (v) => typeof v === 'string' && v.length >= 10 && v.length <= 40 && !Number.isNaN(Date.parse(v));

// Rows are sent to the client with JSON columns parsed and flags as 0/1.
function outEvent(r) {
  return {
    ...r,
    rrule: r.rrule ? JSON.parse(r.rrule) : null,
    exdates: JSON.parse(r.exdates || '[]'),
    reminders: JSON.parse(r.reminders || '[]'),
  };
}

// Pull: everything for this user changed after the `since` cursor. Paged so a
// first sync of a large calendar doesn't produce one huge response; when a
// page is full, both tables are cut at the same boundary and `hasMore` tells
// the client to ask again from the returned cursor.
router.get('/pull', (req, res) => {
  const db = getDb();
  const since = typeof req.query.since === 'string' ? req.query.since : '';

  const q = (table) =>
    db
      .prepare(`SELECT * FROM ${table} WHERE user_id = ? AND updated_at > ? ORDER BY updated_at ASC LIMIT ?`)
      .all(req.user.id, since, PAGE_LIMIT + 1);

  let calendars = q('calendars');
  let events = q('events');

  let bound = null;
  let hasMore = false;
  for (const rows of [calendars, events]) {
    if (rows.length > PAGE_LIMIT) {
      hasMore = true;
      const last = rows[PAGE_LIMIT - 1].updated_at;
      if (bound === null || last < bound) bound = last;
    }
  }
  if (hasMore) {
    calendars = calendars.filter((r) => r.updated_at <= bound);
    events = events.filter((r) => r.updated_at <= bound);
  }

  const all = [...calendars, ...events];
  const cursor = hasMore ? bound : all.reduce((m, r) => (r.updated_at > m ? r.updated_at : m), since);

  res.json({ cursor, hasMore, calendars, events: events.map(outEvent) });
});

function upsertCalendar(db, user, m, existing) {
  const d = m.data || {};
  const name = str(d.name, 100).trim() || 'Calendar';
  const color = str(d.color, 20, '#3b82f6');
  const now = nowIso();
  if (existing) {
    db.prepare(
      `UPDATE calendars SET name = ?, color = ?, is_default = ?, sort_order = ?, is_deleted = 0,
         client_updated_at = ?, updated_at = ? WHERE id = ?`
    ).run(name, color, bool(d.is_default), Number(d.sort_order) || 0, m.client_updated_at, now, m.id);
  } else {
    db.prepare(
      `INSERT INTO calendars (id, user_id, name, color, is_default, sort_order, client_updated_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      m.id, user.id, name, color, bool(d.is_default), Number(d.sort_order) || 0, m.client_updated_at,
      validIso(d.created_at) ? d.created_at : now, now
    );
  }
}

function upsertEvent(db, user, m, existing) {
  const d = m.data || {};
  const now = nowIso();
  const allDay = bool(d.all_day);
  const start = str(d.start, 40);
  const end = str(d.end, 40) || start;
  const vals = [
    str(d.calendar_id, 64),
    str(d.title, 500),
    str(d.description, 20000),
    str(d.location, 500),
    start,
    end,
    allDay,
    d.color ? str(d.color, 20) : null,
    d.rrule ? jsonText(d.rrule, null) : null,
    jsonText(d.exdates, '[]'),
    jsonText(d.reminders, '[]'),
  ];
  if (existing) {
    db.prepare(
      `UPDATE events SET calendar_id = ?, title = ?, description = ?, location = ?, start = ?, end = ?,
         all_day = ?, color = ?, rrule = ?, exdates = ?, reminders = ?, is_deleted = 0,
         client_updated_at = ?, updated_at = ? WHERE id = ?`
    ).run(...vals, m.client_updated_at, now, m.id);
  } else {
    db.prepare(
      `INSERT INTO events (id, user_id, calendar_id, title, description, location, start, end, all_day,
         color, rrule, exdates, reminders, client_updated_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(m.id, user.id, ...vals, m.client_updated_at, validIso(d.created_at) ? d.created_at : now, now);
  }
}

// Push: queued client edits. Each mutation is
//   { table: 'events'|'calendars', id, op: 'upsert'|'delete', data, client_updated_at }
// Last write wins by client_updated_at: if the server already holds a newer
// edit of the same row (made from another device), the mutation is answered
// with status 'stale' plus the server's row, which the client adopts. That
// way a lost race never leaves an edit stuck in the client's queue forever.
router.post('/push', (req, res) => {
  const db = getDb();
  const mutations = Array.isArray(req.body?.mutations) ? req.body.mutations.slice(0, MAX_MUTATIONS) : [];
  const results = [];

  const apply = db.transaction(() => {
    for (const m of mutations) {
      const table = m?.table === 'calendars' ? 'calendars' : m?.table === 'events' ? 'events' : null;
      if (!table || !validId(m.id) || !validIso(m.client_updated_at)) {
        results.push({ table: m?.table, id: m?.id, status: 'invalid' });
        continue;
      }

      const existing = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(m.id);
      if (existing && existing.user_id !== req.user.id) {
        results.push({ table, id: m.id, status: 'forbidden' });
        continue;
      }
      if (existing && existing.client_updated_at > m.client_updated_at) {
        results.push({ table, id: m.id, status: 'stale', row: table === 'events' ? outEvent(existing) : existing });
        continue;
      }

      if (m.op === 'delete') {
        if (existing) {
          const now = nowIso();
          db.prepare(`UPDATE ${table} SET is_deleted = 1, client_updated_at = ?, updated_at = ? WHERE id = ?`)
            .run(m.client_updated_at, now, m.id);
          // Deleting a calendar takes its events with it.
          if (table === 'calendars') {
            db.prepare(
              `UPDATE events SET is_deleted = 1, updated_at = ? WHERE calendar_id = ? AND user_id = ? AND is_deleted = 0`
            ).run(nowIso(), m.id, req.user.id);
          }
        }
        results.push({ table, id: m.id, status: 'ok' });
        continue;
      }

      if (table === 'calendars') upsertCalendar(db, req.user, m, existing);
      else {
        const d = m.data || {};
        if (!validIso(d.start) || !validId(d.calendar_id)) {
          results.push({ table, id: m.id, status: 'invalid' });
          continue;
        }
        upsertEvent(db, req.user, m, existing);
      }
      results.push({ table, id: m.id, status: 'ok' });
    }
  });
  apply();

  res.json({ results });
});

module.exports = router;
