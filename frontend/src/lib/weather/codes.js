// WMO weather codes (what Open-Meteo returns) -> label key + icon. Same table as Quarc Weather.

const CODES = {
  0: { key: 'clear', icon: 'sun' },
  1: { key: 'mainlyClear', icon: 'sun-cloud' },
  2: { key: 'partlyCloudy', icon: 'cloud-sun' },
  3: { key: 'overcast', icon: 'cloud' },
  45: { key: 'fog', icon: 'fog' },
  48: { key: 'rimeFog', icon: 'fog' },
  51: { key: 'drizzleLight', icon: 'drizzle' },
  53: { key: 'drizzleModerate', icon: 'drizzle' },
  55: { key: 'drizzleDense', icon: 'drizzle' },
  56: { key: 'freezingDrizzleLight', icon: 'sleet' },
  57: { key: 'freezingDrizzleDense', icon: 'sleet' },
  61: { key: 'rainSlight', icon: 'rain' },
  63: { key: 'rainModerate', icon: 'rain' },
  65: { key: 'rainHeavy', icon: 'rain-heavy' },
  66: { key: 'freezingRainLight', icon: 'sleet' },
  67: { key: 'freezingRainHeavy', icon: 'sleet' },
  71: { key: 'snowSlight', icon: 'snow' },
  73: { key: 'snowModerate', icon: 'snow' },
  75: { key: 'snowHeavy', icon: 'snow-heavy' },
  77: { key: 'snowGrains', icon: 'snow' },
  80: { key: 'showersSlight', icon: 'showers' },
  81: { key: 'showersModerate', icon: 'showers' },
  82: { key: 'showersViolent', icon: 'rain-heavy' },
  85: { key: 'snowShowersSlight', icon: 'snow' },
  86: { key: 'snowShowersHeavy', icon: 'snow-heavy' },
  95: { key: 'thunderstorm', icon: 'storm' },
  96: { key: 'thunderstormHail', icon: 'storm-hail' },
  99: { key: 'thunderstormHailHeavy', icon: 'storm-hail' },
};

const UNKNOWN = { key: 'unknown', icon: 'cloud' };

export function describe(code) {
  return CODES[code] ?? UNKNOWN;
}

/** i18n key for a weather code, e.g. 'weatherCond.partlyCloudy'. */
export const labelKey = (code) => `weatherCond.${describe(code).key}`;

/** Icon id for WeatherIcon; the clear-sky icons have night versions. */
export function iconFor(code, isDay = true) {
  const { icon } = describe(code);
  if (!isDay) {
    if (icon === 'sun') return 'moon';
    if (icon === 'sun-cloud') return 'moon-cloud';
    if (icon === 'cloud-sun') return 'cloud-moon';
  }
  return icon;
}
