import axios from 'axios';

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:4004',
});

// Attach the parent's JWT to every request if we have one.
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('tf_parent_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// On 401, clear the session and bounce to login.
api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('tf_parent_token');
      localStorage.removeItem('tf_parent_user');
      // BASE_URL is '/' in dev and '/guardian/' under the production subpath.
      if (!location.pathname.includes('/login')) location.href = `${import.meta.env.BASE_URL}login`;
    }
    return Promise.reject(err);
  }
);
