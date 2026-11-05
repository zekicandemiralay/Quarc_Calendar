// Event model + recurrence expansion. Pure functions, no I/O.
//
// Stored event shape (same as the server's rows):
//   timed event   start/end = ISO UTC strings  ('2026-03-01T14:00:00.000Z')
//   all-day event start/end = 'YYYY-MM-DD'      (end is INCLUSIVE)
//   rrule  = null | { freq: 'daily'|'weekly'|'monthly'|'yearly', interval,
//                     byweekday?: [0..6] (0 = Sunday), until?: 'YYYY-MM-DD', count?: n }
//   exdates = ['YYYY-MM-DD', …]  local dates of removed occurrences
//
// An "occurrence" is one concrete instance of an event: the event's fields
// plus `occStart`/`occEnd` Date objects and a unique `key`.

import {
  addDays, addMonths, differenceInCalendarDays, format, getDaysInMonth,
  parseISO, startOfDay, startOfWeek, setDate,
} from 'date-fns';

export const DATE_FMT = 'yyyy-MM-dd';
export const dateKey = (d) => format(d, DATE_FMT);

/** Parse an all-day 'YYYY-MM-DD' as a LOCAL midnight (parseISO on a bare date does that). */
export const parseDay = (s) => parseISO(s);

export function eventStart(ev) {
  return ev.all_day ? parseDay(ev.start) : new Date(ev.start);
}

/** Exclusive end for layout: all-day events end at the midnight AFTER their last day. */
export function eventEnd(ev) {
  if (ev.all_day) return addDays(parseDay(ev.end || ev.start), 1);
  return new Date(ev.end || ev.start);
}

const MAX_ITERATIONS = 6000;

/**
 * Start dates (local) of every occurrence whose start falls in [from, to).
 * `from` is widened by the event's duration by the caller so occurrences that
 * began earlier but still overlap the range are included.
 */
function occurrenceStarts(ev, from, to) {
  const anchor = eventStart(ev);
  const r = ev.rrule;
  if (!r) return anchor >= from && anchor < to ? [anchor] : [];

  const interval = Math.max(1, Number(r.interval) || 1);
  const until = r.until ? addDays(parseDay(r.until), 1) : null; // inclusive date
  const limit = until && until < to ? until : to;
  const maxCount = r.count ? Math.min(Number(r.count), MAX_ITERATIONS) : Infinity;

  const out = [];
  let produced = 0;

  // Build the nth candidate (or several, for weekly-by-weekday) and feed them in order.
  const emit = (d) => {
    if (d < anchor) return true; // before the series started (weekly first week)
    if (d >= limit) return false;
    produced += 1;
    if (produced > maxCount) return false;
    if (d >= from) out.push(d);
    return true;
  };

  const withTime = (day) => {
    // Keep the anchor's wall-clock time on every occurrence (DST safe).
    const d = new Date(day);
    d.setHours(anchor.getHours(), anchor.getMinutes(), anchor.getSeconds(), anchor.getMilliseconds());
    return d;
  };

  let guard = 0;

  if (r.freq === 'daily') {
    let n = 0;
    // Without a count we can jump straight to the first relevant day.
    if (!r.count && from > anchor) n = Math.max(0, Math.floor(differenceInCalendarDays(from, anchor) / interval) - 1);
    for (; guard < MAX_ITERATIONS; guard++, n++) {
      if (!emit(withTime(addDays(startOfDay(anchor), n * interval)))) break;
    }
  } else if (r.freq === 'weekly') {
    const days = (r.byweekday && r.byweekday.length ? [...r.byweekday] : [anchor.getDay()]).sort((a, b) => a - b);
    const week0 = startOfWeek(anchor, { weekStartsOn: 0 });
    let w = 0;
    if (!r.count && from > anchor) w = Math.max(0, Math.floor(differenceInCalendarDays(from, week0) / (7 * interval)) - 1);
    outer: for (; guard < MAX_ITERATIONS; guard++, w++) {
      const base = addDays(week0, w * 7 * interval);
      for (const dow of days) {
        if (!emit(withTime(addDays(base, dow)))) break outer;
      }
    }
  } else if (r.freq === 'monthly' || r.freq === 'yearly') {
    const step = r.freq === 'monthly' ? interval : interval * 12;
    for (let n = 0; guard < MAX_ITERATIONS; guard++, n++) {
      // Month arithmetic from the anchor each time (not cumulative), clamped
      // to the month's last day — so the 31st lands on the 30th/28th, then
      // returns to the 31st the next long month.
      const monthBase = addMonths(setDate(startOfDay(anchor), 1), n * step);
      const day = Math.min(anchor.getDate(), getDaysInMonth(monthBase));
      if (!emit(withTime(setDate(monthBase, day)))) break;
      if (monthBase >= limit) break;
    }
  }
  return out;
}

/**
 * Expand events into occurrences overlapping [rangeStart, rangeEnd).
 * Deleted events are skipped; exdates removed from recurring series.
 */
export function expandEvents(events, rangeStart, rangeEnd) {
  const out = [];
  for (const ev of events) {
    if (ev.is_deleted) continue;
    const s = eventStart(ev);
    const e = eventEnd(ev);
    const duration = Math.max(e - s, 0);
    const ex = ev.exdates && ev.exdates.length ? new Set(ev.exdates) : null;

    // Occurrences that began before rangeStart can still reach into it.
    const lookbackStart = ev.rrule ? new Date(rangeStart.getTime() - duration - 86400000) : rangeStart;
    const starts = ev.rrule ? occurrenceStarts(ev, lookbackStart, rangeEnd) : [s];

    for (const occStart of starts) {
      if (ex && ex.has(dateKey(occStart))) continue;
      let occEnd;
      if (ev.all_day) occEnd = addDays(occStart, differenceInCalendarDays(e, s));
      else occEnd = new Date(occStart.getTime() + duration);
      // Overlap test (zero-length events count at their instant).
      if (occStart >= rangeEnd) continue;
      if (occEnd <= rangeStart && !(occEnd.getTime() === occStart.getTime() && occStart >= rangeStart)) continue;
      out.push({
        ...ev,
        key: `${ev.id}|${dateKey(occStart)}`,
        occStart,
        occEnd,
        isRecurring: !!ev.rrule,
        originalDate: dateKey(occStart),
      });
    }
  }
  return out.sort((a, b) => a.occStart - b.occStart || b.occEnd - b.occStart - (a.occEnd - a.occStart));
}

/** True for events shown in the all-day strip (all-day, or spanning more than a day boundary). */
export function isMultiDay(occ) {
  if (occ.all_day) return true;
  const lastInstant = new Date(occ.occEnd.getTime() - 1);
  return dateKey(occ.occStart) !== dateKey(lastInstant) && occ.occEnd > occ.occStart;
}

// ---- Editing helpers for recurring series ---------------------------------

/** Add an exception so one occurrence disappears from the series. */
export function withExdate(ev, originalDate) {
  return { ...ev, exdates: [...new Set([...(ev.exdates || []), originalDate])] };
}

/** Make the series end the day before `originalDate` ("this and following" split). */
export function endSeriesBefore(ev, originalDate) {
  const dayBefore = dateKey(addDays(parseDay(originalDate), -1));
  const first = ev.all_day ? ev.start : dateKey(new Date(ev.start));
  if (dayBefore < first) return null; // nothing left of the series
  const rrule = { ...ev.rrule, until: dayBefore };
  delete rrule.count; // until and count are mutually exclusive
  return { ...ev, rrule, exdates: (ev.exdates || []).filter((d) => d <= dayBefore) };
}

// ---- Human-readable summary of a rule -------------------------------------

export function describeRule(rule, t, dayNames) {
  if (!rule) return t('recurrence.none');
  const n = rule.interval > 1 ? rule.interval : 1;
  const unit = { daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year' }[rule.freq];
  let text = n === 1 ? t(`recurrence.every_${unit}`) : t('recurrence.every_n', { n, unit: t(`recurrence.unit_${unit}`) });
  if (rule.freq === 'weekly' && rule.byweekday?.length) {
    text += ` ${t('recurrence.on')} ${rule.byweekday.map((d) => dayNames[d]).join(', ')}`;
  }
  if (rule.until) text += `, ${t('recurrence.until')} ${rule.until}`;
  if (rule.count) text += `, ${t('recurrence.times', { n: rule.count })}`;
  return text;
}
