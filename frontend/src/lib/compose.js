import { addMinutes, format } from 'date-fns';
import { useEffect, useState } from 'react';
import { db } from './db';
import { blankEvent } from './data';
import { DATE_FMT } from './recurrence';
import useSettings from '../store/settingsStore';
import useUi from '../store/uiStore';

/** Readable text colour (dark or white) for a given background hex. */
export function textOn(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return '#fff';
  const n = parseInt(m[1], 16);
  const lum = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum > 0.66 ? '#1a1a1a' : '#ffffff';
}

/** Calendar new events go to: the first visible one, preferring the default. */
async function defaultCalendarId() {
  const cals = (await db.calendars.where('is_deleted').equals(0).toArray()).sort((a, b) => a.sort_order - b.sort_order);
  const hidden = new Set(useSettings.getState().hiddenCalendars);
  const visible = cals.filter((c) => !hidden.has(c.id));
  return (visible.find((c) => c.is_default) || visible[0] || cals.find((c) => c.is_default) || cals[0])?.id || '';
}

/**
 * Open the editor on a fresh event.
 *  start     Date the event starts (local)
 *  opts.allDay, opts.end (Date), opts.durationMin
 */
export async function openNewEvent(start, { allDay = false, end = null, durationMin } = {}) {
  const s = useSettings.getState();
  const calendar_id = await defaultCalendarId();
  const reminders = s.defaultReminder == null || allDay ? [] : [s.defaultReminder];
  let event;
  if (allDay) {
    const lastDay = end || start;
    event = blankEvent({ calendar_id, all_day: 1, start: format(start, DATE_FMT), end: format(lastDay, DATE_FMT), reminders });
  } else {
    const endAt = end || addMinutes(start, durationMin || s.defaultDuration);
    event = blankEvent({ calendar_id, start: start.toISOString(), end: endAt.toISOString(), reminders });
  }
  useUi.getState().openEditor({ base: event, occ: null, isNew: true });
}

/** Same breakpoint, read once (for non-React code such as keyboard handlers). */
export const isCompactNow = () => matchMedia('(max-width: 639px)').matches;

/** True below Tailwind's `sm` breakpoint: used to swap in the compact phone layouts. */
export function useIsCompact() {
  const query = '(max-width: 639px)';
  const [compact, setCompact] = useState(() => matchMedia(query).matches);
  useEffect(() => {
    const mq = matchMedia(query);
    const on = () => setCompact(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return compact;
}
