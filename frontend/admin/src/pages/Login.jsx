import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Box, Button, TextField, Typography, Alert, Stack, Link, CircularProgress } from '@mui/material';
import DirectionsBusRoundedIcon from '@mui/icons-material/DirectionsBusRounded';
import SchoolRoundedIcon from '@mui/icons-material/SchoolRounded';
import MarkEmailReadRoundedIcon from '@mui/icons-material/MarkEmailReadRounded';
import { useAuth } from '../lib/auth.jsx';
import { api } from '../lib/api.js';

// Steps:
//   CREDENTIALS  org id + email + password (from the welcome email)
//   VERIFY_EMAIL 6-digit code — first login only
//   SET_PASSWORD replace the emailed temp password
//   RESET        forgot-password: same code UI, ends in a new password
export default function Login() {
  const { login, establish } = useAuth();
  const nav = useNavigate();
  // Invite emails deep-link with ?org=TF-…&email=… so the admin only types the
  // temporary password. (The password is never in the link — it would leak via
  // history/logs.) Read once, at mount.
  const [params] = useSearchParams();

  const [step, setStep] = useState('CREDENTIALS');
  const [tenantSlug, setTenantSlug] = useState(() => (params.get('org') || '').toUpperCase());
  const [email, setEmail] = useState(() => params.get('email') || '');
  const [password, setPassword] = useState('');
  // Arrived from an invite link with both fields filled — only the password is left.
  const prefilled = Boolean(params.get('org') && params.get('email'));

  const [challengeToken, setChallengeToken] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [name, setName] = useState('');

  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const fail = (err, fallback) =>
    setError(err.response?.data?.error || err.message || fallback);

  // Any step that ends with a token lands here.
  function finish(data) {
    establish(data);
    nav('/');
  }

  async function submitCredentials(e) {
    e.preventDefault();
    setError(''); setNotice(''); setBusy(true);
    try {
      const data = await login(email, password, tenantSlug);
      if (data.step === 'DONE') return nav('/');
      setChallengeToken(data.challengeToken);
      setStep(data.step); // VERIFY_EMAIL or SET_PASSWORD
      if (data.step === 'VERIFY_EMAIL') {
        setNotice(`We emailed a 6-digit code to ${data.email}. It expires in ${data.expiresInMinutes} minutes.`);
      }
    } catch (err) { fail(err, 'Login failed'); }
    finally { setBusy(false); }
  }

  async function submitOtp(e) {
    e.preventDefault();
    setError(''); setBusy(true);
    try {
      const { data } = await api.post('/api/auth/verify-otp', { challengeToken, code });
      if (data.step === 'DONE') return finish(data);
      setChallengeToken(data.challengeToken);
      setCode('');
      setStep('SET_PASSWORD');
      setNotice('Email confirmed. Now choose your own password.');
    } catch (err) { fail(err, 'Could not verify that code'); }
    finally { setBusy(false); }
  }

  async function submitNewPassword(e) {
    e.preventDefault();
    if (newPassword !== confirmPassword) return setError('Those passwords don’t match');
    setError(''); setBusy(true);
    try {
      const { data } = await api.post('/api/auth/set-password', {
        challengeToken, password: newPassword, ...(name.trim() ? { name: name.trim() } : {}),
      });
      finish(data);
    } catch (err) { fail(err, 'Could not set your password'); }
    finally { setBusy(false); }
  }

  // Forgot password — reuses the org id + email already typed above, so the
  // admin never retypes an address the super admin chose for them.
  async function startReset() {
    if (!email || !tenantSlug) {
      return setError('Enter your Organization ID and email first, then choose “Forgot password”.');
    }
    setError(''); setBusy(true);
    try {
      const { data } = await api.post('/api/auth/forgot-password', { email, tenantSlug });
      // A missing account answers ok:true with no challenge — say the same
      // thing either way so this can't be used to discover who has an account.
      if (!data.challengeToken) {
        setNotice(`If an account exists for ${email}, a reset code is on its way.`);
        return;
      }
      setChallengeToken(data.challengeToken);
      setStep('RESET');
      setNotice(`We emailed a reset code to ${email}. It expires in ${data.expiresInMinutes} minutes.`);
    } catch (err) { fail(err, 'Could not start a password reset'); }
    finally { setBusy(false); }
  }

  async function submitReset(e) {
    e.preventDefault();
    if (newPassword !== confirmPassword) return setError('Those passwords don’t match');
    setError(''); setBusy(true);
    try {
      const { data } = await api.post('/api/auth/reset-password', { challengeToken, code, password: newPassword });
      finish(data);
    } catch (err) { fail(err, 'Could not reset your password'); }
    finally { setBusy(false); }
  }

  async function resend(purpose) {
    setError(''); setBusy(true);
    try {
      await api.post('/api/auth/resend-otp', { challengeToken, purpose });
      setNotice('A new code is on its way.');
    } catch (err) { fail(err, 'Could not resend the code'); }
    finally { setBusy(false); }
  }

  function backToStart() {
    setStep('CREDENTIALS');
    setError(''); setNotice(''); setCode('');
    setNewPassword(''); setConfirmPassword(''); setChallengeToken('');
  }

  const heading = {
    CREDENTIALS: ['Welcome back', 'Sign in to your organization portal'],
    VERIFY_EMAIL: ['Check your email', 'Enter the 6-digit code we just sent'],
    SET_PASSWORD: ['Choose your password', 'Pick something only you know'],
    RESET: ['Reset your password', 'Enter the code we emailed, then a new password'],
  }[step];

  const codeField = (
    <TextField label="6-digit code" value={code} autoFocus
      onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
      fullWidth size="medium" placeholder="123456"
      inputProps={{ inputMode: 'numeric', style: { letterSpacing: 8, fontSize: 22, fontWeight: 700 } }} />
  );

  const newPasswordFields = (
    <>
      <TextField label="New password" type="password" value={newPassword}
        onChange={(e) => setNewPassword(e.target.value)} fullWidth size="medium"
        helperText="At least 8 characters" />
      <TextField label="Confirm new password" type="password" value={confirmPassword}
        onChange={(e) => setConfirmPassword(e.target.value)} fullWidth size="medium"
        error={!!confirmPassword && newPassword !== confirmPassword}
        helperText={confirmPassword && newPassword !== confirmPassword ? 'Passwords don’t match' : ' '} />
    </>
  );

  const canSetPassword = newPassword.length >= 8 && newPassword === confirmPassword;

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
          <Typography variant="h3" fontWeight={800} sx={{ letterSpacing: '-0.03em', mb: 2 }}>Organization Admin</Typography>
          <Typography sx={{ opacity: 0.9, maxWidth: 420 }}>
            Manage your buses, drivers, passengers and routes — and track every trip live from one dashboard.
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ opacity: 0.85 }}>
          <SchoolRoundedIcon fontSize="small" />
          <Typography variant="body2">Organization portal</Typography>
        </Stack>
      </Box>

      <Box sx={{ flex: 1, display: 'grid', placeItems: 'center', p: 3, bgcolor: 'background.default' }}>
        <Box sx={{ width: '100%', maxWidth: 380 }}>
          <Typography variant="h4" mb={0.5}>{heading[0]}</Typography>
          <Typography color="text.secondary" mb={3}>{heading[1]}</Typography>

          {step === 'CREDENTIALS' && (
            <form onSubmit={submitCredentials}>
              <Stack spacing={2}>
                {error && <Alert severity="error">{error}</Alert>}
                {notice && <Alert severity="info">{notice}</Alert>}
                {prefilled && !error && (
                  <Alert severity="success" icon={<MarkEmailReadRoundedIcon fontSize="inherit" />}>
                    Welcome! Just enter the temporary password from your invitation email.
                  </Alert>
                )}
                <TextField label="Organization ID" value={tenantSlug}
                  onChange={(e) => setTenantSlug(e.target.value.toUpperCase())} fullWidth size="medium"
                  placeholder="TF-GREENVALLEY" helperText="The ID on your welcome email, e.g. TF-GREENVALLEY"
                  inputProps={{ style: { textTransform: 'uppercase' }, autoCapitalize: 'characters', spellCheck: false }} />
                <TextField label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} fullWidth size="medium" />
                <TextField label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} fullWidth size="medium"
                  autoFocus={prefilled}
                  helperText={prefilled ? 'The temporary password from your invitation email' : ' '} />
                <Button type="submit" variant="contained" size="large" disabled={busy} sx={{ py: 1.2 }}>
                  {busy ? <CircularProgress size={22} color="inherit" /> : 'Sign in'}
                </Button>
                <Link component="button" type="button" underline="hover" onClick={startReset}
                  sx={{ alignSelf: 'center', fontSize: 14 }}>
                  Forgot password?
                </Link>
              </Stack>
            </form>
          )}

          {step === 'VERIFY_EMAIL' && (
            <form onSubmit={submitOtp}>
              <Stack spacing={2}>
                {error && <Alert severity="error">{error}</Alert>}
                {notice && <Alert severity="success" icon={<MarkEmailReadRoundedIcon fontSize="inherit" />}>{notice}</Alert>}
                {codeField}
                <Button type="submit" variant="contained" size="large" disabled={busy || code.length !== 6} sx={{ py: 1.2 }}>
                  {busy ? <CircularProgress size={22} color="inherit" /> : 'Verify'}
                </Button>
                <Stack direction="row" justifyContent="space-between">
                  <Link component="button" type="button" underline="hover" onClick={backToStart} sx={{ fontSize: 14 }}>Back</Link>
                  <Link component="button" type="button" underline="hover" onClick={() => resend('VERIFY_EMAIL')} sx={{ fontSize: 14 }}>Resend code</Link>
                </Stack>
              </Stack>
            </form>
          )}

          {step === 'SET_PASSWORD' && (
            <form onSubmit={submitNewPassword}>
              <Stack spacing={2}>
                {error && <Alert severity="error">{error}</Alert>}
                {notice && <Alert severity="success">{notice}</Alert>}
                <TextField label="Your name" value={name} onChange={(e) => setName(e.target.value)}
                  fullWidth size="medium" placeholder="e.g. Priya Kumar" helperText="Optional — shown across the app" />
                {newPasswordFields}
                <Button type="submit" variant="contained" size="large" disabled={busy || !canSetPassword} sx={{ py: 1.2 }}>
                  {busy ? <CircularProgress size={22} color="inherit" /> : 'Save and sign in'}
                </Button>
              </Stack>
            </form>
          )}

          {step === 'RESET' && (
            <form onSubmit={submitReset}>
              <Stack spacing={2}>
                {error && <Alert severity="error">{error}</Alert>}
                {notice && <Alert severity="success" icon={<MarkEmailReadRoundedIcon fontSize="inherit" />}>{notice}</Alert>}
                {codeField}
                {newPasswordFields}
                <Button type="submit" variant="contained" size="large" disabled={busy || code.length !== 6 || !canSetPassword} sx={{ py: 1.2 }}>
                  {busy ? <CircularProgress size={22} color="inherit" /> : 'Reset password'}
                </Button>
                <Stack direction="row" justifyContent="space-between">
                  <Link component="button" type="button" underline="hover" onClick={backToStart} sx={{ fontSize: 14 }}>Back</Link>
                  <Link component="button" type="button" underline="hover" onClick={() => resend('RESET_PASSWORD')} sx={{ fontSize: 14 }}>Resend code</Link>
                </Stack>
              </Stack>
            </form>
          )}
        </Box>
      </Box>
    </Box>
  );
}
