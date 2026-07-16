import { createContext, useContext, useEffect, useState } from 'react';
import { api } from './api.js';

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    const raw = localStorage.getItem('tf_parent_user');
    return raw ? JSON.parse(raw) : null;
  });

  // Refresh the cached user once on load if we hold a token.
  useEffect(() => {
    if (!localStorage.getItem('tf_parent_token')) return;
    api.get('/api/auth/me')
      .then(({ data }) => {
        localStorage.setItem('tf_parent_user', JSON.stringify(data.user));
        setUser(data.user);
      })
      .catch(() => {});
  }, []);

  // Parents sign in with org + phone + password. The phone is their loginId, so
  // login goes straight to DONE (no email OTP, no forced password change).
  async function login(org, phone, password) {
    const { data } = await api.post('/api/auth/login', {
      tenantSlug: org.trim(),
      loginId: phone.trim(),
      password,
    });
    if (data.step && data.step !== 'DONE') {
      throw new Error('Couldn’t sign in. Please contact your organization.');
    }
    if (data.user.role !== 'GUARDIAN') {
      throw new Error('This portal is for parents/guardians.');
    }
    localStorage.setItem('tf_parent_token', data.token);
    localStorage.setItem('tf_parent_user', JSON.stringify(data.user));
    setUser(data.user);
  }

  function logout() {
    localStorage.removeItem('tf_parent_token');
    localStorage.removeItem('tf_parent_user');
    setUser(null);
  }

  return <AuthCtx.Provider value={{ user, login, logout }}>{children}</AuthCtx.Provider>;
}

export const useAuth = () => useContext(AuthCtx);
