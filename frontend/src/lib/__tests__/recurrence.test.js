import { describe, it, expect } from 'vitest';
import { expandEvents, endSeriesBefore, withExdate, isMultiDay, dateKey } from '../recurrence';

const local = (y, m, d, h = 0, min = 0) => new Date(y, m - 1, d, h, min);
const timed = (id, s, e, extra = {}) => ({ id, all_day: 0, start: s.toISOString(), end: e.toISOString(), exdates: [], ...extra });
const days = (occs) => occs.map((o) => o.originalDate);

describe('expandEvents', () => {
  it('returns a single event only inside the range', () => {
    const ev = timed('a', local(2026, 3, 10, 9), local(2026, 3, 10, 10));
    expect(expandEvents([ev], local(2026, 3, 1), local(2026, 4, 1))).toHaveLength(1);
    expect(expandEvents([ev], local(2026, 4, 1), local(2026, 5, 1))).toHaveLength(0);
  });

  it('skips deleted events', () => {
    const ev = timed('a', local(2026, 3, 10, 9), local(2026, 3, 10, 10), { is_deleted: 1 });
    expect(expandEvents([ev], local(2026, 3, 1), local(2026, 4, 1))).toHaveLength(0);
  });

  it('expands daily with interval', () => {
    const ev = timed('a', local(2026, 3, 1, 9), local(2026, 3, 1, 10), { rrule: { freq: 'daily', interval: 2 } });
    expect(days(expandEvents([ev], local(2026, 3, 1), local(2026, 3, 8)))).toEqual(
      ['2026-03-01', '2026-03-03', '2026-03-05', '2026-03-07']);
  });

  it('jumps ahead correctly for ranges far from the anchor (daily, weekly)', () => {
    const d = timed('a', local(2020, 1, 1, 9), local(2020, 1, 1, 10), { rrule: { freq: 'daily', interval: 3 } });
    const got = days(expandEvents([d], local(2026, 3, 1), local(2026, 3, 10)));
    expect(got.length).toBeGreaterThan(0);
    for (const k of got) {
      const diff = Math.round((new Date(k + 'T00:00') - local(2020, 1, 1)) / 86400000);
      expect(diff % 3).toBe(0);
    }
    const w = timed('b', local(2020, 1, 6, 9), local(2020, 1, 6, 10), { rrule: { freq: 'weekly', interval: 1 } });
    expect(days(expandEvents([w], local(2026, 3, 1), local(2026, 3, 31))).every((k) => new Date(k + 'T00:00').getDay() === 1)).toBe(true);
  });

  it('expands weekly on chosen weekdays, never before the anchor', () => {
    // Anchor Wed 2026-03-04; repeat Mon+Wed. The Monday of the anchor week (03-02) must NOT appear.
    const ev = timed('a', local(2026, 3, 4, 9), local(2026, 3, 4, 10), { rrule: { freq: 'weekly', interval: 1, byweekday: [1, 3] } });
    expect(days(expandEvents([ev], local(2026, 3, 1), local(2026, 3, 16)))).toEqual(
      ['2026-03-04', '2026-03-09', '2026-03-11', '2026-03-16'].slice(0, 3));
  });

  it('every 2 weeks', () => {
    const ev = timed('a', local(2026, 3, 2, 9), local(2026, 3, 2, 10), { rrule: { freq: 'weekly', interval: 2 } });
    expect(days(expandEvents([ev], local(2026, 3, 1), local(2026, 4, 10)))).toEqual(['2026-03-02', '2026-03-16', '2026-03-30']);
  });

  it('monthly clamps the 31st and returns to the 31st', () => {
    const ev = timed('a', local(2026, 1, 31, 9), local(2026, 1, 31, 10), { rrule: { freq: 'monthly', interval: 1 } });
    expect(days(expandEvents([ev], local(2026, 1, 1), local(2026, 5, 1)))).toEqual(
      ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
  });

  it('yearly handles Feb 29', () => {
    const ev = timed('a', local(2024, 2, 29, 9), local(2024, 2, 29, 10), { rrule: { freq: 'yearly', interval: 1 } });
    expect(days(expandEvents([ev], local(2025, 1, 1), local(2029, 1, 1)))).toEqual(
      ['2025-02-28', '2026-02-28', '2027-02-28', '2028-02-29']);
  });

  it('honours count and until', () => {
    const c = timed('a', local(2026, 3, 1, 9), local(2026, 3, 1, 10), { rrule: { freq: 'daily', interval: 1, count: 3 } });
    expect(expandEvents([c], local(2026, 1, 1), local(2027, 1, 1))).toHaveLength(3);
    const u = timed('b', local(2026, 3, 1, 9), local(2026, 3, 1, 10), { rrule: { freq: 'daily', interval: 1, until: '2026-03-05' } });
    expect(days(expandEvents([u], local(2026, 1, 1), local(2027, 1, 1))).slice(-1)).toEqual(['2026-03-05']);
  });

  it('removes exdates', () => {
    const ev = timed('a', local(2026, 3, 1, 9), local(2026, 3, 1, 10), { rrule: { freq: 'daily', interval: 1 }, exdates: ['2026-03-02'] });
    expect(days(expandEvents([ev], local(2026, 3, 1), local(2026, 3, 4)))).toEqual(['2026-03-01', '2026-03-03']);
  });

  it('keeps wall-clock time across a DST change', () => {
    const ev = timed('a', local(2026, 3, 20, 9), local(2026, 3, 20, 10), { rrule: { freq: 'daily', interval: 1 } });
    for (const o of expandEvents([ev], local(2026, 3, 20), local(2026, 4, 5))) expect(o.occStart.getHours()).toBe(9);
  });

  it('all-day multi-day events overlap into the range and keep their length', () => {
    const ev = { id: 'x', all_day: 1, start: '2026-03-30', end: '2026-04-02', exdates: [] };
    const apr = expandEvents([ev], local(2026, 4, 1), local(2026, 5, 1));
    expect(apr).toHaveLength(1);
    expect(dateKey(apr[0].occEnd)).toBe('2026-04-03'); // exclusive end
    expect(isMultiDay(apr[0])).toBe(true);
  });

  it('a recurring multi-day event that started before the range is still found', () => {
    const ev = { id: 'x', all_day: 1, start: '2026-03-30', end: '2026-04-02', exdates: [], rrule: { freq: 'monthly', interval: 1 } };
    expect(expandEvents([ev], local(2026, 4, 1), local(2026, 4, 2))).toHaveLength(1);
  });

  it('timed event crossing midnight counts as multi-day', () => {
    const ev = timed('a', local(2026, 3, 1, 22), local(2026, 3, 2, 2));
    expect(isMultiDay(expandEvents([ev], local(2026, 3, 1), local(2026, 3, 3))[0])).toBe(true);
    const ev2 = timed('b', local(2026, 3, 1, 22), local(2026, 3, 2, 0));
    expect(isMultiDay(expandEvents([ev2], local(2026, 3, 1), local(2026, 3, 3))[0])).toBe(false);
  });
});

describe('series editing helpers', () => {
  const ev = timed('a', local(2026, 3, 1, 9), local(2026, 3, 1, 10), { rrule: { freq: 'daily', interval: 1, count: 10 }, exdates: ['2026-03-02', '2026-03-08'] });

  it('endSeriesBefore truncates and drops later exdates and count', () => {
    const cut = endSeriesBefore(ev, '2026-03-05');
    expect(cut.rrule.until).toBe('2026-03-04');
    expect(cut.rrule.count).toBeUndefined();
    expect(cut.exdates).toEqual(['2026-03-02']);
  });
  it('endSeriesBefore on the first occurrence means nothing remains', () => {
    expect(endSeriesBefore(ev, '2026-03-01')).toBeNull();
  });
  it('withExdate is idempotent', () => {
    const twice = withExdate(withExdate(ev, '2026-03-03'), '2026-03-03');
    expect(twice.exdates.filter((d) => d === '2026-03-03')).toHaveLength(1);
  });
});
