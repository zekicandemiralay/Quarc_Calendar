import { describe, it, expect } from 'vitest';
import { layoutDay, layoutSpans } from '../layout';
import { expandEvents } from '../recurrence';

const L = (y, m, d, h = 0, min = 0) => new Date(y, m - 1, d, h, min);
const ev = (id, s, e) => ({ id, all_day: 0, start: s.toISOString(), end: e.toISOString(), exdates: [] });
const day = L(2026, 3, 10);
const occsOf = (list) => expandEvents(list, L(2026, 3, 1), L(2026, 4, 1));

describe('layoutDay', () => {
  it('places non-overlapping events in a single full-width column', () => {
    const r = layoutDay(occsOf([ev('a', L(2026, 3, 10, 9), L(2026, 3, 10, 10)), ev('b', L(2026, 3, 10, 10), L(2026, 3, 10, 11))]), day);
    expect(r.map((x) => [x.col, x.cols])).toEqual([[0, 1], [0, 1]]);
    expect(r[0].top).toBe(540);
    expect(r[0].height).toBe(60);
  });
  it('splits overlapping events into columns', () => {
    const r = layoutDay(occsOf([ev('a', L(2026, 3, 10, 9), L(2026, 3, 10, 11)), ev('b', L(2026, 3, 10, 10), L(2026, 3, 10, 12)), ev('c', L(2026, 3, 10, 11), L(2026, 3, 10, 12))]), day);
    const byId = Object.fromEntries(r.map((x) => [x.occ.id, x]));
    expect(byId.a.col).toBe(0);
    expect(byId.b.col).toBe(1);
    expect(byId.c.col).toBe(0); // reuses the freed column
    expect(r.every((x) => x.cols === 2)).toBe(true);
  });
  it('gives zero-length events a visible minimum height', () => {
    const r = layoutDay(occsOf([ev('a', L(2026, 3, 10, 9), L(2026, 3, 10, 9))]), day);
    expect(r[0].height).toBeGreaterThanOrEqual(20);
  });
  it('ignores events on other days and multi-day events', () => {
    const r = layoutDay(occsOf([ev('a', L(2026, 3, 11, 9), L(2026, 3, 11, 10)), ev('b', L(2026, 3, 9, 22), L(2026, 3, 10, 2))]), day);
    expect(r).toHaveLength(0);
  });
});

describe('layoutSpans', () => {
  const week = Array.from({ length: 7 }, (_, i) => L(2026, 3, 8 + i)); // Sun 8 .. Sat 14
  const allDay = (id, s, e) => ({ id, all_day: 1, start: s, end: e, exdates: [] });

  it('computes columns, spans and clipping', () => {
    const { segments } = layoutSpans(occsOf([allDay('a', '2026-03-06', '2026-03-09'), allDay('b', '2026-03-13', '2026-03-16')]), week);
    const a = segments.find((s) => s.occ.id === 'a');
    const b = segments.find((s) => s.occ.id === 'b');
    expect([a.start, a.span, a.clippedLeft, a.clippedRight]).toEqual([0, 2, true, false]);
    expect([b.start, b.span, b.clippedLeft, b.clippedRight]).toEqual([5, 2, false, true]);
  });
  it('packs overlapping bars into separate lanes and reuses free lanes', () => {
    const { segments, lanes } = layoutSpans(occsOf([allDay('a', '2026-03-09', '2026-03-11'), allDay('b', '2026-03-10', '2026-03-10'), allDay('c', '2026-03-12', '2026-03-12')]), week);
    expect(lanes).toBe(2);
    const lane = (id) => segments.find((s) => s.occ.id === id).lane;
    expect(lane('a')).toBe(0);
    expect(lane('b')).toBe(1);
    expect(lane('c')).toBe(0);
  });
});
