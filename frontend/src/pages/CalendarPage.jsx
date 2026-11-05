import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { addDays, addMonths, addYears, endOfWeek, startOfWeek } from 'date-fns';
import Icon from '../components/Icons';
import Sidebar from '../components/Sidebar';
import SyncBadge from '../components/SyncBadge';
import SearchDialog from '../components/SearchDialog';
import EventEditor from '../components/EventEditor';
import { CalendarEditor, EventPreview, ScopeDialog } from '../components/Dialogs';
import MonthView from '../views/MonthView';
import TimeGridView from '../views/TimeGridView';
import YearView from '../views/YearView';
import AgendaView from '../views/AgendaView';
import useUi from '../store/uiStore';
import useFmt from '../lib/useFmt';
import { isCompactNow, openNewEvent, useIsCompact } from '../lib/compose';
import { getPlatform, getCurrentVersion, fetchLatestRelease, getDownloadUrl, installUpdate, semverGt } from '../lib/updateCheck';

const VIEWS = ['day', 'week', 'month', 'year', 'agenda'];

function step(view, date, dir) {
  switch (view) {
    case 'day': return addDays(date, dir);
    case 'week': return addDays(date, (isCompactNow() ? 3 : 7) * dir);
    case 'month': return addMonths(date, dir);
    case 'year': return addYears(date, dir);
    default: return addDays(date, 14 * dir);
  }
}

// `compact` only forces a re-render when the breakpoint flips; the title itself reads it directly.
// eslint-disable-next-line no-unused-vars
function useTitle(view, date, fmt, compact) {
  switch (view) {
    case 'day': return fmt.f(date, 'EEEE, d MMMM yyyy');
    case 'week': {
      const compact = isCompactNow();
      const s = compact ? date : startOfWeek(date, { weekStartsOn: fmt.weekStartsOn });
      const e = compact ? addDays(date, 2) : endOfWeek(date, { weekStartsOn: fmt.weekStartsOn });
      if (s.getMonth() === e.getMonth()) return `${fmt.f(s, 'd')} – ${fmt.f(e, 'd MMMM yyyy')}`;
      if (s.getFullYear() === e.getFullYear()) return `${fmt.f(s, 'd MMM')} – ${fmt.f(e, 'd MMM yyyy')}`;
      return `${fmt.f(s, 'd MMM yyyy')} – ${fmt.f(e, 'd MMM yyyy')}`;
    }
    case 'year': return fmt.f(date, 'yyyy');
    default: return fmt.f(date, 'MMMM yyyy');
  }
}

// Native apps (Android / desktop) check GitHub releases and offer the update.
function useUpdateBanner() {
  const [update, setUpdate] = useState(null);
  useEffect(() => {
    const platform = getPlatform();
    if (platform === 'web') return undefined;
    const timer = setTimeout(async () => {
      try {
        const current = await getCurrentVersion(platform);
        const release = await fetchLatestRelease();
        const latest = release.tag_name?.replace(/^v/, '');
        const url = getDownloadUrl(release, platform);
        if (latest && current && semverGt(latest, current) && url) setUpdate({ version: latest, url, platform });
      } catch {
        /* offline or GitHub unreachable: skip silently */
      }
    }, 6000);
    return () => clearTimeout(timer);
  }, []);
  return [update, () => setUpdate(null)];
}

export default function CalendarPage() {
  const { t } = useTranslation();
  const fmt = useFmt();
  const view = useUi((s) => s.view);
  const setView = useUi((s) => s.setView);
  const date = useUi((s) => s.date);
  const setDate = useUi((s) => s.setDate);
  const goToday = useUi((s) => s.goToday);
  const sidebarOpen = useUi((s) => s.sidebarOpen);
  const setSidebarOpen = useUi((s) => s.setSidebarOpen);
  const setSearchOpen = useUi((s) => s.setSearchOpen);
  const [update, dismissUpdate] = useUpdateBanner();
  const compact = useIsCompact();
  const swipe = useRef(null);
  const title = useTitle(view, date, fmt, compact);

  // Keyboard shortcuts (ignored while typing in a field or when a dialog is open).
  useEffect(() => {
    const onKey = (e) => {
      const tag = e.target.tagName;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag) || e.target.isContentEditable) return;
      if (e.metaKey || e.ctrlKey || e.altKey) {
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
          e.preventDefault();
          setSearchOpen(true);
        }
        return;
      }
      const ui = useUi.getState();
      if (ui.editor || ui.preview || ui.calendarEditor || ui.scopeAsk || ui.searchOpen) return;
      const k = e.key.toLowerCase();
      const map = { d: 'day', w: 'week', m: 'month', y: 'year', a: 'agenda' };
      if (map[k]) setView(map[k]);
      else if (k === 't') goToday();
      else if (k === 'j' || k === 'arrowright') setDate(step(ui.view, ui.date, 1));
      else if (k === 'k' || k === 'arrowleft') setDate(step(ui.view, ui.date, -1));
      else if (k === 'c') {
        e.preventDefault();
        const start = new Date(ui.date);
        start.setHours(new Date().getHours() + 1, 0, 0, 0);
        openNewEvent(start);
      } else if (k === '/') {
        e.preventDefault();
        setSearchOpen(true);
      } else return;
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setView, setDate, goToday, setSearchOpen]);

  return (
    <div className="flex h-full flex-col">
      {update && (
        <div className="flex items-center justify-center gap-2 bg-emerald-700 px-4 py-1.5 text-xs font-medium text-white">
          {t('updates.updateAvailable')} — v{update.version}
          <button
            onClick={() => {
              installUpdate(update.platform, update.url, update.version);
              dismissUpdate();
            }}
            className="ml-2 underline underline-offset-2 hover:text-emerald-200"
          >
            {t('updates.installNow')}
          </button>
          <button onClick={dismissUpdate} className="ml-2 hover:text-emerald-200" aria-label="Dismiss">✕</button>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <Sidebar />
        {sidebarOpen && <Sidebar drawer />}

        <div className="flex min-w-0 flex-1 flex-col">
          {/* Top bar */}
          <header className="flex flex-shrink-0 items-center gap-1 border-b border-neutral-200 px-2 py-2 pt-[max(0.5rem,env(safe-area-inset-top))] dark:border-neutral-800 sm:gap-2 sm:px-4">
            <button onClick={() => setSidebarOpen(true)} className="rounded-full p-2 hover:bg-neutral-100 dark:hover:bg-neutral-800 lg:hidden" aria-label={t('nav.menu')}>
              <Icon name="menu" size={20} />
            </button>
            <button onClick={goToday} className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-medium hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800">
              {t('nav.today')}
            </button>
            <div className="hidden sm:flex">
              <button onClick={() => setDate(step(view, date, -1))} className="rounded-full p-2 hover:bg-neutral-100 dark:hover:bg-neutral-800" aria-label={t('nav.previous')}>
                <Icon name="chevronLeft" size={20} />
              </button>
              <button onClick={() => setDate(step(view, date, 1))} className="rounded-full p-2 hover:bg-neutral-100 dark:hover:bg-neutral-800" aria-label={t('nav.next')}>
                <Icon name="chevronRight" size={20} />
              </button>
            </div>
            <h1 className="min-w-0 flex-1 truncate text-base font-semibold sm:text-xl">{title}</h1>

            <SyncBadge />
            <button onClick={() => setSearchOpen(true)} className="rounded-full p-2 hover:bg-neutral-100 dark:hover:bg-neutral-800" aria-label={t('search.title')} title={`${t('search.title')} (/)`}>
              <Icon name="search" size={20} />
            </button>

            <div className="hidden rounded-lg border border-neutral-300 p-0.5 dark:border-neutral-700 md:flex">
              {VIEWS.map((v) => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  className={`rounded-md px-3 py-1 text-sm font-medium ${view === v ? 'bg-accent text-white' : 'text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800'}`}
                >
                  {t(`views.${v}`)}
                </button>
              ))}
            </div>
            <select
              value={view}
              onChange={(e) => setView(e.target.value)}
              className="rounded-lg border border-neutral-300 bg-transparent px-2 py-1.5 text-sm dark:border-neutral-700 md:hidden"
              aria-label={t('views.label')}
            >
              {VIEWS.map((v) => (
                <option key={v} value={v} className="text-neutral-900">{t(`views.${v}`)}</option>
              ))}
            </select>
          </header>

          <main
            className="min-h-0 flex-1 overflow-hidden"
            onTouchStart={(e) => { swipe.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }; }}
            onTouchEnd={(e) => {
              const s0 = swipe.current;
              swipe.current = null;
              if (!s0) return;
              const dx = e.changedTouches[0].clientX - s0.x;
              const dy = e.changedTouches[0].clientY - s0.y;
              // A deliberate horizontal swipe moves to the next / previous period.
              if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 2) setDate(step(view, date, dx < 0 ? 1 : -1));
            }}
          >
            {view === 'month' && <MonthView />}
            {view === 'week' && <TimeGridView mode="week" />}
            {view === 'day' && <TimeGridView mode="day" />}
            {view === 'year' && <YearView />}
            {view === 'agenda' && <AgendaView />}
          </main>

          {/* Mobile quick-add */}
          <button
            onClick={() => {
              const start = new Date(date);
              start.setHours(new Date().getHours() + 1, 0, 0, 0);
              openNewEvent(start);
            }}
            className="fixed bottom-[max(1.25rem,env(safe-area-inset-bottom))] right-5 z-30 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent text-white shadow-lg shadow-accent/30 active:scale-95 sm:hidden"
            aria-label={t('event.new')}
          >
            <Icon name="plus" size={26} strokeWidth={2.4} />
          </button>
        </div>
      </div>

      <EventEditor />
      <EventPreview />
      <CalendarEditor />
      <ScopeDialog />
      <SearchDialog />
    </div>
  );
}
