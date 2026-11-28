import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import WeatherIcon from './WeatherIcon';
import Icon from './Icons';
import useSettings from '../store/settingsStore';
import useUi from '../store/uiStore';
import { iconFor, labelKey } from '../lib/weather/codes';
import { useCurrentWeather, useWeatherStore } from '../lib/weather/store';

/** °C -> "14°" in the user's unit. */
export function useTemp() {
  const unit = useSettings((s) => s.tempUnit);
  return useCallback((c) => (c == null ? '' : `${Math.round(unit === 'F' ? (c * 9) / 5 + 32 : c)}°`), [unit]);
}

const placeLabel = (loc) => (loc ? [loc.name, loc.detail].filter(Boolean).join(', ') : '');

/**
 * Icon + high/low for one day. `w` is an entry from useDaysWeather. Opens the weather-location dialog for
 * that day when tapped. A pin marks days that use a place set for specific days.
 */
export function DayWeather({ w, size = 16, className = '', stacked = false, date }) {
  const { t } = useTranslation();
  const temp = useTemp();
  const open = useUi((s) => s.openWeatherDialog);
  if (!w?.day) return null;
  const [max, min, code] = w.day;
  const title = `${t(labelKey(code))} · ${temp(max)} / ${temp(min)} · ${placeLabel(w.loc)}`;
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={(e) => {
        e.stopPropagation();
        open({ date });
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      className={`inline-flex items-center justify-center gap-0.5 rounded-md leading-none hover:bg-neutral-200/60 dark:hover:bg-neutral-800 ${className}`}
    >
      <WeatherIcon icon={iconFor(code)} size={size} className="flex-shrink-0 text-neutral-400 dark:text-neutral-300" />
      <span className={stacked ? 'flex flex-col items-start' : 'flex items-baseline gap-0.5'}>
        <span className="font-semibold text-neutral-700 dark:text-neutral-200">{temp(max)}</span>
        <span className="text-neutral-400">{temp(min)}</span>
      </span>
      {w.loc?.source === 'place' && <Icon name="pin" size={size > 16 ? 12 : 10} className="text-accent" />}
    </button>
  );
}

/** Small "icon 13°" for one hour (time grid). */
export function HourWeather({ v, className = '', style }) {
  const temp = useTemp();
  if (!v) return null;
  const [t, code, isDay] = v;
  return (
    <span className={`pointer-events-none inline-flex items-center gap-0.5 text-[10px] leading-none text-neutral-400 ${className}`} style={style}>
      <WeatherIcon icon={iconFor(code, !!isDay)} size={17} className="text-neutral-400 dark:text-neutral-500" />
      {temp(t)}
    </span>
  );
}

/** Top-bar chip: current temperature and place. Tapping it opens the weather settings. */
export function CurrentWeather() {
  const { t } = useTranslation();
  const temp = useTemp();
  const enabled = useSettings((s) => s.weatherEnabled);
  const open = useUi((s) => s.openWeatherDialog);
  const locating = useWeatherStore((s) => s.locating);
  const cur = useCurrentWeather();
  if (!enabled) return null;

  const base = 'flex flex-shrink-0 items-center gap-1 rounded-full px-1 py-1.5 text-sm sm:gap-1.5 sm:px-2 hover:bg-neutral-100 dark:hover:bg-neutral-800';
  if (!cur?.loc) {
    return (
      <button onClick={() => open({})} className={`${base} text-neutral-500`} title={t('weather.setLocation')}>
        <Icon name="pin" size={16} className={locating ? 'animate-pulse' : ''} />
        <span className="hidden text-xs lg:inline">{locating ? t('weather.locating') : t('weather.setLocation')}</span>
      </button>
    );
  }
  const title = cur.now
    ? `${t(labelKey(cur.now[1]))} · ${temp(cur.now[0])}${cur.day ? ` (${temp(cur.day[0])} / ${temp(cur.day[1])})` : ''} · ${placeLabel(cur.loc)}`
    : placeLabel(cur.loc);
  return (
    <button onClick={() => open({})} className={base} title={title} aria-label={title}>
      {cur.now ? (
        <>
          <WeatherIcon icon={iconFor(cur.now[1], !!cur.now[2])} size={22} className="flex-shrink-0 text-neutral-400 dark:text-neutral-300" />
          <span className="font-semibold">{temp(cur.now[0])}</span>
        </>
      ) : (
        <Icon name="pin" size={16} className="text-neutral-400" />
      )}
      <span className="hidden max-w-[9rem] truncate text-xs text-neutral-500 lg:inline">{cur.loc.name}</span>
    </button>
  );
}
