// Offline-first behaviour end to end: the real sync engine + local database
// (fake-indexeddb) talking to the real backend (in-memory SQLite).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import 'fake-indexeddb/auto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let server, base, online = true, serverDown = false;
const realFetch = globalThis.fetch;
let cookie;

beforeAll(() => {
  process.env.DB_PATH = ':memory:';
  process.env.JWT_SECRET = 'test-secret';
  const jwt = require('../../../../backend/node_modules/jsonwebtoken');
  cookie = `token=${jwt.sign({ id: 'user-1', username: 'u', role: 'user' }, 'test-secret', { expiresIn: '1h' })}`;
  const app = require('../../../../backend/src/index');
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  Object.defineProperty(globalThis.navigator, 'onLine', { get: () => online, configurable: true });
  globalThis.fetch = (url, opts = {}) => {
    if (serverDown) return Promise.reject(new TypeError('fetch failed'));
    return realFetch(base + url, { ...opts, headers: { ...(opts.headers || {}), Cookie: cookie } });
  };
});
afterAll(() => {
  globalThis.fetch = realFetch;
  server.close();
});

describe('offline-first sync', async () => {
  const { db } = await import('../db');
  const { saveEvent, saveCalendar, deleteEvent, blankEvent, ensureDefaultCalendar } = await import('../data');
  const { syncNow, useSyncStore } = await import('../sync');
  const serverPull = async () => (await realFetch(`${base}/api/sync/pull?since=`, { headers: { Cookie: cookie } })).json();

  it('queues edits while offline and uploads them when the connection returns', async () => {
    online = false;
    await ensureDefaultCalendar({ id: 'user-1' });
    const cal = await db.calendars.toCollection().first();
    expect(cal.is_default).toBe(1);

    const ev = blankEvent({ calendar_id: cal.id, title: 'Dentist', start: '2026-06-01T08:00:00.000Z', end: '2026-06-01T09:00:00.000Z', reminders: [15] });
    await saveEvent(ev);
    await saveEvent({ ...ev, title: 'Dentist (moved)' }); // second edit replaces the first in the queue
    expect(await db.outbox.count()).toBe(2); // calendar + one coalesced event

    await syncNow();
    expect(useSyncStore.getState().status).toBe('offline');
    expect((await serverPull()).events).toHaveLength(0); // nothing reached the server

    online = true;
    await syncNow();
    expect(useSyncStore.getState().status).toBe('idle');
    expect(await db.outbox.count()).toBe(0);
    const remote = await serverPull();
    expect(remote.events.map((e) => e.title)).toEqual(['Dentist (moved)']);
    expect(remote.events[0].reminders).toEqual([15]);
  });

  it('keeps changes queued when the server is unreachable, then retries', async () => {
    const cal = await db.calendars.toCollection().first();
    await saveEvent(blankEvent({ calendar_id: cal.id, title: 'Offline-ish', start: '2026-06-02T08:00:00.000Z', end: '2026-06-02T09:00:00.000Z' }));
    serverDown = true;
    await syncNow();
    expect(useSyncStore.getState().status).toBe('error');
    expect(await db.outbox.count()).toBe(1);
    serverDown = false;
    await syncNow();
    expect(await db.outbox.count()).toBe(0);
    expect((await serverPull()).events).toHaveLength(2);
  });

  it('pulls changes made on another device', async () => {
    const cal = await db.calendars.toCollection().first();
    await realFetch(`${base}/api/sync/push`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ mutations: [{ table: 'events', id: 'from-phone-1', op: 'upsert', client_updated_at: new Date().toISOString(),
        data: { calendar_id: cal.id, title: 'Added on phone', start: '2026-06-03T10:00:00.000Z', end: '2026-06-03T11:00:00.000Z' } }] }),
    });
    await syncNow();
    expect((await db.events.get('from-phone-1')).title).toBe('Added on phone');
  });

  it('propagates deletes both ways', async () => {
    const ev = await db.events.where('title').equals('Offline-ish').first().catch(() => null) || (await db.events.toArray()).find((e) => e.title === 'Offline-ish');
    await deleteEvent(ev.id);
    await syncNow();
    expect((await serverPull()).events.find((e) => e.id === ev.id).is_deleted).toBe(1);
  });

  it('adopts the server version when another device edited the same event later (last write wins)', async () => {
    const ev = (await db.events.toArray()).find((e) => e.title === 'Dentist (moved)');
    online = false;
    await saveEvent({ ...ev, title: 'Local edit' }); // offline edit, at time T1
    await new Promise((r) => setTimeout(r, 15));
    await realFetch(`${base}/api/sync/push`, { // another device edits later, at T2 > T1
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ mutations: [{ table: 'events', id: ev.id, op: 'upsert', client_updated_at: new Date().toISOString(),
        data: { ...ev, title: 'Remote edit' } }] }),
    });
    online = true;
    await syncNow();
    expect((await db.events.get(ev.id)).title).toBe('Remote edit');
    expect(await db.outbox.count()).toBe(0); // no stuck mutation
  });

  it('uploads a local edit made after the last pull', async () => {
    const ev = (await db.events.toArray()).find((e) => e.title === 'Added on phone');
    await saveEvent({ ...ev, title: 'Newest local' });
    await syncNow();
    expect((await db.events.get(ev.id)).title).toBe('Newest local');
    expect((await serverPull()).events.find((e) => e.id === ev.id).title).toBe('Newest local');
  });

  it('syncs a calendar delete and its events', async () => {
    const extra = await saveCalendar({ id: 'cal-extra-0001', name: 'Work', color: '#000', is_default: 0, sort_order: 1, is_deleted: 0, created_at: new Date().toISOString() });
    await saveEvent(blankEvent({ calendar_id: extra.id, title: 'Standup', start: '2026-06-05T08:00:00.000Z', end: '2026-06-05T08:15:00.000Z' }));
    await syncNow();
    const { deleteCalendar } = await import('../data');
    await deleteCalendar(extra.id);
    await syncNow();
    const remote = await serverPull();
    expect(remote.calendars.find((c) => c.id === extra.id).is_deleted).toBe(1);
    expect(remote.events.filter((e) => e.calendar_id === extra.id).every((e) => e.is_deleted === 1)).toBe(true);
  });
});
