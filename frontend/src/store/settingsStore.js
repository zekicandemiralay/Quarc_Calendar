import { create } from 'zustand';

// Per-device preferences (not synced): stored in localStorage.
const KEY = 'quarc_calendar_settings';

const DEFAULTS = {
  theme: 'dark', // 'light' | 'dark' | 'system'
  weekStartsOn: 1, // 0 Sunday, 1 Monday, 6 Saturday
  timeFormat: 'auto', // 'auto' | '12' | '24'
  defaultView: 'week', // 'day' | 'week' | 'month' | 'year' | 'agenda'
  defaultDuration: 60, // minutes
  defaultReminder: 10, // minutes before, or null for none
  showWeekNumbers: false,
  notifications: true,
  hiddenCalendars: [], // ids the user has toggled off on this device
};

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
