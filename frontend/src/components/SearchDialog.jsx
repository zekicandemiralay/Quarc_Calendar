import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Icon from './Icons';
import useUi from '../store/uiStore';
import useFmt from '../lib/useFmt';
import { useAllEvents, useCalendars } from '../lib/hooks';
import { eventStart } from '../lib/recurrence';

/** Search across every event (title, location, description) on this device: works offline. */
export default function SearchDialog() {
  const { t } = useTranslation();
  const fmt = useFmt();
  const open = useUi((s) => s.searchOpen);
  const setOpen = useUi((s) => s.setSearchOpen);
  const setDate = useUi((s) => s.setDate);
  const setView = useUi((s) => s.setView);
  const events = useAllEvents();
  const calendars = useCalendars();
  const [q, setQ] = useState('');
  const [index, setIndex] = useState(0);
  const inputRef = useRef(null);

  useEffect(() => {
    if (open) {
      setQ('');
      setIndex(0);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  const results = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return [];
    const cal = new Map(calendars.map((c) => [c.id, c]));
    return events
      .filter((e) => cal.has(e.calendar_id))
      .filter((e) => `${e.title} ${e.location} ${e.description}`.toLowerCase().includes(needle))
      .sort((a, b) => eventStart(b) - eventStart(a))
      .slice(0, 50)
      .map((e) => ({ e, color: e.color || cal.get(e.calendar_id).color }));
  }, [q, events, calendars]);

  if (!open) return null;

  const go = (e) => {
    setDate(eventStart(e));
    setView('day');
    setOpen(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center px-3 pt-[10vh]" role="dialog" aria-modal="true">
      <div className="absolute inset-0 animate-fade bg-black/50" onClick={() => setOpen(false)} />
      <div className="relative w-full max-w-xl animate-pop overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-neutral-900 dark:ring-1 dark:ring-neutral-800">
        <div className="flex items-center gap-3 border-b border-neutral-200 px-4 dark:border-neutral-800">
          <Icon name="search" className="text-neutral-400" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setIndex(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setOpen(false);
              else if (e.key === 'ArrowDown') {
                e.preventDefault();
                setIndex((i) => Math.min(i + 1, results.length - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setIndex((i) => Math.max(i - 1, 0));
              } else if (e.key === 'Enter' && results[index]) go(results[index].e);
            }}
            placeholder={t('search.placeholder')}
            className="h-14 flex-1 bg-transparent text-base outline-none placeholder:text-neutral-400"
          />
          <kbd className="hidden rounded border border-neutral-300 px-1.5 py-0.5 text-[10px] text-neutral-500 dark:border-neutral-700 sm:block">Esc</kbd>
        </div>
        <ul className="max-h-[50vh] overflow-y-auto py-1">
          {q && results.length === 0 && <li className="px-4 py-6 text-center text-sm text-neutral-400">{t('search.noResults')}</li>}
          {results.map(({ e, color }, i) => (
            <li key={e.id}>
              <button
                onClick={() => go(e)}
                onMouseEnter={() => setIndex(i)}
                className={`flex w-full items-center gap-3 px-4 py-2.5 text-left ${i === index ? 'bg-neutral-100 dark:bg-neutral-800' : ''}`}
              >
                <span className="h-3 w-3 flex-shrink-0 rounded-full" style={{ background: color }} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{e.title || t('event.noTitle')}</span>
                  <span className="block truncate text-xs text-neutral-500">
                    {fmt.f(eventStart(e), 'EEE, d MMM yyyy')}
                    {e.location ? ` · ${e.location}` : ''}
                  </span>
                </span>
                {e.rrule && <Icon name="repeat" size={14} className="text-neutral-400" />}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
