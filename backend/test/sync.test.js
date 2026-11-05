// Run: npm test   (uses an in-memory database)
process.env.DB_PATH = ':memory:';
process.env.JWT_SECRET = 'test-secret';
const assert = require('assert');
const jwt = require('jsonwebtoken');
const app = require('../src/index');

const cookie = (id) => `token=${jwt.sign({ id, username: id, role: 'user' }, 'test-secret', { expiresIn: '1h' })}`;

(async () => {
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (path, user, body) => {
    const res = await fetch(base + path, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json', ...(user ? { Cookie: cookie(user) } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, json: await res.json() };
  };
  const ev = (id, extra = {}) => ({
    table: 'events', id, op: 'upsert', client_updated_at: '2026-01-01T10:00:00.000Z',
    data: { calendar_id: 'cal-00001', title: 'T', start: '2026-01-02T09:00:00.000Z', end: '2026-01-02T10:00:00.000Z', ...extra.data },
    ...extra.m,
  });

  assert.strictEqual((await call('/api/sync/pull')).status, 401, 'requires login');

  let r = await call('/api/sync/push', 'alice', { mutations: [
    { table: 'calendars', id: 'cal-00001', op: 'upsert', client_updated_at: '2026-01-01T10:00:00.000Z', data: { name: 'Home', color: '#ff0000', is_default: true } },
    ev('evt-00001', { data: { rrule: { freq: 'weekly', interval: 1 }, reminders: [10] } }),
  ] });
  assert.deepStrictEqual(r.json.results.map((x) => x.status), ['ok', 'ok']);

  r = await call('/api/sync/pull?since=', 'alice');
  assert.strictEqual(r.json.events.length, 1);
  assert.deepStrictEqual(r.json.events[0].rrule, { freq: 'weekly', interval: 1 });
  assert.deepStrictEqual(r.json.events[0].reminders, [10]);
  assert.strictEqual(r.json.calendars[0].name, 'Home');
  const cursor = r.json.cursor;

  r = await call('/api/sync/pull?since=' + encodeURIComponent(cursor), 'alice');
  assert.strictEqual(r.json.events.length + r.json.calendars.length, 0, 'nothing new after cursor');

  // Stale edit (older client time) is rejected with the server row.
  r = await call('/api/sync/push', 'alice', { mutations: [ev('evt-00001', { data: { title: 'OLD' }, m: { client_updated_at: '2025-12-31T00:00:00.000Z' } })] });
  assert.strictEqual(r.json.results[0].status, 'stale');
  assert.strictEqual(r.json.results[0].row.title, 'T');

  // Newer edit wins and shows up after the cursor.
  r = await call('/api/sync/push', 'alice', { mutations: [ev('evt-00001', { data: { title: 'NEW' }, m: { client_updated_at: '2026-01-02T00:00:00.000Z' } })] });
  assert.strictEqual(r.json.results[0].status, 'ok');
  r = await call('/api/sync/pull?since=' + encodeURIComponent(cursor), 'alice');
  assert.strictEqual(r.json.events[0].title, 'NEW');

  // Another user can neither see nor overwrite it.
  r = await call('/api/sync/pull?since=', 'bob');
  assert.strictEqual(r.json.events.length, 0);
  r = await call('/api/sync/push', 'bob', { mutations: [ev('evt-00001', { m: { client_updated_at: '2030-01-01T00:00:00.000Z' } })] });
  assert.strictEqual(r.json.results[0].status, 'forbidden');

  // Invalid input is rejected, not crashed on.
  r = await call('/api/sync/push', 'alice', { mutations: [{ table: 'events', id: 'x', op: 'upsert' }, ev('evt-00002', { data: { start: 'garbage' } })] });
  assert.deepStrictEqual(r.json.results.map((x) => x.status), ['invalid', 'invalid']);

  // Deleting a calendar tombstones it and its events.
  r = await call('/api/sync/push', 'alice', { mutations: [{ table: 'calendars', id: 'cal-00001', op: 'delete', client_updated_at: '2026-02-01T00:00:00.000Z' }] });
  assert.strictEqual(r.json.results[0].status, 'ok');
  r = await call('/api/sync/pull?since=', 'alice');
  assert.strictEqual(r.json.calendars[0].is_deleted, 1);
  assert.strictEqual(r.json.events[0].is_deleted, 1);

  // Paging: > 1000 rows come back in pages that together cover everything once.
  const many = Array.from({ length: 500 }, (_, i) => ev('page-' + String(i).padStart(5, '0'), { data: { calendar_id: 'cal-00009' } }));
  for (let i = 0; i < 3; i++) {
    const batch = many.map((m) => ({ ...m, id: m.id + '-' + i }));
    await call('/api/sync/push', 'carol', { mutations: batch });
  }
  let since = '', seen = new Set(), pages = 0;
  do {
    r = await call('/api/sync/pull?since=' + encodeURIComponent(since), 'carol');
    r.json.events.forEach((e) => seen.add(e.id));
    since = r.json.cursor; pages++;
  } while (r.json.hasMore && pages < 10);
  assert.strictEqual(seen.size, 1500);
  assert.ok(pages >= 2, 'paged');

  server.close();
  console.log('backend sync tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
