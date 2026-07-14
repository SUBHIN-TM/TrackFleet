import { useEffect, useState } from 'react';
import {
  Box, Typography, Button, Card, Table, TableBody, TableCell, TableHead, TableRow,
  Dialog, DialogTitle, DialogContent, DialogActions, TextField, Stack, Alert,
  FormControlLabel, Checkbox, Divider, Chip,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import { api } from '../lib/api.js';
import PageHeader from '../components/PageHeader.jsx';

const empty = {
  name: '', grade: '', homeAddress: '', homeLat: '', homeLng: '',
  addGuardian: true, gName: '', gEmail: '', gPassword: '', gPhone: '', gRelation: 'Parent',
};

export default function Passengers() {
  const [rows, setRows] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(empty);
  const [error, setError] = useState('');

  async function load() {
    const { data } = await api.get('/api/passengers');
    setRows(data.passengers);
  }
  useEffect(() => { load(); }, []);

  function set(k, v) { setForm((f) => ({ ...f, [k]: v })); }

  async function create() {
    setError('');
    try {
      const body = {
        name: form.name, grade: form.grade, homeAddress: form.homeAddress,
        ...(form.homeLat ? { homeLat: Number(form.homeLat) } : {}),
        ...(form.homeLng ? { homeLng: Number(form.homeLng) } : {}),
      };
      if (form.addGuardian && form.gEmail) {
        body.guardian = { name: form.gName, email: form.gEmail, password: form.gPassword, phone: form.gPhone, relation: form.gRelation };
      }
      await api.post('/api/passengers', body);
      setOpen(false); setForm(empty); load();
    } catch (err) { setError(err.response?.data?.error || 'Failed'); }
  }

  return (
    <Box>
      <PageHeader title="Students" crumbs={[{ label: 'Students' }]}
        action={<Button variant="contained" startIcon={<AddIcon />} onClick={() => setOpen(true)}>Add Student</Button>} />
      <Card>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell>Class</TableCell>
              <TableCell>Home address</TableCell>
              <TableCell>Guardian</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((p) => (
              <TableRow key={p.id} hover>
                <TableCell><b>{p.name}</b>{!p.active && <Chip size="small" label="archived" sx={{ ml: 1 }} />}</TableCell>
                <TableCell>{p.grade || '—'}</TableCell>
                <TableCell>{p.homeAddress || '—'}</TableCell>
                <TableCell>{p.guardians?.[0]?.guardian?.name || '—'}</TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && <TableRow><TableCell colSpan={4} align="center" sx={{ py: 5, color: 'text.secondary' }}>No students yet.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Add Student</DialogTitle>
        <DialogContent>
          <Stack spacing={2} mt={1}>
            {error && <Alert severity="error">{error}</Alert>}
            <TextField label="Student name" value={form.name} onChange={(e) => set('name', e.target.value)} />
            <TextField label="Class / grade" value={form.grade} onChange={(e) => set('grade', e.target.value)} />
            <TextField label="Home address" value={form.homeAddress} onChange={(e) => set('homeAddress', e.target.value)} />
            <Stack direction="row" spacing={2}>
              <TextField label="Home latitude" value={form.homeLat} onChange={(e) => set('homeLat', e.target.value)} fullWidth />
              <TextField label="Home longitude" value={form.homeLng} onChange={(e) => set('homeLng', e.target.value)} fullWidth />
            </Stack>
            <FormControlLabel control={<Checkbox checked={form.addGuardian} onChange={(e) => set('addGuardian', e.target.checked)} />} label="Create a parent/guardian login" />
            {form.addGuardian && (
              <>
                <Divider>Guardian (parent login)</Divider>
                <TextField label="Guardian name" value={form.gName} onChange={(e) => set('gName', e.target.value)} />
                <TextField label="Guardian email (parent login)" value={form.gEmail} onChange={(e) => set('gEmail', e.target.value)} />
                <TextField label="Guardian password" type="password" value={form.gPassword} onChange={(e) => set('gPassword', e.target.value)} helperText="min 6 characters" />
                <Stack direction="row" spacing={2}>
                  <TextField label="Phone" value={form.gPhone} onChange={(e) => set('gPhone', e.target.value)} fullWidth />
                  <TextField label="Relation" value={form.gRelation} onChange={(e) => set('gRelation', e.target.value)} fullWidth />
                </Stack>
              </>
            )}
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
