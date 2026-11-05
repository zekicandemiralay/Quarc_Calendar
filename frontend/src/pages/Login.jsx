import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import useAuthStore from '../store/authStore';

export default function Login() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const login = useAuthStore((s) => s.login);
  const register = useAuthStore((s) => s.register);
  const [mode, setMode] = useState('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to="/" replace />;

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (mode === 'login') await login(username, password);
      else await register(username, password);
      navigate('/');
    } catch (err) {
      // fetch() rejects with a TypeError when there is no connection at all
      setError(err instanceof TypeError ? t('auth.needsConnection') : err.message);
    } finally {
      setBusy(false);
    }
  }

  const field =
    'rounded-lg border border-neutral-300 bg-transparent px-3 py-2.5 outline-none focus:border-accent focus:ring-1 focus:ring-accent dark:border-neutral-700';

  return (
    <div className="flex h-full items-center justify-center bg-gradient-to-br from-neutral-100 to-neutral-200 px-4 dark:from-neutral-950 dark:to-neutral-900">
      <div className="w-full max-w-sm rounded-3xl bg-white p-8 shadow-xl dark:bg-neutral-900 dark:ring-1 dark:ring-neutral-800">
        <div className="mb-6 flex flex-col items-center gap-3">
          <img src="/logo.png" alt="Quarc Calendar" className="h-20 w-20 rounded-2xl shadow-md" />
          <div className="text-center">
            <h1 className="text-xl font-semibold tracking-tight">Quarc Calendar</h1>
            <p className="mt-1 text-sm text-neutral-500">{t('auth.signInToAccount')}</p>
          </div>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <input
            className={field}
            placeholder={t('auth.username')}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoCapitalize="none"
            autoFocus
          />
          <input
            className={field}
            placeholder={t('auth.password')}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          />
          {error && <p className="text-sm text-red-500">{error}</p>}
          <button
            type="submit"
            disabled={busy || !username || !password}
            className="mt-2 rounded-lg bg-accent px-3 py-2.5 font-medium text-white hover:bg-accent-dark disabled:opacity-50"
          >
            {mode === 'login' ? t('auth.login') : t('auth.signup')}
          </button>
        </form>
        <button className="mt-4 w-full text-center text-sm text-neutral-500 hover:underline" onClick={() => setMode(mode === 'login' ? 'signup' : 'login')}>
          {mode === 'login' ? t('auth.needAccount') : t('auth.haveAccount')}
        </button>
      </div>
    </div>
  );
}
