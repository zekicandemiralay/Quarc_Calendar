import { useEffect } from 'react';
import Icon from './Icons';

/**
 * Centered dialog on desktop, bottom sheet on phones. Closes on Escape and
 * backdrop click. `footer` sticks to the bottom so actions stay reachable.
 */
export default function Modal({ title, onClose, children, footer, width = 'max-w-lg', labelledBy }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-labelledby={labelledBy}>
      <div className="absolute inset-0 animate-fade bg-black/50" onClick={onClose} />
      <div className={`relative flex max-h-[92vh] w-full ${width} animate-pop flex-col rounded-t-2xl bg-white shadow-2xl dark:bg-neutral-900 sm:rounded-2xl dark:sm:border dark:sm:border-neutral-800`}>
        {title !== null && (
          <div className="flex items-center justify-between gap-3 px-5 pb-1 pt-4">
            <h2 id={labelledBy} className="truncate text-base font-semibold">{title}</h2>
            <button onClick={onClose} className="rounded-full p-1.5 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800" aria-label="Close">
              <Icon name="x" />
            </button>
          </div>
        )}
        <div className="flex-1 overflow-y-auto px-5 py-3">{children}</div>
        {footer && (
          <div className="flex items-center justify-end gap-2 border-t border-neutral-200 px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] dark:border-neutral-800">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

export const btnPrimary =
  'rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-dark disabled:opacity-50';
export const btnGhost =
  'rounded-lg px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-800';
export const btnDanger =
  'rounded-lg px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40';
export const inputCls =
  'w-full rounded-lg border border-neutral-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-accent focus:ring-1 focus:ring-accent dark:border-neutral-700';
