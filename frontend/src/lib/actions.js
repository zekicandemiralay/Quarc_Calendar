// High-level event actions that understand recurring series ("this event",
// "this and following", "all events"). The UI calls these; they translate into
// plain saveEvent / deleteEvent calls on the local database.

import { addDays, differenceInCalendarDays, format, startOfDay } from 'date-fns';
import { db } from './db';
import { blankEvent, saveEvent, saveEvents, deleteEvent } from './data';
import { DATE_FMT, endSeriesBefore, eventStart, expandEvents, parseDay, withExdate } from './recurrence';

export const SCOPE = { THIS: 'this', FOLLOWING: 'following', ALL: 'all' };

const atTime = (day, hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  const d = startOfDay(day);
  d.setHours(h, m, 0, 0);
  return d;
};

/**
 * Turn the editor form values into stored start/end fields.
 * form: { all_day, startDate: Date, startTime: 'HH:mm', endDate: Date, endTime }
 */
export function formToTimes(form) {
  if (form.all_day) {
    const s = startOfDay(form.startDate);
    const e = startOfDay(form.endDate < form.startDate ? form.startDate : form.endDate);
    return { start: format(s, DATE_FMT), end: format(e, DATE_FMT) };
  }
  const s = atTime(form.startDate, form.startTime);
  let e = atTime(form.endDate, form.endTime);
  if (e < s) e = s; // never end before start
  return { start: s.toISOString(), end: e.toISOString() };
}

/**
 * Save an edit made in the editor.
 *  base      the stored event (series master) being edited
 *  fields    new non-time fields (title, description, location, calendar_id, color, rrule, reminders)
 *  form      time fields from the editor (see formToTimes)
 *  scope     SCOPE.* (ignored for non-recurring events)
 *  originalDate  'YYYY-MM-DD' of the occurrence that was opened
 */
export async function saveEdited({ base, fields, form, scope, originalDate }) {
  const times = formToTimes(form);
  const isSeries = !!base.rrule;
  const merged = { ...base, ...fields };
  // Content a split-off copy inherits from the series, overridden by the edit.
  const content = {
    calendar_id: base.calendar_id, title: base.title, description: base.description,
    location: base.location, color: base.color, reminders: base.reminders, ...fields,
  };

  if (!isSeries || scope === SCOPE.ALL) {
    // Move the whole series by however far the opened occurrence was moved,
    // keeping the master's own start date otherwise.
    let start = times.start;
    let end = times.end;
    if (isSeries) {
      const dayDelta = differenceInCalendarDays(startOfDay(form.startDate), parseDay(originalDate));
      const anchorDay = addDays(startOfDay(eventStart(base)), dayDelta);
      const span = differenceInCalendarDays(startOfDay(form.endDate), startOfDay(form.startDate));
      if (form.all_day) {
        start = format(anchorDay, DATE_FMT);
        end = format(addDays(anchorDay, Math.max(span, 0)), DATE_FMT);
      } else {
        const s = atTime(anchorDay, form.startTime);
        const durationMs = new Date(times.end) - new Date(times.start);
        start = s.toISOString();
        end = new Date(s.getTime() + durationMs).toISOString();
      }
    }
    return saveEvent({ ...merged, all_day: form.all_day ? 1 : 0, start, end });
  }

  if (scope === SCOPE.THIS) {
    const detached = blankEvent({
      ...content, all_day: form.all_day ? 1 : 0, start: times.start, end: times.end,
      rrule: null, exdates: [], created_at: new Date().toISOString(),
    });
    return saveEvents([withExdate(base, originalDate), detached]);
  }

  // FOLLOWING
  const first = base.all_day ? base.start : format(new Date(base.start), DATE_FMT);
  if (originalDate <= first) {
    return saveEdited({ base, fields, form, scope: SCOPE.ALL, originalDate });
  }
  const truncated = endSeriesBefore(base, originalDate);
  const wanted = fields.rrule !== undefined ? fields.rrule : base.rrule;
  let rrule = wanted ? { ...wanted } : null;
  if (rrule?.count && base.rrule?.count) {
    // The new series gets only the occurrences that were still to come.
    const before = expandEvents([{ ...base, exdates: [] }], new Date(0), parseDay(originalDate)).length;
    rrule.count = Math.max(1, base.rrule.count - before);
  }
  const tail = blankEvent({
    ...content, rrule, all_day: form.all_day ? 1 : 0, start: times.start, end: times.end,
    exdates: [], created_at: new Date().toISOString(),
  });
  return saveEvents(truncated ? [truncated, tail] : [tail]);
}

/** Delete an occurrence / the following ones / the whole series. */
export async function deleteWithScope({ base, scope, originalDate }) {
  if (!base.rrule || scope === SCOPE.ALL) return deleteEvent(base.id);
  if (scope === SCOPE.THIS) return saveEvent(withExdate(base, originalDate));
  const truncated = endSeriesBefore(base, originalDate);
  return truncated ? saveEvent(truncated) : deleteEvent(base.id);
}

/** Duplicate an event as a standalone copy. */
export async function duplicateEvent(base, occ) {
  const copy = blankEvent({
    ...base, id: undefined, title: base.title, rrule: null, exdates: [],
    start: occ ? (base.all_day ? format(occ.occStart, DATE_FMT) : occ.occStart.toISOString()) : base.start,
    end: occ
      ? (base.all_day ? format(addDays(occ.occEnd, -1), DATE_FMT) : occ.occEnd.toISOString())
      : base.end,
  });
  copy.id = crypto.randomUUID();
  return saveEvent(copy);
}

/** Move/resize via drag: new local start/end Dates for an occurrence. */
export async function moveOccurrence({ occ, newStart, newEnd, scope }) {
  const base = await db.events.get(occ.id);
  if (!base) return;
  const form = {
    all_day: !!base.all_day,
    startDate: startOfDay(newStart),
    endDate: startOfDay(base.all_day ? addDays(newEnd, -1) : newEnd),
    startTime: format(newStart, 'HH:mm'),
    endTime: format(newEnd, 'HH:mm'),
  };
  // A timed event dragged past midnight keeps its exact end instant.
  if (!base.all_day) form.endDate = startOfDay(newEnd);
  return saveEdited({
    base,
    fields: {},
    form,
    scope: base.rrule ? scope : SCOPE.ALL,
    originalDate: occ.originalDate,
  });
}
