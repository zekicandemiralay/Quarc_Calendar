import { create } from 'zustand';
import { startOfDay } from 'date-fns';
import useSettings, { initialView } from './settingsStore';

// Transient UI state: what's being viewed, which dialogs are open, toasts.
const useUi = create((set, get) => ({
  view: initialView(useSettings.getState()),
  date: startOfDay(new Date()),
  sidebarOpen: false, // mobile drawer
  searchOpen: false,

  // Editor: { event, scope?, occurrence? } or null. A "draft" has no saved copy yet.
  editor: null,
  // Read-only detail card for an occurrence: { occ, anchor: {x,y} } or null
  preview: null,
  calendarEditor: null, // { calendar } | { calendar: null } for new
  weatherDialog: null, // { date?: Date } — weather locations, optionally focused on one day

  // "This event / following / all" question for recurring events: { action, resolve } or null
  scopeAsk: null,
  // "Delete …?" question before something that can't be undone: { title, message, confirmLabel, resolve } or null
  confirmAsk: null,

  toasts: [],

  setView(view) {
    set({ view });
    // Remembered so the app reopens in the same view next time.
    if (useSettings.getState().lastView !== view) useSettings.getState().update({ lastView: view });
  },
  setDate: (date) => set({ date: startOfDay(date) }),
  goToday: () => set({ date: startOfDay(new Date()) }),
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
  setSearchOpen: (searchOpen) => set({ searchOpen }),

  openEditor: (editor) => set({ editor, preview: null }),
  closeEditor: () => set({ editor: null }),
  openPreview: (preview) => set({ preview }),
  closePreview: () => set({ preview: null }),
  openCalendarEditor: (calendarEditor) => set({ calendarEditor }),
  closeCalendarEditor: () => set({ calendarEditor: null }),
  openWeatherDialog: (weatherDialog = {}) => set({ weatherDialog, preview: null }),
  closeWeatherDialog: () => set({ weatherDialog: null }),

  /** Ask which part of a recurring series an action applies to. Resolves to a SCOPE value or null (cancelled). */
  askScope: (action) => new Promise((resolve) => set({ scopeAsk: { action, resolve } })),
  answerScope(value) {
    const ask = get().scopeAsk;
    set({ scopeAsk: null });
    ask?.resolve(value);
  },

  /** Ask before deleting. Resolves true only when the person presses the delete button. */
  askConfirm: (message, opts = {}) =>
    new Promise((resolve) => {
      get().confirmAsk?.resolve(false); // a new question replaces an unanswered one
      set({ confirmAsk: { message, ...opts, resolve } });
    }),
  answerConfirm(value) {
    const ask = get().confirmAsk;
    set({ confirmAsk: null });
    ask?.resolve(value);
  },

  toast(message, opts = {}) {
    const id = Math.random().toString(36).slice(2);
    set({ toasts: [...get().toasts, { id, message, ...opts }] });
    setTimeout(() => get().dismissToast(id), opts.duration || 5000);
    return id;
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));

export default useUi;
