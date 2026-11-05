import { useTranslation } from 'react-i18next';
import Icon from './Icons';
import { syncNow, useSyncStore } from '../lib/sync';
import { usePendingCount } from '../lib/hooks';
import { useIsCompact } from '../lib/compose';

/**
 * Shows connection / sync state: "Synced", "Syncing...", "Offline - 3 changes
 * saved on this device", or an error with tap-to-retry.
 */
export default function SyncBadge({ compact = false }) {
  const { t } = useTranslation();
  const status = useSyncStore((s) => s.status);
  const pending = usePendingCount();
  const phone = useIsCompact();

  let icon = 'cloudCheck';
  let label = t('sync.synced');
  let tone = 'text-neutral-500';

  if (status === 'syncing') {
    icon = 'refresh';
    label = t('sync.syncing');
  } else if (status === 'offline') {
    icon = 'cloudOff';
    label = pending ? t('sync.offlinePending', { count: pending }) : t('sync.offline');
    tone = 'text-amber-600 dark:text-amber-400';
  } else if (status === 'error') {
    icon = 'cloudOff';
    label = t('sync.error');
    tone = 'text-red-600 dark:text-red-400';
  } else if (status === 'auth') {
    icon = 'cloudOff';
    label = t('sync.signedOut');
    tone = 'text-red-600 dark:text-red-400';
  } else if (pending) {
    label = t('sync.pending', { count: pending });
    tone = 'text-amber-600 dark:text-amber-400';
  }

  // On phones the header is tight: only show the badge when something needs attention.
  if (phone && status === 'idle' && !pending) return null;

  return (
    <button
      onClick={() => syncNow()}
      title={label}
      aria-label={label}
      className={`flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-xs font-medium hover:bg-neutral-100 dark:hover:bg-neutral-800 ${tone}`}
    >
      <Icon name={icon} size={16} className={status === 'syncing' ? 'animate-spin' : ''} />
      {!compact && <span className="hidden md:inline">{label}</span>}
    </button>
  );
}
