import { describe, it, expect } from 'vitest';
import 'fake-indexeddb/auto';
import { exportIcs, parseIcs } from '../ics';

describe('ics', () => {
  const cal = [{ id: 'c1', name: 'Home' }];
  const events = [
    { id: 'e1', calendar_id: 'c1', title: 'Team, sync; weekly', description: 'Line1\nLine2', location: 'Room 4', all_day: 0,
      start: '2026-03-02T09:00:00.000Z', end: '2026-03-02T10:30:00.000Z', rrule: { freq: 'weekly', interval: 2, byweekday: [1, 3], count: 6 },
      exdates: [], reminders: [10, 1440] },
    { id: 'e2', calendar_id: 'c1', title: 'Trip', all_day: 1, start: '2026-04-01', end: '2026-04-03', exdates: [], reminders: [] },
  ];

  it('round-trips events through .ics', () => {
    const text = exportIcs(events, cal);
    expect(text).toContain('DTEND;VALUE=DATE:20260404'); // exclusive end
    const { events: back, skipped } = parseIcs(text, 'c9');
    expect(skipped).toBe(0);
    expect(back).toHaveLength(2);
    const [a, b] = back;
    expect(a.title).toBe('Team, sync; weekly');
    expect(a.description).toBe('Line1\nLine2');
    expect(a.start).toBe(events[0].start);
    expect(a.end).toBe(events[0].end);
    expect(a.rrule).toEqual({ freq: 'weekly', interval: 2, byweekday: [1, 3], count: 6 });
    expect(a.reminders).toEqual([10, 1440]);
    expect(a.calendar_id).toBe('c9');
    expect(b.all_day).toBe(1);
    expect([b.start, b.end]).toEqual(['2026-04-01', '2026-04-03']);
  });

  it('folds long lines and unfolds them again', () => {
    const long = { ...events[1], title: 'x'.repeat(300) };
    const text = exportIcs([long], cal);
    expect(text.split('\r\n').every((l) => l.length <= 75)).toBe(true);
    expect(parseIcs(text, 'c').events[0].title).toBe('x'.repeat(300));
  });

  it('imports a Google-style file (UTC, TZID, DATE) and skips junk', () => {
    const ics = [
      'BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'DTSTART:20260310T120000Z', 'DTEND:20260310T130000Z', 'SUMMARY:UTC meeting', 'END:VEVENT',
      'BEGIN:VEVENT', 'DTSTART;TZID=Europe/Istanbul:20260311T090000', 'SUMMARY:Local meeting', 'RRULE:FREQ=DAILY;UNTIL=20260320T000000Z', 'END:VEVENT',
      'BEGIN:VEVENT', 'SUMMARY:No start', 'END:VEVENT', 'END:VCALENDAR',
    ].join('\n');
    const { events: evs, skipped } = parseIcs(ics, 'c');
    expect(skipped).toBe(1);
    expect(evs[0].start).toBe('2026-03-10T12:00:00.000Z');
    expect(evs[1].rrule).toEqual({ freq: 'daily', interval: 1, until: '2026-03-20' });
    expect(new Date(evs[1].start).getHours()).toBe(9); // floating time = local
  });
});
