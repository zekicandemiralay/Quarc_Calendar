import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './db';
import { expandEvents } from './recurrence';
import useSettings from '../store/settingsStore';

const EMPTY = [];

export function useCalendars() {
  return useLiveQuery(
    async () => (await db.calendars.where('is_deleted').equals(0).toArray()).sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)),
    [],
    EMPTY
  );
}

export function useAllEvents() {
  return useLiveQuery(() => db.events.where('is_deleted').equals(0).toArray(), [], EMPTY);
}

/** Occurrences overlapping [start, end) from calendars that aren't hidden, with their display colour. */
export function useOccurrences(start, end) {
  const events = useAllEvents();
  const calendars = useCalendars();
  const hidden = useSettings((s) => s.hiddenCalendars);

  const startMs = +start;
  const endMs = +end;
  return useMemo(() => {
    const cal = new Map(calendars.map((c) => [c.id, c]));
    const hide = new Set(hidden);
    const visible = events.filter((e) => cal.has(e.calendar_id) && !hide.has(e.calendar_id));
    return expandEvents(visible, new Date(startMs), new Date(endMs)).map((o) => ({
      ...o,
      displayColor: o.color || cal.get(o.calendar_id)?.color || '#3e63dd',
      calendarName: cal.get(o.calendar_id)?.name || '',
    }));
  }, [events, calendars, hidden, startMs, endMs]);
}

/** Pending-upload count, live. */
export function usePendingCount() {
  return useLiveQuery(() => db.outbox.count(), [], 0);
}
