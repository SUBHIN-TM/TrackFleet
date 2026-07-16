import { useEffect, useState } from 'react';
import {
  Box, Typography, Button, Card, Table, TableBody, TableCell, TableHead, TableRow,
  Chip, Dialog, DialogTitle, DialogContent, DialogActions, TextField, Stack, Alert,
  Tooltip, IconButton, Divider, Avatar,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import KeyOutlinedIcon from '@mui/icons-material/KeyOutlined';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import ArchiveOutlinedIcon from '@mui/icons-material/ArchiveOutlined';
import UnarchiveOutlinedIcon from '@mui/icons-material/UnarchiveOutlined';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined';
import VisibilityOffOutlinedIcon from '@mui/icons-material/VisibilityOffOutlined';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import PageHeader from '../components/PageHeader.jsx';

const empty = { name: '', phone: '', licenseNumber: '' };

// No 0/O/1/l/I — these get read off a screen and retyped by hand. Mirrors the
// backend's unambiguous alphabet so a suggested password looks consistent.
const PW_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
function suggestPassword(len = 12) {
  const a = new Uint32Array(len);
  (window.crypto || window.msCrypto).getRandomValues(a);
  return Array.from(a, (n) => PW_ALPHABET[n % PW_ALPHABET.length]).join('');
}

export default function Drivers() {
  const { user } = useAuth();
  const orgId = (user?.tenantSlug || '').toUpperCase();
  const [rows, setRows] = useState([]);
  const [error, setError] = useState('');

  // Add / edit share one dialog. `editing` holds the driver being edited (null = add).
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(empty);

  // Sign-in details panel — holds the driver whose credentials we're showing.
  const [creds, setCreds] = useState(null);
  // Which field label was just copied, for the transient check-mark feedback.
  const [copiedKey, setCopiedKey] = useState(null);
  // Password column starts hidden — reveal on demand to avoid shoulder-surfing.
  const [showPw, setShowPw] = useState(false);
  // Reset-password dialog: the driver being reset + the (editable, prefilled) value.
  const [resetFor, setResetFor] = useState(null);
  const [resetPw, setResetPw] = useState('');
  const [resetBusy, setResetBusy] = useState(false);
  const [resetErr, setResetErr] = useState('');

  async function load() {
    const { data } = await api.get('/api/drivers');
    setRows(data.drivers);
    // Keep an open details panel in sync after a reset regenerates the password.
    setCreds((c) => (c ? data.drivers.find((d) => d.id === c.id) || null : null));
  }
  useEffect(() => { load(); }, []);

  function openAdd() { setEditing(null); setForm(empty); setError(''); setFormOpen(true); }
  function openEdit(d) {
    setEditing(d);
    setForm({ name: d.name || '', email: d.email || '', phone: d.phone || '', licenseNumber: d.driverProfile?.licenseNumber || '' });
    setError(''); setFormOpen(true);
  }

  async function save() {
    setError('');
    try {
      if (editing) {
        await api.patch(`/api/drivers/${editing.id}`, {
          name: form.name, phone: form.phone, licenseNumber: form.licenseNumber,
        });
        setFormOpen(false); load();
      } else {
        const { data } = await api.post('/api/drivers', form);
        setFormOpen(false); setForm(empty);
        await load();
        // Jump straight into the sign-in details for the new driver.
        setCreds(data.driver);
      }
    } catch (err) { setError(err.response?.data?.error || 'Failed'); }
  }

  async function archive(d) { await api.delete(`/api/drivers/${d.id}`); load(); }
  async function restore(d) { await api.patch(`/api/drivers/${d.id}`, { status: 'ACTIVE' }); load(); }

  // Open the reset dialog with a fresh suggestion prefilled — the admin can keep
  // it or type their own.
  function openReset(d) {
    setResetFor(d); setResetPw(suggestPassword()); setResetErr('');
  }
  async function confirmReset() {
    if (resetPw.trim().length < 6) return setResetErr('Use at least 6 characters');
    setResetErr(''); setResetBusy(true);
    try {
      const { data } = await api.post(`/api/drivers/${resetFor.id}/reset-password`, { password: resetPw.trim() });
      // Keep an open details panel for the same driver in sync.
      setCreds((c) => (c && c.id === data.driver.id ? data.driver : c));
      setResetFor(null);
      load();
    } catch (err) {
      setResetErr(err.response?.data?.error || 'Failed');
    } finally { setResetBusy(false); }
  }

  function copy(key, value) {
    navigator.clipboard?.writeText(value);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 1500);
  }
  function copyAll() {
    if (!creds) return;
    copy('all', `Org ID: ${orgId}\nDriver ID: ${creds.loginId}\nPassword: ${creds.provisionalPassword || ''}`);
  }

  return (
    <Box>
      <PageHeader title="Drivers" crumbs={[{ label: 'Drivers' }]}
        action={<Button variant="contained" startIcon={<AddIcon />} onClick={openAdd}>Add Driver</Button>} />
      <Card>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell>
              <Tooltip title="The driver signs in with the Org ID + this Driver ID + their password — no email needed." arrow>
                <TableCell>Driver ID (login)</TableCell>
              </Tooltip>
              <TableCell>
                <Stack direction="row" alignItems="center" spacing={0.5}>
                  <Tooltip title="The driver's current password. You set and change it — the driver can't." arrow>
                    <span>Password</span>
                  </Tooltip>
                  <Tooltip title={showPw ? 'Hide passwords' : 'Reveal passwords'} arrow>
                    <IconButton size="small" onClick={() => setShowPw((v) => !v)}>
                      {showPw ? <VisibilityOffOutlinedIcon fontSize="small" /> : <VisibilityOutlinedIcon fontSize="small" />}
                    </IconButton>
                  </Tooltip>
                </Stack>
              </TableCell>
              <TableCell>Phone</TableCell>
              <TableCell>License</TableCell>
              <TableCell>Status</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((d) => {
              const disabled = d.status === 'DISABLED';
              return (
                <TableRow key={d.id} hover sx={disabled ? { opacity: 0.55 } : undefined}>
                  <TableCell><b>{d.name}</b></TableCell>
                  <TableCell><Chip size="small" label={d.loginId || '—'} sx={{ fontWeight: 700 }} /></TableCell>
                  <TableCell>
                    {!d.provisionalPassword ? (
                      <Button size="small" onClick={() => openReset(d)}>Set password</Button>
                    ) : showPw ? (
                      <Tooltip title={copiedKey === `row-${d.id}` ? 'Copied!' : 'Click to copy'} arrow>
                        <Box component="span" onClick={() => copy(`row-${d.id}`, d.provisionalPassword)}
                          sx={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontWeight: 700, cursor: 'pointer',
                            color: copiedKey === `row-${d.id}` ? 'success.main' : 'text.primary' }}>
                          {copiedKey === `row-${d.id}` ? 'Copied!' : d.provisionalPassword}
                        </Box>
                      </Tooltip>
                    ) : (
                      <Box component="span" sx={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontWeight: 700, letterSpacing: 2, color: 'text.secondary' }}>
                        ••••••••
                      </Box>
                    )}
                  </TableCell>
                  <TableCell>{d.phone || '—'}</TableCell>
                  <TableCell>{d.driverProfile?.licenseNumber || '—'}</TableCell>
                  <TableCell><Chip size="small" label={disabled ? 'archived' : d.status} color={disabled ? 'default' : 'success'} /></TableCell>
                  <TableCell align="right">
                    <Tooltip title="Sign-in details — copy the Org ID, Driver ID & password to hand over" arrow>
                      <IconButton size="small" onClick={() => setCreds(d)}><KeyOutlinedIcon fontSize="small" /></IconButton>
                    </Tooltip>
                    <Tooltip title="Edit driver" arrow>
                      <IconButton size="small" onClick={() => openEdit(d)}><EditOutlinedIcon fontSize="small" /></IconButton>
                    </Tooltip>
                    {disabled ? (
                      <Tooltip title="Restore — re-enable this driver's login" arrow>
                        <IconButton size="small" onClick={() => restore(d)}><UnarchiveOutlinedIcon fontSize="small" /></IconButton>
                      </Tooltip>
                    ) : (
                      <Tooltip title="Archive — disables sign-in but keeps trip history" arrow>
                        <IconButton size="small" onClick={() => archive(d)}><ArchiveOutlinedIcon fontSize="small" /></IconButton>
                      </Tooltip>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
            {rows.length === 0 && <TableRow><TableCell colSpan={7} align="center" sx={{ py: 5, color: 'text.secondary' }}>No drivers yet.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </Card>

      {/* Add / edit form — email optional, password auto-generated on add. */}
      <Dialog open={formOpen} onClose={() => setFormOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{editing ? 'Edit Driver' : 'Add Driver'}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} mt={1}>
            {error && <Alert severity="error">{error}</Alert>}
            {!editing && (
              <Alert severity="info" sx={{ py: 0.5 }}>
                We’ll assign a Driver ID and a password automatically — you can copy the sign-in details afterwards, anytime.
              </Alert>
            )}
            <TextField label="Full name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <TextField label="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            <TextField label="License number" value={form.licenseNumber} onChange={(e) => setForm({ ...form, licenseNumber: e.target.value })} />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setFormOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={save} disabled={form.name.trim().length < 2}>{editing ? 'Save' : 'Create'}</Button>
        </DialogActions>
      </Dialog>

      {/* Sign-in details — re-openable anytime, copyable. */}
      <Dialog open={!!creds} onClose={() => setCreds(null)} maxWidth="xs" fullWidth
        PaperProps={{ sx: { borderRadius: 4, overflow: 'hidden' } }}>
        <DialogTitle sx={{ pb: 1.5 }}>
          <Stack direction="row" spacing={1.5} alignItems="center">
            <Avatar sx={{ bgcolor: 'primary.light', color: 'primary.main', width: 40, height: 40 }}>
              <KeyOutlinedIcon />
            </Avatar>
            <Box sx={{ minWidth: 0 }}>
              <Typography fontWeight={800} noWrap>Sign-in details</Typography>
              <Typography variant="caption" color="text.secondary" noWrap>{creds?.name}</Typography>
            </Box>
          </Stack>
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2}>
            <Typography variant="body2" color="text.secondary">
              Share these three values with the driver to sign in on the driver app.
            </Typography>

            <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 3, overflow: 'hidden', bgcolor: '#fbfbfe' }}>
              <CredRow label="Organization ID" value={orgId}
                onCopy={() => copy('org', orgId)} copied={copiedKey === 'org'} />
              <Divider />
              <CredRow label="Driver ID" value={creds?.loginId}
                onCopy={() => copy('driver', creds?.loginId)} copied={copiedKey === 'driver'} />
              <Divider />
              <CredRow label="Password" value={creds?.provisionalPassword}
                onCopy={() => copy('pass', creds?.provisionalPassword)} copied={copiedKey === 'pass'} />
            </Box>

            <Button variant="outlined" fullWidth
              startIcon={copiedKey === 'all' ? <CheckRoundedIcon /> : <ContentCopyIcon />}
              onClick={copyAll} sx={{ borderRadius: 2.5, py: 1 }}>
              {copiedKey === 'all' ? 'Copied all details' : 'Copy all'}
            </Button>

            <Typography variant="caption" color="text.secondary" sx={{ textAlign: 'center' }}>
              You control this password — the driver can’t change it. Use “Reset password” to issue a new one.
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5, pt: 1, justifyContent: 'space-between' }}>
          <Button startIcon={<RestartAltIcon />} color="warning" onClick={() => creds && openReset(creds)}>
            Reset password
          </Button>
          <Button variant="contained" onClick={() => setCreds(null)} sx={{ borderRadius: 2.5, px: 3 }}>
            Done
          </Button>
        </DialogActions>
      </Dialog>

      {/* Reset password — prefilled with a suggestion the admin can keep or edit. */}
      <Dialog open={!!resetFor} onClose={() => setResetFor(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Reset password — {resetFor?.name}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} mt={1}>
            {resetErr && <Alert severity="error">{resetErr}</Alert>}
            <Typography variant="body2" color="text.secondary">
              Keep this suggested password, or type your own. The driver signs in with it.
            </Typography>
            <TextField autoFocus fullWidth label="New password" value={resetPw}
              onChange={(e) => setResetPw(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && resetPw.trim().length >= 6) confirmReset(); }}
              helperText="At least 6 characters."
              InputProps={{
                sx: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontWeight: 700 },
                endAdornment: (
                  <Tooltip title="Suggest another" arrow>
                    <IconButton edge="end" onClick={() => setResetPw(suggestPassword())}>
                      <RestartAltIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                ),
              }} />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setResetFor(null)}>Cancel</Button>
          <Button variant="contained" onClick={confirmReset} disabled={resetBusy || resetPw.trim().length < 6}>
            {resetBusy ? 'Saving…' : 'Set password'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

// One credential row: label stacked above the value, with an inline copy button
// that sits in its own column — never overlapping the value, even a long one.
function CredRow({ label, value, onCopy, copied, muted }) {
  return (
    <Stack direction="row" alignItems="center" spacing={1} sx={{ px: 2, py: 1.5 }}>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography sx={{ textTransform: 'uppercase', letterSpacing: 0.5, fontSize: 11, fontWeight: 700, color: 'text.secondary' }}>
          {label}
        </Typography>
        <Typography sx={{
          fontFamily: muted ? undefined : 'ui-monospace, SFMono-Regular, Menlo, monospace',
          fontStyle: muted ? 'italic' : 'normal',
          fontWeight: muted ? 500 : 700, fontSize: muted ? 14 : 15.5,
          color: muted ? 'text.secondary' : 'text.primary', wordBreak: 'break-all', lineHeight: 1.35,
        }}>
          {value || '—'}
        </Typography>
      </Box>
      {!muted && onCopy && (
        <Tooltip title={copied ? 'Copied!' : 'Copy'} arrow>
          <IconButton size="small" onClick={onCopy}
            sx={{ color: copied ? 'success.main' : 'text.secondary', flexShrink: 0 }}>
            {copied ? <CheckRoundedIcon fontSize="small" /> : <ContentCopyIcon fontSize="small" />}
          </IconButton>
        </Tooltip>
      )}
    </Stack>
  );
}
