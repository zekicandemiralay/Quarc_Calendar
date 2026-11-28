import { useEffect, useMemo } from 'react';
import { create } from 'zustand';
import { useLiveQuery } from 'dexie-react-hooks';
import { addDays, format } from 'date-fns';
import i18n from 'i18next';
import { db } from '../db';
import useSettings from '../../store/settingsStore';
import { fetchArchive, fetchRecent, getCurrentPositionSafe, hourKey, PAST_DAYS, FORECAST_DAYS, reverseGeocode } from './provider';

// Weather for the calendar.
//
// WHICH place a day uses: a synced "place" whose date range covers the day (a trip), otherwise this
// device's default: a fixed place chosen in settings, or the device's current location.
//
// WHERE the data comes from: memory -> IndexedDB (so it shows offline) -> network when stale. Data is
// cached per location in chunks:
//   r:<loc>            the forecast API's recent window (92 days back, 16 ahead), refreshed hourly
//   a:<loc>:<YYYY-MM>  older recorded weather from the archive API, one month per chunk, never refetched

const DATE = 'yyyy-MM-dd';
const RECENT_MAX_AGE = 60 * 60 * 1000;
const RETRY_AFTER = 5 * 60 * 1000;
const POSITION_EVERY = 30 * 60 * 1000;
const MAX_CACHED = 80;

export const toDateStr = (d) => format(d, DATE);
export const locKey = (lat, lon) => `${lat.toFixed(2)},${lon.toFixed(2)}`;

export const useWeatherStore = create(() => ({
  chunks: {}, // key -> { days, hours, current, fetchedAt }
  version: 0, // bumped whenever chunks change, so hooks recompute
  tick: 0, // bumped periodically so visible data is re-checked for staleness
  locating: false,
}));

const inflight = new Map();
const failedAt = new Map();

function putChunk(key, chunk) {
  useWeatherStore.setState((s) => ({ chunks: { ...s.chunks, [key]: chunk }, version: s.version + 1 }));
}

async function ensureChunk(key, fetcher, maxAge) {
  if (inflight.has(key)) return inflight.get(key);
  const job = (async () => {
    let chunk = useWeatherStore.getState().chunks[key];
    if (!chunk) {
      const row = await db.weather.get(key).catch(() => null);
      if (row) {
        chunk = row.data;
        putChunk(key, chunk);
      }
    }
    const fresh = chunk && Date.now() - chunk.fetchedAt < maxAge;
    if (fresh || !navigator.onLine || Date.now() - (failedAt.get(key) || 0) < RETRY_AFTER) return;
    try {
      const data = { ...(await fetcher()), fetchedAt: Date.now() };
      putChunk(key, data);
      await db.weather.put({ key, fetchedAt: data.fetchedAt, data });
      pruneCache();
    } catch {
      failedAt.set(key, Date.now()); // offline or service down: keep showing the cached copy
    }
  })().finally(() => inflight.delete(key));
  inflight.set(key, job);
  return job;
}

let pruning = false;
async function pruneCache() {
  if (pruning) return;
  pruning = true;
  try {
    const count = await db.weather.count();
    if (count > MAX_CACHED) {
      const oldest = (await db.weather.toArray()).sort((a, b) => a.fetchedAt - b.fetchedAt).slice(0, count - MAX_CACHED);
      await db.weather.bulkDelete(oldest.map((r) => r.key));
    }
  } finally {
    pruning = false;
  }
}

/** The span the recent chunk covers, as date strings. */
function recentWindow(now = new Date()) {
  return { from: toDateStr(addDays(now, -PAST_DAYS)), to: toDateStr(addDays(now, FORECAST_DAYS - 1)) };
}

/** Make sure weather for `loc` covering dates [from, to] (YYYY-MM-DD) is loaded or being loaded. */
export function ensureRange(loc, from, to) {
  const { latitude: lat, longitude: lon } = loc;
  const win = recentWindow();
  if (to >= win.from && from <= win.to) {
    ensureChunk(`r:${loc.key}`, () => fetchRecent(lat, lon), RECENT_MAX_AGE);
  }
  if (from < win.from) {
    // Whole months of recorded weather, up to the start of the recent window.
    const today = toDateStr(new Date());
    let month = from.slice(0, 7);
    const lastMonth = (to < win.from ? to : win.from).slice(0, 7);
    for (let guard = 0; month <= lastMonth && guard < 24; guard++) {
      const [y, m] = month.split('-').map(Number);
      const start = `${month}-01`;
      const endOfMonth = toDateStr(new Date(y, m, 0));
      const end = endOfMonth < today ? endOfMonth : today;
      if (start >= '1950-01-01') ensureChunk(`a:${loc.key}:${month}`, () => fetchArchive(lat, lon, start, end), Infinity);
      month = toDateStr(new Date(y, m, 1)).slice(0, 7);
    }
  }
}

// ---- lookups ---------------------------------------------------------------------

function chunksFor(key, dateStr) {
  const c = useWeatherStore.getState().chunks;
  return [c[`r:${key}`], c[`a:${key}:${dateStr.slice(0, 7)}`]].filter(Boolean);
}

/** [max, min, code] for a day, or null. */
export function dayAt(key, dateStr) {
  for (const ch of chunksFor(key, dateStr)) if (ch.days[dateStr]) return ch.days[dateStr];
  return null;
}

/** [temp, code, isDay] for the hour starting at `ms`, or null. */
export function hourAt(key, dateStr, ms) {
  const k = hourKey(ms);
  for (const ch of chunksFor(key, dateStr)) if (ch.hours[k]) return ch.hours[k];
  return null;
}

/** Conditions right now: the live reading while it's fresh, otherwise this hour's forecast. */
export function currentAt(key, now = Date.now()) {
  const recent = useWeatherStore.getState().chunks[`r:${key}`];
  if (recent?.current && now - recent.fetchedAt < 90 * 60 * 1000) return [recent.current.t, recent.current.c, recent.current.d];
  return hourAt(key, toDateStr(new Date(now)), now - (now % 3600000));
}

// ---- locations ---------------------------------------------------------------------

/** This device's default location (fixed place or last location fix), or null when unknown. */
export function homeLocation(settings) {
  const p = settings.weatherHome || settings.lastPosition;
  if (!p) return null;
  return {
    key: locKey(p.latitude, p.longitude),
    latitude: p.latitude,
    longitude: p.longitude,
    name: p.name || `${p.latitude.toFixed(2)}, ${p.longitude.toFixed(2)}`,
    detail: p.detail || '',
    source: settings.weatherHome ? 'home' : 'gps',
  };
}

/** The place a day's weather is for. When ranges overlap, the most recently edited one wins. */
export function locationFor(dateStr, places, home) {
  let best = null;
  for (const p of places) {
    if (p.start_date <= dateStr && dateStr <= p.end_date && (!best || p.client_updated_at > best.client_updated_at)) best = p;
  }
  if (!best) return home;
  return {
    key: locKey(best.latitude, best.longitude),
    latitude: best.latitude,
    longitude: best.longitude,
    name: best.name,
    detail: best.detail,
    source: 'place',
    place: best,
  };
}

const NO_PLACES = [];
export function usePlaces() {
  return useLiveQuery(
    async () => (await db.places.where('is_deleted').equals(0).toArray()).sort((a, b) => a.start_date.localeCompare(b.start_date)),
    [],
    NO_PLACES
  );
}

function useHome() {
  const home = useSettings((s) => s.weatherHome);
  const last = useSettings((s) => s.lastPosition);
  return useMemo(() => homeLocation({ weatherHome: home, lastPosition: last }), [home, last]);
}

// ---- hooks for the views ----------------------------------------------------------

/**
 * Weather for a list of days (Date objects at local midnight). Returns one entry per day:
 *   { date, loc, day: [max, min, code] | null, hour(h) -> [temp, code, isDay] | null }
 * or an empty list when weather is turned off.
 */
export function useDaysWeather(days) {
  const enabled = useSettings((s) => s.weatherEnabled);
  const places = usePlaces();
  const home = useHome();
  const version = useWeatherStore((s) => s.version);
  const tick = useWeatherStore((s) => s.tick);

  const dates = useMemo(() => days.map(toDateStr), [days]);
  const locs = useMemo(() => dates.map((d) => locationFor(d, places, home)), [dates, places, home]);

  // One request range per location among the visible days.
  const wanted = useMemo(() => {
    const by = new Map();
    locs.forEach((loc, i) => {
      if (!loc) return;
      const r = by.get(loc.key) || { loc, from: dates[i], to: dates[i] };
      if (dates[i] < r.from) r.from = dates[i];
      if (dates[i] > r.to) r.to = dates[i];
      by.set(loc.key, r);
    });
    return [...by.values()];
  }, [locs, dates]);
  const wantedKey = wanted.map((w) => `${w.loc.key}:${w.from}:${w.to}`).join('|');

  useEffect(() => {
    if (!enabled) return;
    for (const w of wanted) ensureRange(w.loc, w.from, w.to);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, wantedKey, tick]);

  return useMemo(() => {
    if (!enabled) return [];
    return days.map((d, i) => {
      const loc = locs[i];
      const date = dates[i];
      return {
        date,
        loc,
        day: loc ? dayAt(loc.key, date) : null,
        hour: (h) => (loc ? hourAt(loc.key, date, new Date(d.getFullYear(), d.getMonth(), d.getDate(), h).getTime()) : null),
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, days, dates, locs, version]);
}

/** Today's location and its current conditions, for the top bar. */
export function useCurrentWeather() {
  const tick = useWeatherStore((s) => s.tick);
  const today = useMemo(() => {
    const n = new Date();
    return [new Date(n.getFullYear(), n.getMonth(), n.getDate())];
  }, [tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const [entry] = useDaysWeather(today);
  useWeatherStore((s) => s.version);
  if (!entry) return null;
  return { loc: entry.loc, day: entry.day, now: entry.loc ? currentAt(entry.loc.key) : null };
}

// ---- device location -----------------------------------------------------------------

const distKm = (a, b) => {
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLon = ((b.longitude - a.longitude) * Math.PI) / 180 * Math.cos((a.latitude * Math.PI) / 180);
  return 6371 * Math.hypot(dLat, dLon);
};

/** Get a fresh location fix (when following the device's location). Resolves true when one was obtained. */
export async function refreshPosition() {
  const s = useSettings.getState();
  if (!s.weatherEnabled || s.weatherHome) return false;
  if (useWeatherStore.getState().locating) return false;
  useWeatherStore.setState({ locating: true });
  try {
    const pos = await getCurrentPositionSafe();
    if (!pos) return false;
    const last = useSettings.getState().lastPosition;
    if (last && last.name && distKm(last, pos) < 2) {
      // Same place: keep the name we have, just note when it was confirmed.
      useSettings.getState().update({ lastPosition: { ...last, at: Date.now() } });
      return true;
    }
    const lang = (i18n.language || 'en').slice(0, 2);
    const named = await reverseGeocode(pos.latitude, pos.longitude, { language: lang });
    useSettings.getState().update({
      lastPosition: {
        // ~100 m is plenty for weather, and keeps the stored fix coarse.
        latitude: Math.round(pos.latitude * 1000) / 1000,
        longitude: Math.round(pos.longitude * 1000) / 1000,
        name: named?.name || null,
        detail: named?.detail || '',
        at: Date.now(),
      },
    });
    return true;
  } finally {
    useWeatherStore.setState({ locating: false });
  }
}

/** While logged in: keep the location fix and the visible weather fresh. */
export function startWeather() {
  const bump = () => useWeatherStore.setState((s) => ({ tick: s.tick + 1 }));
  const onVisible = () => {
    if (document.visibilityState !== 'visible') return;
    bump();
    const last = useSettings.getState().lastPosition;
    if (!last || Date.now() - (last.at || 0) > POSITION_EVERY) refreshPosition();
  };
  const onOnline = () => bump();
  refreshPosition();
  const timer = setInterval(() => {
    bump();
    refreshPosition();
  }, POSITION_EVERY);
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('online', onOnline);
  return () => {
    clearInterval(timer);
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('online', onOnline);
  };
}
