import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import Icon from '../components/Icons';
import { inputCls } from '../components/Modal';
import useAuthStore from '../store/authStore';
import useSettings from '../store/settingsStore';
import useUi from '../store/uiStore';
import { apiUrl } from '../lib/apiUrl';
import { db } from '../lib/db';
import { saveEvent } from '../lib/data';
import { exportIcs, parseIcs } from '../lib/ics';
import { syncNow, useSyncStore } from '../lib/sync';
import { usePendingCount, useCalendars } from '../lib/hooks';
import {
  semverGt, getPlatform, getCurrentVersion, fetchLatestRelease, getDownloadUrl, installUpdate,
} from '../lib/updateCheck';

function Section({ title, children }) {
  return (
    <section className="mb-8">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-neutral-500">{title}</h2>
      <div className="space-y-4 rounded-2xl border border-neutral-200 p-4 dark:border-neutral-800">{children}</div>
    </section>
  );
}

function Field({ label, hint, children }) {
  return (
    <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <div className="min-w-0">
        <div className="text-sm font-medium">{label}</div>
        {hint && <div className="text-xs text-neutral-500">{hint}</div>}
      </div>
      <div className="flex-shrink-0">{children}</div>
    </div>
  );
}

function UpdateSection() {
  const { t } = useTranslation();
  const [platform] = useState(getPlatform);
  const [currentVersion, setCurrentVersion] = useState(null);
  const [release, setRelease] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [installing, setInstalling] = useState(false);

  const check = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setCurrentVersion(await getCurrentVersion(platform));
      setRelease(await fetchLatestRelease());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [platform]);
  useEffect(() => { check(); }, [check]);

  const latest = release?.tag_name?.replace(/^v/, '');
  const hasUpdate = currentVersion && latest && semverGt(latest, currentVersion);

  return (
    <Section title={t('updates.title')}>
      {loading && <p className="text-sm text-neutral-400">{t('updates.checking')}</p>}
      {error && !loading && <p className="text-sm text-neutral-500">{t('updates.error')}: {error}</p>}
      {!loading && !error && release && (
        <div className="space-y-2 text-sm">
          {platform !== 'web' && currentVersion && (
            <div className="flex justify-between"><span className="text-neutral-500">{t('updates.installed')}</span><span className="font-medium">v{currentVersion}</span></div>
          )}
          <div className="flex justify-between"><span className="text-neutral-500">{t('updates.latest')}</span><span className="font-medium">{release.tag_name}</span></div>
          <div className={`rounded-lg px-3 py-2 font-medium ${hasUpdate ? 'bg-amber-500/10 text-amber-600' : 'bg-green-500/10 text-green-600'}`}>
            {hasUpdate ? t('updates.updateAvailable') : t('updates.upToDate')}
          </div>
          {platform !== 'web' && hasUpdate && (
            <button
              onClick={() => {
                const url = getDownloadUrl(release, platform);
                if (!url) return;
                setInstalling(true);
                installUpdate(platform, url, latest);
              }}
              disabled={installing}
              className="w-full rounded-lg bg-accent px-3 py-2 font-medium text-white hover:bg-accent-dark disabled:opacity-50"
            >
              {installing ? t('updates.downloading') : t('updates.install')}
            </button>
          )}
          {platform === 'web' && (
            <a href={release.html_url} target="_blank" rel="noopener noreferrer" className="block rounded-lg bg-neutral-100 px-3 py-2 text-center font-medium hover:bg-neutral-200 dark:bg-neutral-800 dark:hover:bg-neutral-700">
              {t('updates.viewRelease')}
            </a>
          )}
        </div>
      )}
      <button onClick={check} disabled={loading} className="text-xs text-neutral-500 hover:text-neutral-800 disabled:opacity-40 dark:hover:text-neutral-200">
        {t('updates.refresh')}
      </button>
    </Section>
  );
}

export default function Settings() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const settings = useSettings();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const toast = useUi((s) => s.toast);
  const calendars = useCalendars();
  const pending = usePendingCount();
  const syncStatus = useSyncStore((s) => s.status);
  const lastSync = useSyncStore((s) => s.lastSync);
  const fileRef = useRef(null);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [pwMessage, setPwMessage] = useState(null);
  const [importCal, setImportCal] = useState('');
  const [notifPerm, setNotifPerm] = useState(typeof Notification !== 'undefined' ? Notification.permission : 'unsupported');

  useEffect(() => {
    if (!importCal && calendars.length) setImportCal((calendars.find((c) => c.is_default) || calendars[0]).id);
  }, [calendars, importCal]);

  function changeLanguage(lng) {
    i18n.changeLanguage(lng);
    localStorage.setItem('language', lng);
  }

  async function handleChangePassword(e) {
    e.preventDefault();
    setPwMessage(null);
    try {
      const res = await fetch(apiUrl('/api/auth/change-password'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json().catch(() => ({}));
      setPwMessage({ ok: res.ok, text: res.ok ? t('settings.saved') : data.error || t('common.error') });
      if (res.ok) {
        setCurrentPassword('');
        setNewPassword('');
      }
    } catch {
      setPwMessage({ ok: false, text: t('auth.needsConnection') });
    }
  }

  async function handleExport() {
    const events = await db.events.where('is_deleted').equals(0).toArray();
    const text = exportIcs(events, calendars);
    const url = URL.createObjectURL(new Blob([text], { type: 'text/calendar;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'quarc-calendar.ics';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function handleImport(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !importCal) return;
    try {
      const { events, skipped } = parseIcs(await file.text(), importCal);
      for (const ev of events) await saveEvent(ev);
      toast(t('settings.imported', { count: events.length }) + (skipped ? ` (${t('settings.skipped', { count: skipped })})` : ''));
    } catch (err) {
      toast(`${t('common.error')}: ${err.message}`);
    }
  }

  async function requestNotifications() {
    if (typeof Notification === 'undefined') return;
    setNotifPerm(await Notification.requestPermission());
  }

  async function handleLogout() {
    const ok = await logout();
    if (ok === false) {
      // Unsynced changes exist: try once to upload them, otherwise confirm.
      await syncNow();
      if ((await db.outbox.count()) > 0 && !window.confirm(t('settings.logoutPendingConfirm', { count: await db.outbox.count() }))) return;
      await logout({ force: true });
    }
    navigate('/login');
  }

  const selectCls = `${inputCls} !w-auto`;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl px-4 py-6 pt-[max(1.5rem,env(safe-area-inset-top))] sm:px-6">
        <div className="mb-6 flex items-center gap-3">
          <button onClick={() => navigate('/')} className="rounded-full p-2 hover:bg-neutral-100 dark:hover:bg-neutral-800" aria-label={t('common.back')}>
            <Icon name="chevronLeft" size={20} />
          </button>
          <h1 className="text-2xl font-semibold tracking-tight">{t('settings.title')}</h1>
        </div>

        <Section title={t('settings.account')}>
          <Field label={user?.username} hint={t('settings.sharedAccount')}>
            <button onClick={handleLogout} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40">
              <Icon name="logout" size={16} /> {t('settings.logout')}
            </button>
          </Field>
          <form onSubmit={handleChangePassword} className="flex flex-col gap-2 border-t border-neutral-200 pt-4 dark:border-neutral-800">
            <div className="text-sm font-medium">{t('auth.changePassword')}</div>
            <input type="password" autoComplete="current-password" placeholder={t('auth.currentPassword')} value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} className={inputCls} />
            <input type="password" autoComplete="new-password" placeholder={t('auth.newPassword')} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className={inputCls} />
            {pwMessage && <p className={`text-sm ${pwMessage.ok ? 'text-green-600' : 'text-red-500'}`}>{pwMessage.text}</p>}
            <button type="submit" disabled={!currentPassword || !newPassword} className="self-start rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-dark disabled:opacity-50">
              {t('auth.changePassword')}
            </button>
          </form>
        </Section>

        <Section title={t('settings.sync')}>
          <Field
            label={syncStatus === 'offline' ? t('sync.offline') : syncStatus === 'error' ? t('sync.error') : syncStatus === 'syncing' ? t('sync.syncing') : t('sync.synced')}
            hint={`${lastSync ? t('settings.lastSync', { time: lastSync.toLocaleTimeString() }) : ''}${pending ? ` ${t('sync.pending', { count: pending })}` : ''}`}
          >
            <button onClick={() => syncNow()} className="flex items-center gap-2 rounded-lg border border-neutral-300 px-3 py-2 text-sm font-medium hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800">
              <Icon name="refresh" size={16} /> {t('settings.syncNow')}
            </button>
          </Field>
          <p className="text-xs text-neutral-500">{t('settings.offlineExplain')}</p>
        </Section>

        <Section title={t('settings.appearance')}>
          <Field label={t('settings.language')}>
            <select value={i18n.language.slice(0, 2)} onChange={(e) => changeLanguage(e.target.value)} className={selectCls}>
              <option value="en">English</option>
              <option value="tr">Türkçe</option>
            </select>
          </Field>
          <Field label={t('settings.theme')}>
            <select value={settings.theme} onChange={(e) => settings.update({ theme: e.target.value })} className={selectCls}>
              <option value="dark">{t('settings.themeDark')}</option>
              <option value="light">{t('settings.themeLight')}</option>
              <option value="system">{t('settings.themeSystem')}</option>
            </select>
          </Field>
          <Field label={t('settings.weekStart')}>
            <select value={settings.weekStartsOn} onChange={(e) => settings.update({ weekStartsOn: Number(e.target.value) })} className={selectCls}>
              <option value={1}>{t('settings.monday')}</option>
              <option value={0}>{t('settings.sunday')}</option>
              <option value={6}>{t('settings.saturday')}</option>
            </select>
          </Field>
          <Field label={t('settings.timeFormat')}>
            <select value={settings.timeFormat} onChange={(e) => settings.update({ timeFormat: e.target.value })} className={selectCls}>
              <option value="auto">{t('settings.auto')}</option>
              <option value="24">24 h</option>
              <option value="12">12 h (AM/PM)</option>
            </select>
          </Field>
          <Field label={t('settings.defaultView')}>
            <select value={settings.defaultView} onChange={(e) => settings.update({ defaultView: e.target.value })} className={selectCls}>
              {['day', 'week', 'month', 'year', 'agenda'].map((v) => <option key={v} value={v}>{t(`views.${v}`)}</option>)}
            </select>
          </Field>
        </Section>

        <Section title={t('settings.events')}>
          <Field label={t('settings.defaultDuration')}>
            <select value={settings.defaultDuration} onChange={(e) => settings.update({ defaultDuration: Number(e.target.value) })} className={selectCls}>
              {[15, 30, 45, 60, 90, 120].map((m) => <option key={m} value={m}>{m} min</option>)}
            </select>
          </Field>
          <Field label={t('settings.defaultReminder')}>
            <select
              value={settings.defaultReminder ?? ''}
              onChange={(e) => settings.update({ defaultReminder: e.target.value === '' ? null : Number(e.target.value) })}
              className={selectCls}
            >
              <option value="">{t('settings.noReminder')}</option>
              {[0, 5, 10, 15, 30, 60].map((m) => <option key={m} value={m}>{m === 0 ? t('reminders.atStart') : `${m} min`}</option>)}
            </select>
          </Field>
          <Field label={t('settings.notifications')} hint={t('settings.notificationsHint')}>
            <div className="flex items-center gap-3">
              <input type="checkbox" checked={settings.notifications} onChange={(e) => settings.update({ notifications: e.target.checked })} className="h-4 w-4 accent-[#e5484d]" />
              {notifPerm === 'default' && (
                <button onClick={requestNotifications} className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs font-medium hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800">
                  {t('settings.allowNotifications')}
                </button>
              )}
              {notifPerm === 'denied' && <span className="text-xs text-neutral-500">{t('settings.notificationsBlocked')}</span>}
            </div>
          </Field>
        </Section>

        <Section title={t('settings.data')}>
          <Field label={t('settings.exportIcs')} hint={t('settings.exportHint')}>
            <button onClick={handleExport} className="flex items-center gap-2 rounded-lg border border-neutral-300 px-3 py-2 text-sm font-medium hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800">
              <Icon name="download" size={16} /> .ics
            </button>
          </Field>
          <Field label={t('settings.importIcs')} hint={t('settings.importHint')}>
            <div className="flex items-center gap-2">
              <select value={importCal} onChange={(e) => setImportCal(e.target.value)} className={`${selectCls} max-w-[9rem]`}>
                {calendars.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <button onClick={() => fileRef.current?.click()} className="flex items-center gap-2 rounded-lg border border-neutral-300 px-3 py-2 text-sm font-medium hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800">
                <Icon name="upload" size={16} /> .ics
              </button>
              <input ref={fileRef} type="file" accept=".ics,text/calendar" className="hidden" onChange={handleImport} />
            </div>
          </Field>
        </Section>

        <UpdateSection />

        <p className="pb-8 text-center text-xs text-neutral-400">Quarc Calendar</p>
      </div>
    </div>
  );
}
