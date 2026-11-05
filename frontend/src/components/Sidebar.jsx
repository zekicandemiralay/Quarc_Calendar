import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { addMonths, eachDayOfInterval, endOfMonth, endOfWeek, isSameDay, isSameMonth, startOfMonth, startOfWeek } from 'date-fns';
import Icon from './Icons';
import useUi from '../store/uiStore';
import useSettings from '../store/settingsStore';
import useFmt from '../lib/useFmt';
import { useCalendars } from '../lib/hooks';
import { openNewEvent } from '../lib/compose';
import { useState } from 'react';

function MiniMonth() {
  const fmt = useFmt();
  const date = useUi((s) => s.date);
  const setDate = useUi((s) => s.setDate);
  const [cursor, setCursor] = useState(date);

  // Follow the main view when it moves to another month.
  const [lastDate, setLastDate] = useState(date);
  if (+date !== +lastDate) {
    setLastDate(date);
    if (!isSameMonth(date, cursor)) setCursor(date);
  }

  const days = eachDayOfInterval({
    start: startOfWeek(startOfMonth(cursor), { weekStartsOn: fmt.weekStartsOn }),
    end: endOfWeek(endOfMonth(cursor), { weekStartsOn: fmt.weekStartsOn }),
  });
  const today = new Date();

  return (
    <div className="select-none">
      <div className="mb-1 flex items-center justify-between px-1">
        <span className="text-sm font-semibold">{fmt.f(cursor, 'MMMM yyyy')}</span>
        <div className="flex">
          <button onClick={() => setCursor(addMonths(cursor, -1))} className="rounded-full p-1 hover:bg-neutral-200 dark:hover:bg-neutral-800" aria-label="Previous month">
            <Icon name="chevronLeft" size={16} />
          </button>
          <button onClick={() => setCursor(addMonths(cursor, 1))} className="rounded-full p-1 hover:bg-neutral-200 dark:hover:bg-neutral-800" aria-label="Next month">
            <Icon name="chevronRight" size={16} />
          </button>
        </div>
      </div>
      <div className="grid grid-cols-7 text-center text-[10px] font-medium text-neutral-400">
        {days.slice(0, 7).map((d) => (
          <div key={+d} className="py-1">{fmt.f(d, 'EEEEE')}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 text-center text-xs">
        {days.map((d) => {
          const inMonth = isSameMonth(d, cursor);
          const isToday = isSameDay(d, today);
          const selected = isSameDay(d, date);
          return (
            <button
              key={+d}
              onClick={() => setDate(d)}
              className={`mx-auto flex h-7 w-7 items-center justify-center rounded-full ${
                isToday
                  ? 'bg-accent font-semibold text-white'
                  : selected
                  ? 'bg-accent/15 font-semibold text-accent'
                  : inMonth
                  ? 'hover:bg-neutral-200 dark:hover:bg-neutral-800'
                  : 'text-neutral-400 hover:bg-neutral-200 dark:hover:bg-neutral-800'
              }`}
            >
              {d.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function Sidebar({ drawer = false }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const calendars = useCalendars();
  const hidden = useSettings((s) => s.hiddenCalendars);
  const toggleCalendar = useSettings((s) => s.toggleCalendar);
  const date = useUi((s) => s.date);
  const openCalendarEditor = useUi((s) => s.openCalendarEditor);
  const setSidebarOpen = useUi((s) => s.setSidebarOpen);

  const content = (
    <div className="flex h-full w-72 flex-col gap-5 overflow-y-auto border-r border-neutral-200 bg-neutral-50 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] dark:border-neutral-800 dark:bg-neutral-950">
      <div className="flex items-center gap-2.5">
        <img src="/logo.png" alt="" className="h-8 w-8 rounded-lg" />
        <span className="text-lg font-semibold tracking-tight">Quarc Calendar</span>
      </div>

      <button
        onClick={() => {
          setSidebarOpen(false);
          const start = new Date(date);
          const now = new Date();
          start.setHours(now.getHours() + 1, 0, 0, 0);
          openNewEvent(start);
        }}
        className="flex items-center justify-center gap-2 rounded-2xl bg-accent px-4 py-3 text-sm font-semibold text-white shadow-md shadow-accent/20 transition hover:bg-accent-dark"
      >
        <Icon name="plus" size={18} strokeWidth={2.4} /> {t('event.new')}
      </button>

      <MiniMonth />

      <div>
        <div className="mb-1 flex items-center justify-between px-1">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{t('calendars.title')}</h3>
          <button onClick={() => openCalendarEditor({ calendar: null })} className="rounded-full p-1 text-neutral-500 hover:bg-neutral-200 dark:hover:bg-neutral-800" aria-label={t('calendars.new')} title={t('calendars.new')}>
            <Icon name="plus" size={16} />
          </button>
        </div>
        <ul>
          {calendars.map((c) => {
            const on = !hidden.includes(c.id);
            return (
              <li key={c.id} className="group flex items-center gap-1 rounded-lg hover:bg-neutral-200/70 dark:hover:bg-neutral-800/70">
                <button onClick={() => toggleCalendar(c.id)} className="flex min-w-0 flex-1 items-center gap-3 px-2 py-1.5 text-left text-sm">
                  <span
                    className="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border-2 text-white"
                    style={{ borderColor: c.color, background: on ? c.color : 'transparent' }}
                  >
                    {on && <Icon name="check" size={11} strokeWidth={3.5} />}
                  </span>
                  <span className={`truncate ${on ? '' : 'text-neutral-400'}`}>{c.name}</span>
                </button>
                <button
                  onClick={() => openCalendarEditor({ calendar: c })}
                  className="rounded-full p-1.5 text-neutral-400 opacity-0 hover:bg-neutral-300 group-hover:opacity-100 focus:opacity-100 dark:hover:bg-neutral-700 max-sm:opacity-100"
                  aria-label={t('calendars.edit')}
                >
                  <Icon name="more" size={16} />
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="mt-auto">
        <button
          onClick={() => {
            setSidebarOpen(false);
            navigate('/settings');
          }}
          className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-sm hover:bg-neutral-200 dark:hover:bg-neutral-800"
        >
          <Icon name="settings" /> {t('settings.title')}
        </button>
      </div>
    </div>
  );

  if (!drawer) return <aside className="hidden flex-shrink-0 lg:block">{content}</aside>;

  return (
    <div className="fixed inset-0 z-40 lg:hidden">
      <div className="absolute inset-0 animate-fade bg-black/50" onClick={() => setSidebarOpen(false)} />
      <div className="absolute inset-y-0 left-0 animate-slide shadow-2xl">{content}</div>
    </div>
  );
}
