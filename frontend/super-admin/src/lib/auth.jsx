import { createContext, useContext, useState } from 'react';
import { api } from './api.js';
import { closeLiveSocket } from './liveSocket.js';

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    const raw = localStorage.getItem('tf_user');
    return raw ? JSON.parse(raw) : null;
  });

  async function login(email, password) {
    const { data } = await api.post('/api/auth/login', { email, password });
    if (data.user.role !== 'SUPER_ADMIN') {
      throw new Error('This console is for platform (super) admins only.');
    }
    localStorage.setItem('tf_token', data.token);
    localStorage.setItem('tf_user', JSON.stringify(data.user));
    setUser(data.user);
  }

  function logout() {
    localStorage.removeItem('tf_token');
    localStorage.removeItem('tf_user');
    // The live socket was authorized as THIS user at handshake time and still
    // sits in their trip rooms. Dropping the token doesn't close it.
    closeLiveSocket();
    setUser(null);
  }

  return <AuthCtx.Provider value={{ user, login, logout }}>{children}</AuthCtx.Provider>;
}

export const useAuth = () => useContext(AuthCtx);
