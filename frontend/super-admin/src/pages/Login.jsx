import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, Button, TextField, Typography, Alert, Stack, IconButton, InputAdornment } from '@mui/material';
import DirectionsBusRoundedIcon from '@mui/icons-material/DirectionsBusRounded';
import ShieldRoundedIcon from '@mui/icons-material/ShieldRounded';
import Visibility from '@mui/icons-material/Visibility';
import VisibilityOff from '@mui/icons-material/VisibilityOff';
import { useAuth } from '../lib/auth.jsx';

export default function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  // Prefill dev credentials only in dev builds — production must start blank.
  const [email, setEmail] = useState(import.meta.env.DEV ? 'super@trackfleet.local' : '');
  const [password, setPassword] = useState(import.meta.env.DEV ? 'admin123' : '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [showPw, setShowPw] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError(''); setBusy(true);
    try { await login(email.trim(), password); nav('/'); }
    catch (err) { setError(err.response?.data?.error || err.message || 'Login failed'); }
    finally { setBusy(false); }
  }

  return (
    <Box sx={{ minHeight: '100vh', display: 'flex' }}>
      {/* Left brand panel */}
      <Box sx={{ flex: 1, display: { xs: 'none', md: 'flex' }, flexDirection: 'column', justifyContent: 'space-between', p: 6, color: '#fff', background: 'linear-gradient(150deg,#1f9d4e 0%,#2eb85c 45%,#4fd07a 100%)' }}>
        <Stack direction="row" spacing={1.5} alignItems="center">
          <Box sx={{ width: 40, height: 40, borderRadius: 2, display: 'grid', placeItems: 'center', bgcolor: 'rgba(255,255,255,.15)' }}>
            <DirectionsBusRoundedIcon />
          </Box>
          <Typography variant="h6" fontWeight={800}>TrackFleet</Typography>
        </Stack>
        <Box>
          <Typography variant="h3" fontWeight={800} sx={{ letterSpacing: '-0.03em', mb: 2 }}>Platform Console</Typography>
          <Typography sx={{ opacity: 0.9, maxWidth: 420 }}>
            Provision organizations, control feature access, and manage every one on your fleet-tracking platform — from one place.
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ opacity: 0.85 }}>
          <ShieldRoundedIcon fontSize="small" />
          <Typography variant="body2">Super-admin access · multi-tenant SaaS</Typography>
        </Stack>
      </Box>

      {/* Right form */}
      <Box sx={{ flex: 1, display: 'grid', placeItems: 'center', p: 3, bgcolor: 'background.default' }}>
        <Box sx={{ width: '100%', maxWidth: 380 }}>
          <Typography variant="h4" mb={0.5}>Welcome back</Typography>
          <Typography color="text.secondary" mb={3}>Sign in to the platform console</Typography>
          <form onSubmit={submit}>
            <Stack spacing={2}>
              {error && <Alert severity="error">{error}</Alert>}
              <TextField label="Email" value={email} onChange={(e) => setEmail(e.target.value)} fullWidth size="medium" />
              <TextField label="Password" type={showPw ? 'text' : 'password'} value={password}
                onChange={(e) => setPassword(e.target.value)} fullWidth size="medium"
                InputProps={{
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton onClick={() => setShowPw((s) => !s)} edge="end" tabIndex={-1}
                        aria-label={showPw ? 'Hide password' : 'Show password'}>
                        {showPw ? <VisibilityOff /> : <Visibility />}
                      </IconButton>
                    </InputAdornment>
                  ),
                }} />
              <Button type="submit" variant="contained" size="large" disabled={busy} sx={{ py: 1.2 }}>
                {busy ? 'Signing in…' : 'Sign in'}
              </Button>
            </Stack>
          </form>
        </Box>
      </Box>
    </Box>
  );
}
