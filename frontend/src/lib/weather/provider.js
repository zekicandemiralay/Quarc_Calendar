// Weather data, fetched DIRECTLY from the device (same approach as Quarc Weather): no Quarc server in the
// path, so the weather keeps working when Tailscale is off or the server is down. Open-Meteo, its
// geocoder and OpenStreetMap's Nominatim all allow browser requests (CORS) and need no API key.
//
//   recent window   forecast API: the last 92 days (best estimate of what happened) + 16 days ahead
//   older dates     archive API (ERA5 reanalysis), fetched one month at a time
//   city search     Open-Meteo geocoder
//   place name      Nominatim reverse geocoding for a GPS fix
//
// Plain GETs with no custom headers, so no CORS pre-flight. Temperatures are always fetched in °C;
// the UI converts for display, so the cache doesn't depend on the unit setting.

const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const ARCHIVE_URL = 'https://archive-api.open-meteo.com/v1/archive';
const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const REVERSE_URL = 'https://nominatim.openstreetmap.org/reverse';
const TIMEOUT_MS = 12000;

export const PAST_DAYS = 92; // the forecast API's maximum
export const FORECAST_DAYS = 16; // today + 15

const HOURLY = 'temperature_2m,weather_code,is_day';
const DAILY = 'weather_code,temperature_2m_max,temperature_2m_min';

export class WeatherError extends Error {}

async function getJson(url, params, fetchImpl = fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetchImpl(`${url}?${new URLSearchParams(params)}`, { signal: controller.signal });
    if (!res.ok) throw new WeatherError(`Weather service ${res.status}`);
    return await res.json();
  } catch (err) {
    if (err instanceof WeatherError) throw err;
    throw new WeatherError(err?.name === 'AbortError' ? 'Weather service timed out' : 'Weather service unreachable');
  } finally {
    clearTimeout(timer);
  }
}

const coords = (lat, lon) => ({ latitude: lat.toFixed(3), longitude: lon.toFixed(3) });
const r1 = (v) => Math.round(v * 10) / 10;

/** Hourly lookups are keyed by the absolute hour, so they line up with the calendar whatever the time zones. */
export const hourKey = (ms) => Math.round(ms / 3600000);

/**
 * Turn an Open-Meteo response (timezone=auto, timeformat=unixtime) into the compact cached form:
 *   days    { 'YYYY-MM-DD' (the place's own date): [max, min, code] }
 *   hours   { hourKey: [temp, code, isDay] }
 *   current { t, c, d, at } or null
 */
export function normalize(json) {
  const off = (json.utc_offset_seconds || 0) * 1000;
  const days = {};
  const d = json.daily || {};
  (d.time || []).forEach((t, i) => {
    const max = d.temperature_2m_max?.[i];
    const min = d.temperature_2m_min?.[i];
    if (max == null || min == null) return;
    // Local midnight, shifted by today's UTC offset and nudged to noon: lands on the right date even
    // across a daylight-saving change inside the window.
    const date = new Date(t * 1000 + off + 12 * 3600000).toISOString().slice(0, 10);
    days[date] = [r1(max), r1(min), d.weather_code?.[i] ?? null];
  });

  const hours = {};
  const h = json.hourly || {};
  (h.time || []).forEach((t, i) => {
    const temp = h.temperature_2m?.[i];
    if (temp == null) return;
    hours[hourKey(t * 1000)] = [r1(temp), h.weather_code?.[i] ?? null, h.is_day?.[i] ?? 1];
  });

  const c = json.current;
  const current =
    c && c.temperature_2m != null ? { t: r1(c.temperature_2m), c: c.weather_code ?? null, d: c.is_day ?? 1, at: c.time * 1000 } : null;
  return { days, hours, current };
}

/** Last 92 days + the next 16, with current conditions. */
export async function fetchRecent(lat, lon, fetchImpl) {
  const json = await getJson(
    FORECAST_URL,
    {
      ...coords(lat, lon),
      current: 'temperature_2m,weather_code,is_day',
      hourly: HOURLY,
      daily: DAILY,
      timezone: 'auto',
      timeformat: 'unixtime',
      past_days: String(PAST_DAYS),
      forecast_days: String(FORECAST_DAYS),
    },
    fetchImpl
  );
  return normalize(json);
}

/** Recorded weather for an older date range (YYYY-MM-DD, inclusive). */
export async function fetchArchive(lat, lon, startDate, endDate, fetchImpl) {
  const json = await getJson(
    ARCHIVE_URL,
    { ...coords(lat, lon), start_date: startDate, end_date: endDate, hourly: HOURLY, daily: DAILY, timezone: 'auto', timeformat: 'unixtime' },
    fetchImpl
  );
  return normalize(json);
}

/** City search: [{ name, detail, latitude, longitude }]. */
export async function searchPlaces(query, { language = 'en', fetchImpl } = {}) {
  const q = String(query || '').trim();
  if (q.length < 2) return [];
  const data = await getJson(GEOCODE_URL, { name: q, count: '8', language, format: 'json' }, fetchImpl);
  return (data.results || []).map((r) => ({
    name: r.name,
    detail: [r.admin1, r.country].filter((x) => x && x !== r.name).join(', '),
    latitude: r.latitude,
    longitude: r.longitude,
  }));
}

/** A readable name for a GPS fix ("Kadıköy, İstanbul"), or null. Never throws. */
export async function reverseGeocode(lat, lon, { language = 'en', fetchImpl } = {}) {
  try {
    const a = await getJson(
      REVERSE_URL,
      { lat: lat.toFixed(4), lon: lon.toFixed(4), format: 'jsonv2', zoom: '14', addressdetails: '1', 'accept-language': language },
      fetchImpl
    );
    if (a.error) return null;
    const ad = a.address || {};
    const name = ad.suburb || ad.neighbourhood || ad.quarter || ad.town || ad.village || ad.city_district || ad.city || ad.county || a.name;
    if (!name) return null;
    const region = ad.city || ad.province || ad.state || ad.region;
    return { name, detail: [region !== name ? region : null, ad.country].filter(Boolean).join(', ') };
  } catch {
    return null;
  }
}

/**
 * The device's position, or null for every failure (no API, denied, timeout). On Android this goes through
 * the native Capacitor Geolocation plugin, because a WebView can't show the runtime permission dialog
 * itself (same as Quarc Weather). Web, PWA and desktop use the browser API.
 */
export async function getCurrentPositionSafe({ timeout = 10000 } = {}) {
  const Geo = window?.Capacitor?.isNativePlatform?.() && window.Capacitor.Plugins?.Geolocation;
  if (Geo) {
    try {
      const perm = await Geo.requestPermissions();
      if (perm?.location !== 'granted' && perm?.coarseLocation !== 'granted') return null;
      const pos = await Geo.getCurrentPosition({ timeout, enableHighAccuracy: false });
      return { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
    } catch {
      return null;
    }
  }
  if (!navigator.geolocation) return null;
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => {
      if (!settled) {
        settled = true;
        resolve(v);
      }
    };
    const guard = setTimeout(() => done(null), timeout);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        clearTimeout(guard);
        done({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
      },
      () => {
        clearTimeout(guard);
        done(null);
      },
      { timeout, enableHighAccuracy: false, maximumAge: 10 * 60 * 1000 }
    );
  });
}
