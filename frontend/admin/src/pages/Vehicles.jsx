import { useEffect, useState } from 'react';
import {
  Box, Typography, Button, Card, Table, TableBody, TableCell, TableHead, TableRow,
  Chip, Dialog, DialogTitle, DialogContent, DialogActions, TextField, Stack, Alert,
  IconButton, Tooltip,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import { api } from '../lib/api.js';
import PageHeader from '../components/PageHeader.jsx';

export default function Vehicles() {
  const [rows, setRows] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ regNumber: '', capacity: 40 });
  const [error, setError] = useState('');

  async function load() {
    const { data } = await api.get('/api/vehicles');
    setRows(data.vehicles);
  }
  useEffect(() => { load(); }, []);

  async function create() {
    setError('');
    try {
      await api.post('/api/vehicles', { regNumber: form.regNumber, capacity: Number(form.capacity) });
      setOpen(false);
      setForm({ regNumber: '', capacity: 40 });
      load();
    } catch (err) { setError(err.response?.data?.error || 'Failed'); }
  }

  async function remove(id) {
    await api.delete(`/api/vehicles/${id}`);
    load();
  }

  return (
    <Box>
      <PageHeader title="Vehicles" crumbs={[{ label: 'Vehicles' }]}
        action={<Button variant="contained" startIcon={<AddIcon />} onClick={() => setOpen(true)}>Add Vehicle</Button>} />
      <Card>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Registration</TableCell>
              <TableCell align="center">Capacity</TableCell>
              <TableCell>Status</TableCell>
              <TableCell align="right">Action</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((v) => (
              <TableRow key={v.id} hover>
                <TableCell><b>{v.regNumber}</b></TableCell>
                <TableCell align="center">{v.capacity}</TableCell>
                <TableCell><Chip size="small" label={v.active ? 'Active' : 'Inactive'} color={v.active ? 'success' : 'default'} /></TableCell>
                <TableCell align="right">
                  <Tooltip title="Remove"><IconButton onClick={() => remove(v.id)}><DeleteIcon color="error" /></IconButton></Tooltip>
                </TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && <TableRow><TableCell colSpan={4} align="center" sx={{ py: 5, color: 'text.secondary' }}>No vehicles yet.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Add Vehicle</DialogTitle>
        <DialogContent>
          <Stack spacing={2} mt={1}>
            {error && <Alert severity="error">{error}</Alert>}
            <TextField label="Registration number" value={form.regNumber} onChange={(e) => setForm({ ...form, regNumber: e.target.value })} placeholder="KL-01-AB-1234" />
            <TextField label="Capacity" type="number" value={form.capacity} onChange={(e) => setForm({ ...form, capacity: e.target.value })} />
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
