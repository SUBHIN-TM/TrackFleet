import axios from 'axios';

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:4004',
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('tf_admin_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('tf_admin_token');
      localStorage.removeItem('tf_admin_user');
      // BASE_URL is '/' in dev and '/admin/' under the production subpath.
      if (!location.pathname.includes('/login')) location.href = `${import.meta.env.BASE_URL}login`;
    }
    return Promise.reject(err);
  }
);
