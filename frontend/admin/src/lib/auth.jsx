import { createContext, useContext, useState } from 'react';
import { api } from './api.js';

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    const raw = localStorage.getItem('tf_admin_user');
    return raw ? JSON.parse(raw) : null;
  });

  // Tenant admins log in via their org's portal, which supplies the tenant slug.
  async function login(email, password, tenantSlug) {
    const { data } = await api.post('/api/auth/login', { email, password, tenantSlug });
    if (data.user.role !== 'TENANT_ADMIN') {
      throw new Error('This portal is for school (tenant) admins only.');
    }
    localStorage.setItem('tf_admin_token', data.token);
    localStorage.setItem('tf_admin_user', JSON.stringify(data.user));
    setUser(data.user);
  }

  function logout() {
    localStorage.removeItem('tf_admin_token');
    localStorage.removeItem('tf_admin_user');
    setUser(null);
  }

  return <AuthCtx.Provider value={{ user, login, logout }}>{children}</AuthCtx.Provider>;
}

export const useAuth = () => useContext(AuthCtx);
