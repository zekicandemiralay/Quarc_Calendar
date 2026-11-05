import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { addDays, addMinutes, eachDayOfInterval, isSameDay, startOfDay, startOfWeek } from 'date-fns';
import useUi from '../store/uiStore';
import useFmt from '../lib/useFmt';
import { useOccurrences } from '../lib/hooks';
import { layoutDay, layoutSpans, snap, SNAP_MINUTES } from '../lib/layout';
import { isMultiDay } from '../lib/recurrence';
import { moveOccurrence, SCOPE } from '../lib/actions';
import { openNewEvent, textOn, useIsCompact } from '../lib/compose';

const HOUR_H = 52; // px per hour
const GUTTER_W = 52;
const LANE_H = 22;
const DRAG_THRESHOLD = 5;

/** Week view (7 columns) or day view (1 column): all-day strip + scrollable hour grid. */
export default function TimeGridView({ mode }) {
  const { t } = useTranslation();
  const fmt = useFmt();
  const compact = useIsCompact();
  const date = useUi((s) => s.date);
  const setDate = useUi((s) => s.setDate);
  const setView = useUi((s) => s.setView);
  const openPreview = useUi((s) => s.openPreview);
  const askScope = useUi((s) => s.askScope);

  const days = useMemo(() => {
    if (mode === 'day') return [startOfDay(date)];
    // Phones are too narrow for seven columns: show three days starting at the selected date.
    if (compact) return [0, 1, 2].map((i) => addDays(startOfDay(date), i));
    const start = startOfWeek(date, { weekStartsOn: fmt.weekStartsOn });
    return eachDayOfInterval({ start, end: addDays(start, 6) });
  }, [mode, date, fmt.weekStartsOn, compact]);

  const occs = useOccurrences(days[0], addDays(days[days.length - 1], 1));
  const spanOccs = useMemo(() => occs.filter(isMultiDay), [occs]);
  const { segments, lanes } = useMemo(() => layoutSpans(spanOccs, days), [spanOccs, days]);

  const scrollRef = useRef(null);
  const colsRef = useRef(null);
  const [now, setNow] = useState(new Date());
  const [selection, setSelection] = useState(null); // {dayIndex, from, to} minutes
  const [drag, setDrag] = useState(null); // {occKey, mode:'move'|'resize', dMin, dDay}
  const pointerType = useRef('mouse');
  const suppressClick = useRef(false);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(id);
  }, []);

  // Start the visible window around "now" (or the morning) when the view or day changes.
  const anchorKey = `${mode}-${+days[0]}`;
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const containsToday = days.some((d) => isSameDay(d, new Date()));
    const hour = containsToday ? Math.max(0, new Date().getHours() - 2) : 7;
    el.scrollTop = hour * HOUR_H;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchorKey]);

  const hours = Array.from({ length: 24 }, (_, h) => h);
  const dayColumns = useMemo(() => days.map((d) => layoutDay(occs, d)), [occs, days]);

  // ---- pointer helpers ---------------------------------------------------
  const minuteAt = (clientY) => {
    const rect = colsRef.current.getBoundingClientRect();
    return Math.min(24 * 60, Math.max(0, ((clientY - rect.top) / HOUR_H) * 60));
  };
  const dayIndexAt = (clientX) => {
    const rect = colsRef.current.getBoundingClientRect();
    const w = rect.width / days.length;
    return Math.min(days.length - 1, Math.max(0, Math.floor((clientX - rect.left) / w)));
  };

  // Drag on empty space to create an event (mouse). Touch uses tap, below.
  function onColumnPointerDown(e, dayIndex) {
    pointerType.current = e.pointerType;
    if (e.pointerType !== 'mouse' || e.button !== 0 || e.target.closest('[data-event]')) return;
    const origin = snap(minuteAt(e.clientY), SNAP_MINUTES);
    let moved = false;
    const move = (ev) => {
      const cur = snap(minuteAt(ev.clientY), SNAP_MINUTES);
      if (Math.abs(cur - origin) >= SNAP_MINUTES) moved = true;
      if (moved) setSelection({ dayIndex, from: Math.min(origin, cur), to: Math.max(origin, cur) + (cur === origin ? SNAP_MINUTES : 0) });
    };
    const up = (ev) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (moved) {
        const cur = snap(minuteAt(ev.clientY), SNAP_MINUTES);
        const from = Math.min(origin, cur);
        const to = Math.max(origin, cur) || from + SNAP_MINUTES;
        suppressClick.current = true;
        setTimeout(() => (suppressClick.current = false), 0);
        openNewEvent(addMinutes(days[dayIndex], from), { end: addMinutes(days[dayIndex], Math.max(to, from + SNAP_MINUTES)) });
      }
      setSelection(null);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  function onColumnClick(e, dayIndex) {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    if (e.target.closest('[data-event]')) return;
    const minute = Math.floor(minuteAt(e.clientY) / 30) * 30; // half-hour slots for taps
    openNewEvent(addMinutes(days[dayIndex], minute));
  }

  // Drag an existing event to move it, or its bottom edge to resize (mouse only).
  function startEventDrag(e, occ, dragMode) {
    pointerType.current = e.pointerType;
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    e.stopPropagation();
    const startX = e.clientX;
    const startY = e.clientY;
    const colW = colsRef.current.getBoundingClientRect().width / days.length;
    let active = false;
    let latest = { dMin: 0, dDay: 0 };

    const move = (ev) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!active && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      active = true;
      latest = {
        dMin: snap((dy / HOUR_H) * 60, SNAP_MINUTES),
        dDay: dragMode === 'move' && days.length > 1 ? Math.round(dx / colW) : 0,
      };
      setDrag({ occKey: occ.key, mode: dragMode, ...latest });
    };
    const up = async () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setDrag(null);
      if (!active) return; // a plain click: let onClick open the preview
      suppressClick.current = true;
      setTimeout(() => (suppressClick.current = false), 0);
      if (latest.dMin === 0 && latest.dDay === 0) return;

      let newStart = occ.occStart;
      let newEnd = occ.occEnd;
      if (dragMode === 'move') {
        newStart = addDays(addMinutes(occ.occStart, latest.dMin), latest.dDay);
        newEnd = addDays(addMinutes(occ.occEnd, latest.dMin), latest.dDay);
      } else {
        newEnd = addMinutes(occ.occEnd, latest.dMin);
        if (newEnd <= newStart) newEnd = addMinutes(newStart, SNAP_MINUTES);
      }
      let scope = SCOPE.ALL;
      if (occ.isRecurring) {
        scope = await askScope('move');
        if (!scope) return;
      }
      moveOccurrence({ occ, newStart, newEnd, scope });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  // ---- render ----------------------------------------------------------------
  const stripH = Math.max(1, lanes) * LANE_H + 6;
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Day headers */}
      <div className="flex flex-shrink-0 border-b border-neutral-200 dark:border-neutral-800" style={{ paddingLeft: GUTTER_W }}>
        {days.map((d) => {
          const isToday = isSameDay(d, now);
          return (
            <button
              key={+d}
              onClick={() => {
                setDate(d);
                if (mode === 'week') setView('day');
              }}
              className="flex flex-1 flex-col items-center py-1.5 hover:bg-neutral-50 dark:hover:bg-neutral-900"
            >
              <span className={`text-[11px] font-medium uppercase tracking-wide ${isToday ? 'text-accent' : 'text-neutral-500'}`}>
                {fmt.f(d, 'EEE')}
              </span>
              <span className={`mt-0.5 flex h-8 w-8 items-center justify-center rounded-full text-lg font-medium ${isToday ? 'bg-accent text-white' : ''}`}>
                {d.getDate()}
              </span>
            </button>
          );
        })}
      </div>

      {/* All-day / multi-day strip */}
      <div className="relative flex flex-shrink-0 overflow-y-auto border-b border-neutral-200 dark:border-neutral-800" style={{ maxHeight: 5 * LANE_H + 6 }}>
        <div className="flex-shrink-0 pr-2 pt-1.5 text-right text-[10px] uppercase text-neutral-400" style={{ width: GUTTER_W }}>
          {t('event.allDay')}
        </div>
        <div className="relative flex-1" style={{ height: stripH }}>
          <div className="absolute inset-0 flex">
            {days.map((d) => (
              <div
                key={+d}
                className="flex-1 border-l border-neutral-200 dark:border-neutral-800"
                onClick={() => openNewEvent(d, { allDay: true })}
              />
            ))}
          </div>
          <div className="pointer-events-none absolute inset-x-0 top-[3px] grid" style={{ gridTemplateColumns: `repeat(${days.length}, 1fr)`, gridAutoRows: LANE_H }}>
            {segments.map((s) => (
              <button
                key={s.occ.key + s.start}
                data-event
                onClick={(e) => openPreview({ occ: s.occ, x: e.clientX, y: e.clientY })}
                className={`pointer-events-auto mx-px mb-0.5 truncate px-1.5 text-left text-xs font-medium hover:brightness-110 ${s.clippedLeft ? '' : 'rounded-l'} ${s.clippedRight ? '' : 'rounded-r'}`}
                style={{
                  gridColumn: `${s.start + 1} / span ${s.span}`,
                  gridRow: s.lane + 1,
                  background: s.occ.displayColor,
                  color: textOn(s.occ.displayColor),
                }}
              >
                {s.occ.title || t('event.noTitle')}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Hour grid */}
      <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="relative flex" style={{ height: 24 * HOUR_H }}>
          <div className="flex-shrink-0" style={{ width: GUTTER_W }}>
            {hours.map((h) => (
              <div key={h} className="relative text-right" style={{ height: HOUR_H }}>
                {h > 0 && (
                  <span className="absolute -top-2 right-2 text-[10px] text-neutral-400">{fmt.hour(h)}</span>
                )}
              </div>
            ))}
          </div>

          <div ref={colsRef} className="relative flex flex-1 select-none">
            {/* hour lines */}
            <div className="pointer-events-none absolute inset-0">
              {hours.map((h) => (
                <div key={h} className="border-t border-neutral-200 dark:border-neutral-800" style={{ height: HOUR_H }}>
                  <div className="border-t border-dashed border-neutral-100 dark:border-neutral-900" style={{ marginTop: HOUR_H / 2 - 1 }} />
                </div>
              ))}
            </div>

            {days.map((d, di) => {
              const isToday = isSameDay(d, now);
              return (
                <div
                  key={+d}
                  className={`relative flex-1 border-l border-neutral-200 dark:border-neutral-800 ${isToday ? 'bg-accent/[0.03]' : ''}`}
                  onPointerDown={(e) => onColumnPointerDown(e, di)}
                  onClick={(e) => onColumnClick(e, di)}
                >
                  {dayColumns[di].map(({ occ, top, height, col, cols }) => {
                    const dragging = drag && drag.occKey === occ.key;
                    const dTop = dragging && drag.mode === 'move' ? drag.dMin : 0;
                    const dHeight = dragging && drag.mode === 'resize' ? drag.dMin : 0;
                    const dX = dragging ? drag.dDay * 100 : 0;
                    const h = Math.max(((height + dHeight) / 60) * HOUR_H - 2, 14);
                    const short = h < 34;
                    return (
                      <div
                        key={occ.key}
                        data-event
                        onPointerDown={(e) => startEventDrag(e, occ, 'move')}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (suppressClick.current) return;
                          openPreview({ occ, x: e.clientX, y: e.clientY });
                        }}
                        className={`absolute cursor-pointer overflow-hidden rounded-md px-1.5 py-0.5 text-xs shadow-sm ring-1 ring-white/60 hover:brightness-110 dark:ring-neutral-950 ${dragging ? 'z-30 opacity-80 shadow-lg' : 'z-10'}`}
                        style={{
                          top: ((top + dTop) / 60) * HOUR_H + 1,
                          height: h,
                          left: `calc(${(col / cols) * 100}% + ${dX}% + 1px)`,
                          width: `calc(${100 / cols}% - 3px)`,
                          background: occ.displayColor,
                          color: textOn(occ.displayColor),
                        }}
                      >
                        <div className={`font-semibold leading-tight ${short ? 'truncate' : 'line-clamp-2'}`}>
                          {occ.title || t('event.noTitle')}
                          {short && <span className="ml-1 font-normal opacity-80">{fmt.time(occ.occStart)}</span>}
                        </div>
                        {!short && (
                          <div className="truncate text-[11px] opacity-90">
                            {fmt.time(addMinutes(occ.occStart, dragging && drag.mode === 'move' ? drag.dMin : 0))} – {fmt.time(addMinutes(occ.occEnd, dragging ? drag.dMin : 0))}
                          </div>
                        )}
                        {!short && occ.location && <div className="truncate text-[11px] opacity-80">{occ.location}</div>}
                        <div
                          className="absolute inset-x-0 bottom-0 h-2 cursor-ns-resize"
                          onPointerDown={(e) => startEventDrag(e, occ, 'resize')}
                        />
                      </div>
                    );
                  })}

                  {selection && selection.dayIndex === di && (
                    <div
                      className="pointer-events-none absolute inset-x-0.5 z-20 rounded-md border-2 border-accent bg-accent/20"
                      style={{ top: (selection.from / 60) * HOUR_H, height: ((selection.to - selection.from) / 60) * HOUR_H }}
                    />
                  )}

                  {isToday && (
                    <div className="pointer-events-none absolute inset-x-0 z-20" style={{ top: (nowMinutes / 60) * HOUR_H }}>
                      <div className="relative h-0.5 bg-accent">
                        <span className="absolute -left-1.5 -top-[5px] h-3 w-3 rounded-full bg-accent" />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
