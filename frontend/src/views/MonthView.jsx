import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  addDays, eachDayOfInterval, endOfMonth, endOfWeek, isSameDay, isSameMonth,
  startOfMonth, startOfWeek, startOfDay,
} from 'date-fns';
import useUi from '../store/uiStore';
import useFmt from '../lib/useFmt';
import { useOccurrences } from '../lib/hooks';
import { layoutSpans } from '../lib/layout';
import { isMultiDay } from '../lib/recurrence';
import { openNewEvent, textOn, useIsCompact } from '../lib/compose';
import DayList from '../components/DayList';

const HEADER_H = 28; // day-number row
const LANE_H = 20;

function useHeight(ref) {
  const [h, setH] = useState(600);
  useLayoutEffect(() => {
    if (!ref.current) return undefined;
    const ro = new ResizeObserver(([entry]) => setH(entry.contentRect.height));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, [ref]);
  return h;
}

export default function MonthView() {
  const { t } = useTranslation();
  const fmt = useFmt();
  const compact = useIsCompact();
  const date = useUi((s) => s.date);
  const setDate = useUi((s) => s.setDate);
  const setView = useUi((s) => s.setView);
  const openPreview = useUi((s) => s.openPreview);

  const gridRef = useRef(null);
  const gridH = useHeight(gridRef);

  const weeks = useMemo(() => {
    const start = startOfWeek(startOfMonth(date), { weekStartsOn: fmt.weekStartsOn });
    const end = endOfWeek(endOfMonth(date), { weekStartsOn: fmt.weekStartsOn });
    const all = eachDayOfInterval({ start, end });
    const rows = [];
    for (let i = 0; i < all.length; i += 7) rows.push(all.slice(i, i + 7));
    return rows;
  }, [date, fmt.weekStartsOn]);

  const rangeStart = weeks[0][0];
  const rangeEnd = addDays(weeks[weeks.length - 1][6], 1);
  const occs = useOccurrences(rangeStart, rangeEnd);
  const today = new Date();

  const rowH = gridH / weeks.length;
  const capacity = Math.max(1, Math.floor((rowH - HEADER_H - 4) / LANE_H));
  const headerDays = weeks[0];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="grid flex-shrink-0 grid-cols-7 border-b border-neutral-200 dark:border-neutral-800">
        {headerDays.map((d) => (
          <div key={+d} className="px-2 py-2 text-center text-[11px] font-medium uppercase tracking-wide text-neutral-500">
            {compact ? fmt.f(d, 'EEEEE') : fmt.f(d, 'EEE')}
          </div>
        ))}
      </div>

      <div ref={gridRef} className={`grid min-h-0 flex-1 ${compact ? 'max-h-[46%]' : ''}`} style={{ gridTemplateRows: `repeat(${weeks.length}, minmax(0, 1fr))` }}>
        {weeks.map((week) => (
          <WeekRow
            key={+week[0]}
            week={week}
            occs={occs}
            date={date}
            today={today}
            compact={compact}
            capacity={capacity}
            onDayClick={(d) => {
              if (compact) setDate(d);
              else {
                setDate(d);
                setView('day');
              }
            }}
            onCreate={(d) => openNewEvent(addDays(startOfDay(d), 0), { allDay: true })}
            onOpen={(occ, e) => openPreview({ occ, x: e.clientX, y: e.clientY })}
            onMore={(d) => {
              setDate(d);
              setView('day');
            }}
            fmt={fmt}
            t={t}
          />
        ))}
      </div>

      {compact && (
        <div className="min-h-0 flex-1 overflow-y-auto border-t border-neutral-200 dark:border-neutral-800">
          <DayList day={date} />
        </div>
      )}
    </div>
  );
}

function WeekRow({ week, occs, date, today, compact, capacity, onDayClick, onCreate, onOpen, onMore, fmt }) {
  const weekStart = week[0];
  const weekEnd = addDays(week[6], 1);

  const rowOccs = occs.filter((o) => o.occStart < weekEnd && o.occEnd > weekStart);
  const spanOccs = rowOccs.filter(isMultiDay);
  const { segments, lanes } = layoutSpans(spanOccs, week);

  // Lanes we can actually draw; the last visible line is reserved for "+N more" when space is short.
  const timedCap = Math.max(0, capacity);
  const visibleLanes = lanes <= timedCap ? lanes : Math.max(0, timedCap - 1);
  const shownSegments = segments.filter((s) => s.lane < visibleLanes);

  return (
    <div className="relative grid grid-cols-7 border-b border-neutral-200 last:border-b-0 dark:border-neutral-800">
      {week.map((day, i) => {
        const dayStart = startOfDay(day);
        const dayEnd = addDays(dayStart, 1);
        const isToday = isSameDay(day, today);
        const inMonth = isSameMonth(day, date);
        const selected = compact && isSameDay(day, date);

        const hiddenSpans = segments.filter((s) => s.lane >= visibleLanes && i >= s.start && i < s.start + s.span).length;
        const timed = rowOccs
          .filter((o) => !isMultiDay(o) && o.occStart < dayEnd && o.occEnd > dayStart)
          .sort((a, b) => a.occStart - b.occStart);
        const room = Math.max(0, timedCap - visibleLanes);
        const timedShown = hiddenSpans + timed.length > room && room > 0 ? Math.max(0, room - 1) : room;
        const visibleTimed = timed.slice(0, timedShown);
        const more = hiddenSpans + timed.length - visibleTimed.length;

        return (
          <div
            key={+day}
            onClick={() => onDayClick(day)}
            onDoubleClick={() => !compact && onCreate(day)}
            className={`relative min-w-0 cursor-pointer overflow-hidden border-r border-neutral-200 last:border-r-0 dark:border-neutral-800 ${inMonth ? '' : 'bg-neutral-50/60 dark:bg-neutral-950/40'} ${selected ? 'bg-accent/5' : ''}`}
          >
            <div className="flex h-7 items-center justify-center pt-1 sm:justify-start sm:px-2">
              <span
                className={`flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-xs font-medium ${
                  isToday ? 'bg-accent text-white' : selected ? 'bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900' : inMonth ? '' : 'text-neutral-400'
                }`}
              >
                {day.getDate() === 1 && !compact ? fmt.f(day, 'd MMM') : day.getDate()}
              </span>
            </div>

            {compact ? (
              <div className="flex flex-wrap justify-center gap-0.5 px-1 pt-0.5">
                {rowOccs
                  .filter((o) => o.occStart < dayEnd && o.occEnd > dayStart)
                  .slice(0, 4)
                  .map((o) => (
                    <span key={o.key} className="h-1.5 w-1.5 rounded-full" style={{ background: o.displayColor }} />
                  ))}
              </div>
            ) : (
              <div className="flex flex-col gap-px" style={{ paddingTop: visibleLanes * LANE_H }}>
                {visibleTimed.map((o) => (
                  <button
                    key={o.key}
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpen(o, e);
                    }}
                    className="mx-1 flex h-[19px] items-center gap-1 truncate rounded px-1 text-left text-[11px] hover:bg-neutral-200/70 dark:hover:bg-neutral-800"
                  >
                    <span className="h-2 w-2 flex-shrink-0 rounded-full" style={{ background: o.displayColor }} />
                    <span className="flex-shrink-0 text-neutral-500">{fmt.time(o.occStart)}</span>
                    <span className="truncate font-medium">{o.title || '…'}</span>
                  </button>
                ))}
                {more > 0 && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onMore(day);
                    }}
                    className="mx-1 h-[19px] truncate rounded px-1 text-left text-[11px] font-medium text-neutral-500 hover:bg-neutral-200/70 dark:hover:bg-neutral-800"
                  >
                    +{more}
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}

      {/* Multi-day / all-day bars, laid over the seven columns */}
      {!compact && (
        <div className="pointer-events-none absolute inset-x-0 grid grid-cols-7" style={{ top: HEADER_H, gridAutoRows: LANE_H }}>
          {shownSegments.map((s) => (
            <button
              key={s.occ.key + s.start}
              onClick={(e) => {
                e.stopPropagation();
                onOpen(s.occ, e);
              }}
              className={`pointer-events-auto mx-px truncate px-1.5 text-left text-[11px] font-medium leading-[18px] hover:brightness-110 ${s.clippedLeft ? 'rounded-l-none' : 'rounded-l'} ${s.clippedRight ? 'rounded-r-none' : 'rounded-r'}`}
              style={{
                gridColumn: `${s.start + 1} / span ${s.span}`,
                gridRow: s.lane + 1,
                height: LANE_H - 2,
                marginTop: 0,
                background: s.occ.displayColor,
                color: textOn(s.occ.displayColor),
              }}
            >
              {s.occ.title || '…'}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
