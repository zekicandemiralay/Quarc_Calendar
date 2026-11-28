import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { parseISO } from 'date-fns';
import Modal, { inputCls } from './Modal';
import Icon from './Icons';
import WeatherIcon from './WeatherIcon';
import { useTemp } from './Weather';
import useSettings from '../store/settingsStore';
import useUi from '../store/uiStore';
import useFmt from '../lib/useFmt';
import { deletePlace, savePlace } from '../lib/data';
import { searchPlaces } from '../lib/weather/provider';
import { homeLocation, locationFor, refreshPosition, toDateStr, usePlaces, useWeatherStore, useDaysWeather } from '../lib/weather/store';
import { iconFor } from '../lib/weather/codes';

const label = (p) => [p.name, p.detail].filter(Boolean).join(', ');

/** City search box with a result list. Calls onPick({ name, detail, latitude, longitude }). */
function PlaceSearch({ onPick, autoFocus = false, placeholder }) {
  const { t, i18n } = useTranslation();
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [state, setState] = useState('idle'); // idle | searching | error | empty
  const seq = useRef(0);

  useEffect(() => {
    const query = q.trim();
    if (query.length < 2) {
      setResults([]);
      setState('idle');
      return undefined;
    }
    const id = ++seq.current;
    const timer = setTimeout(async () => {
      setState('searching');
      try {
        const found = await searchPlaces(query, { language: (i18n.language || 'en').slice(0, 2) });
        if (id !== seq.current) return;
        setResults(found);
        setState(found.length ? 'idle' : 'empty');
      } catch {
        if (id === seq.current) setState('error');
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [q, i18n.language]);

  return (
    <div>
      <div className="relative">
        <Icon name="search" size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
        <input
          autoFocus={autoFocus}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={placeholder || t('weather.searchPlace')}
          className={`${inputCls} pl-9`}
        />
      </div>
      {state === 'searching' && <p className="mt-2 text-xs text-neutral-500">{t('weather.searching')}</p>}
      {state === 'error' && <p className="mt-2 text-xs text-red-500">{t('weather.searchFailed')}</p>}
      {state === 'empty' && <p className="mt-2 text-xs text-neutral-500">{t('weather.noResults')}</p>}
      {results.length > 0 && (
        <ul className="mt-1.5 max-h-52 overflow-y-auto rounded-lg border border-neutral-200 dark:border-neutral-800">
          {results.map((r) => (
            <li key={`${r.latitude},${r.longitude}`}>
              <button
                type="button"
                onClick={() => {
                  onPick(r);
                  setQ('');
                  setResults([]);
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800"
              >
                <Icon name="pin" size={14} className="text-neutral-400" />
                <span className="min-w-0">
                  <span className="font-medium">{r.name}</span>
                  {r.detail && <span className="text-neutral-500">, {r.detail}</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Add / edit one place-for-days. */
function PlaceForm({ initial, onDone }) {
  const { t } = useTranslation();
  const [place, setPlace] = useState(initial.name ? initial : null);
  const [from, setFrom] = useState(initial.start_date);
  const [to, setTo] = useState(initial.end_date);
  const valid = place && from && to && to >= from;

  async function save() {
    if (!valid) return;
    await savePlace({
      ...(initial.id ? initial : {}),
      name: place.name,
      detail: place.detail || '',
      latitude: place.latitude,
      longitude: place.longitude,
      start_date: from,
      end_date: to,
    });
    onDone();
  }

  return (
    <div className="space-y-3 rounded-xl border border-neutral-200 p-3 dark:border-neutral-800">
      {place ? (
        <div className="flex items-center justify-between gap-2 text-sm">
          <span className="flex min-w-0 items-center gap-2">
            <Icon name="pin" size={15} className="text-accent" />
            <span className="truncate font-medium">{label(place)}</span>
          </span>
          <button type="button" onClick={() => setPlace(null)} className="text-xs font-medium text-accent hover:underline">
            {t('weather.change')}
          </button>
        </div>
      ) : (
        <PlaceSearch onPick={setPlace} autoFocus />
      )}
      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs text-neutral-500">
          {t('weather.from')}
          <input
            type="date"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
              if (e.target.value > to) setTo(e.target.value);
            }}
            className={`${inputCls} mt-1`}
          />
        </label>
        <label className="text-xs text-neutral-500">
          {t('weather.to')}
          <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className={`${inputCls} mt-1`} />
        </label>
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onDone} className="rounded-lg px-3 py-1.5 text-sm font-medium hover:bg-neutral-100 dark:hover:bg-neutral-800">
          {t('common.cancel')}
        </button>
        <button
          type="button"
          disabled={!valid}
          onClick={save}
          className="rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-white hover:bg-accent-dark disabled:opacity-50"
        >
          {t('common.save')}
        </button>
      </div>
    </div>
  );
}

export default function WeatherDialog() {
  const dialog = useUi((s) => s.weatherDialog);
  if (!dialog) return null;
  return <WeatherDialogBody focusDate={dialog.date || null} />;
}

function WeatherDialogBody({ focusDate }) {
  const { t } = useTranslation();
  const fmt = useFmt();
  const temp = useTemp();
  const close = useUi((s) => s.closeWeatherDialog);
  const askConfirm = useUi((s) => s.askConfirm);
  const settings = useSettings();
  const places = usePlaces();
  const locating = useWeatherStore((s) => s.locating);
  const [pickingHome, setPickingHome] = useState(false);
  const [locateFailed, setLocateFailed] = useState(false);

  const focusStr = focusDate ? toDateStr(focusDate) : null;
  const focusDays = useMemo(() => (focusDate ? [focusDate] : []), [focusDate]);
  const [focusW] = useDaysWeather(focusDays);
  const home = homeLocation(settings);

  // Opened from a day: edit the place covering it, or start a new one for just that day.
  const [form, setForm] = useState(() => {
    if (!focusStr) return null;
    const covering = locationFor(focusStr, places, null);
    return covering?.place ? { ...covering.place } : { start_date: focusStr, end_date: focusStr };
  });
  // places load asynchronously: once they arrive, prefer editing an existing place over a new one
  const adopted = useRef(false);
  useEffect(() => {
    if (adopted.current || !focusStr || !places.length) return;
    adopted.current = true;
    const covering = locationFor(focusStr, places, null);
    if (covering?.place) setForm((f) => (f && !f.id && !f.name ? { ...covering.place } : f));
  }, [places, focusStr]);

  const fmtRange = (p) => {
    const s = parseISO(p.start_date);
    const e = parseISO(p.end_date);
    if (p.start_date === p.end_date) return fmt.f(s, 'EEE d MMM yyyy');
    if (s.getFullYear() === e.getFullYear()) return `${fmt.f(s, 'd MMM')} – ${fmt.f(e, 'd MMM yyyy')}`;
    return `${fmt.f(s, 'd MMM yyyy')} – ${fmt.f(e, 'd MMM yyyy')}`;
  };

  async function followDevice() {
    settings.update({ weatherHome: null });
    setPickingHome(false);
    setLocateFailed(false);
    const ok = await refreshPosition();
    if (!ok && !useSettings.getState().lastPosition) setLocateFailed(true);
  }

  async function remove(p) {
    const ok = await askConfirm(t('weather.deletePlaceConfirm', { place: p.name, dates: fmtRange(p) }), { confirmLabel: t('common.delete') });
    if (ok) await deletePlace(p.id);
  }

  const today = toDateStr(new Date());
  const upcoming = places.filter((p) => p.end_date >= today);
  const past = places.filter((p) => p.end_date < today);

  return (
    <Modal title={t('weather.title')} onClose={close} width="max-w-lg">
      <div className="space-y-6 pb-2">
        {focusDate && (
          <div className="flex items-center gap-3 rounded-xl bg-neutral-100 px-3 py-2.5 dark:bg-neutral-800/60">
            {focusW?.day ? (
              <WeatherIcon icon={iconFor(focusW.day[2])} size={34} className="text-neutral-400" />
            ) : (
              <Icon name="calendar" size={22} className="text-neutral-400" />
            )}
            <div className="min-w-0 text-sm">
              <div className="font-semibold">{fmt.f(focusDate, 'EEEE, d MMMM yyyy')}</div>
              <div className="truncate text-neutral-500">
                {focusW?.day ? `${temp(focusW.day[0])} / ${temp(focusW.day[1])} · ` : `${t('weather.noData')} · `}
                {focusW?.loc ? label(focusW.loc) : t('weather.noLocation')}
              </div>
            </div>
          </div>
        )}

        {/* Places for specific days */}
        <section>
          <div className="mb-1 flex items-center justify-between">
            <h3 className="text-sm font-semibold">{t('weather.dayPlaces')}</h3>
            {!form && (
              <button
                type="button"
                onClick={() => setForm({ start_date: focusStr || today, end_date: focusStr || today })}
                className="flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium text-accent hover:bg-accent/10"
              >
                <Icon name="plus" size={14} /> {t('weather.addPlace')}
              </button>
            )}
          </div>
          <p className="mb-3 text-xs text-neutral-500">{t('weather.dayPlacesHint')}</p>

          {form && <PlaceForm key={form.id || 'new'} initial={form} onDone={() => setForm(null)} />}

          {[...upcoming, ...past].length > 0 && (
            <ul className="mt-3 divide-y divide-neutral-200 rounded-xl border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
              {[...upcoming, ...past].map((p) => (
                <li key={p.id} className={`flex items-center gap-2 px-3 py-2 ${p.end_date < today ? 'opacity-60' : ''}`}>
                  <Icon name="pin" size={15} className="text-accent" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{label(p)}</div>
                    <div className="text-xs text-neutral-500">{fmtRange(p)}</div>
                  </div>
                  <button type="button" onClick={() => setForm({ ...p })} className="rounded-full p-1.5 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800" aria-label={t('event.edit')}>
                    <Icon name="edit" size={15} />
                  </button>
                  <button type="button" onClick={() => remove(p)} className="rounded-full p-1.5 text-neutral-500 hover:bg-neutral-100 hover:text-red-500 dark:hover:bg-neutral-800" aria-label={t('common.delete')}>
                    <Icon name="trash" size={15} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Default location */}
        <section>
          <h3 className="mb-1 text-sm font-semibold">{t('weather.defaultLocation')}</h3>
          <p className="mb-3 text-xs text-neutral-500">{t('weather.defaultLocationHint')}</p>
          <div className="space-y-2">
            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-neutral-200 p-3 dark:border-neutral-800">
              <input type="radio" checked={!settings.weatherHome && !pickingHome} onChange={followDevice} className="mt-0.5 h-4 w-4 accent-[#e5484d]" />
              <span className="min-w-0 flex-1 text-sm">
                <span className="font-medium">{t('weather.currentLocation')}</span>
                <span className="block truncate text-xs text-neutral-500">
                  {locating
                    ? t('weather.locating')
                    : settings.lastPosition
                      ? label(homeLocation({ lastPosition: settings.lastPosition }))
                      : t('weather.locationUnavailable')}
                </span>
                {locateFailed && <span className="mt-1 block text-xs text-red-500">{t('weather.locationDenied')}</span>}
              </span>
              {!settings.weatherHome && (
                <button type="button" onClick={(e) => { e.preventDefault(); followDevice(); }} className="rounded-full p-1.5 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800" aria-label={t('weather.locateAgain')} title={t('weather.locateAgain')}>
                  <Icon name="refresh" size={15} className={locating ? 'animate-spin' : ''} />
                </button>
              )}
            </label>
            <div className="rounded-xl border border-neutral-200 p-3 dark:border-neutral-800">
              <label className="flex cursor-pointer items-start gap-3">
                <input type="radio" checked={!!settings.weatherHome || pickingHome} onChange={() => setPickingHome(true)} className="mt-0.5 h-4 w-4 accent-[#e5484d]" />
                <span className="min-w-0 flex-1 text-sm">
                  <span className="font-medium">{t('weather.fixedPlace')}</span>
                  {settings.weatherHome && <span className="block truncate text-xs text-neutral-500">{label(settings.weatherHome)}</span>}
                </span>
                {settings.weatherHome && !pickingHome && (
                  <button type="button" onClick={(e) => { e.preventDefault(); setPickingHome(true); }} className="text-xs font-medium text-accent hover:underline">
                    {t('weather.change')}
                  </button>
                )}
              </label>
              {pickingHome && (
                <div className="mt-3">
                  <PlaceSearch
                    autoFocus
                    onPick={(p) => {
                      settings.update({ weatherHome: { name: p.name, detail: p.detail, latitude: p.latitude, longitude: p.longitude } });
                      setPickingHome(false);
                    }}
                  />
                </div>
              )}
            </div>
          </div>
          {home && <p className="mt-2 text-xs text-neutral-500">{t('weather.deviceOnly')}</p>}
        </section>

        {/* Display */}
        <section className="flex flex-wrap items-center justify-between gap-3 border-t border-neutral-200 pt-4 dark:border-neutral-800">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={settings.weatherEnabled} onChange={(e) => settings.update({ weatherEnabled: e.target.checked })} className="h-4 w-4 accent-[#e5484d]" />
            {t('weather.show')}
          </label>
          <div className="flex rounded-lg border border-neutral-300 p-0.5 dark:border-neutral-700">
            {['C', 'F'].map((u) => (
              <button
                key={u}
                type="button"
                onClick={() => settings.update({ tempUnit: u })}
                className={`rounded-md px-3 py-1 text-sm font-medium ${settings.tempUnit === u ? 'bg-accent text-white' : 'text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800'}`}
              >
                °{u}
              </button>
            ))}
          </div>
        </section>
        <p className="text-[11px] text-neutral-400">{t('weather.attribution')}</p>
      </div>
    </Modal>
  );
}
