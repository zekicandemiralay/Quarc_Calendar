import { useMemo } from 'react';
import { addDays, eachDayOfInterval, endOfMonth, endOfWeek, isSameDay, isSameMonth, startOfMonth, startOfWeek, startOfYear } from 'date-fns';
import useUi from '../store/uiStore';
import useFmt from '../lib/useFmt';
import { useOccurrences } from '../lib/hooks';
import { dateKey } from '../lib/recurrence';

/** Twelve small months; days with events get a dot. Click a day to open it. */
export default function YearView() {
  const fmt = useFmt();
  const date = useUi((s) => s.date);
  const setDate = useUi((s) => s.setDate);
  const setView = useUi((s) => s.setView);

  const yearStart = startOfYear(date);
  const yearEnd = new Date(yearStart.getFullYear() + 1, 0, 1);
  const occs = useOccurrences(yearStart, yearEnd);

  // 'YYYY-MM-DD' -> colour of the first event that day
  const busy = useMemo(() => {
    const map = new Map();
    for (const o of occs) {
      let d = new Date(o.occStart.getFullYear(), o.occStart.getMonth(), o.occStart.getDate());
      const last = new Date(Math.max(o.occEnd - 1, +o.occStart));
      for (let guard = 0; d <= last && guard < 400; guard++) {
        const k = dateKey(d);
        if (!map.has(k)) map.set(k, o.displayColor);
        d = addDays(d, 1);
      }
    }
    return map;
  }, [occs]);

  const today = new Date();
  return (
    <div className="h-full overflow-y-auto p-4 sm:p-6">
      <div className="mx-auto grid max-w-6xl grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 12 }, (_, m) => {
          const monthDate = new Date(yearStart.getFullYear(), m, 1);
          const days = eachDayOfInterval({
            start: startOfWeek(startOfMonth(monthDate), { weekStartsOn: fmt.weekStartsOn }),
            end: endOfWeek(endOfMonth(monthDate), { weekStartsOn: fmt.weekStartsOn }),
          });
          return (
            <div key={m}>
              <button
                onClick={() => {
                  setDate(monthDate);
                  setView('month');
                }}
                className="mb-1 text-sm font-semibold hover:text-accent"
              >
                {fmt.f(monthDate, 'MMMM')}
              </button>
              <div className="grid grid-cols-7 text-center text-[10px] text-neutral-400">
                {days.slice(0, 7).map((d) => (
                  <div key={+d}>{fmt.f(d, 'EEEEE')}</div>
                ))}
              </div>
              <div className="grid grid-cols-7 text-center text-xs">
                {days.map((d) => {
                  const inMonth = isSameMonth(d, monthDate);
                  const color = busy.get(dateKey(d));
                  return (
                    <button
                      key={+d}
                      onClick={() => {
                        setDate(d);
                        setView('day');
                      }}
                      className={`relative mx-auto flex h-7 w-7 items-center justify-center rounded-full hover:bg-neutral-100 dark:hover:bg-neutral-800 ${
                        isSameDay(d, today) ? 'bg-accent font-semibold text-white hover:bg-accent' : inMonth ? '' : 'invisible'
                      }`}
                    >
                      {d.getDate()}
                      {color && inMonth && !isSameDay(d, today) && (
                        <span className="absolute bottom-0.5 h-1 w-1 rounded-full" style={{ background: color }} />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
