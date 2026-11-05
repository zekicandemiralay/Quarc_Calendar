import { useMemo } from 'react';
import { format } from 'date-fns';
import { enUS, tr } from 'date-fns/locale';
import { useTranslation } from 'react-i18next';
import useSettings from '../store/settingsStore';

const LOCALES = { en: enUS, tr };

/** Locale-aware date/time formatting that follows the user's settings. */
export default function useFmt() {
  const { i18n } = useTranslation();
  const timeFormat = useSettings((s) => s.timeFormat);
  const weekStartsOn = useSettings((s) => s.weekStartsOn);
  const lang = (i18n.language || 'en').slice(0, 2);

  return useMemo(() => {
    const locale = LOCALES[lang] || enUS;
    const h12 = timeFormat === 'auto' ? lang === 'en' : timeFormat === '12';
    const f = (d, pattern) => format(d, pattern, { locale });
    return {
      locale,
      lang,
      h12,
      weekStartsOn,
      f,
      time: (d) => (h12 ? f(d, 'h:mm a') : f(d, 'HH:mm')),
      // Compact label for the hour gutter: "9 AM" / "09:00"
      hour: (h) => {
        const d = new Date(2000, 0, 1, h);
        return h12 ? f(d, 'h a') : f(d, 'HH:mm');
      },
      weekdayNames: Array.from({ length: 7 }, (_, i) => f(new Date(2024, 0, 7 + i), 'EEEE')), // index 0 = Sunday
      weekdayShort: Array.from({ length: 7 }, (_, i) => f(new Date(2024, 0, 7 + i), 'EEE')),
    };
  }, [lang, timeFormat, weekStartsOn]);
}
