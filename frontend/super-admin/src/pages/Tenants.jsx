import { useEffect, useState } from 'react';
import {
  Box, Typography, Button, Card, Table, TableBody, TableCell, TableHead, TableRow,
  Chip, Dialog, DialogTitle, DialogContent, DialogActions, TextField, MenuItem,
  Stack, Alert, Switch, Divider, Snackbar, Tooltip,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import MailOutlineIcon from '@mui/icons-material/MailOutline';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import PageHeader from '../components/PageHeader.jsx';

// Features shown with plain-English labels + a short explanation.
const FEATURES = [
  { key: 'parentApp', label: 'Parent mobile app', desc: 'Parents can track the bus & get alerts' },
  { key: 'geofenceAlerts', label: 'Bus approaching alerts', desc: '“Bus is 5 min away” notifications' },
  { key: 'eta', label: 'Arrival time prediction (ETA)', desc: 'Estimated time the bus reaches each stop' },
  { key: 'reports', label: 'Attendance & reports', desc: 'Daily attendance, export to CSV/PDF' },
  { key: 'sos', label: 'SOS / panic button', desc: 'Emergency alert from the driver' },
];
// Placeholder name — the org rarely tells us who the admin is up front, and a
// blank row reads as broken. They can correct it at first login or in profile.
const DEFAULT_ADMIN_NAME = 'Primary Admin';

const emptyForm = {
  name: '', orgTypeId: '', adminEmail: '', adminName: DEFAULT_ADMIN_NAME,
  features: { parentApp: true, geofenceAlerts: true, eta: false, reports: true, sos: false },
};

// Column heading with a dotted underline that explains the column on hover.
const help = (label, title) => (
  <Tooltip title={title}>
    <span style={{ cursor: 'help', borderBottom: '1px dotted #b6bacb' }}>{label}</span>
  </Tooltip>
);

export default function Tenants() {
  const nav = useNavigate();
  const [tenants, setTenants] = useState([]);
  const [orgTypes, setOrgTypes] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState('');

  async function load() {
    setLoading(true);
    const { data } = await api.get('/api/tenants');
    setTenants(data.tenants);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  // Only active types can take new organizations (the API enforces this too).
  useEffect(() => {
    api.get('/api/org-types').then(({ data }) => setOrgTypes(data.orgTypes.filter((t) => t.active)));
  }, []);

  function set(k, v) { setForm((f) => ({ ...f, [k]: v })); }
  function toggleFeature(k) { setForm((f) => ({ ...f, features: { ...f.features, [k]: !f.features[k] } })); }

  // Login id is generated automatically from the name — no manual entry.
  const canSubmit = form.name && form.orgTypeId && form.adminEmail && form.adminName.trim().length >= 2;

  async function create() {
    setError('');
    try {
      const { data } = await api.post('/api/tenants', {
        name: form.name, orgTypeId: form.orgTypeId, features: form.features,
        admin: { email: form.adminEmail, name: form.adminName.trim() },
      });
      setOpen(false); setForm(emptyForm);
      // The org exists either way — if the invite email bounced, say so rather
      // than leaving the super admin to wonder why nobody ever signed in.
      if (data.invite && !data.invite.sent) {
        setToast(`Organization created, but the invite email failed to send. Resend it from the organization page.`);
      }
      nav(`/tenants/${data.tenant.id}`); // jump into the new tenant's detail
    } catch (err) { setError(err.response?.data?.error || 'Failed to create tenant'); }
  }

  const statusColor = { ACTIVE: 'success', SUSPENDED: 'error', TRIAL: 'warning' };

  return (
    <Box>
      <PageHeader
        title="Organizations"
        crumbs={[{ label: 'Organizations' }]}
        action={(
          <Tooltip title="Set up a new organization. You only need its name, type, and the admin's email — we email them their login.">
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => setOpen(true)}>Add Organization</Button>
          </Tooltip>
        )}
      />

      <Card sx={{ overflowX: 'auto' }}>
        <Table sx={{ minWidth: 900 }}>
          <TableHead>
            <TableRow>
              <TableCell>{help('Org ID', 'Account number, assigned automatically. Never reused, so numbers can skip.')}</TableCell>
              <TableCell>Organization</TableCell>
              <TableCell>{help('Login ID', 'What this organization types to sign in. Generated from its name and fixed for life.')}</TableCell>
              <TableCell>{help('Type', 'The category it belongs to. Manage the list under Organization Types.')}</TableCell>
              <TableCell align="center">Passengers</TableCell>
              <TableCell align="center">Vehicles</TableCell>
              <TableCell>{help('Status', 'Active organizations can sign in. Suspended ones cannot, though their data is kept.')}</TableCell>
              <TableCell />
            </TableRow>
          </TableHead>
          <TableBody>
            {tenants.map((t) => (
              <Tooltip key={t.id} title={`Open ${t.name} — manage its admins, features and status`} followCursor>
                <TableRow hover sx={{ cursor: 'pointer' }} onClick={() => nav(`/tenants/${t.id}`)}>
                <TableCell><Chip size="small" variant="outlined" label={`#${t.code ?? '—'}`} /></TableCell>
                <TableCell><b>{t.name}</b></TableCell>
                <TableCell><code>{t.slug?.toUpperCase()}</code></TableCell>
                <TableCell>{t.orgType?.name || '—'}</TableCell>
                <TableCell align="center">{t._count?.passengers ?? 0}</TableCell>
                <TableCell align="center">{t._count?.vehicles ?? 0}</TableCell>
                <TableCell><Chip size="small" label={t.status} color={statusColor[t.status] || 'default'} /></TableCell>
                <TableCell align="right"><ChevronRightIcon color="action" /></TableCell>
                </TableRow>
              </Tooltip>
            ))}
            {!loading && tenants.length === 0 && (
              <TableRow><TableCell colSpan={8} align="center" sx={{ py: 5, color: 'text.secondary' }}>No organizations yet — create your first one.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>
          Add a new organization
          <Typography variant="body2" color="text.secondary">Works for any organization — school, office, company, hospital, etc.</Typography>
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2.5} mt={1}>
            {error && <Alert severity="error">{error}</Alert>}

            <Divider textAlign="left"><b>1. Organization details</b></Divider>
            <TextField required label="Organization name" placeholder="e.g. Green Valley" value={form.name}
              onChange={(e) => set('name', e.target.value)} />
            <TextField label="Login ID (generated automatically)" value={form.name ? previewSlug(form.name) : ''} disabled
              helperText="Created for you from the name and given to the organization to sign in. If another org already has this ID, the Org ID number is appended to keep it unique." />
            <TextField required select label="Organization type" value={form.orgTypeId}
              onChange={(e) => set('orgTypeId', e.target.value)}
              helperText={orgTypes.length
                ? 'Manage the list under Organization Types'
                : 'No active types — add one under Organization Types first'}>
              {orgTypes.map((t) => (
                <MenuItem key={t.id} value={t.id}>{t.name}</MenuItem>
              ))}
            </TextField>

            <Divider textAlign="left"><b>2. Features to include</b></Divider>
            <Typography variant="caption" color="text.secondary" sx={{ mt: -1 }}>Turn on the features this organization is paying for.</Typography>
            <Stack divider={<Divider flexItem />}>
              {FEATURES.map((f) => (
                <Stack key={f.key} direction="row" justifyContent="space-between" alignItems="center" sx={{ py: 0.75 }}>
                  <Box>
                    <Typography variant="body2" fontWeight={600}>{f.label}</Typography>
                    <Typography variant="caption" color="text.secondary">{f.desc}</Typography>
                  </Box>
                  <Switch checked={!!form.features[f.key]} onChange={() => toggleFeature(f.key)} />
                </Stack>
              ))}
            </Stack>

            <Divider textAlign="left"><b>3. Admin login</b></Divider>
            <Typography variant="caption" color="text.secondary" sx={{ mt: -1 }}>
              Their email is all we really need — we’ll send them everything else.
            </Typography>
            <TextField required type="email" label="Admin's email" placeholder="admin@example.com"
              value={form.adminEmail} onChange={(e) => set('adminEmail', e.target.value)}
              helperText="They sign in with this address" />
            <TextField label="Display name" value={form.adminName}
              onChange={(e) => set('adminName', e.target.value)}
              helperText={form.adminName.trim() === DEFAULT_ADMIN_NAME
                ? 'A placeholder — if the organization told you the real name, type it here instead. They can change it themselves later.'
                : 'You can leave this as “Primary Admin” if you don’t know their name yet.'} />
            <Alert severity="info" icon={<MailOutlineIcon fontSize="small" />} sx={{ borderRadius: 2 }}>
              <Typography variant="body2" fontWeight={600} mb={0.5}>What happens next</Typography>
              <Typography variant="caption" component="div" color="text.secondary" sx={{ lineHeight: 1.7 }}>
                We email them the Organization ID <b>{form.name ? previewSlug(form.name) : 'TF-…'}</b> and a
                temporary password. On first sign-in they confirm this email with a 6-digit code, then choose
                their own password — so you never handle it.
              </Typography>
            </Alert>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => { setOpen(false); setError(''); }}>Cancel</Button>
          <Button variant="contained" onClick={create} disabled={!canSubmit}>Create Organization</Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={!!toast} autoHideDuration={6000} onClose={() => setToast('')} message={toast}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }} />
    </Box>
  );
}

// Mirrors the backend's slug rules (backend/src/lib/slug.js) for the live preview.
// Only an approximation: if the id is already taken the server appends the Org ID,
// which we can't know until the tenant exists.
const MAX = 12;
function previewSlug(s) {
  const full = s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  let root = full;
  if (full.length > MAX) {
    const cut = full.slice(0, MAX);
    // Cut on a word boundary: "Metro University" -> "metro", not "metro-univer".
    root = full[MAX] === '-' ? cut : (cut.replace(/-[^-]*$/, '') || cut).replace(/-+$/, '');
  }
  return `TF-${root || 'org'}`.toUpperCase();
}
