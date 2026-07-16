import { createContext, useContext, useEffect, useState } from 'react';
import { api } from './api.js';

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    const raw = localStorage.getItem('tf_admin_user');
    return raw ? JSON.parse(raw) : null;
  });

  // The cached user can be stale (e.g. missing the org name added server-side,
  // or a name changed elsewhere). If we hold a token, refresh from /me once on
  // load so the shell always has current details. A bad token 401s and the api
  // interceptor bounces to login.
  useEffect(() => {
    if (!localStorage.getItem('tf_admin_token')) return;
    api.get('/api/auth/me')
      .then(({ data }) => {
        localStorage.setItem('tf_admin_user', JSON.stringify(data.user));
        setUser(data.user);
      })
      .catch(() => {});
  }, []);

  // Login is multi-step: the API answers with a `step` and only hands over a
  // token once the mailbox is verified and a real password is set. Callers
  // drive the intermediate steps and call this when step === 'DONE'.
  function establish(data) {
    if (data.user.role !== 'TENANT_ADMIN') {
      throw new Error('This portal is for organization admins only.');
    }
    localStorage.setItem('tf_admin_token', data.token);
    localStorage.setItem('tf_admin_user', JSON.stringify(data.user));
    setUser(data.user);
  }

  // Returns the raw step response; only establishes a session if already DONE.
  async function login(email, password, tenantSlug) {
    const { data } = await api.post('/api/auth/login', { email, password, tenantSlug });
    if (data.step === 'DONE') establish(data);
    return data;
  }

  // Orgs are invited under a placeholder name ("Primary Admin"), so the real
  // person needs a way to correct it without asking the super admin.
  async function updateName(name) {
    const { data } = await api.patch('/api/auth/profile', { name });
    localStorage.setItem('tf_admin_user', JSON.stringify(data.user));
    setUser(data.user);
    return data.user;
  }

  function logout() {
    localStorage.removeItem('tf_admin_token');
    localStorage.removeItem('tf_admin_user');
    setUser(null);
  }

  return (
    <AuthCtx.Provider value={{ user, login, logout, establish, updateName }}>{children}</AuthCtx.Provider>
  );
}

export const useAuth = () => useContext(AuthCtx);
