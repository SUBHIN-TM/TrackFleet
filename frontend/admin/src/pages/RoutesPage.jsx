import { useEffect, useState } from 'react';
import {
  Box, Typography, Button, Card, CardContent, List, ListItemButton, ListItemText,
  Dialog, DialogTitle, DialogContent, DialogActions, TextField, Stack, Alert,
  MenuItem, Divider, IconButton, Chip, Table, TableBody, TableCell, TableRow, TableHead, Tooltip,
} from '@mui/material';
import Grid from '@mui/material/Grid2';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import PersonAddIcon from '@mui/icons-material/PersonAdd';
import { api } from '../lib/api.js';
import PageHeader from '../components/PageHeader.jsx';

export default function RoutesPage() {
  const [routes, setRoutes] = useState([]);
  const [selected, setSelected] = useState(null);
  const [passengers, setPassengers] = useState([]);
  const [routeDlg, setRouteDlg] = useState(false);
  const [stopDlg, setStopDlg] = useState(false);
  const [assignDlg, setAssignDlg] = useState(false);
  const [routeForm, setRouteForm] = useState({ name: '', direction: 'PICKUP' });
  const [stopForm, setStopForm] = useState({ name: '', lat: '', lng: '', scheduledTime: '', geofenceRadius: 150 });
  const [assignForm, setAssignForm] = useState({ passengerId: '', stopId: '' });
  const [error, setError] = useState('');

  async function loadRoutes(keepId) {
    const { data } = await api.get('/api/routes');
    setRoutes(data.routes);
    const keep = keepId || selected?.id;
    setSelected(keep ? data.routes.find((r) => r.id === keep) || data.routes[0] : data.routes[0] || null);
  }
  useEffect(() => {
    loadRoutes();
    api.get('/api/passengers').then(({ data }) => setPassengers(data.passengers));
  }, []);

  async function createRoute() {
    setError('');
    try {
      const { data } = await api.post('/api/routes', routeForm);
      setRouteDlg(false); setRouteForm({ name: '', direction: 'PICKUP' });
      await loadRoutes(data.route.id);
    } catch (err) { setError(err.response?.data?.error || 'Failed'); }
  }

  async function addStop() {
    setError('');
    try {
      const seq = (selected.stops?.length || 0) + 1;
      await api.post(`/api/routes/${selected.id}/stops`, {
        name: stopForm.name, lat: Number(stopForm.lat), lng: Number(stopForm.lng),
        geofenceRadius: Number(stopForm.geofenceRadius), scheduledTime: stopForm.scheduledTime, sequence: seq,
      });
      setStopDlg(false); setStopForm({ name: '', lat: '', lng: '', scheduledTime: '', geofenceRadius: 150 });
      await loadRoutes(selected.id);
    } catch (err) { setError(err.response?.data?.error || 'Failed'); }
  }

  async function delStop(stopId) {
    await api.delete(`/api/routes/${selected.id}/stops/${stopId}`);
    await loadRoutes(selected.id);
  }

  async function assign() {
    setError('');
    try {
      await api.post(`/api/routes/${selected.id}/assign`, assignForm);
      setAssignDlg(false); setAssignForm({ passengerId: '', stopId: '' });
      await loadRoutes(selected.id);
    } catch (err) { setError(err.response?.data?.error || 'Failed'); }
  }

  return (
    <Box>
      <PageHeader title="Routes & Stops" crumbs={[{ label: 'Routes & Stops' }]}
        action={<Button variant="contained" startIcon={<AddIcon />} onClick={() => setRouteDlg(true)}>New Route</Button>} />

      <Grid container spacing={3}>
        <Grid size={{ xs: 12, md: 4 }}>
          <Card>
            <CardContent><Typography variant="subtitle2" color="text.secondary">ROUTES</Typography></CardContent>
            <List dense>
              {routes.map((r) => (
                <ListItemButton key={r.id} selected={selected?.id === r.id} onClick={() => setSelected(r)}>
                  <ListItemText primary={r.name} secondary={`${r.direction} · ${r.stops?.length || 0} stops`} />
                </ListItemButton>
              ))}
              {routes.length === 0 && <Box sx={{ p: 2, color: 'text.secondary' }}>No routes yet.</Box>}
            </List>
          </Card>
        </Grid>

        <Grid size={{ xs: 12, md: 8 }}>
          {selected ? (
            <Card>
              <CardContent>
                <Stack direction="row" justifyContent="space-between" alignItems="center" mb={1}>
                  <Box>
                    <Typography variant="h6" fontWeight={700}>{selected.name}</Typography>
                    <Chip size="small" label={selected.direction} sx={{ mt: 0.5 }} />
                  </Box>
                  <Stack direction="row" spacing={1}>
                    <Button size="small" startIcon={<PersonAddIcon />} disabled={!selected.stops?.length} onClick={() => setAssignDlg(true)}>Assign Student</Button>
                    <Button size="small" variant="contained" startIcon={<AddIcon />} onClick={() => setStopDlg(true)}>Add Stop</Button>
                  </Stack>
                </Stack>
                <Divider sx={{ my: 1 }} />
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>#</TableCell>
                      <TableCell>Stop</TableCell>
                      <TableCell>Time</TableCell>
                      <TableCell>Coords</TableCell>
                      <TableCell>Students</TableCell>
                      <TableCell />
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {selected.stops?.map((s) => (
                      <TableRow key={s.id}>
                        <TableCell>{s.sequence}</TableCell>
                        <TableCell><b>{s.name}</b></TableCell>
                        <TableCell>{s.scheduledTime || '—'}</TableCell>
                        <TableCell>{s.lat.toFixed(3)}, {s.lng.toFixed(3)}</TableCell>
                        <TableCell>
                          {s.assignments?.length
                            ? s.assignments.map((a) => a.passenger.name).join(', ')
                            : <span style={{ color: '#999' }}>none</span>}
                        </TableCell>
                        <TableCell align="right">
                          <Tooltip title="Delete stop"><IconButton size="small" onClick={() => delStop(s.id)}><DeleteIcon fontSize="small" color="error" /></IconButton></Tooltip>
                        </TableCell>
                      </TableRow>
                    ))}
                    {!selected.stops?.length && <TableRow><TableCell colSpan={6} align="center" sx={{ py: 3, color: 'text.secondary' }}>No stops — add the first stop.</TableCell></TableRow>}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ) : (
            <Card><CardContent sx={{ py: 6, textAlign: 'center', color: 'text.secondary' }}>Select or create a route.</CardContent></Card>
          )}
        </Grid>
      </Grid>

      {/* New route */}
      <Dialog open={routeDlg} onClose={() => setRouteDlg(false)} maxWidth="xs" fullWidth>
        <DialogTitle>New Route</DialogTitle>
        <DialogContent>
          <Stack spacing={2} mt={1}>
            {error && <Alert severity="error">{error}</Alert>}
            <TextField label="Route name" value={routeForm.name} onChange={(e) => setRouteForm({ ...routeForm, name: e.target.value })} placeholder="Route 7 - Kazhakkoottam Line" />
            <TextField select label="Direction" value={routeForm.direction} onChange={(e) => setRouteForm({ ...routeForm, direction: e.target.value })}>
              <MenuItem value="PICKUP">Pickup (morning)</MenuItem>
              <MenuItem value="DROP">Drop (evening)</MenuItem>
              <MenuItem value="BOTH">Both</MenuItem>
            </TextField>
          </Stack>
        </DialogContent>
        <DialogActions><Button onClick={() => setRouteDlg(false)}>Cancel</Button><Button variant="contained" onClick={createRoute}>Create</Button></DialogActions>
      </Dialog>

      {/* Add stop */}
      <Dialog open={stopDlg} onClose={() => setStopDlg(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Add Stop</DialogTitle>
        <DialogContent>
          <Stack spacing={2} mt={1}>
            {error && <Alert severity="error">{error}</Alert>}
            <TextField label="Stop name" value={stopForm.name} onChange={(e) => setStopForm({ ...stopForm, name: e.target.value })} />
            <Stack direction="row" spacing={2}>
              <TextField label="Latitude" value={stopForm.lat} onChange={(e) => setStopForm({ ...stopForm, lat: e.target.value })} fullWidth />
              <TextField label="Longitude" value={stopForm.lng} onChange={(e) => setStopForm({ ...stopForm, lng: e.target.value })} fullWidth />
            </Stack>
            <Stack direction="row" spacing={2}>
              <TextField label="Scheduled time" value={stopForm.scheduledTime} onChange={(e) => setStopForm({ ...stopForm, scheduledTime: e.target.value })} placeholder="07:15" fullWidth />
              <TextField label="Geofence (m)" type="number" value={stopForm.geofenceRadius} onChange={(e) => setStopForm({ ...stopForm, geofenceRadius: e.target.value })} fullWidth />
            </Stack>
          </Stack>
        </DialogContent>
        <DialogActions><Button onClick={() => setStopDlg(false)}>Cancel</Button><Button variant="contained" onClick={addStop}>Add</Button></DialogActions>
      </Dialog>

      {/* Assign student */}
      <Dialog open={assignDlg} onClose={() => setAssignDlg(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Assign Student to Stop</DialogTitle>
        <DialogContent>
          <Stack spacing={2} mt={1}>
            {error && <Alert severity="error">{error}</Alert>}
            <TextField select label="Student" value={assignForm.passengerId} onChange={(e) => setAssignForm({ ...assignForm, passengerId: e.target.value })}>
              {passengers.map((p) => <MenuItem key={p.id} value={p.id}>{p.name} {p.grade ? `(${p.grade})` : ''}</MenuItem>)}
            </TextField>
            <TextField select label="Stop" value={assignForm.stopId} onChange={(e) => setAssignForm({ ...assignForm, stopId: e.target.value })}>
              {selected?.stops?.map((s) => <MenuItem key={s.id} value={s.id}>{s.sequence}. {s.name}</MenuItem>)}
            </TextField>
          </Stack>
        </DialogContent>
        <DialogActions><Button onClick={() => setAssignDlg(false)}>Cancel</Button><Button variant="contained" onClick={assign}>Assign</Button></DialogActions>
      </Dialog>
    </Box>
  );
}
