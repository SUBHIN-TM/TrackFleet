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
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
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
  { key: 'parentApp', label: 'Parent mobile app', desc: 'Parents can track the bus live and get alerts.' },
  { key: 'geofenceAlerts', label: 'Bus approaching alerts', desc: '“Bus is 5 min away” notifications as it nears a stop.' },
  { key: 'eta', label: 'Arrival time prediction (ETA)', desc: 'Estimated time the bus reaches each stop.' },
  { key: 'reports', label: 'Attendance & reports', desc: 'Daily attendance, exportable to CSV/PDF.' },
  { key: 'sos', label: 'SOS / panic button', desc: 'Emergency alert the driver can raise from the bus.' },
];

export default function TenantDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const [tenant, setTenant] = useState(null);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [resendDlg, setResendDlg] = useState(null);
  const [addDlg, setAddDlg] = useState(false);
  const [newAdmin, setNewAdmin] = useState({ email: '', name: '' });
  const [renameDlg, setRenameDlg] = useState(null);
  const [renameTo, setRenameTo] = useState('');

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
  // No "set their password" any more — nobody but the admin should know it.
  // Re-inviting mails a fresh temp password and restarts first-login setup.
  async function resendInvite() {
    setError('');
    try {
      const { data } = await api.post(`/api/tenants/${id}/admins/${resendDlg.id}/resend-invite`);
      setResendDlg(null); load(); setToast(data.message);
    } catch (err) { setError(err.response?.data?.error || 'Failed to resend the invite'); }
  }
  async function addAdmin() {
    setError('');
    try {
      const { data } = await api.post(`/api/tenants/${id}/admins`, {
        email: newAdmin.email, ...(newAdmin.name.trim() ? { name: newAdmin.name.trim() } : {}),
      });
      setAddDlg(false); setNewAdmin({ email: '', name: '' }); load();
      setToast(data.invite?.sent
        ? `Invite emailed to ${data.admin.email}`
        : `Admin added, but the invite email failed to send — resend it from the list.`);
    } catch (err) { setError(err.response?.data?.error || 'Failed'); }
  }
  // Names start as placeholders ("Primary Admin"), so renaming is expected once
  // the organization tells you who actually holds the login.
  async function renameAdmin() {
    setError('');
    try {
      await api.patch(`/api/tenants/${id}/admins/${renameDlg.id}`, { name: renameTo.trim() });
      setRenameDlg(null); load(); setToast('Name updated');
    } catch (err) { setError(err.response?.data?.error || 'Failed to rename'); }
  }
  function openAddDlg() {
    // Prefill the next number so a second login reads "Admin 2".
    setNewAdmin({ email: '', name: `Admin ${(tenant?.admins?.length ?? 0) + 1}` });
    setError(''); setAddDlg(true);
  }
  const copy = (text) => { navigator.clipboard?.writeText(text); setToast('Copied to clipboard'); };

  if (!tenant) return <Typography color="text.secondary">Loading…</Typography>;
  const statusColor = { ACTIVE: 'success', SUSPENDED: 'error', TRIAL: 'warning' }[tenant.status];
  const STATUS_HELP = {
    ACTIVE: 'Everything works normally — this organization can sign in and use the app.',
    SUSPENDED: 'Nobody at this organization can sign in. Their data is safe and untouched; activating restores access.',
    TRIAL: 'Working normally, on a trial. Nothing is enforced yet — this is a label for your own tracking.',
  };
  const stats = [
    { label: 'Passengers', value: tenant._count?.passengers ?? 0, icon: <GroupsRoundedIcon />, c: '#0ea5e9' },
    { label: 'Vehicles', value: tenant._count?.vehicles ?? 0, icon: <DirectionsBusRoundedIcon />, c: '#16a34a' },
    { label: 'Routes', value: tenant._count?.routes ?? 0, icon: <RouteRoundedIcon />, c: '#d97706' },
    { label: 'Total users', value: tenant._count?.users ?? 0, icon: <PeopleRoundedIcon />, c: '#4f46e5' },
  ];

  return (
    <Box>
      <Button startIcon={<ArrowBackRoundedIcon />} onClick={() => nav('/tenants')} sx={{ mb: 2, color: 'text.secondary' }}>Back to organizations</Button>

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
                  <Tooltip title="This organization's account number. Assigned automatically and never reused — numbers may skip if an organization was deleted.">
                    <Chip size="small" variant="outlined" label={`Org #${tenant.code ?? '—'}`} />
                  </Tooltip>
                  <Tooltip title={STATUS_HELP[tenant.status] || ''}>
                    <Chip size="small" label={tenant.status} color={statusColor} />
                  </Tooltip>
                </Stack>
                <Typography color="text.secondary" variant="body2">
                  Login ID:{' '}
                  <Tooltip title="What this organization types to sign in, alongside their email and password. Fixed for life — renaming the organization won't change it.">
                    <b style={{ cursor: 'help' }}>{tenant.slug?.toUpperCase()}</b>
                  </Tooltip>
                  {' · '}
                  <Tooltip title="The organization type. Change the list under Organization Types in the sidebar.">
                    <span style={{ cursor: 'help' }}>{tenant.orgType?.name}</span>
                  </Tooltip>
                </Typography>
              </Box>
            </Stack>
            <Tooltip title={tenant.status === 'SUSPENDED'
              ? 'Let this organization sign in again. Their data was never touched — everything returns exactly as it was.'
              : 'Immediately blocks everyone at this organization from signing in — admins, drivers and parents. Nothing is deleted, and you can undo it at any time.'}>
              <Button
                variant={tenant.status === 'SUSPENDED' ? 'contained' : 'outlined'}
                color={tenant.status === 'SUSPENDED' ? 'success' : 'error'}
                startIcon={tenant.status === 'SUSPENDED' ? <CheckCircleRoundedIcon /> : <BlockRoundedIcon />}
                onClick={toggleStatus}
              >
                {tenant.status === 'SUSPENDED' ? 'Activate organization' : 'Suspend organization'}
              </Button>
            </Tooltip>
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
                  <Typography variant="caption" color="text.secondary">People who can sign in and manage this organization</Typography>
                </Box>
                <Tooltip title={
                  <Box sx={{ py: 0.5 }}>
                    <b>Gives one more person their own login</b> for this organization — for example a
                    second transport manager. It does not replace anyone.
                    <Box sx={{ mt: 0.8 }}>
                      You type only their email; we send them their own temporary password.
                      Skip this unless the organization asked for another login.
                    </Box>
                  </Box>
                }>
                  {/* nowrap: the label is long and this card is narrow at md. */}
                  <Button size="small" variant="outlined" startIcon={<PersonAddRoundedIcon />} onClick={openAddDlg}
                    sx={{ whiteSpace: 'nowrap', flexShrink: 0 }}>
                    {tenant.admins?.length ? 'Invite another admin' : 'Invite admin'}
                  </Button>
                </Tooltip>
              </Stack>
              {/* Four columns don't fit this card on a narrow window — scroll the
                  table itself rather than clipping the actions off-screen. */}
              <Box sx={{ overflowX: 'auto' }}>
              <Table size="small" sx={{ mt: 1, minWidth: 460 }}>
                <TableHead>
                  <TableRow>
                    <TableCell>Admin</TableCell>
                    <TableCell>Email (login)</TableCell>
                    <TableCell>
                      <Tooltip title="Whether this person has finished setting up their own login yet.">
                        <span style={{ cursor: 'help', borderBottom: '1px dotted #b6bacb' }}>Setup</span>
                      </Tooltip>
                    </TableCell>
                    <TableCell align="right">Invite</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {tenant.admins?.map((a) => {
                    // Older invites predate placeholder names, so `name` may be
                    // null — fall back to the email rather than a blank row.
                    const label = a.name || a.email;
                    const pending = !a.emailVerifiedAt || a.mustChangePassword;
                    // A placeholder isn't a real person's name; show it as
                    // provisional so nobody mistakes "Admin 2" for who they are.
                    const isPlaceholder = !a.name || /^(Primary Admin|Admin \d+)$/.test(a.name);
                    return (
                      <TableRow key={a.id} hover>
                        <TableCell>
                          <Stack direction="row" spacing={1.2} alignItems="center">
                            <Avatar sx={{ width: 30, height: 30, fontSize: 12, bgcolor: 'primary.light', color: 'primary.main', fontWeight: 700 }}>
                              {label[0]?.toUpperCase()}
                            </Avatar>
                            <Tooltip title={isPlaceholder
                              ? 'A placeholder, not their real name. Click the pencil to set it once the organization tells you — or they can set it themselves at first sign-in or in their profile.'
                              : 'Click the pencil to rename.'}>
                              <Stack direction="row" spacing={0.5} alignItems="center" sx={{ cursor: 'help' }}>
                                <Typography fontWeight={600} variant="body2" noWrap
                                  fontStyle={isPlaceholder ? 'italic' : 'normal'}
                                  color={isPlaceholder ? 'text.secondary' : 'text.primary'}>
                                  {a.name || 'Name not set'}
                                </Typography>
                                <IconButton size="small"
                                  onClick={() => { setError(''); setRenameDlg(a); setRenameTo(a.name || ''); }}>
                                  <EditOutlinedIcon sx={{ fontSize: 14 }} />
                                </IconButton>
                              </Stack>
                            </Tooltip>
                          </Stack>
                        </TableCell>
                        <TableCell>
                          <Stack direction="row" spacing={0.5} alignItems="center">
                            <Typography variant="body2">{a.email}</Typography>
                            <Tooltip title="Copy email"><IconButton size="small" onClick={() => copy(a.email)}><ContentCopyRoundedIcon sx={{ fontSize: 15 }} /></IconButton></Tooltip>
                          </Stack>
                        </TableCell>
                        <TableCell>
                          <Tooltip
                            title={pending ? (
                              <Box sx={{ py: 0.5 }}>
                                <b>They haven’t signed in yet.</b> Nothing is wrong — we emailed their
                                temporary password and we’re waiting on them to:
                                <Box component="ol" sx={{ m: '6px 0 0', pl: 2.2 }}>
                                  <li>sign in with it at the organization portal,</li>
                                  <li>type the 6-digit code we email them,</li>
                                  <li>choose their own password.</li>
                                </Box>
                                <Box sx={{ mt: 0.8 }}>This turns green once all three are done.</Box>
                              </Box>
                            ) : 'Setup complete — they confirmed their email and chose their own password. Only they know it.'}
                          >
                            <Chip size="small" variant="outlined"
                              label={pending ? 'Invite pending' : 'Active'}
                              color={pending ? 'warning' : 'success'} />
                          </Tooltip>
                        </TableCell>
                        <TableCell align="right">
                          <Tooltip title={
                            <Box sx={{ py: 0.5 }}>
                              <b>Resend the invite.</b> Emails <b>{a.email}</b> a brand-new temporary
                              password and starts their setup over.
                              <Box sx={{ mt: 0.8 }}>
                                Use it if they lost the email or can’t get in. Their current password
                                stops working straight away.
                              </Box>
                            </Box>
                          }>
                            <IconButton color="primary" onClick={() => setResendDlg(a)}><KeyRoundedIcon fontSize="small" /></IconButton>
                          </Tooltip>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {!tenant.admins?.length && <TableRow><TableCell colSpan={4} align="center" sx={{ py: 3, color: 'text.secondary' }}>No admins yet.</TableCell></TableRow>}
                </TableBody>
              </Table>
              </Box>
              <Box sx={{ mt: 2, p: 1.5, borderRadius: 2, bgcolor: '#f7f8fb', border: '1px dashed #e2e6ef' }}>
                <Typography variant="caption" color="text.secondary">
                  Admins sign in at the portal <b>:5174</b> using Login ID <Chip size="small" label={tenant.slug?.toUpperCase()} sx={{ height: 20 }} onClick={() => copy(tenant.slug?.toUpperCase())} /> and
                  the temporary password we emailed them. They confirm the email with a code, then set their own password —
                  you never see or handle it.
                </Typography>
              </Box>
            </CardContent>
          </Card>
        </Grid>

        {/* Feature flags */}
        <Grid size={{ xs: 12, md: 5 }}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="subtitle2" color="text.secondary">FEATURES</Typography>
              <Typography variant="caption" color="text.secondary">What this organization has purchased. Changes apply immediately.</Typography>
              <Stack mt={1.5} divider={<Divider flexItem />}>
                {FEATURES.map((f) => {
                  const on = !!tenant.features?.[f.key];
                  return (
                    <Stack key={f.key} direction="row" justifyContent="space-between" alignItems="center" sx={{ py: 0.75 }}>
                      <Typography variant="body2" fontWeight={500}>{f.label}</Typography>
                      <Tooltip title={
                        <Box sx={{ py: 0.5 }}>
                          {f.desc}
                          <Box sx={{ mt: 0.8 }}>
                            <b>{on ? 'Currently on.' : 'Currently off.'}</b>{' '}
                            {on
                              ? 'Clicking turns it off for this organization right away.'
                              : 'Clicking turns it on for this organization right away.'}
                          </Box>
                        </Box>
                      }>
                        <Switch checked={on} onChange={() => toggleFeature(f.key)} />
                      </Tooltip>
                    </Stack>
                  );
                })}
              </Stack>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Rename an admin */}
      <Dialog open={!!renameDlg} onClose={() => setRenameDlg(null)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ pb: 0.5 }}>
          Rename admin
          <Typography variant="body2" color="text.secondary">{renameDlg?.email}</Typography>
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2} mt={1}>
            {error && <Alert severity="error">{error}</Alert>}
            <TextField autoFocus label="Display name" value={renameTo}
              onChange={(e) => setRenameTo(e.target.value)} fullWidth
              placeholder="e.g. Priya Kumar"
              helperText="Only changes how they're shown. Their email and password are untouched." />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setRenameDlg(null)}>Cancel</Button>
          <Button variant="contained" onClick={renameAdmin} disabled={renameTo.trim().length < 2}>Save name</Button>
        </DialogActions>
      </Dialog>

      {/* Resend invite */}
      <Dialog open={!!resendDlg} onClose={() => setResendDlg(null)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ pb: 0.5 }}>
          Send a new temporary password?
          <Typography variant="body2" color="text.secondary">To {resendDlg?.email}</Typography>
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2} mt={0.5}>
            {error && <Alert severity="error">{error}</Alert>}
            <Typography variant="body2" color="text.secondary">
              Use this if they never got the first email, or can’t sign in. They’ll get a fresh
              temporary password, confirm their email with a 6-digit code, then choose their own password.
            </Typography>
            <Alert severity="warning" sx={{ borderRadius: 2 }}>
              <Typography variant="caption">
                Whatever password they use now <b>stops working immediately</b>. Only do this if they’re
                expecting it.
              </Typography>
            </Alert>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setResendDlg(null)}>Cancel</Button>
          <Button variant="contained" onClick={resendInvite}>Email new password</Button>
        </DialogActions>
      </Dialog>

      {/* Invite admin */}
      <Dialog open={addDlg} onClose={() => setAddDlg(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ pb: 0.5 }}>
          Invite another admin
          <Typography variant="body2" color="text.secondary">
            An extra login for {tenant.name}. Existing admins are unaffected.
          </Typography>
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2} mt={1}>
            {error && <Alert severity="error">{error}</Alert>}
            <TextField required autoFocus type="email" label="Their email" placeholder="admin@example.com"
              value={newAdmin.email} onChange={(e) => setNewAdmin({ ...newAdmin, email: e.target.value })} fullWidth
              helperText="They’ll sign in with this address" />
            <TextField label="Display name" value={newAdmin.name}
              onChange={(e) => setNewAdmin({ ...newAdmin, name: e.target.value })} fullWidth
              helperText="A placeholder unless you know their real name — they can change it themselves later." />
            <Alert severity="info" sx={{ borderRadius: 2 }}>
              <Typography variant="caption" component="div" sx={{ lineHeight: 1.7 }}>
                We email them Organization ID <b>{tenant.slug?.toUpperCase()}</b> and a temporary
                password. They confirm the email with a 6-digit code, then pick their own password —
                you never see it.
              </Typography>
            </Alert>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setAddDlg(false)}>Cancel</Button>
          <Button variant="contained" onClick={addAdmin} disabled={!newAdmin.email}>Send invite email</Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={!!toast} autoHideDuration={2500} onClose={() => setToast('')} message={toast} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }} />
    </Box>
  );
}
