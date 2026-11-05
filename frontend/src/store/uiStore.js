import { create } from 'zustand';
import { startOfDay } from 'date-fns';
import useSettings from './settingsStore';

// Transient UI state: what's being viewed, which dialogs are open, toasts.
const useUi = create((set, get) => ({
  view: useSettings.getState().defaultView,
  date: startOfDay(new Date()),
  sidebarOpen: false, // mobile drawer
  searchOpen: false,

  // Editor: { event, scope?, occurrence? } or null. A "draft" has no saved copy yet.
  editor: null,
  // Read-only detail card for an occurrence: { occ, anchor: {x,y} } or null
  preview: null,
  calendarEditor: null, // { calendar } | { calendar: null } for new

  // "This event / following / all" question for recurring events: { action, resolve } or null
  scopeAsk: null,

  toasts: [],

  setView: (view) => set({ view }),
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

  /** Ask which part of a recurring series an action applies to. Resolves to a SCOPE value or null (cancelled). */
  askScope: (action) => new Promise((resolve) => set({ scopeAsk: { action, resolve } })),
  answerScope(value) {
    const ask = get().scopeAsk;
    set({ scopeAsk: null });
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
