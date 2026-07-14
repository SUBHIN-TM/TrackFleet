import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, Button, TextField, Typography, Alert, Stack } from '@mui/material';
import DirectionsBusRoundedIcon from '@mui/icons-material/DirectionsBusRounded';
import SchoolRoundedIcon from '@mui/icons-material/SchoolRounded';
import { useAuth } from '../lib/auth.jsx';

export default function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const [tenantSlug, setTenantSlug] = useState('greenvalley');
  const [email, setEmail] = useState('admin@greenvalley.com');
  const [password, setPassword] = useState('secret123');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError(''); setBusy(true);
    try { await login(email, password, tenantSlug); nav('/'); }
    catch (err) { setError(err.response?.data?.error || err.message || 'Login failed'); }
    finally { setBusy(false); }
  }

  return (
    <Box sx={{ minHeight: '100vh', display: 'flex' }}>
      <Box sx={{ flex: 1, display: { xs: 'none', md: 'flex' }, flexDirection: 'column', justifyContent: 'space-between', p: 6, color: '#fff', background: 'linear-gradient(150deg,#1d4ed8 0%,#2f6df6 45%,#38bdf8 100%)' }}>
        <Stack direction="row" spacing={1.5} alignItems="center">
          <Box sx={{ width: 40, height: 40, borderRadius: 2, display: 'grid', placeItems: 'center', bgcolor: 'rgba(255,255,255,.15)' }}>
            <DirectionsBusRoundedIcon />
          </Box>
          <Typography variant="h6" fontWeight={800}>TrackFleet</Typography>
        </Stack>
        <Box>
          <Typography variant="h3" fontWeight={800} sx={{ letterSpacing: '-0.03em', mb: 2 }}>School Admin</Typography>
          <Typography sx={{ opacity: 0.9, maxWidth: 420 }}>
            Manage your buses, drivers, students and routes — and track every trip live from one dashboard.
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ opacity: 0.85 }}>
          <SchoolRoundedIcon fontSize="small" />
          <Typography variant="body2">Organization portal</Typography>
        </Stack>
      </Box>

      <Box sx={{ flex: 1, display: 'grid', placeItems: 'center', p: 3, bgcolor: 'background.default' }}>
        <Box sx={{ width: '100%', maxWidth: 380 }}>
          <Typography variant="h4" mb={0.5}>Welcome back</Typography>
          <Typography color="text.secondary" mb={3}>Sign in to your school portal</Typography>
          <form onSubmit={submit}>
            <Stack spacing={2}>
              {error && <Alert severity="error">{error}</Alert>}
              <TextField label="School ID" value={tenantSlug} onChange={(e) => setTenantSlug(e.target.value)} fullWidth size="medium" helperText="your organization's portal id" />
              <TextField label="Email" value={email} onChange={(e) => setEmail(e.target.value)} fullWidth size="medium" />
              <TextField label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} fullWidth size="medium" />
              <Button type="submit" variant="contained" size="large" disabled={busy} sx={{ py: 1.2 }}>{busy ? 'Signing in…' : 'Sign in'}</Button>
            </Stack>
          </form>
        </Box>
      </Box>
    </Box>
  );
}
