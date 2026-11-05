// Pure layout maths for the calendar grids (no DOM), kept separate so it can
// be unit-tested.

import { addDays, differenceInCalendarDays, startOfDay } from 'date-fns';
import { isMultiDay } from './recurrence';

export const SNAP_MINUTES = 15;
export const MIN_EVENT_MINUTES = 20; // visual minimum so tiny events stay clickable

const minutesOfDay = (d, day) => Math.round((d - day) / 60000);

/**
 * Timed occurrences for ONE day -> positioned boxes. Overlapping events share
 * the width: they're grouped into clusters of transitively-overlapping events,
 * and inside a cluster each event takes the first free column.
 * Returns [{ occ, top, height, col, cols }] with top/height in minutes.
 */
export function layoutDay(occs, day) {
  const dayStart = startOfDay(day);
  const dayEnd = addDays(dayStart, 1);

  const items = occs
    .filter((o) => !isMultiDay(o) && o.occStart < dayEnd && o.occEnd > dayStart)
    .map((o) => {
      const top = Math.max(0, minutesOfDay(o.occStart, dayStart));
      const end = Math.min(24 * 60, minutesOfDay(o.occEnd, dayStart));
      return { occ: o, top, bottom: Math.max(end, top + MIN_EVENT_MINUTES) };
    })
    .sort((a, b) => a.top - b.top || b.bottom - a.bottom);

  const result = [];
  let cluster = [];
  let clusterEnd = -1;

  const flush = () => {
    if (!cluster.length) return;
    const colEnds = [];
    for (const it of cluster) {
      let col = colEnds.findIndex((end) => end <= it.top);
      if (col === -1) {
        col = colEnds.length;
        colEnds.push(it.bottom);
      } else colEnds[col] = it.bottom;
      it.col = col;
    }
    for (const it of cluster) {
      result.push({ occ: it.occ, top: it.top, height: it.bottom - it.top, col: it.col, cols: colEnds.length });
    }
    cluster = [];
    clusterEnd = -1;
  };

  for (const it of items) {
    if (cluster.length && it.top >= clusterEnd) flush();
    cluster.push(it);
    clusterEnd = Math.max(clusterEnd, it.bottom);
  }
  flush();
  return result;
}

/**
 * Multi-day / all-day occurrences for a row of `days` consecutive dates
 * (a week row in the month grid, or the strip above the week/day grid).
 * Each occurrence becomes one segment clipped to the row, packed into lanes.
 * Returns { segments: [{ occ, start, span, lane, clippedLeft, clippedRight }], lanes }.
 * `start`/`span` are 0-based column indexes.
 */
export function layoutSpans(occs, days) {
  const first = startOfDay(days[0]);
  const last = days.length;
  const segs = [];

  for (const o of occs) {
    const s = differenceInCalendarDays(startOfDay(o.occStart), first);
    // occEnd is exclusive; step back 1 ms so a midnight end doesn't claim an extra day
    const e = differenceInCalendarDays(startOfDay(new Date(Math.max(o.occEnd - 1, +o.occStart))), first);
    if (e < 0 || s >= last) continue;
    segs.push({
      occ: o,
      start: Math.max(0, s),
      span: Math.min(last - 1, e) - Math.max(0, s) + 1,
      clippedLeft: s < 0,
      clippedRight: e > last - 1,
    });
  }

  // Longer first, then earlier, so long bars take the top lanes.
  segs.sort((a, b) => a.start - b.start || b.span - a.span || a.occ.occStart - b.occ.occStart);

  const laneEnds = [];
  for (const seg of segs) {
    let lane = laneEnds.findIndex((end) => end <= seg.start);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(0);
    }
    laneEnds[lane] = seg.start + seg.span;
    seg.lane = lane;
  }
  return { segments: segs, lanes: laneEnds.length };
}

/** Snap a minute offset to the grid. */
export const snap = (minutes, step = SNAP_MINUTES) => Math.round(minutes / step) * step;
