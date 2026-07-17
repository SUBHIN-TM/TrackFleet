import { useEffect, useMemo, useState } from 'react';
import {
  Box, Typography, Button, Card, Table, TableBody, TableCell, TableHead, TableRow,
  Dialog, DialogTitle, DialogContent, DialogActions, TextField, Stack, Alert,
  FormControlLabel, Checkbox, Divider, Chip, IconButton, Tooltip, MenuItem, Avatar,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import ArchiveOutlinedIcon from '@mui/icons-material/ArchiveOutlined';
import KeyOutlinedIcon from '@mui/icons-material/KeyOutlined';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import WhatsAppIcon from '@mui/icons-material/WhatsApp';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import PageHeader from '../components/PageHeader.jsx';

const PARENT_PORTAL = (import.meta.env.VITE_PARENT_PORTAL_URL || 'http://localhost:5175').replace(/\/$/, '');

// No 0/O/1/l/I — read off a screen and retyped by hand. Same alphabet as the
// backend generator, so suggestions look consistent.
const PW_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
function suggestPassword(len = 12) {
  const a = new Uint32Array(len);
  (window.crypto || window.msCrypto).getRandomValues(a);
  return Array.from(a, (n) => PW_ALPHABET[n % PW_ALPHABET.length]).join('');
}
const parentLink = (org, phone) =>
  `${PARENT_PORTAL}/login?org=${encodeURIComponent(org)}&phone=${encodeURIComponent(phone)}`;

// "Category" is the neutral sub-group label (class / ward / team). Location now
// comes from the stop a passenger is mapped to, not typed coordinates.
const empty = {
  name: '', category: '', phone: '', homeAddress: '', routeId: '', stopId: '',
  addGuardian: true, gName: '', gPhone: '', gRelation: 'Parent',
};

export default function Passengers() {
  const { user } = useAuth();
  const orgId = (user?.tenantSlug || '').toUpperCase();
  const [rows, setRows] = useState([]);
  const [routes, setRoutes] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(empty);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null);
  const [gCreds, setGCreds] = useState(null); // parent sign-in details panel
  const [copiedKey, setCopiedKey] = useState(null);
  // Reset-password dialog for the guardian in gCreds (prefilled suggestion).
  const [resetOpen, setResetOpen] = useState(false);
  const [resetPw, setResetPw] = useState('');
  const [resetBusy, setResetBusy] = useState(false);
  const [resetErr, setResetErr] = useState('');
  // Edit the guardian's own details (name / phone-login).
  const [gEditOpen, setGEditOpen] = useState(false);
  const [gEditForm, setGEditForm] = useState({ name: '', phone: '' });
  const [gEditBusy, setGEditBusy] = useState(false);
  const [gEditErr, setGEditErr] = useState('');

  async function load() {
    const { data } = await api.get('/api/passengers');
    setRows(data.passengers);
  }
  async function loadRoutes() {
    const { data } = await api.get('/api/routes');
    setRoutes(data.routes);
  }
  useEffect(() => { load(); loadRoutes(); }, []);

  // stopId -> { stop name, route name } for the table's Stop column.
  const stopIndex = useMemo(() => {
    const m = {};
    for (const r of routes) for (const s of r.stops || []) m[s.id] = { stop: s.name, route: r.name };
    return m;
  }, [routes]);
  const stopsForRoute = routes.find((r) => r.id === form.routeId)?.stops || [];

  function set(k, v) { setForm((f) => ({ ...f, [k]: v })); }

  function openAdd() { setEditing(null); setForm(empty); setError(''); setOpen(true); }
  function openEdit(p) {
    setEditing(p);
    // Prefill the tagged route + stop so both can be changed from here too.
    setForm({
      ...empty, addGuardian: false,
      name: p.name || '', category: p.category || '', phone: p.phone || '',
      routeId: p.route?.id || '',
      stopId: p.stopAssignments?.[0]?.stopId || '',
    });
    setError(''); setOpen(true);
  }

  async function save() {
    setError('');
    try {
      if (editing) {
        await api.patch(`/api/passengers/${editing.id}`, {
          name: form.name, category: form.category, phone: form.phone,
          // '' -> null clears the tag; a value re-tags them.
          routeId: form.routeId || null,
          stopId: form.stopId || null,
        });
        setOpen(false); load();
        return;
      }
      const body = {
        name: form.name, category: form.category, phone: form.phone,
        ...(form.routeId ? { routeId: form.routeId } : {}),
        ...(form.stopId ? { stopId: form.stopId } : {}),
      };
      if (form.addGuardian && form.gPhone.trim()) {
        body.guardian = { name: form.gName || 'Parent', phone: form.gPhone.trim(), relation: form.gRelation };
      }
      const { data } = await api.post('/api/passengers', body);
      setOpen(false); setForm(empty);
      await load();
      // Surface the parent's sign-in details to hand over, if one was created.
      if (data.guardianCredentials?.password) {
        const c = data.guardianCredentials;
        setGCreds({ id: c.id, name: c.name, orgId: c.orgId || orgId, login: c.loginId, password: c.password,
          link: c.portalLink || parentLink(c.orgId || orgId, c.loginId) });
      }
    } catch (err) { setError(err.response?.data?.error || 'Failed'); }
  }

  async function archive(p) { await api.delete(`/api/passengers/${p.id}`); load(); }

  function openParentCreds(g) {
    setGCreds({
      id: g.id, name: g.name, orgId, login: g.loginId || g.phone, password: g.provisionalPassword,
      link: parentLink(orgId, g.loginId || g.phone),
    });
  }

  // Edit the parent's name / phone. Phone doubles as their login, so a change
  // here also changes their sign-in details (and the shareable portal link).
  function openGuardianEdit() {
    setGEditForm({ name: gCreds?.name || '', phone: gCreds?.login || '' });
    setGEditErr(''); setGEditOpen(true);
  }
  async function saveGuardianEdit() {
    if (gEditForm.name.trim().length < 2) return setGEditErr('Enter the parent’s name');
    if (gEditForm.phone.trim().length < 5) return setGEditErr('Enter a valid phone number');
    setGEditErr(''); setGEditBusy(true);
    try {
      const { data } = await api.patch(`/api/passengers/guardians/${gCreds.id}`, {
        name: gEditForm.name.trim(), phone: gEditForm.phone.trim(),
      });
      const g = data.guardian;
      // Login + portal link follow the phone.
      setGCreds((c) => c && { ...c, name: g.name, login: g.loginId, link: parentLink(c.orgId, g.loginId) });
      setGEditOpen(false);
      load();
    } catch (err) {
      setGEditErr(err.response?.data?.error || 'Failed');
    } finally { setGEditBusy(false); }
  }

  // Reset the parent's password — prefilled suggestion the admin can keep or edit.
  function openReset() {
    setResetPw(suggestPassword()); setResetErr(''); setResetOpen(true);
  }
  async function confirmReset() {
    if (resetPw.trim().length < 6) return setResetErr('Use at least 6 characters');
    setResetErr(''); setResetBusy(true);
    try {
      const { data } = await api.post(`/api/passengers/guardians/${gCreds.id}/reset-password`, { password: resetPw.trim() });
      setGCreds((c) => c && { ...c, password: data.guardian.provisionalPassword });
      setResetOpen(false);
      load();
    } catch (err) {
      setResetErr(err.response?.data?.error || 'Failed');
    } finally { setResetBusy(false); }
  }

  function copy(key, value) {
    if (!value) return;
    navigator.clipboard?.writeText(value);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 1500);
  }
  const waLink = (text) => `https://wa.me/?text=${encodeURIComponent(text)}`;
  const credsText = (c) =>
    `Parent login for ${c?.name}\nPortal: ${c?.link}\nOrg ID: ${c?.orgId}\nPhone: ${c?.login}\nPassword: ${c?.password}`;

  return (
    <Box>
      <PageHeader title="Passengers" crumbs={[{ label: 'Passengers' }]}
        action={<Button variant="contained" startIcon={<AddIcon />} onClick={openAdd}>Add Passenger</Button>} />
      <Card>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell>
              <Tooltip title="A neutral sub-group — class for schools, ward/department for hospitals, team for offices." arrow>
                <TableCell>Category</TableCell>
              </Tooltip>
              <TableCell>Stop</TableCell>
              <TableCell>Passenger phone</TableCell>
              <TableCell>Guardian</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((p) => {
              const g = p.guardians?.[0]?.guardian;
              const sid = p.stopAssignments?.[0]?.stopId;
              const stop = sid ? stopIndex[sid] : null;
              return (
                <TableRow key={p.id} hover>
                  <TableCell><b>{p.name}</b>{!p.active && <Chip size="small" label="archived" sx={{ ml: 1 }} />}</TableCell>
                  <TableCell>{p.category || '—'}</TableCell>
                  <TableCell>{stop ? <Tooltip title={stop.route} arrow><span>{stop.stop}</span></Tooltip> : '—'}</TableCell>
                  <TableCell>{p.phone || '—'}</TableCell>
                  <TableCell>{g ? <>{g.name}<Typography variant="caption" color="text.secondary" display="block">{g.phone}</Typography></> : '—'}</TableCell>
                  <TableCell align="right">
                    {g && (
                      <Tooltip title="Parent sign-in details — copy password & portal link to share" arrow>
                        <IconButton size="small" onClick={() => openParentCreds(g)}><KeyOutlinedIcon fontSize="small" /></IconButton>
                      </Tooltip>
                    )}
                    <Tooltip title="Edit passenger" arrow>
                      <IconButton size="small" onClick={() => openEdit(p)}><EditOutlinedIcon fontSize="small" /></IconButton>
                    </Tooltip>
                    {p.active && (
                      <Tooltip title="Archive — hides them and stops billing, but keeps trip history" arrow>
                        <IconButton size="small" onClick={() => archive(p)}><ArchiveOutlinedIcon fontSize="small" /></IconButton>
                      </Tooltip>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
            {rows.length === 0 && <TableRow><TableCell colSpan={6} align="center" sx={{ py: 5, color: 'text.secondary' }}>No passengers yet.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </Card>

      {/* Add / edit passenger */}
      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editing ? 'Edit Passenger' : 'Add Passenger'}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} mt={1}>
            {error && <Alert severity="error">{error}</Alert>}
            <TextField label="Passenger name" value={form.name} onChange={(e) => set('name', e.target.value)} />
            <TextField label="Category" value={form.category} onChange={(e) => set('category', e.target.value)}
              placeholder="e.g. Class 5B · Cardiology · Sales team"
              helperText="A neutral sub-group — class for schools, ward/department for hospitals, team for offices." />
            <TextField label="Passenger phone" value={form.phone} onChange={(e) => set('phone', e.target.value)}
              helperText="Optional — the passenger's own number, if they have one." />

            <Divider>Pickup / drop stop</Divider>
            <Stack direction="row" spacing={2}>
              <TextField select fullWidth label="Route" value={form.routeId}
                onChange={(e) => setForm((f) => ({ ...f, routeId: e.target.value, stopId: '' }))}
                helperText="Optional — pick the route first">
                <MenuItem value=""><em>None</em></MenuItem>
                {routes.map((r) => <MenuItem key={r.id} value={r.id}>{r.name}</MenuItem>)}
              </TextField>
              <TextField select fullWidth label="Stop" value={form.stopId}
                onChange={(e) => set('stopId', e.target.value)}
                disabled={!form.routeId}
                helperText={form.routeId && stopsForRoute.length === 0 ? 'This route has no stops' : 'Where they board/alight'}>
                <MenuItem value=""><em>None</em></MenuItem>
                {stopsForRoute.map((s) => <MenuItem key={s.id} value={s.id}>{s.sequence}. {s.name}</MenuItem>)}
              </TextField>
            </Stack>

            {!editing && (
              <>
                <FormControlLabel control={<Checkbox checked={form.addGuardian} onChange={(e) => set('addGuardian', e.target.checked)} />} label="Create a parent/guardian login" />
                {form.addGuardian && (
                  <>
                    <Divider>Guardian (parent login)</Divider>
                    <Alert severity="info" sx={{ py: 0.5 }}>
                      Parents sign in with their <b>phone number</b> — no email. We generate a password you can copy and share (e.g. on WhatsApp).
                    </Alert>
                    <TextField label="Guardian name" value={form.gName} onChange={(e) => set('gName', e.target.value)} placeholder="e.g. Priya Kumar" />
                    <Stack direction="row" spacing={2}>
                      <TextField label="Guardian phone (login)" value={form.gPhone} onChange={(e) => set('gPhone', e.target.value)} fullWidth
                        helperText="Must be unique — it's their login" />
                      <TextField label="Relation" value={form.gRelation} onChange={(e) => set('gRelation', e.target.value)} fullWidth />
                    </Stack>
                  </>
                )}
              </>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={save} disabled={form.name.trim().length < 2}>{editing ? 'Save' : 'Add'}</Button>
        </DialogActions>
      </Dialog>

      {/* Parent sign-in details — copyable, re-openable from any row. */}
      <Dialog open={!!gCreds} onClose={() => setGCreds(null)} maxWidth="xs" fullWidth
        PaperProps={{ sx: { borderRadius: 4 } }}>
        <DialogTitle sx={{ pb: 1.5 }}>
          <Stack direction="row" spacing={1.5} alignItems="center">
            <Avatar sx={{ bgcolor: 'primary.light', color: 'primary.main', width: 40, height: 40 }}><KeyOutlinedIcon /></Avatar>
            <Box sx={{ minWidth: 0 }}>
              <Typography fontWeight={800} noWrap>Parent sign-in details</Typography>
              <Typography variant="caption" color="text.secondary" noWrap>{gCreds?.name}</Typography>
            </Box>
          </Stack>
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2}>
            <Typography variant="body2" color="text.secondary">
              Share these so the parent can sign in on the parent portal.
            </Typography>
            <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 3, overflow: 'hidden', bgcolor: '#fbfbfe' }}>
              <CredRow label="Org ID" value={gCreds?.orgId} onCopy={() => copy('org', gCreds?.orgId)} copied={copiedKey === 'org'} />
              <Divider />
              <CredRow label="Phone (login)" value={gCreds?.login} onCopy={() => copy('login', gCreds?.login)} copied={copiedKey === 'login'} />
              <Divider />
              <CredRow label="Password" value={gCreds?.password} onCopy={() => copy('pass', gCreds?.password)} copied={copiedKey === 'pass'} />
              <Divider />
              <CredRow label="Portal link" value={gCreds?.link} onCopy={() => copy('link', gCreds?.link)} copied={copiedKey === 'link'} small />
            </Box>
            <Stack direction="row" spacing={1}>
              <Button fullWidth variant="outlined" sx={{ borderRadius: 2.5 }}
                startIcon={copiedKey === 'all' ? <CheckRoundedIcon /> : <ContentCopyIcon />}
                onClick={() => copy('all', credsText(gCreds))}>
                {copiedKey === 'all' ? 'Copied' : 'Copy all'}
              </Button>
              <Button fullWidth variant="contained" color="success" sx={{ borderRadius: 2.5 }}
                startIcon={<WhatsAppIcon />} component="a" href={waLink(credsText(gCreds))} target="_blank" rel="noopener">
                WhatsApp
              </Button>
            </Stack>
            <Typography variant="caption" color="text.secondary" textAlign="center">
              Opens the parent portal with the phone prefilled — the parent just enters their password.
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2, justifyContent: 'space-between' }}>
          <Stack direction="row" spacing={0.5}>
            <Button startIcon={<EditOutlinedIcon />} onClick={openGuardianEdit} disabled={!gCreds?.id}>
              Edit details
            </Button>
            <Button startIcon={<RestartAltIcon />} color="warning" onClick={openReset} disabled={!gCreds?.id}>
              Reset password
            </Button>
          </Stack>
          <Button variant="contained" onClick={() => setGCreds(null)} sx={{ borderRadius: 2.5, px: 3 }}>Done</Button>
        </DialogActions>
      </Dialog>

      {/* Edit parent details — phone is their login, so warn on change. */}
      <Dialog open={gEditOpen} onClose={() => setGEditOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Edit parent details</DialogTitle>
        <DialogContent>
          <Stack spacing={2} mt={1}>
            {gEditErr && <Alert severity="error">{gEditErr}</Alert>}
            <TextField autoFocus label="Parent name" value={gEditForm.name} fullWidth
              onChange={(e) => setGEditForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Priya Kumar" />
            <TextField label="Phone (their login)" value={gEditForm.phone} fullWidth
              onChange={(e) => setGEditForm((f) => ({ ...f, phone: e.target.value }))}
              helperText="Must be unique in your organization" />
            {gEditForm.phone.trim() !== (gCreds?.login || '') && gEditForm.phone.trim() && (
              <Alert severity="warning" sx={{ py: 0.5 }}>
                Changing the phone changes how this parent signs in — re-share their sign-in details afterwards. Their password stays the same.
              </Alert>
            )}
            <Typography variant="caption" color="text.secondary">
              This parent may be linked to several passengers — these details apply to all of them.
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setGEditOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={saveGuardianEdit}
            disabled={gEditBusy || gEditForm.name.trim().length < 2 || gEditForm.phone.trim().length < 5}>
            {gEditBusy ? 'Saving…' : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Reset parent password — prefilled with a suggestion, freely editable. */}
      <Dialog open={resetOpen} onClose={() => setResetOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Reset password — {gCreds?.name}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} mt={1}>
            {resetErr && <Alert severity="error">{resetErr}</Alert>}
            <Typography variant="body2" color="text.secondary">
              Keep this suggested password, or type your own. The parent signs in with it.
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
          <Button onClick={() => setResetOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={confirmReset} disabled={resetBusy || resetPw.trim().length < 6}>
            {resetBusy ? 'Saving…' : 'Set password'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

function CredRow({ label, value, onCopy, copied, small }) {
  return (
    <Stack direction="row" alignItems="center" spacing={1} sx={{ px: 2, py: 1.4 }}>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography sx={{ textTransform: 'uppercase', letterSpacing: 0.5, fontSize: 11, fontWeight: 700, color: 'text.secondary' }}>{label}</Typography>
        <Typography sx={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontWeight: 700,
          fontSize: small ? 12.5 : 15, color: 'text.primary', wordBreak: 'break-all', lineHeight: 1.35 }}>
          {value || '—'}
        </Typography>
      </Box>
      <Tooltip title={copied ? 'Copied!' : 'Copy'} arrow>
        <IconButton size="small" onClick={onCopy} sx={{ color: copied ? 'success.main' : 'text.secondary', flexShrink: 0 }}>
          {copied ? <CheckRoundedIcon fontSize="small" /> : <ContentCopyIcon fontSize="small" />}
        </IconButton>
      </Tooltip>
    </Stack>
  );
}
