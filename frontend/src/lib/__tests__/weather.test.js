import { describe, it, expect } from 'vitest';
import { normalize, hourKey } from '../weather/provider';
import { iconFor } from '../weather/codes';
import { homeLocation, locationFor, locKey } from '../weather/store';
import { initialView } from '../../store/settingsStore';

describe('weather: Open-Meteo response normalisation', () => {
  // Istanbul (UTC+3): local midnight 2026-11-28 = 2026-11-27T21:00Z
  const midnight = Date.UTC(2026, 10, 27, 21) / 1000;
  const json = {
    utc_offset_seconds: 10800,
    current: { time: midnight + 13 * 3600, temperature_2m: 14.84, weather_code: 3, is_day: 1 },
    hourly: {
      time: [midnight, midnight + 3600, midnight + 7200],
      temperature_2m: [9.04, 8.6, null],
      weather_code: [0, 2, 61],
      is_day: [0, 0, 0],
    },
    daily: { time: [midnight, midnight + 86400], temperature_2m_max: [15.2, 12], temperature_2m_min: [7.1, null], weather_code: [2, 61] },
  };
  const n = normalize(json);

  it('keys days by the place\'s own date, skipping incomplete days', () => {
    expect(n.days).toEqual({ '2026-11-28': [15.2, 7.1, 2] });
  });

  it('keys hours by absolute time, skipping missing values', () => {
    expect(n.hours[hourKey(midnight * 1000)]).toEqual([9, 0, 0]);
    expect(n.hours[hourKey((midnight + 3600) * 1000)]).toEqual([8.6, 2, 0]);
    expect(Object.keys(n.hours)).toHaveLength(2);
  });

  it('keeps current conditions', () => {
    expect(n.current).toEqual({ t: 14.8, c: 3, d: 1, at: (midnight + 13 * 3600) * 1000 });
  });

  it('gets the date right across a daylight-saving change in the window', () => {
    // Berlin: summer midnight 2026-07-01 = 2026-06-30T22:00Z, but the response's offset is winter's (+1h)
    const summerMidnight = Date.UTC(2026, 5, 30, 22) / 1000;
    const m = normalize({ utc_offset_seconds: 3600, daily: { time: [summerMidnight], temperature_2m_max: [25], temperature_2m_min: [15], weather_code: [0] } });
    expect(Object.keys(m.days)).toEqual(['2026-07-01']);
  });

  it('a device-local hour finds the place\'s hour even across time zones', () => {
    // 12:00 in Istanbul is 10:00 in Berlin: the same instant, the same key
    expect(hourKey(Date.UTC(2026, 10, 28, 9))).toBe(hourKey(Date.UTC(2026, 10, 28, 9, 0, 0, 400)));
  });

  it('uses night icons for clear skies at night only', () => {
    expect(iconFor(0, false)).toBe('moon');
    expect(iconFor(0, true)).toBe('sun');
    expect(iconFor(61, false)).toBe('rain');
  });
});

describe('weather: which place a day uses', () => {
  const home = homeLocation({ weatherHome: null, lastPosition: { latitude: 41.01, longitude: 28.98, name: 'Fatih', detail: 'İstanbul' } });
  const berlin = { id: 'p1', name: 'Berlin', detail: 'Germany', latitude: 52.52, longitude: 13.4, start_date: '2026-12-03', end_date: '2026-12-07', client_updated_at: '2026-11-01T00:00:00Z' };
  const potsdam = { ...berlin, id: 'p2', name: 'Potsdam', latitude: 52.4, longitude: 13.06, start_date: '2026-12-05', end_date: '2026-12-05', client_updated_at: '2026-11-02T00:00:00Z' };

  it('falls back to the device default outside every range', () => {
    expect(locationFor('2026-12-02', [berlin], home)).toBe(home);
    expect(locationFor('2026-12-08', [berlin], home)).toBe(home);
    expect(home.source).toBe('gps');
  });

  it('uses the place on its first and last day (inclusive)', () => {
    expect(locationFor('2026-12-03', [berlin], home).name).toBe('Berlin');
    expect(locationFor('2026-12-07', [berlin], home).source).toBe('place');
  });

  it('the most recently edited place wins where ranges overlap', () => {
    expect(locationFor('2026-12-05', [berlin, potsdam], home).name).toBe('Potsdam');
    expect(locationFor('2026-12-04', [berlin, potsdam], home).name).toBe('Berlin');
  });

  it('a fixed default place beats the device location; nothing known gives null', () => {
    const fixed = homeLocation({ weatherHome: { name: 'Ankara', latitude: 39.93, longitude: 32.86 }, lastPosition: home });
    expect(fixed.name).toBe('Ankara');
    expect(fixed.source).toBe('home');
    expect(homeLocation({ weatherHome: null, lastPosition: null })).toBe(null);
  });

  it('nearby fixes share one cache key', () => {
    expect(locKey(41.0112, 28.9771)).toBe(locKey(41.0141, 28.9822));
  });
});

describe('start view', () => {
  it('reopens the last used view by default, or a fixed one', () => {
    expect(initialView({ startView: 'last', lastView: 'month' })).toBe('month');
    expect(initialView({ startView: 'agenda', lastView: 'month' })).toBe('agenda');
    expect(initialView({ startView: 'last', lastView: 'bogus' })).toBe('week');
  });
});
