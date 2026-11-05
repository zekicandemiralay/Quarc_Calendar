import { create } from 'zustand';
import { db, getMeta, setMeta, clearLocalData } from './db';
import { apiUrl } from './apiUrl';

// Sync engine. The UI never waits on the network: everything is written to
// the local database first (lib/data.js), and this module drains the outbox
// to the server and pulls other devices' changes whenever it can.
//
// Triggers: app start, after every local write (debounced), the browser's
// 'online' event, tab regaining focus, and a 30 s heartbeat. If any attempt
// fails (offline, server down) nothing is lost: the changes simply stay in
// the outbox and the next trigger retries.

export const useSyncStore = create(() => ({
  status: navigator.onLine ? 'idle' : 'offline', // idle | syncing | offline | error | auth
  lastSync: null,
  error: null,
}));

class AuthError extends Error {}

let rerun = false;
let debounceTimer = null;
let onAuthLost = () => {};

export function setAuthLostHandler(fn) {
  onAuthLost = fn;
}

async function request(path, options) {
  const res = await fetch(apiUrl(path), { credentials: 'include', ...options });
  if (res.status === 401) throw new AuthError('Session expired');
  if (!res.ok) throw new Error(`Server returned ${res.status}`);
  return res.json();
}

// ---- Push -------------------------------------------------------------------

async function pushOutbox() {
  for (;;) {
    const batch = await db.outbox.limit(200).toArray();
    if (!batch.length) return;

    const { results } = await request('/api/sync/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mutations: batch.map((m) => ({
          table: m.table, id: m.id, op: m.op, data: m.data, client_updated_at: m.client_updated_at,
        })),
      }),
    });

    const sent = new Map(batch.map((m) => [m.key, m]));
    await db.transaction('rw', db.events, db.calendars, db.outbox, async () => {
      for (const r of results) {
        const key = `${r.table}:${r.id}`;
        const was = sent.get(key);
        if (!was) continue;
        // If the user edited this row again while the request was in flight,
        // the outbox entry is newer than what we sent: keep it for next round.
        const current = await db.outbox.get(key);
        const unchanged = current && current.client_updated_at === was.client_updated_at;

        if (r.status === 'stale' && r.row) {
          // Another device wrote a newer version first: adopt it, drop ours.
          if (unchanged) {
            await db[r.table].put(r.row);
            await db.outbox.delete(key);
          }
        } else if (unchanged) {
          // 'ok', and also 'invalid'/'forbidden', which can never succeed on retry.
          await db.outbox.delete(key);
        }
      }
    });
    if (batch.length < 200) return;
  }
}

// ---- Pull -------------------------------------------------------------------

async function applyRows(table, rows) {
  for (const row of rows) {
    const pending = await db.outbox.get(`${table}:${row.id}`);
    // Never clobber a local edit that hasn't been uploaded yet and is newer.
    if (pending && pending.client_updated_at > row.client_updated_at) continue;
    if (pending) await db.outbox.delete(`${table}:${row.id}`);
    await db[table].put(row);
  }
}

async function pullChanges() {
  for (;;) {
    const since = await getMeta('cursor', '');
    const data = await request(`/api/sync/pull?since=${encodeURIComponent(since)}`);
    await db.transaction('rw', db.events, db.calendars, db.outbox, db.meta, async () => {
      await applyRows('calendars', data.calendars);
      await applyRows('events', data.events);
      await setMeta('cursor', data.cursor);
    });
    if (!data.hasMore) return;
  }
}

// ---- Public API ---------------------------------------------------------------

let current = null;

/** Run a sync. Resolves when the in-flight (or this) run finishes; calls during a run schedule one more pass. */
export function syncNow() {
  if (current) {
    rerun = true;
    return current;
  }
  if (!navigator.onLine) {
    useSyncStore.setState({ status: 'offline' });
    return Promise.resolve();
  }
  useSyncStore.setState({ status: 'syncing', error: null });
  current = (async () => {
    try {
      await pushOutbox();
      await pullChanges();
      useSyncStore.setState({ status: 'idle', lastSync: new Date(), error: null });
    } catch (e) {
      if (e instanceof AuthError) {
        useSyncStore.setState({ status: 'auth', error: e.message });
        onAuthLost();
      } else {
        useSyncStore.setState({ status: navigator.onLine ? 'error' : 'offline', error: e.message });
      }
    } finally {
      current = null;
      if (rerun) {
        rerun = false;
        setTimeout(syncNow, 0);
      }
    }
  })();
  return current;
}

/** Called after every local write: batch bursts of edits into one request. */
export function requestSync() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(syncNow, 600);
}

export function startSyncLoop() {
  const onOnline = () => syncNow();
  const onOffline = () => useSyncStore.setState({ status: 'offline' });
  const onVisible = () => document.visibilityState === 'visible' && syncNow();
  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);
  document.addEventListener('visibilitychange', onVisible);
  const interval = setInterval(syncNow, 30000);
  syncNow();
  return () => {
    window.removeEventListener('online', onOnline);
    window.removeEventListener('offline', onOffline);
    document.removeEventListener('visibilitychange', onVisible);
    clearInterval(interval);
    clearTimeout(debounceTimer);
  };
}

/** Local data belongs to one account: wipe it if a different user logs in. */
export async function adoptUser(userId) {
  const owner = await getMeta('user_id');
  if (owner && owner !== userId) await clearLocalData();
  if (owner !== userId) await setMeta('user_id', userId);
}
