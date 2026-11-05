import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { format } from 'date-fns';
import Modal, { btnDanger, btnGhost, btnPrimary, inputCls } from './Modal';
import Icon from './Icons';
import useUi from '../store/uiStore';
import useFmt from '../lib/useFmt';
import { EVENT_COLORS, createCalendar, deleteCalendar, saveCalendar } from '../lib/data';
import { useCalendars } from '../lib/hooks';
import { db } from '../lib/db';
import { SCOPE, deleteWithScope, duplicateEvent } from '../lib/actions';
import { describeRule } from '../lib/recurrence';
import { describeMinutes } from '../lib/reminders';

// ---------------------------------------------------------------------------
// "This event / This and following / All events"
// ---------------------------------------------------------------------------
export function ScopeDialog() {
  const { t } = useTranslation();
  const ask = useUi((s) => s.scopeAsk);
  const answer = useUi((s) => s.answerScope);
  const [value, setValue] = useState(SCOPE.THIS);
  useEffect(() => setValue(SCOPE.THIS), [ask]);
  if (!ask) return null;

  const options = ask.action === 'move' ? [SCOPE.THIS, SCOPE.ALL] : [SCOPE.THIS, SCOPE.FOLLOWING, SCOPE.ALL];
  return (
    <Modal
      title={t(`scope.title_${ask.action}`)}
      onClose={() => answer(null)}
      width="max-w-sm"
      footer={
        <>
          <button onClick={() => answer(null)} className={btnGhost}>{t('common.cancel')}</button>
          <button onClick={() => answer(value)} className={ask.action === 'delete' ? `${btnDanger} !bg-red-600 !text-white hover:!bg-red-700` : btnPrimary}>
            {t('common.ok')}
          </button>
        </>
      }
    >
      <div className="space-y-1">
        {options.map((o) => (
          <label key={o} className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 hover:bg-neutral-100 dark:hover:bg-neutral-800">
            <input type="radio" name="scope" checked={value === o} onChange={() => setValue(o)} className="h-4 w-4 accent-[#e5484d]" />
            <span className="text-sm">{t(`scope.${o}`)}</span>
          </label>
        ))}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Read-only event card
// ---------------------------------------------------------------------------
export function EventPreview() {
  const { t } = useTranslation();
  const fmt = useFmt();
  const preview = useUi((s) => s.preview);
  const close = useUi((s) => s.closePreview);
  const openEditor = useUi((s) => s.openEditor);
  const askScope = useUi((s) => s.askScope);
  if (!preview) return null;
  const { occ } = preview;

  const sameDay = format(occ.occStart, 'yyyyMMdd') === format(new Date(occ.occEnd.getTime() - 1), 'yyyyMMdd');
  let when;
  if (occ.all_day) {
    const lastDay = new Date(occ.occEnd.getTime() - 1);
    when = sameDay ? fmt.f(occ.occStart, 'EEEE, d MMMM yyyy') : `${fmt.f(occ.occStart, 'd MMM')} – ${fmt.f(lastDay, 'd MMM yyyy')}`;
  } else if (sameDay || occ.occEnd <= occ.occStart) {
    when = `${fmt.f(occ.occStart, 'EEEE, d MMMM yyyy')} · ${fmt.time(occ.occStart)} – ${fmt.time(occ.occEnd)}`;
  } else {
    when = `${fmt.f(occ.occStart, 'EEE d MMM')}, ${fmt.time(occ.occStart)} – ${fmt.f(occ.occEnd, 'EEE d MMM')}, ${fmt.time(occ.occEnd)}`;
  }

  async function edit() {
    const base = await db.events.get(occ.id);
    if (base) openEditor({ base, occ, isNew: false });
  }
  async function remove() {
    const base = await db.events.get(occ.id);
    if (!base) return;
    let scope = SCOPE.ALL;
    if (base.rrule) {
      scope = await askScope('delete');
      if (!scope) return;
    }
    await deleteWithScope({ base, scope, originalDate: occ.originalDate });
    close();
  }

  return (
    <Modal
      title={null}
      onClose={close}
      width="max-w-md"
      footer={
        <>
          <button onClick={remove} className={`${btnDanger} mr-auto flex items-center gap-1.5`}>
            <Icon name="trash" size={16} /> {t('common.delete')}
          </button>
          <button
            onClick={async () => {
              const base = await db.events.get(occ.id);
              if (base) await duplicateEvent(base, occ);
              close();
            }}
            className={`${btnGhost} flex items-center gap-1.5`}
          >
            <Icon name="copy" size={16} /> {t('event.duplicate')}
          </button>
          <button onClick={edit} className={`${btnPrimary} flex items-center gap-1.5`}>
            <Icon name="edit" size={16} /> {t('common.edit')}
          </button>
        </>
      }
    >
      <div className="flex gap-3 pt-2">
        <span className="mt-1.5 h-4 w-4 flex-shrink-0 rounded" style={{ background: occ.displayColor }} />
        <div className="min-w-0 flex-1">
          <h2 className="break-words text-xl font-semibold leading-snug">{occ.title || t('event.noTitle')}</h2>
          <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-300">{when}</p>

          <div className="mt-4 space-y-2.5 text-sm">
            {occ.isRecurring && (
              <Line icon="repeat">{describeRule(occ.rrule, t, fmt.weekdayShort)}</Line>
            )}
            {occ.location && (
              <Line icon="pin">
                <a
                  href={`https://www.openstreetmap.org/search?query=${encodeURIComponent(occ.location)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:underline"
                >
                  {occ.location}
                </a>
              </Line>
            )}
            {occ.reminders?.length > 0 && (
              <Line icon="bell">
                {occ.reminders.map((m) => (m === 0 ? t('reminders.atStart') : t('reminders.before', { text: describeMinutes(m, t) }))).join(', ')}
              </Line>
            )}
            <Line icon="calendar">{occ.calendarName}</Line>
            {occ.description && (
              <Line icon="align">
                <span className="whitespace-pre-wrap break-words">{occ.description}</span>
              </Line>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}

function Line({ icon, children }) {
  return (
    <div className="flex items-start gap-3">
      <Icon name={icon} size={16} className="mt-0.5 text-neutral-400" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create / edit / delete a calendar
// ---------------------------------------------------------------------------
export function CalendarEditor() {
  const { t } = useTranslation();
  const ctx = useUi((s) => s.calendarEditor);
  const close = useUi((s) => s.closeCalendarEditor);
  const calendars = useCalendars();
  const [name, setName] = useState('');
  const [color, setColor] = useState(EVENT_COLORS[5]);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!ctx) return;
    setName(ctx.calendar?.name || '');
    setColor(ctx.calendar?.color || EVENT_COLORS[(calendars.length + 5) % EVENT_COLORS.length]);
    setConfirmDelete(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx]);

  if (!ctx) return null;
  const editing = ctx.calendar;
  const canDelete = editing && calendars.length > 1;

  async function save() {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (editing) await saveCalendar({ ...editing, name: trimmed, color });
    else await createCalendar({ name: trimmed, color });
    close();
  }

  return (
    <Modal
      title={editing ? t('calendars.edit') : t('calendars.new')}
      onClose={close}
      width="max-w-sm"
      footer={
        confirmDelete ? (
          <>
            <span className="mr-auto text-sm text-red-600">{t('calendars.deleteConfirm')}</span>
            <button onClick={() => setConfirmDelete(false)} className={btnGhost}>{t('common.cancel')}</button>
            <button onClick={async () => { await deleteCalendar(editing.id); close(); }} className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700">
              {t('common.delete')}
            </button>
          </>
        ) : (
          <>
            {canDelete && <button onClick={() => setConfirmDelete(true)} className={`${btnDanger} mr-auto`}>{t('common.delete')}</button>}
            <button onClick={close} className={btnGhost}>{t('common.cancel')}</button>
            <button onClick={save} disabled={!name.trim()} className={btnPrimary}>{t('common.save')}</button>
          </>
        )
      }
    >
      <div className="space-y-4">
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && save()}
          placeholder={t('calendars.name')}
          maxLength={100}
          className={inputCls}
        />
        <div className="flex flex-wrap gap-2">
          {EVENT_COLORS.map((c) => (
            <button
              key={c}
              onClick={() => setColor(c)}
              className={`flex h-8 w-8 items-center justify-center rounded-full text-white ring-offset-2 ring-offset-white dark:ring-offset-neutral-900 ${color === c ? 'ring-2 ring-neutral-500' : ''}`}
              style={{ background: c }}
              aria-label={c}
            >
              {color === c && <Icon name="check" size={16} strokeWidth={2.5} />}
            </button>
          ))}
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Toasts (reminders, confirmations)
// ---------------------------------------------------------------------------
export function Toasts() {
  const toasts = useUi((s) => s.toasts);
  const dismiss = useUi((s) => s.dismissToast);
  if (!toasts.length) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4 pb-[env(safe-area-inset-bottom)]">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="pointer-events-auto flex max-w-md animate-pop items-center gap-3 rounded-xl bg-neutral-900 px-4 py-3 text-sm text-white shadow-xl dark:bg-neutral-100 dark:text-neutral-900"
        >
          {t.kind === 'reminder' && <Icon name="bell" size={16} className="text-amber-400 dark:text-amber-600" />}
          <span className="min-w-0 flex-1">{t.message}</span>
          <button onClick={() => dismiss(t.id)} className="opacity-60 hover:opacity-100" aria-label="Close">
            <Icon name="x" size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
