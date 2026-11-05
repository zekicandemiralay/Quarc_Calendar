import { addDays } from 'date-fns';
import { db } from './db';
import { expandEvents } from './recurrence';
import useSettings from '../store/settingsStore';
import useUi from '../store/uiStore';

// Reminders run entirely on the device, so they fire offline too. While the
// app is open we check every 20 s for reminders that have just come due and
// show an in-app toast (plus a system notification if the user allowed it).

const FIRED_KEY = 'quarc_calendar_fired';
const TICK_MS = 20000;
const GRACE_MS = 5 * 60 * 1000; // don't announce things that came due while the app was closed for long
const MAX_LOOKAHEAD_DAYS = 8; // longest reminder offered is 1 week

function loadFired() {
  try {
    return JSON.parse(localStorage.getItem(FIRED_KEY) || '{}');
  } catch {
    return {};
  }
}

function saveFired(fired, now) {
  // forget entries older than two days
  const cutoff = now - 2 * 86400000;
  for (const k of Object.keys(fired)) if (fired[k] < cutoff) delete fired[k];
  try {
    localStorage.setItem(FIRED_KEY, JSON.stringify(fired));
  } catch {
    /* ignore */
  }
}

export async function checkReminders(t, now = Date.now()) {
  const events = (await db.events.toArray()).filter((e) => !e.is_deleted && e.reminders?.length);
  if (!events.length) return [];

  const hidden = new Set(useSettings.getState().hiddenCalendars);
  const occs = expandEvents(
    events.filter((e) => !hidden.has(e.calendar_id)),
    new Date(now - 86400000),
    addDays(new Date(now), MAX_LOOKAHEAD_DAYS)
  );

  const fired = loadFired();
  const due = [];
  for (const occ of occs) {
    for (const minutes of occ.reminders) {
      const at = occ.occStart.getTime() - minutes * 60000;
      const id = `${occ.key}|${minutes}`;
      if (at <= now && at > now - GRACE_MS && occ.occEnd.getTime() > now - GRACE_MS && !fired[id]) {
        fired[id] = now;
        due.push({ occ, minutes });
      }
    }
  }
  if (due.length) saveFired(fired, now);

  for (const { occ, minutes } of due) {
    const when = minutes === 0 ? t('reminders.now') : t('reminders.in', { text: describeMinutes(minutes, t) });
    const title = occ.title || t('event.noTitle');
    useUi.getState().toast(`${title}: ${when}`, { kind: 'reminder', duration: 12000 });
    if (useSettings.getState().notifications && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      try {
        new Notification(title, { body: when, tag: occ.key, icon: '/logo.png' });
      } catch {
        /* some WebViews throw; the toast already covers it */
      }
    }
  }
  return due;
}

/** 90 -> '1 h 30 min', 1440 -> '1 day' */
export function describeMinutes(m, t) {
  if (m % 10080 === 0) return t('reminders.weeks', { count: m / 10080 });
  if (m % 1440 === 0) return t('reminders.days', { count: m / 1440 });
  if (m % 60 === 0) return t('reminders.hours', { count: m / 60 });
  return t('reminders.minutes', { count: m });
}

export function startReminders(t) {
  const tick = () => checkReminders(t).catch(() => {});
  const first = setTimeout(tick, 1500);
  const timer = setInterval(tick, TICK_MS);
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}
