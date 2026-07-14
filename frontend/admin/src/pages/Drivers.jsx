import { useEffect, useState } from 'react';
import {
  Box, Typography, Button, Card, Table, TableBody, TableCell, TableHead, TableRow,
  Chip, Dialog, DialogTitle, DialogContent, DialogActions, TextField, Stack, Alert,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import { api } from '../lib/api.js';
import PageHeader from '../components/PageHeader.jsx';

const empty = { name: '', email: '', password: '', phone: '', licenseNumber: '' };

export default function Drivers() {
  const [rows, setRows] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(empty);
  const [error, setError] = useState('');

  async function load() {
    const { data } = await api.get('/api/drivers');
    setRows(data.drivers);
  }
  useEffect(() => { load(); }, []);

  async function create() {
    setError('');
    try {
      await api.post('/api/drivers', form);
      setOpen(false); setForm(empty); load();
    } catch (err) { setError(err.response?.data?.error || 'Failed'); }
  }

  return (
    <Box>
      <PageHeader title="Drivers" crumbs={[{ label: 'Drivers' }]}
        action={<Button variant="contained" startIcon={<AddIcon />} onClick={() => setOpen(true)}>Add Driver</Button>} />
      <Card>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell>Email (login)</TableCell>
              <TableCell>Phone</TableCell>
              <TableCell>License</TableCell>
              <TableCell>Status</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((d) => (
              <TableRow key={d.id} hover>
                <TableCell><b>{d.name}</b></TableCell>
                <TableCell>{d.email}</TableCell>
                <TableCell>{d.phone || '—'}</TableCell>
                <TableCell>{d.driverProfile?.licenseNumber || '—'}</TableCell>
                <TableCell><Chip size="small" label={d.status} color={d.status === 'ACTIVE' ? 'success' : 'default'} /></TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && <TableRow><TableCell colSpan={5} align="center" sx={{ py: 5, color: 'text.secondary' }}>No drivers yet.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Add Driver</DialogTitle>
        <DialogContent>
          <Stack spacing={2} mt={1}>
            {error && <Alert severity="error">{error}</Alert>}
            <TextField label="Full name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <TextField label="Email (used to log into the driver app)" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            <TextField label="Password" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} helperText="min 6 characters" />
            <TextField label="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            <TextField label="License number" value={form.licenseNumber} onChange={(e) => setForm({ ...form, licenseNumber: e.target.value })} />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={create}>Add</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
