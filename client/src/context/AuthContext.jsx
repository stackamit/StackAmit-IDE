import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { adminApi, getToken, setToken, toError } from '../services/admin.js';

const AuthContext = createContext(null);

/**
 * Admin session state. There is deliberately no "register" path — a single
 * admin is provisioned via server environment variables.
 */
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(Boolean(getToken()));

  const refresh = useCallback(async () => {
    if (!getToken()) {
      setUser(null);
      setLoading(false);
      return null;
    }
    try {
      const me = await adminApi.me();
      setUser(me);
      return me;
    } catch (err) {
      setToken(null);
      setUser(null);
      throw toError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh().catch(() => {});
  }, [refresh]);

  const login = useCallback(async (username, password) => {
    const data = await adminApi.login(username, password).catch((err) => {
      throw toError(err);
    });
    setUser({ authenticated: true, username: data.username });
    return data;
  }, []);

  const logout = useCallback(async () => {
    await adminApi.logout().catch(() => {});
    setUser(null);
  }, []);

  const value = useMemo(() => ({ user, loading, login, logout, refresh }), [user, loading, login, logout, refresh]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

export default AuthContext;
