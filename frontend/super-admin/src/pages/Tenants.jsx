import { useEffect, useState } from 'react';
import {
  Box, Typography, Button, Card, Table, TableBody, TableCell, TableHead, TableRow,
  Chip, Dialog, DialogTitle, DialogContent, DialogActions, TextField, MenuItem,
  Stack, Alert, FormControlLabel, Switch, Divider, InputAdornment, IconButton,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import PageHeader from '../components/PageHeader.jsx';

const FEATURE_KEYS = ['parentApp', 'geofenceAlerts', 'eta', 'reports', 'sos'];
const emptyForm = {
  name: '', slug: '', vertical: 'SCHOOL',
  adminName: '', adminEmail: '', adminPassword: '',
  features: { parentApp: true, geofenceAlerts: true, eta: false, reports: true, sos: false },
};

export default function Tenants() {
  const nav = useNavigate();
  const [tenants, setTenants] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const { data } = await api.get('/api/tenants');
    setTenants(data.tenants);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  function set(k, v) { setForm((f) => ({ ...f, [k]: v })); }
  function toggleFeature(k) { setForm((f) => ({ ...f, features: { ...f.features, [k]: !f.features[k] } })); }

  const canSubmit = form.name && form.slug && form.adminName && form.adminEmail && form.adminPassword.length >= 6;

  async function create() {
    setError('');
    try {
      const { data } = await api.post('/api/tenants', {
        name: form.name, slug: form.slug, vertical: form.vertical, features: form.features,
        admin: { name: form.adminName, email: form.adminEmail, password: form.adminPassword },
      });
      setOpen(false); setForm(emptyForm); setShowPw(false);
      nav(`/tenants/${data.tenant.id}`); // jump into the new tenant's detail
    } catch (err) { setError(err.response?.data?.error || 'Failed to create tenant'); }
  }

  const statusColor = { ACTIVE: 'success', SUSPENDED: 'error', TRIAL: 'warning' };

  return (
    <Box>
      <PageHeader
        title="Tenants"
        crumbs={[{ label: 'Tenants' }]}
        action={<Button variant="contained" startIcon={<AddIcon />} onClick={() => setOpen(true)}>New Tenant</Button>}
      />

      <Card>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Organization</TableCell>
              <TableCell>Slug</TableCell>
              <TableCell>Vertical</TableCell>
              <TableCell align="center">Passengers</TableCell>
              <TableCell align="center">Vehicles</TableCell>
              <TableCell>Status</TableCell>
              <TableCell />
            </TableRow>
          </TableHead>
          <TableBody>
            {tenants.map((t) => (
              <TableRow key={t.id} hover sx={{ cursor: 'pointer' }} onClick={() => nav(`/tenants/${t.id}`)}>
                <TableCell><b>{t.name}</b></TableCell>
                <TableCell><code>{t.slug}</code></TableCell>
                <TableCell>{t.vertical}</TableCell>
                <TableCell align="center">{t._count?.passengers ?? 0}</TableCell>
                <TableCell align="center">{t._count?.vehicles ?? 0}</TableCell>
                <TableCell><Chip size="small" label={t.status} color={statusColor[t.status] || 'default'} /></TableCell>
                <TableCell align="right"><ChevronRightIcon color="action" /></TableCell>
              </TableRow>
            ))}
            {!loading && tenants.length === 0 && (
              <TableRow><TableCell colSpan={7} align="center" sx={{ py: 5, color: 'text.secondary' }}>No tenants yet — create your first school.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Provision a new tenant</DialogTitle>
        <DialogContent>
          <Stack spacing={2} mt={1}>
            {error && <Alert severity="error">{error}</Alert>}

            <Divider textAlign="left">Organization (required)</Divider>
            <TextField required label="Organization name" value={form.name}
              onChange={(e) => { set('name', e.target.value); if (!form.slug || form.slug === slugify(form.name)) set('slug', slugify(e.target.value)); }} />
            <TextField required label="Slug (login portal id)" value={form.slug} onChange={(e) => set('slug', slugify(e.target.value))}
              helperText="lowercase; the school logs in with this id" />
            <TextField select label="Vertical" value={form.vertical} onChange={(e) => set('vertical', e.target.value)}>
              <MenuItem value="SCHOOL">School</MenuItem>
              <MenuItem value="HOSPITAL">Hospital</MenuItem>
              <MenuItem value="COMPANY">Company</MenuItem>
            </TextField>

            <Divider textAlign="left">Feature flags (what they bought)</Divider>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
              {FEATURE_KEYS.map((k) => (
                <FormControlLabel key={k} control={<Switch checked={!!form.features[k]} onChange={() => toggleFeature(k)} />} label={k} />
              ))}
            </Box>

            <Divider textAlign="left">Tenant admin login (you set this)</Divider>
            <TextField required label="Admin full name" value={form.adminName} onChange={(e) => set('adminName', e.target.value)} />
            <TextField required label="Admin email" value={form.adminEmail} onChange={(e) => set('adminEmail', e.target.value)}
              helperText="the school admin signs in with this email" />
            <TextField required label="Admin password" type={showPw ? 'text' : 'password'} value={form.adminPassword}
              onChange={(e) => set('adminPassword', e.target.value)} helperText="min 6 characters — set manually, share with the school"
              InputProps={{ endAdornment: (
                <InputAdornment position="end">
                  <IconButton onClick={() => setShowPw((s) => !s)} edge="end">{showPw ? <VisibilityOffIcon /> : <VisibilityIcon />}</IconButton>
                </InputAdornment>
              ) }} />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setOpen(false); setError(''); }}>Cancel</Button>
          <Button variant="contained" onClick={create} disabled={!canSubmit}>Create Tenant</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

function slugify(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}
