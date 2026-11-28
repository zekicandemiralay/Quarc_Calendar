import { create } from 'zustand';

// Per-device preferences (not synced): stored in localStorage.
const KEY = 'quarc_calendar_settings';

const DEFAULTS = {
  theme: 'dark', // 'light' | 'dark' | 'system'
  weekStartsOn: 1, // 0 Sunday, 1 Monday, 6 Saturday
  timeFormat: 'auto', // 'auto' | '12' | '24'
  startView: 'last', // 'last' (whatever was open last time) | 'day' | 'week' | 'month' | 'year' | 'agenda'
  lastView: 'week',
  defaultDuration: 60, // minutes
  defaultReminder: 10, // minutes before, or null for none
  showWeekNumbers: false,
  notifications: true,
  hiddenCalendars: [], // ids the user has toggled off on this device

  // Weather
  weatherEnabled: true,
  tempUnit: 'C', // 'C' | 'F'
  // The default weather location on this device: null = follow the device's
  // current location, or a fixed place { name, detail, latitude, longitude }.
  // Synced per-day places (trips) override it for their dates.
  weatherHome: null,
  // Last good location fix { latitude, longitude, name, detail, at }, so the
  // weather shows straight away (and offline) before a new fix arrives.
  lastPosition: null,
};

export const VIEWS = ['day', 'week', 'month', 'year', 'agenda'];

/** The view to open the app in. */
export function initialView(s) {
  const v = s.startView === 'last' ? s.lastView : s.startView;
  return VIEWS.includes(v) ? v : 'week';
}

function load() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}

export function applyTheme(theme) {
  const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', dark ? '#121212' : '#ffffff');
}

const useSettings = create((set, get) => ({
  ...load(),
  update(patch) {
    const next = { ...get(), ...patch };
    const { update, toggleCalendar, ...persist } = next; // eslint-disable-line no-unused-vars
    try {
      localStorage.setItem(KEY, JSON.stringify(persist));
    } catch {
      /* storage unavailable: setting still applies for this session */
    }
    set(patch);
    if (patch.theme) applyTheme(patch.theme);
  },
  toggleCalendar(id) {
    const hidden = new Set(get().hiddenCalendars);
    if (hidden.has(id)) hidden.delete(id);
    else hidden.add(id);
    get().update({ hiddenCalendars: [...hidden] });
  },
}));

export default useSettings;
