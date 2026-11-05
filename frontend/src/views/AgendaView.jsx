import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { addDays, isSameDay, startOfDay } from 'date-fns';
import useUi from '../store/uiStore';
import useFmt from '../lib/useFmt';
import { useOccurrences } from '../lib/hooks';
import { isMultiDay } from '../lib/recurrence';
import Icon from '../components/Icons';

const DAYS_AHEAD = 90;

/** Upcoming events, grouped by day, for the next 90 days from the selected date. */
export default function AgendaView() {
  const { t } = useTranslation();
  const fmt = useFmt();
  const date = useUi((s) => s.date);
  const setDate = useUi((s) => s.setDate);
  const setView = useUi((s) => s.setView);
  const openPreview = useUi((s) => s.openPreview);

  const start = startOfDay(date);
  const end = addDays(start, DAYS_AHEAD);
  const occs = useOccurrences(start, end);

  const groups = useMemo(() => {
    const map = new Map();
    for (const o of occs) {
      // list a multi-day event on every day it covers inside the window
      let d = o.occStart < start ? start : startOfDay(o.occStart);
      const last = new Date(Math.max(o.occEnd - 1, +o.occStart));
      for (let guard = 0; d <= last && d < end && guard < DAYS_AHEAD + 1; guard++) {
        const key = +d;
        if (!map.has(key)) map.set(key, { day: d, items: [] });
        map.get(key).items.push(o);
        d = addDays(d, 1);
      }
    }
    return [...map.values()].sort((a, b) => a.day - b.day);
  }, [occs, +start]); // eslint-disable-line react-hooks/exhaustive-deps

  const today = new Date();
  if (!groups.length) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-neutral-400">
        <Icon name="calendar" size={40} strokeWidth={1.3} />
        <p className="text-sm">{t('agenda.nothingUpcoming')}</p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-4 py-4">
        {groups.map(({ day, items }) => (
          <section key={+day} className="flex gap-4 border-b border-neutral-200 py-3 last:border-0 dark:border-neutral-800">
            <button
              onClick={() => {
                setDate(day);
                setView('day');
              }}
              className="w-14 flex-shrink-0 text-center"
            >
              <div className={`text-[11px] font-medium uppercase ${isSameDay(day, today) ? 'text-accent' : 'text-neutral-500'}`}>{fmt.f(day, 'EEE')}</div>
              <div className={`mx-auto flex h-9 w-9 items-center justify-center rounded-full text-lg font-medium ${isSameDay(day, today) ? 'bg-accent text-white' : ''}`}>
                {day.getDate()}
              </div>
              <div className="text-[11px] text-neutral-400">{fmt.f(day, 'MMM')}</div>
            </button>
            <ul className="min-w-0 flex-1 space-y-1">
              {items.map((o) => (
                <li key={o.key + +day}>
                  <button
                    onClick={(e) => openPreview({ occ: o, x: e.clientX, y: e.clientY })}
                    className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800"
                  >
                    <span className="h-3 w-3 flex-shrink-0 rounded-full" style={{ background: o.displayColor }} />
                    <span className="w-28 flex-shrink-0 text-xs text-neutral-500">
                      {o.all_day || isMultiDay(o) ? t('event.allDay') : `${fmt.time(o.occStart)} – ${fmt.time(o.occEnd)}`}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{o.title || t('event.noTitle')}</span>
                      {o.location && <span className="block truncate text-xs text-neutral-500">{o.location}</span>}
                    </span>
                    {o.isRecurring && <Icon name="repeat" size={14} className="text-neutral-400" />}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
