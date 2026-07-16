import { useEffect, useState } from 'react';
import {
  Box, Typography, Button, Card, Table, TableBody, TableCell, TableHead, TableRow,
  Chip, Dialog, DialogTitle, DialogContent, DialogActions, TextField,
  Stack, Alert, FormControlLabel, Switch, Tooltip, IconButton, Snackbar,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/EditOutlined';
import DeleteIcon from '@mui/icons-material/DeleteOutline';
import { api } from '../lib/api.js';
import PageHeader from '../components/PageHeader.jsx';

const emptyForm = { key: '', name: '', active: true };

// A type's `key` is a stable code other code can branch on, so it is only
// settable at creation — editing is limited to the display fields.
export default function OrgTypes() {
  const [orgTypes, setOrgTypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null); // null = creating
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState(null);
  const [toast, setToast] = useState('');

  async function load() {
    setLoading(true);
    const { data } = await api.get('/api/org-types');
    setOrgTypes(data.orgTypes);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  function openCreate() {
    setEditing(null); setForm(emptyForm); setError(''); setOpen(true);
  }
  function openEdit(t) {
    setEditing(t);
    setForm({ key: t.key, name: t.name, active: t.active });
    setError(''); setOpen(true);
  }

  const canSubmit = form.name.trim() && (editing || form.key.trim());

  async function save() {
    setError('');
    try {
      if (editing) {
        const { name, active } = form;
        await api.patch(`/api/org-types/${editing.id}`, { name, active });
        setToast(`Updated ${name}`);
      } else {
        await api.post('/api/org-types', form);
        setToast(`Added ${form.name}`);
      }
      setOpen(false);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not save the organization type');
    }
  }

  async function remove(t) {
    try {
      await api.delete(`/api/org-types/${t.id}`);
      setToast(`Deleted ${t.name}`);
      setConfirm(null);
      load();
    } catch (err) {
      // The in-use guard lands here — keep the dialog open and show why.
      setError(err.response?.data?.error || 'Could not delete this organization type');
    }
  }

  return (
    <Box>
      <PageHeader
        title="Organization Types"
        crumbs={[{ label: 'Organization Types' }]}
        action={(
          <Tooltip title="Creates a new category (e.g. University, Factory). It then appears in the type dropdown next time you add an organization. Doesn't change any existing organization.">
            <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>Add organization type</Button>
          </Tooltip>
        )}
      />

      <Typography color="text.secondary" variant="body2" mb={2}>
        The category an organization belongs to — school, hospital, office, and so on.
        Used to group and filter organizations.
      </Typography>

      <Card sx={{ overflowX: 'auto' }}>
        <Table sx={{ minWidth: 620 }}>
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell>
                <Tooltip title="A fixed internal code for this type. Set once when the type is created and can never be changed — rename using the Name column instead.">
                  <span style={{ cursor: 'help', borderBottom: '1px dotted #b6bacb' }}>Key</span>
                </Tooltip>
              </TableCell>
              <TableCell align="center">
                <Tooltip title="How many organizations currently use this type. A type in use cannot be deleted.">
                  <span style={{ cursor: 'help', borderBottom: '1px dotted #b6bacb' }}>Organizations</span>
                </Tooltip>
              </TableCell>
              <TableCell>
                <Tooltip title="Active types can be picked when creating a new organization. Inactive ones are hidden from that list.">
                  <span style={{ cursor: 'help', borderBottom: '1px dotted #b6bacb' }}>Status</span>
                </Tooltip>
              </TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {orgTypes.map((t) => {
              const inUse = t._count?.tenants ?? 0;
              return (
                <TableRow key={t.id} hover>
                  <TableCell><b>{t.name}</b></TableCell>
                  <TableCell><code>{t.key}</code></TableCell>
                  <TableCell align="center">
                    <Tooltip title={inUse
                      ? `${inUse} organization${inUse === 1 ? '' : 's'} currently use this type, so it can't be deleted.`
                      : 'No organization uses this type, so it can be deleted safely.'}>
                      <span style={{ cursor: 'help' }}>{inUse}</span>
                    </Tooltip>
                  </TableCell>
                  <TableCell>
                    <Tooltip title={t.active
                      ? 'Can be picked when creating a new organization.'
                      : 'Hidden when creating a new organization. Organizations already using it keep working normally.'}>
                      <Chip size="small" label={t.active ? 'Active' : 'Inactive'} color={t.active ? 'success' : 'default'} />
                    </Tooltip>
                  </TableCell>
                  <TableCell align="right">
                    <Tooltip title={`Rename “${t.name}” or turn it on/off for new organizations. The Key stays fixed.`}>
                      <IconButton size="small" onClick={() => openEdit(t)}><EditIcon fontSize="small" /></IconButton>
                    </Tooltip>
                    <Tooltip title={inUse
                      ? `Can't delete — ${inUse} organization${inUse === 1 ? '' : 's'} still use “${t.name}”. Move them to another type first, or edit this type and switch it off to hide it from new organizations.`
                      : `Permanently delete “${t.name}”. No organization uses it, so nothing will break.`}>
                      {/* span keeps the tooltip alive on the disabled button */}
                      <span>
                        <IconButton size="small" disabled={inUse > 0}
                          onClick={() => { setError(''); setConfirm(t); }}>
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </span>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              );
            })}
            {!loading && !orgTypes.length && (
              <TableRow>
                <TableCell colSpan={5}>
                  <Typography color="text.secondary" align="center" py={3}>
                    No organization types yet — add one to start creating organizations.
                  </Typography>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>

      {/* Create / edit */}
      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle sx={{ pb: 0.5 }}>
          {editing ? `Edit ${editing.name}` : 'Add an organization type'}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2.5} mt={1}>
            {error && <Alert severity="error">{error}</Alert>}

            <TextField required label="Name" placeholder="e.g. University" value={form.name}
              onChange={(e) => set('name', e.target.value)}
              helperText="Shown in the organization type dropdown" />

            <TextField required label="Key" placeholder="e.g. UNIVERSITY" value={form.key}
              onChange={(e) => set('key', e.target.value.toUpperCase())}
              disabled={!!editing}
              inputProps={{ style: { textTransform: 'uppercase' } }}
              helperText={editing
                ? 'The key is fixed once created — rename using the Name field instead'
                : 'A stable code used internally. Letters, numbers and underscores.'} />

            <FormControlLabel
              control={<Switch checked={form.active} onChange={() => set('active', !form.active)} />}
              label={
                <Box>
                  <Typography variant="body2" fontWeight={600}>Active</Typography>
                  <Typography variant="caption" color="text.secondary">
                    Inactive types are hidden when creating a new organization. Existing organizations keep working.
                  </Typography>
                </Box>
              }
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={save} disabled={!canSubmit}>
            {editing ? 'Save changes' : 'Create type'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog open={!!confirm} onClose={() => setConfirm(null)} fullWidth maxWidth="xs">
        <DialogTitle>Delete “{confirm?.name}” permanently?</DialogTitle>
        <DialogContent>
          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
          <Typography variant="body2" color="text.secondary">
            No organization uses this type, so nothing will break — it just disappears from the
            list of types you can pick. This can’t be undone.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setConfirm(null)}>Cancel</Button>
          <Button color="error" variant="contained" onClick={() => remove(confirm)}>Delete type</Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={!!toast} autoHideDuration={2500} onClose={() => setToast('')} message={toast}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }} />
    </Box>
  );
}
