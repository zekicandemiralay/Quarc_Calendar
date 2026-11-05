import { useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import useAuthStore from './store/authStore';
import useSettings, { applyTheme } from './store/settingsStore';
import { setAuthLostHandler, startSyncLoop, syncNow } from './lib/sync';
import { ensureDefaultCalendar } from './lib/data';
import { startReminders } from './lib/reminders';
import Login from './pages/Login';
import CalendarPage from './pages/CalendarPage';
import Settings from './pages/Settings';
import { Toasts } from './components/Dialogs';

function ProtectedRoute({ children }) {
  const { user, loading } = useAuthStore();
  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <img src="/logo.png" alt="" className="h-16 w-16 animate-pulse rounded-2xl" />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  const { t } = useTranslation();
  const checkSession = useAuthStore((s) => s.checkSession);
  const user = useAuthStore((s) => s.user);
  const theme = useSettings((s) => s.theme);

  useEffect(() => {
    checkSession();
  }, [checkSession]);

  // Theme (and follow the OS when set to "system")
  useEffect(() => {
    applyTheme(theme);
    if (theme !== 'system') return undefined;
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const on = () => applyTheme('system');
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [theme]);

  // Everything that runs while logged in: local-first sync and reminders.
  useEffect(() => {
    if (!user) return undefined;
    // If the server rejects our session, re-check it: a real expiry sends us to the login page
    // (local data is kept and will sync after logging back in).
    setAuthLostHandler(() => useAuthStore.getState().checkSession());
    const stopSync = startSyncLoop();
    // After the first sync attempt (online or not), a brand-new account gets its default calendar.
    syncNow().finally(() => ensureDefaultCalendar(user).catch(() => {}));
    const stopReminders = startReminders(t);
    return () => {
      stopSync();
      stopReminders();
    };
  }, [user, t]);

  return (
    <>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<ProtectedRoute><CalendarPage /></ProtectedRoute>} />
        <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <Toasts />
    </>
  );
}
