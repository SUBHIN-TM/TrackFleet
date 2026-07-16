import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Box, Button, TextField, Typography, Alert, Stack } from '@mui/material';
import DirectionsBusRoundedIcon from '@mui/icons-material/DirectionsBusRounded';
import FavoriteRoundedIcon from '@mui/icons-material/FavoriteRounded';
import { useAuth } from '../lib/auth.jsx';

export default function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const [params] = useSearchParams();
  // The admin shares a link like /login?org=TF-INTERVAL&phone=98470… — prefill it.
  const [org, setOrg] = useState(() => (params.get('org') || '').toUpperCase());
  const [phone, setPhone] = useState(() => params.get('phone') || '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const prefilled = Boolean(params.get('org') && params.get('phone'));

  async function submit(e) {
    e.preventDefault();
    setError(''); setBusy(true);
    try { await login(org, phone, password); nav('/'); }
    catch (err) { setError(err.response?.data?.error || err.message || 'Login failed'); }
    finally { setBusy(false); }
  }

  const ready = org.trim() && phone.trim() && password;

  return (
    <Box sx={{ minHeight: '100vh', display: 'flex' }}>
      {/* Left brand panel */}
      <Box sx={{ flex: 1, display: { xs: 'none', md: 'flex' }, flexDirection: 'column', justifyContent: 'space-between', p: 6, color: '#fff', background: 'linear-gradient(150deg,#1d4ed8 0%,#3b82f6 45%,#60a5fa 100%)' }}>
        <Stack direction="row" spacing={1.5} alignItems="center">
          <Box sx={{ width: 40, height: 40, borderRadius: 2, display: 'grid', placeItems: 'center', bgcolor: 'rgba(255,255,255,.15)' }}>
            <DirectionsBusRoundedIcon />
          </Box>
          <Typography variant="h6" fontWeight={800}>TrackFleet</Typography>
        </Stack>
        <Box>
          <Typography variant="h3" fontWeight={800} sx={{ letterSpacing: '-0.03em', mb: 2 }}>Parent Portal</Typography>
          <Typography sx={{ opacity: 0.9, maxWidth: 420 }}>
            Follow your child’s ride in real time — see their stop, know when the bus is near, and travel with peace of mind.
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ opacity: 0.85 }}>
          <FavoriteRoundedIcon fontSize="small" />
          <Typography variant="body2">Safe journeys, every day</Typography>
        </Stack>
      </Box>

      {/* Right form */}
      <Box sx={{ flex: 1, display: 'grid', placeItems: 'center', p: 3, bgcolor: 'background.default' }}>
        <Box sx={{ width: '100%', maxWidth: 380 }}>
          <Typography variant="h4" mb={0.5}>Welcome</Typography>
          <Typography color="text.secondary" mb={3}>Sign in to follow your child’s ride</Typography>
          {prefilled && (
            <Alert severity="success" sx={{ mb: 2 }}>
              Details filled in from your invite — just add your password.
            </Alert>
          )}
          <form onSubmit={submit}>
            <Stack spacing={2}>
              {error && <Alert severity="error">{error}</Alert>}
              <TextField label="Organization ID" value={org} onChange={(e) => setOrg(e.target.value.toUpperCase())}
                placeholder="TF-INTERVAL" fullWidth size="medium" />
              <TextField label="Phone number" value={phone} onChange={(e) => setPhone(e.target.value)}
                placeholder="Your registered phone" fullWidth size="medium" />
              <TextField label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                autoFocus={prefilled} fullWidth size="medium" />
              <Button type="submit" variant="contained" size="large" disabled={busy || !ready} sx={{ py: 1.2 }}>
                {busy ? 'Signing in…' : 'Sign in'}
              </Button>
            </Stack>
          </form>
          <Typography variant="caption" color="text.secondary" display="block" mt={2}>
            Your organization gives you these details. Lost them? Ask your school/office admin to re-share.
          </Typography>
        </Box>
      </Box>
    </Box>
  );
}
