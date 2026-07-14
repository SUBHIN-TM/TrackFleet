import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Box, Typography, Card, CardContent, Chip, Stack, Button, Divider, Table,
  TableBody, TableCell, TableHead, TableRow, Dialog, DialogTitle, DialogContent,
  DialogActions, TextField, Alert, Switch, IconButton, Tooltip, Snackbar, Avatar, Link,
} from '@mui/material';
import Grid from '@mui/material/Grid2';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import KeyRoundedIcon from '@mui/icons-material/KeyRounded';
import PersonAddRoundedIcon from '@mui/icons-material/PersonAddRounded';
import BlockRoundedIcon from '@mui/icons-material/BlockRounded';
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded';
import GroupsRoundedIcon from '@mui/icons-material/GroupsRounded';
import DirectionsBusRoundedIcon from '@mui/icons-material/DirectionsBusRounded';
import RouteRoundedIcon from '@mui/icons-material/RouteRounded';
import PeopleRoundedIcon from '@mui/icons-material/PeopleRounded';
import { api } from '../lib/api.js';

const FEATURES = [
  { key: 'parentApp', label: 'Parent app' },
  { key: 'geofenceAlerts', label: 'Geofence alerts' },
  { key: 'eta', label: 'ETA prediction' },
  { key: 'reports', label: 'Reports & export' },
  { key: 'sos', label: 'SOS / panic' },
];

export default function TenantDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const [tenant, setTenant] = useState(null);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [pwDlg, setPwDlg] = useState(null);
  const [pw, setPw] = useState('');
  const [addDlg, setAddDlg] = useState(false);
  const [newAdmin, setNewAdmin] = useState({ name: '', email: '', password: '' });

  async function load() {
    const { data } = await api.get(`/api/tenants/${id}`);
    setTenant(data.tenant);
  }
  useEffect(() => { load(); }, [id]);

  async function toggleStatus() {
    const status = tenant.status === 'SUSPENDED' ? 'ACTIVE' : 'SUSPENDED';
    await api.patch(`/api/tenants/${id}`, { status });
    load(); setToast(`Tenant ${status === 'ACTIVE' ? 'activated' : 'suspended'}`);
  }
  async function toggleFeature(k) {
    const features = { ...(tenant.features || {}), [k]: !tenant.features?.[k] };
    await api.patch(`/api/tenants/${id}`, { features });
    setTenant((t) => ({ ...t, features }));
  }
  async function resetPassword() {
    setError('');
    try {
      await api.post(`/api/tenants/${id}/admins/${pwDlg.id}/reset-password`, { password: pw });
      setPwDlg(null); setToast(`Password updated for ${pwDlg.email}`); setPw('');
    } catch (err) { setError(err.response?.data?.error || 'Failed'); }
  }
  async function addAdmin() {
    setError('');
    try {
      await api.post(`/api/tenants/${id}/admins`, newAdmin);
      setAddDlg(false); setNewAdmin({ name: '', email: '', password: '' }); load(); setToast('Admin added');
    } catch (err) { setError(err.response?.data?.error || 'Failed'); }
  }
  const copy = (text) => { navigator.clipboard?.writeText(text); setToast('Copied to clipboard'); };

  if (!tenant) return <Typography color="text.secondary">Loading…</Typography>;
  const statusColor = { ACTIVE: 'success', SUSPENDED: 'error', TRIAL: 'warning' }[tenant.status];
  const stats = [
    { label: 'Passengers', value: tenant._count?.passengers ?? 0, icon: <GroupsRoundedIcon />, c: '#0ea5e9' },
    { label: 'Vehicles', value: tenant._count?.vehicles ?? 0, icon: <DirectionsBusRoundedIcon />, c: '#16a34a' },
    { label: 'Routes', value: tenant._count?.routes ?? 0, icon: <RouteRoundedIcon />, c: '#d97706' },
    { label: 'Total users', value: tenant._count?.users ?? 0, icon: <PeopleRoundedIcon />, c: '#4f46e5' },
  ];

  return (
    <Box>
      <Button startIcon={<ArrowBackRoundedIcon />} onClick={() => nav('/tenants')} sx={{ mb: 2, color: 'text.secondary' }}>Back to tenants</Button>

      {/* Header */}
      <Card sx={{ mb: 2.5 }}>
        <CardContent sx={{ py: 3 }}>
          <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" alignItems={{ md: 'center' }} gap={2}>
            <Stack direction="row" spacing={2} alignItems="center">
              <Avatar variant="rounded" sx={{ width: 64, height: 64, fontSize: 28, fontWeight: 800, bgcolor: 'primary.light', color: 'primary.main' }}>
                {tenant.name[0]}
              </Avatar>
              <Box>
                <Stack direction="row" spacing={1.5} alignItems="center">
                  <Typography variant="h5">{tenant.name}</Typography>
                  <Chip size="small" label={tenant.status} color={statusColor} />
                </Stack>
                <Typography color="text.secondary" variant="body2">/{tenant.slug} · {tenant.vertical}</Typography>
              </Box>
            </Stack>
            <Button
              variant={tenant.status === 'SUSPENDED' ? 'contained' : 'outlined'}
              color={tenant.status === 'SUSPENDED' ? 'success' : 'error'}
              startIcon={tenant.status === 'SUSPENDED' ? <CheckCircleRoundedIcon /> : <BlockRoundedIcon />}
              onClick={toggleStatus}
            >
              {tenant.status === 'SUSPENDED' ? 'Activate tenant' : 'Suspend tenant'}
            </Button>
          </Stack>
        </CardContent>
      </Card>

      {/* Stat tiles */}
      <Grid container spacing={2.5} mb={0.5}>
        {stats.map((s) => (
          <Grid size={{ xs: 6, md: 3 }} key={s.label}>
            <Card>
              <CardContent>
                <Stack direction="row" spacing={1.5} alignItems="center">
                  <Box sx={{ width: 42, height: 42, borderRadius: 2.5, display: 'grid', placeItems: 'center', bgcolor: `${s.c}15`, color: s.c }}>{s.icon}</Box>
                  <Box>
                    <Typography variant="h5" fontWeight={800} lineHeight={1}>{s.value}</Typography>
                    <Typography variant="caption" color="text.secondary">{s.label}</Typography>
                  </Box>
                </Stack>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>

      <Grid container spacing={2.5} mt={0}>
        {/* Admin logins — primary card */}
        <Grid size={{ xs: 12, md: 7 }}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Stack direction="row" justifyContent="space-between" alignItems="center" mb={0.5}>
                <Box>
                  <Typography variant="subtitle2" color="text.secondary">ADMIN LOGINS</Typography>
                  <Typography variant="caption" color="text.secondary">Credentials the school uses to sign in</Typography>
                </Box>
                <Button size="small" variant="outlined" startIcon={<PersonAddRoundedIcon />} onClick={() => setAddDlg(true)}>Add admin</Button>
              </Stack>
              <Table size="small" sx={{ mt: 1 }}>
                <TableHead>
                  <TableRow>
                    <TableCell>Admin</TableCell>
                    <TableCell>Email (login)</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell align="right">Password</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {tenant.admins?.map((a) => (
                    <TableRow key={a.id} hover>
                      <TableCell>
                        <Stack direction="row" spacing={1.2} alignItems="center">
                          <Avatar sx={{ width: 30, height: 30, fontSize: 12, bgcolor: 'primary.light', color: 'primary.main', fontWeight: 700 }}>{a.name[0]}</Avatar>
                          <Typography fontWeight={600} variant="body2">{a.name}</Typography>
                        </Stack>
                      </TableCell>
                      <TableCell>
                        <Stack direction="row" spacing={0.5} alignItems="center">
                          <Typography variant="body2">{a.email}</Typography>
                          <Tooltip title="Copy email"><IconButton size="small" onClick={() => copy(a.email)}><ContentCopyRoundedIcon sx={{ fontSize: 15 }} /></IconButton></Tooltip>
                        </Stack>
                      </TableCell>
                      <TableCell><Chip size="small" label={a.status} color={a.status === 'ACTIVE' ? 'success' : 'default'} variant="outlined" /></TableCell>
                      <TableCell align="right">
                        <Tooltip title="Set / reset password">
                          <IconButton color="primary" onClick={() => { setPwDlg(a); setPw(''); }}><KeyRoundedIcon fontSize="small" /></IconButton>
                        </Tooltip>
                      </TableCell>
                    </TableRow>
                  ))}
                  {!tenant.admins?.length && <TableRow><TableCell colSpan={4} align="center" sx={{ py: 3, color: 'text.secondary' }}>No admins yet.</TableCell></TableRow>}
                </TableBody>
              </Table>
              <Box sx={{ mt: 2, p: 1.5, borderRadius: 2, bgcolor: '#f7f8fb', border: '1px dashed #e2e6ef' }}>
                <Typography variant="caption" color="text.secondary">
                  School sign-in → portal <b>:5174</b>, School ID <Chip size="small" label={tenant.slug} sx={{ height: 20 }} onClick={() => copy(tenant.slug)} /> + email &amp; password above.
                </Typography>
              </Box>
            </CardContent>
          </Card>
        </Grid>

        {/* Feature flags */}
        <Grid size={{ xs: 12, md: 5 }}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="subtitle2" color="text.secondary">FEATURE FLAGS</Typography>
              <Typography variant="caption" color="text.secondary">What this tenant has purchased</Typography>
              <Stack mt={1.5} divider={<Divider flexItem />}>
                {FEATURES.map((f) => (
                  <Stack key={f.key} direction="row" justifyContent="space-between" alignItems="center" sx={{ py: 0.75 }}>
                    <Typography variant="body2" fontWeight={500}>{f.label}</Typography>
                    <Switch checked={!!tenant.features?.[f.key]} onChange={() => toggleFeature(f.key)} />
                  </Stack>
                ))}
              </Stack>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Reset password */}
      <Dialog open={!!pwDlg} onClose={() => setPwDlg(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Set password — {pwDlg?.name}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} mt={0.5}>
            {error && <Alert severity="error">{error}</Alert>}
            <Typography variant="body2" color="text.secondary">{pwDlg?.email}</Typography>
            <TextField label="New password" value={pw} onChange={(e) => setPw(e.target.value)} helperText="min 6 characters — share this with the tenant" autoFocus fullWidth />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setPwDlg(null)}>Cancel</Button>
          <Button variant="contained" onClick={resetPassword} disabled={pw.length < 6}>Update password</Button>
        </DialogActions>
      </Dialog>

      {/* Add admin */}
      <Dialog open={addDlg} onClose={() => setAddDlg(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Add tenant admin</DialogTitle>
        <DialogContent>
          <Stack spacing={2} mt={0.5}>
            {error && <Alert severity="error">{error}</Alert>}
            <TextField label="Name" value={newAdmin.name} onChange={(e) => setNewAdmin({ ...newAdmin, name: e.target.value })} fullWidth />
            <TextField label="Email" value={newAdmin.email} onChange={(e) => setNewAdmin({ ...newAdmin, email: e.target.value })} fullWidth />
            <TextField label="Password" value={newAdmin.password} onChange={(e) => setNewAdmin({ ...newAdmin, password: e.target.value })} helperText="min 6 characters" fullWidth />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setAddDlg(false)}>Cancel</Button>
          <Button variant="contained" onClick={addAdmin} disabled={!newAdmin.name || !newAdmin.email || newAdmin.password.length < 6}>Add admin</Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={!!toast} autoHideDuration={2500} onClose={() => setToast('')} message={toast} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }} />
    </Box>
  );
}
