// iCalendar (.ics) import / export: lets users move data in and out of Google,
// Apple and Outlook calendars without any server involved (works offline).

import { addDays, format } from 'date-fns';
import { blankEvent } from './data';
import { parseDay, DATE_FMT } from './recurrence';

const DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

// ---- Export -----------------------------------------------------------------

const esc = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/;/g, '\\;').replace(/,/g, '\\,');
const utc = (iso) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const ymd = (s) => s.replace(/-/g, '');

// RFC 5545: lines are limited to 75 octets; continuation lines start with a space.
function fold(line) {
  const out = [];
  let rest = line;
  while (rest.length > 74) {
    out.push(rest.slice(0, 74));
    rest = ` ${rest.slice(74)}`;
  }
  out.push(rest);
  return out.join('\r\n');
}

function rruleText(r) {
  if (!r) return null;
  const parts = [`FREQ=${r.freq.toUpperCase()}`];
  if (r.interval > 1) parts.push(`INTERVAL=${r.interval}`);
  if (r.freq === 'weekly' && r.byweekday?.length) parts.push(`BYDAY=${r.byweekday.map((d) => DAYS[d]).join(',')}`);
  if (r.until) parts.push(`UNTIL=${ymd(r.until)}`);
  if (r.count) parts.push(`COUNT=${r.count}`);
  return parts.join(';');
}

export function exportIcs(events, calendars) {
  const calName = new Map(calendars.map((c) => [c.id, c.name]));
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Quarc//Quarc Calendar//EN', 'CALSCALE:GREGORIAN'];

  for (const ev of events) {
    if (ev.is_deleted) continue;
    lines.push('BEGIN:VEVENT', `UID:${ev.id}@quarc-calendar`, `DTSTAMP:${utc(new Date().toISOString())}`);
    if (ev.all_day) {
      lines.push(`DTSTART;VALUE=DATE:${ymd(ev.start)}`);
      // ICS all-day end is exclusive
      lines.push(`DTEND;VALUE=DATE:${ymd(format(addDays(parseDay(ev.end || ev.start), 1), DATE_FMT))}`);
    } else {
      lines.push(`DTSTART:${utc(ev.start)}`, `DTEND:${utc(ev.end || ev.start)}`);
    }
    lines.push(`SUMMARY:${esc(ev.title || '(No title)')}`);
    if (ev.description) lines.push(`DESCRIPTION:${esc(ev.description)}`);
    if (ev.location) lines.push(`LOCATION:${esc(ev.location)}`);
    if (calName.has(ev.calendar_id)) lines.push(`CATEGORIES:${esc(calName.get(ev.calendar_id))}`);
    const rr = rruleText(ev.rrule);
    if (rr) lines.push(`RRULE:${rr}`);
    for (const ex of ev.exdates || []) {
      lines.push(ev.all_day ? `EXDATE;VALUE=DATE:${ymd(ex)}` : `EXDATE:${ymd(ex)}T${utc(ev.start).slice(9)}`);
    }
    for (const m of ev.reminders || []) {
      lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(ev.title || 'Reminder')}`, `TRIGGER:-PT${m}M`, 'END:VALARM');
    }
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

// ---- Import -----------------------------------------------------------------

const unesc = (s) => s.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');

function unfold(text) {
  return text.replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
}

/** 'DTSTART;TZID=Europe/Istanbul:20260301T090000' -> { name, params, value } */
function parseLine(line) {
  const idx = line.indexOf(':');
  if (idx < 0) return null;
  const [name, ...paramParts] = line.slice(0, idx).split(';');
  const params = {};
  for (const p of paramParts) {
    const [k, v] = p.split('=');
    params[k.toUpperCase()] = v;
  }
  return { name: name.toUpperCase(), params, value: line.slice(idx + 1) };
}

/** Returns { allDay, iso|dateString } for a DTSTART/DTEND-like value. */
function parseDateValue({ params, value }) {
  const m = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, z] = m;
  if (params.VALUE === 'DATE' || h === undefined) return { allDay: true, date: `${y}-${mo}-${d}` };
  // UTC ('Z') is exact; anything else is treated as the user's local time.
  const date = z
    ? new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +(s || 0)))
    : new Date(+y, +mo - 1, +d, +h, +mi, +(s || 0));
  return { allDay: false, iso: date.toISOString() };
}

function parseRrule(text) {
  const p = Object.fromEntries(text.split(';').map((kv) => kv.split('=')));
  const freq = (p.FREQ || '').toLowerCase();
  if (!['daily', 'weekly', 'monthly', 'yearly'].includes(freq)) return null;
  const rule = { freq, interval: Math.max(1, parseInt(p.INTERVAL, 10) || 1) };
  if (freq === 'weekly' && p.BYDAY) {
    const days = p.BYDAY.split(',').map((d) => DAYS.indexOf(d.slice(-2))).filter((d) => d >= 0);
    if (days.length) rule.byweekday = days;
  }
  if (p.UNTIL) {
    const m = p.UNTIL.match(/^(\d{4})(\d{2})(\d{2})/);
    if (m) rule.until = `${m[1]}-${m[2]}-${m[3]}`;
  }
  if (p.COUNT) rule.count = parseInt(p.COUNT, 10) || undefined;
  return rule;
}

/**
 * Parse .ics text into event objects ready for saveEvent().
 * Unsupported recurrence features (BYMONTHDAY lists, BYSETPOS...) import as the
 * plain frequency, and `skipped` counts events that couldn't be read at all.
 */
export function parseIcs(text, calendarId) {
  const events = [];
  let skipped = 0;
  let cur = null;
  let inAlarm = false;

  for (const raw of unfold(text)) {
    const line = parseLine(raw);
    if (!line) continue;
    if (line.name === 'BEGIN' && line.value === 'VEVENT') {
      cur = { props: [], alarms: [] };
    } else if (line.name === 'END' && line.value === 'VEVENT' && cur) {
      const built = buildEvent(cur, calendarId);
      if (built) events.push(built);
      else skipped += 1;
      cur = null;
    } else if (cur && line.name === 'BEGIN' && line.value === 'VALARM') inAlarm = true;
    else if (cur && line.name === 'END' && line.value === 'VALARM') inAlarm = false;
    else if (cur) {
      if (inAlarm) cur.alarms.push(line);
      else cur.props.push(line);
    }
  }
  return { events, skipped };
}

function buildEvent({ props, alarms }, calendarId) {
  const get = (n) => props.find((p) => p.name === n);
  const dtstart = get('DTSTART');
  const start = dtstart && parseDateValue(dtstart);
  if (!start) return null;

  let end = null;
  const dtend = get('DTEND');
  if (dtend) end = parseDateValue(dtend);

  const fields = {
    calendar_id: calendarId,
    title: unesc(get('SUMMARY')?.value || ''),
    description: unesc(get('DESCRIPTION')?.value || ''),
    location: unesc(get('LOCATION')?.value || ''),
  };

  if (start.allDay) {
    fields.all_day = 1;
    fields.start = start.date;
    // ICS DTEND is exclusive; ours is inclusive.
    const lastDay = end?.date ? addDays(parseDay(end.date), -1) : parseDay(start.date);
    fields.end = format(lastDay < parseDay(start.date) ? parseDay(start.date) : lastDay, DATE_FMT);
  } else {
    fields.start = start.iso;
    fields.end = end?.iso || start.iso;
  }

  const rr = get('RRULE');
  if (rr) fields.rrule = parseRrule(rr.value);
  fields.exdates = props
    .filter((p) => p.name === 'EXDATE')
    .flatMap((p) => p.value.split(',').map((v) => v.match(/^(\d{4})(\d{2})(\d{2})/)))
    .filter(Boolean)
    .map((m) => `${m[1]}-${m[2]}-${m[3]}`);

  fields.reminders = alarms
    .filter((a) => a.name === 'TRIGGER')
    .map((a) => {
      const m = a.value.match(/^-P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?/);
      return m ? (+m[1] || 0) * 1440 + (+m[2] || 0) * 60 + (+m[3] || 0) : null;
    })
    .filter((n) => n !== null);

  return blankEvent(fields);
}
