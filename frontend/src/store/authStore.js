import { create } from 'zustand';
import { apiUrl } from '../lib/apiUrl';
import { adoptUser } from '../lib/sync';
import { db, clearLocalData } from '../lib/db';
import { syncFromStore, watchStoreSession } from '../lib/storeSso';

// Login goes through the shared quarc-auth service (same account as every
// other Quarc app). The session lives in an httpOnly cookie; the last known
// user is cached in localStorage so the app still opens when offline.

const cachedUser = () => {
  try {
    return JSON.parse(localStorage.getItem('quarc_user') || 'null');
  } catch {
    return null;
  }
};

const useAuthStore = create((set, get) => ({
  user: cachedUser(),
  loading: true,

  async login(username, password) {
    const res = await fetch(apiUrl('/api/auth/login'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Login failed');
    }
    const user = await res.json();
    await adoptUser(user.id);
    localStorage.setItem('quarc_user', JSON.stringify(user));
    set({ user, loading: false });
    return user;
  },

  async register(username, password) {
    const res = await fetch(apiUrl('/api/auth/register'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Sign up failed');
    }
    await get().checkSession();
  },

  /**
   * Log out. Local data is wiped so the next person on this device doesn't
   * see it, but only if nothing is waiting to be uploaded (or `force`).
   */
  async logout({ force = false } = {}) {
    if (!force && (await db.outbox.count()) > 0) return false;
    await fetch(apiUrl('/api/auth/logout'), { method: 'POST', credentials: 'include' }).catch(() => {});
    localStorage.removeItem('quarc_user');
    await clearLocalData();
    set({ user: null, loading: false });
    return true;
  },

  /** Server says the session is gone (expired / revoked). Keep local data: it can still sync after re-login. */
  sessionLost() {
    localStorage.removeItem('quarc_user');
    set({ user: null, loading: false });
  },

  async checkSession() {
    // On Android, Quarc Store (if installed) is the primary login source:
    // this applies its sign-in/sign-out to this app's cookie, if it changed.
    await syncFromStore();
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(apiUrl('/api/auth/me'), { credentials: 'include', signal: controller.signal });
      clearTimeout(timeout);
      if (res.ok) {
        const user = await res.json();
        await adoptUser(user.id);
        localStorage.setItem('quarc_user', JSON.stringify(user));
        set({ user, loading: false });
      } else {
        localStorage.removeItem('quarc_user');
        set({ user: null, loading: false });
      }
    } catch {
      // Network error / offline: fall back to the last cached user rather than
      // logging out, so the app stays fully usable without a connection.
      set({ user: get().user, loading: false });
    }
  },
}));

// Signing in/out in Quarc Store applies as soon as the user switches back here.
watchStoreSession(() => useAuthStore.getState().checkSession());

export default useAuthStore;
