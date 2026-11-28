import { useTranslation } from 'react-i18next';
import { addDays, startOfDay } from 'date-fns';
import useUi from '../store/uiStore';
import useFmt from '../lib/useFmt';
import { useOccurrences } from '../lib/hooks';
import { isMultiDay } from '../lib/recurrence';
import { openNewEvent } from '../lib/compose';
import { useMemo } from 'react';
import { useDaysWeather } from '../lib/weather/store';
import { DayWeather } from './Weather';

/** Compact list of one day's events (used under the phone month grid). */
export default function DayList({ day }) {
  const { t } = useTranslation();
  const fmt = useFmt();
  const openPreview = useUi((s) => s.openPreview);
  const start = startOfDay(day);
  const occs = useOccurrences(start, addDays(start, 1));
  const days = useMemo(() => [start], [+start]); // eslint-disable-line react-hooks/exhaustive-deps
  const [w] = useDaysWeather(days);

  return (
    <div className="p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex min-w-0 items-center gap-2">
          <h3 className="truncate text-sm font-semibold">{fmt.f(day, 'EEE d MMM')}</h3>
          {w?.day && (
            <span className="flex min-w-0 items-center gap-1 text-xs text-neutral-500">
              <DayWeather w={w} date={start} size={18} className="px-1 py-0.5 text-xs" />
              <span className="truncate">{w.loc?.name}</span>
            </span>
          )}
        </div>
        <button
          onClick={() => openNewEvent(new Date(start.getTime() + 9 * 3600000))}
          className="flex-shrink-0 whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium text-accent hover:bg-accent/10"
        >
          + {t('event.new')}
        </button>
      </div>
      {occs.length === 0 && <p className="py-4 text-center text-sm text-neutral-400">{t('agenda.nothing')}</p>}
      <ul className="space-y-1.5">
        {occs.map((o) => (
          <li key={o.key}>
            <button
              onClick={(e) => openPreview({ occ: o, x: e.clientX, y: e.clientY })}
              className="flex w-full items-stretch gap-3 rounded-lg px-2 py-1.5 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800"
            >
              <span className="w-1 flex-shrink-0 rounded-full" style={{ background: o.displayColor }} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{o.title || t('event.noTitle')}</span>
                <span className="block truncate text-xs text-neutral-500">
                  {o.all_day || isMultiDay(o) ? t('event.allDay') : `${fmt.time(o.occStart)} – ${fmt.time(o.occEnd)}`}
                  {o.location ? ` · ${o.location}` : ''}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
