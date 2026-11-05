import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { addDays, format, parse } from 'date-fns';
import Modal, { btnDanger, btnGhost, btnPrimary, inputCls } from './Modal';
import Icon from './Icons';
import useUi from '../store/uiStore';
import useFmt from '../lib/useFmt';
import { useCalendars } from '../lib/hooks';
import { EVENT_COLORS } from '../lib/data';
import { DATE_FMT, eventEnd, eventStart } from '../lib/recurrence';
import { deleteWithScope, duplicateEvent, saveEdited, SCOPE } from '../lib/actions';
import { describeMinutes } from '../lib/reminders';

const REMINDER_CHOICES = [0, 5, 10, 15, 30, 60, 120, 1440, 2880, 10080];
const FREQS = ['daily', 'weekly', 'monthly', 'yearly'];

const toDate = (s) => parse(s, DATE_FMT, new Date());
const fieldTimes = (base, occ) => {
  const s = occ ? occ.occStart : eventStart(base);
  const e = occ ? occ.occEnd : eventEnd(base);
  if (base.all_day) return { s, e: addDays(e, -1) };
  return { s, e };
};

export default function EventEditor() {
  const { t } = useTranslation();
  const fmt = useFmt();
  const editor = useUi((s) => s.editor);
  const close = useUi((s) => s.closeEditor);
  const askScope = useUi((s) => s.askScope);
  const toast = useUi((s) => s.toast);
  const calendars = useCalendars();

  if (!editor) return null;
  const { base, occ, isNew } = editor;
  return (
    <EditorForm
      key={base.id + (occ?.key || '')}
      base={base}
      occ={occ}
      isNew={isNew}
      calendars={calendars}
      close={close}
      askScope={askScope}
      toast={toast}
      t={t}
      fmt={fmt}
    />
  );
}

function EditorForm({ base, occ, isNew, calendars, close, askScope, toast, t, fmt }) {
  const initial = useMemo(() => {
    const { s, e } = fieldTimes(base, occ);
    return {
      title: base.title,
      calendar_id: base.calendar_id,
      all_day: !!base.all_day,
      startDate: format(s, DATE_FMT),
      startTime: base.all_day ? '09:00' : format(s, 'HH:mm'),
      endDate: format(e, DATE_FMT),
      endTime: base.all_day ? '10:00' : format(e, 'HH:mm'),
      location: base.location || '',
      description: base.description || '',
      color: base.color || null,
      reminders: [...(base.reminders || [])],
      rrule: base.rrule ? { ...base.rrule } : null,
    };
  }, [base, occ]);

  const [f, setF] = useState(initial);
  const [saving, setSaving] = useState(false);
  const titleRef = useRef(null);
  const set = (patch) => setF((cur) => ({ ...cur, ...patch }));

  useEffect(() => {
    if (isNew) titleRef.current?.focus();
  }, [isNew]);

  // Default to a calendar once they've loaded (first run on a fresh device).
  useEffect(() => {
    if (!f.calendar_id && calendars.length) set({ calendar_id: (calendars.find((c) => c.is_default) || calendars[0]).id });
  }, [calendars, f.calendar_id]);

  const calendar = calendars.find((c) => c.id === f.calendar_id);
  const accent = f.color || calendar?.color || EVENT_COLORS[5];

  // Moving the start keeps the event's length by moving the end with it.
  function changeStart(patch) {
    const next = { ...f, ...patch };
    const oldStart = new Date(`${f.startDate}T${f.startTime}`);
    const oldEnd = new Date(`${f.endDate}T${f.endTime}`);
    const newStart = new Date(`${next.startDate}T${next.startTime}`);
    if (!Number.isNaN(+oldStart) && !Number.isNaN(+oldEnd) && !Number.isNaN(+newStart)) {
      const end = new Date(+newStart + (oldEnd - oldStart));
      next.endDate = format(end, DATE_FMT);
      next.endTime = format(end, 'HH:mm');
    }
    if (f.all_day && next.endDate < next.startDate) next.endDate = next.startDate;
    setF(next);
  }

  const isSeries = !!base.rrule && !isNew;
  const invalidRange = !f.all_day && new Date(`${f.endDate}T${f.endTime}`) < new Date(`${f.startDate}T${f.startTime}`);

  async function save() {
    if (!f.calendar_id) return;
    let scope = SCOPE.ALL;
    if (isSeries) {
      scope = await askScope('edit');
      if (!scope) return;
    }
    setSaving(true);
    try {
      const fields = {
        title: f.title.trim(),
        calendar_id: f.calendar_id,
        location: f.location.trim(),
        description: f.description,
        color: f.color,
        reminders: [...f.reminders].sort((a, b) => a - b),
      };
      if (scope !== SCOPE.THIS) fields.rrule = f.rrule;
      await saveEdited({
        base,
        fields,
        form: {
          all_day: f.all_day,
          startDate: toDate(f.startDate),
          endDate: toDate(f.endDate),
          startTime: f.startTime,
          endTime: f.endTime,
        },
        scope,
        originalDate: occ?.originalDate || (base.all_day ? base.start : format(new Date(base.start), DATE_FMT)),
      });
      close();
    } catch (err) {
      toast(`${t('common.error')}: ${err.message}`);
      setSaving(false);
    }
  }

  async function remove() {
    let scope = SCOPE.ALL;
    if (base.rrule) {
      scope = await askScope('delete');
      if (!scope) return;
    }
    await deleteWithScope({ base, scope, originalDate: occ?.originalDate });
    close();
  }

  const onKey = (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') save();
  };

  const rrule = f.rrule;
  const setRule = (patch) => set({ rrule: { ...rrule, ...patch } });

  return (
    <Modal
      title={isNew ? t('event.new') : t('event.edit')}
      onClose={close}
      labelledBy="event-editor-title"
      width="max-w-xl"
      footer={
        <>
          {!isNew && (
            <>
              <button onClick={remove} className={`${btnDanger} mr-auto`}>
                {t('common.delete')}
              </button>
              <button
                onClick={async () => {
                  await duplicateEvent(base, occ);
                  toast(t('event.duplicated'));
                  close();
                }}
                className={btnGhost}
              >
                {t('event.duplicate')}
              </button>
            </>
          )}
          <button onClick={close} className={btnGhost}>{t('common.cancel')}</button>
          <button onClick={save} disabled={saving || !f.calendar_id || invalidRange} className={btnPrimary}>
            {t('common.save')}
          </button>
        </>
      }
    >
      <div className="space-y-4" onKeyDown={onKey}>
        <input
          ref={titleRef}
          value={f.title}
          onChange={(e) => set({ title: e.target.value })}
          onKeyDown={(e) => e.key === 'Enter' && save()}
          placeholder={t('event.addTitle')}
          className="w-full border-0 border-b-2 border-neutral-200 bg-transparent pb-2 text-xl font-medium outline-none placeholder:text-neutral-400 focus:border-accent dark:border-neutral-700"
        />

        {/* When */}
        <Row icon="clock">
          <label className="mb-2 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={f.all_day}
              onChange={(e) => set({ all_day: e.target.checked, endDate: f.endDate < f.startDate ? f.startDate : f.endDate })}
              className="h-4 w-4 accent-[#e5484d]"
            />
            {t('event.allDay')}
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <input type="date" value={f.startDate} onChange={(e) => e.target.value && changeStart({ startDate: e.target.value })} className={`${inputCls} !w-auto`} />
            {!f.all_day && (
              <input type="time" value={f.startTime} onChange={(e) => e.target.value && changeStart({ startTime: e.target.value })} className={`${inputCls} !w-auto`} />
            )}
            <span className="text-neutral-400">–</span>
            {!f.all_day && (
              <input type="time" value={f.endTime} onChange={(e) => e.target.value && set({ endTime: e.target.value })} className={`${inputCls} !w-auto ${invalidRange ? '!border-red-500' : ''}`} />
            )}
            <input
              type="date"
              value={f.endDate}
              min={f.startDate}
              onChange={(e) => e.target.value && set({ endDate: e.target.value })}
              className={`${inputCls} !w-auto ${invalidRange ? '!border-red-500' : ''}`}
            />
          </div>
          {invalidRange && <p className="mt-1 text-xs text-red-500">{t('event.endBeforeStart')}</p>}
        </Row>

        {/* Repeat */}
        {(
          <Row icon="repeat">
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={rrule ? rrule.freq : 'none'}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === 'none') set({ rrule: null });
                  else {
                    const d = toDate(f.startDate);
                    set({
                      rrule: {
                        freq: v,
                        interval: rrule?.interval || 1,
                        ...(v === 'weekly' ? { byweekday: rrule?.byweekday?.length ? rrule.byweekday : [d.getDay()] } : {}),
                        ...(rrule?.until ? { until: rrule.until } : {}),
                        ...(rrule?.count ? { count: rrule.count } : {}),
                      },
                    });
                  }
                }}
                className={`${inputCls} !w-auto`}
              >
                <option value="none">{t('recurrence.none')}</option>
                {FREQS.map((x) => (
                  <option key={x} value={x}>{t(`recurrence.${x}`)}</option>
                ))}
              </select>
              {rrule && (
                <>
                  <span className="text-sm text-neutral-500">{t('recurrence.every')}</span>
                  <input
                    type="number"
                    min="1"
                    max="99"
                    value={rrule.interval}
                    onChange={(e) => setRule({ interval: Math.max(1, Math.min(99, Number(e.target.value) || 1)) })}
                    className={`${inputCls} !w-16`}
                  />
                  <span className="text-sm text-neutral-500">{t(`recurrence.unit_${{ daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year' }[rrule.freq]}`)}</span>
                </>
              )}
            </div>

            {rrule?.freq === 'weekly' && (
              <div className="mt-2 flex gap-1">
                {[1, 2, 3, 4, 5, 6, 0].map((d) => {
                  const on = rrule.byweekday?.includes(d);
                  return (
                    <button
                      key={d}
                      type="button"
                      onClick={() => {
                        const cur = new Set(rrule.byweekday || []);
                        if (cur.has(d)) cur.delete(d);
                        else cur.add(d);
                        if (cur.size) setRule({ byweekday: [...cur].sort() });
                      }}
                      className={`h-8 w-8 rounded-full text-xs font-medium ${on ? 'bg-accent text-white' : 'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300'}`}
                      title={fmt.weekdayNames[d]}
                    >
                      {fmt.weekdayShort[d].slice(0, 2)}
                    </button>
                  );
                })}
              </div>
            )}

            {rrule && (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                <span className="text-neutral-500">{t('recurrence.ends')}</span>
                <select
                  value={rrule.until ? 'until' : rrule.count ? 'count' : 'never'}
                  onChange={(e) => {
                    const { until, count, ...rest } = rrule; // eslint-disable-line no-unused-vars
                    if (e.target.value === 'never') set({ rrule: rest });
                    else if (e.target.value === 'until') set({ rrule: { ...rest, until: format(addDays(toDate(f.startDate), 30), DATE_FMT) } });
                    else set({ rrule: { ...rest, count: 10 } });
                  }}
                  className={`${inputCls} !w-auto`}
                >
                  <option value="never">{t('recurrence.never')}</option>
                  <option value="until">{t('recurrence.onDate')}</option>
                  <option value="count">{t('recurrence.afterCount')}</option>
                </select>
                {rrule.until && (
                  <input type="date" value={rrule.until} min={f.startDate} onChange={(e) => e.target.value && setRule({ until: e.target.value })} className={`${inputCls} !w-auto`} />
                )}
                {rrule.count && (
                  <>
                    <input type="number" min="1" max="999" value={rrule.count} onChange={(e) => setRule({ count: Math.max(1, Math.min(999, Number(e.target.value) || 1)) })} className={`${inputCls} !w-20`} />
                    <span className="text-neutral-500">{t('recurrence.occurrences')}</span>
                  </>
                )}
              </div>
            )}
          </Row>
        )}

        <Row icon="pin">
          <input value={f.location} onChange={(e) => set({ location: e.target.value })} placeholder={t('event.location')} className={inputCls} />
        </Row>

        {/* Reminders */}
        <Row icon="bell">
          <div className="flex flex-wrap items-center gap-2">
            {f.reminders.map((m) => (
              <span key={m} className="inline-flex items-center gap-1 rounded-full bg-neutral-100 py-1 pl-3 pr-1.5 text-sm dark:bg-neutral-800">
                {m === 0 ? t('reminders.atStart') : t('reminders.before', { text: describeMinutes(m, t) })}
                <button onClick={() => set({ reminders: f.reminders.filter((x) => x !== m) })} className="rounded-full p-0.5 hover:bg-neutral-200 dark:hover:bg-neutral-700" aria-label={t('common.remove')}>
                  <Icon name="x" size={14} />
                </button>
              </span>
            ))}
            {f.reminders.length < 4 && (
              <select
                value=""
                onChange={(e) => {
                  const m = Number(e.target.value);
                  if (e.target.value !== '' && !f.reminders.includes(m)) set({ reminders: [...f.reminders, m] });
                }}
                className={`${inputCls} !w-auto`}
              >
                <option value="">{f.reminders.length ? t('reminders.addAnother') : t('reminders.add')}</option>
                {REMINDER_CHOICES.filter((m) => !f.reminders.includes(m)).map((m) => (
                  <option key={m} value={m}>{m === 0 ? t('reminders.atStart') : t('reminders.before', { text: describeMinutes(m, t) })}</option>
                ))}
              </select>
            )}
          </div>
        </Row>

        {/* Calendar + colour */}
        <Row icon="calendar">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <span className="h-3 w-3 flex-shrink-0 rounded-full" style={{ background: accent }} />
              <select value={f.calendar_id} onChange={(e) => set({ calendar_id: e.target.value })} className={inputCls}>
                {calendars.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => set({ color: null })}
              title={t('event.calendarColor')}
              className={`flex h-6 items-center rounded-full border px-2 text-[11px] ${!f.color ? 'border-accent text-accent' : 'border-neutral-300 text-neutral-500 dark:border-neutral-700'}`}
            >
              {t('event.calendarColor')}
            </button>
            {EVENT_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => set({ color: c })}
                className={`h-6 w-6 rounded-full ring-offset-2 ring-offset-white dark:ring-offset-neutral-900 ${f.color === c ? 'ring-2 ring-neutral-500' : ''}`}
                style={{ background: c }}
                aria-label={c}
              />
            ))}
          </div>
        </Row>

        <Row icon="align">
          <textarea value={f.description} onChange={(e) => set({ description: e.target.value })} placeholder={t('event.description')} rows={3} className={`${inputCls} resize-y`} />
        </Row>

        {isSeries && <p className="text-xs text-neutral-500">{t('event.seriesHint')}</p>}
      </div>
    </Modal>
  );
}

function Row({ icon, children }) {
  return (
    <div className="flex gap-3">
      <Icon name={icon} className="mt-2.5 text-neutral-400" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
