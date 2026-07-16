import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { CssBaseline, ThemeProvider } from '@mui/material';
import { AuthProvider, useAuth } from './lib/auth.jsx';
import theme from './theme.js';
import Login from './pages/Login.jsx';
import Shell from './pages/Shell.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Vehicles from './pages/Vehicles.jsx';
import Drivers from './pages/Drivers.jsx';
import Passengers from './pages/Passengers.jsx';
import RoutesPage from './pages/RoutesPage.jsx';
import Schedules from './pages/Schedules.jsx';
import LiveToday from './pages/LiveToday.jsx';

function Protected({ children }) {
  const { user } = useAuth();
  return user ? children : <Navigate to="/login" replace />;
}

// '/' in dev; '/admin' when built for the production subpath.
const BASENAME = import.meta.env.BASE_URL.replace(/\/$/, '') || '/';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <AuthProvider>
        <BrowserRouter basename={BASENAME}>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/" element={<Protected><Shell /></Protected>}>
              <Route index element={<Dashboard />} />
              <Route path="vehicles" element={<Vehicles />} />
              <Route path="drivers" element={<Drivers />} />
              <Route path="passengers" element={<Passengers />} />
              <Route path="routes" element={<RoutesPage />} />
              <Route path="schedules" element={<Schedules />} />
              <Route path="live" element={<LiveToday />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </ThemeProvider>
  </React.StrictMode>
);
