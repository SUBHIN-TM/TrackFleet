import { useEffect, useState } from 'react';
import {
  Box, Typography, Button, Card, Table, TableBody, TableCell, TableHead, TableRow,
  Dialog, DialogTitle, DialogContent, DialogActions, TextField, Stack, Alert,
  MenuItem, Chip, IconButton, Tooltip, ToggleButton, ToggleButtonGroup, Divider, Skeleton,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import ArchiveOutlinedIcon from '@mui/icons-material/ArchiveOutlined';
import UnarchiveOutlinedIcon from '@mui/icons-material/UnarchiveOutlined';
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined';
import polyline from '@mapbox/polyline';
import { api } from '../lib/api.js';
import PageHeader from '../components/PageHeader.jsx';
import PlatformMap from '../components/PlatformMap.jsx';

// Mon=1 … Sun=7 (matches TripSchedule.daysOfWeek).
const DAYS = [['Mon', 1], ['Tue', 2], ['Wed', 3], ['Thu', 4], ['Fri', 5], ['Sat', 6], ['Sun', 7]];
const DIRECTIONS = { PICKUP: 'Pickup', DROP: 'Drop', BOTH: 'Both' };
const vehicleLabel = (v) => (v ? `${v.fleetNo ? v.fleetNo + ' · ' : ''}${v.regNumber}` : '—');
const daysLabel = (arr) => {
  const s = [...(arr || [])].sort((a, b) => a - b);
  if (s.join() === '1,2,3,4,5') return 'Mon–Fri';
  if (s.join() === '1,2,3,4,5,6,7') return 'Every day';
  return DAYS.filter(([, n]) => s.includes(n)).map(([l]) => l).join(', ') || '—';
};

const empty = { name: '', routeId: '', vehicleId: '', driverId: '', direction: 'PICKUP', daysOfWeek: [1, 2, 3, 4, 5], startTime: '07:00' };

// Next free "Schedule N" — scans existing names so deleting #2 doesn't collide.
function nextScheduleName(rows) {
  let max = 0;
  for (const s of rows) {
    const m = /^Schedule (\d+)$/i.exec(s.name || '');
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `Schedule ${Math.max(max, rows.length) + 1}`;
}

export default function Schedules() {
  const [rows, setRows] = useState([]);
  const [routes, setRoutes] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(empty);
  const [error, setError] = useState('');
  // Detail view: the schedule being inspected + its full route (stops/passengers).
  const [viewSched, setViewSched] = useState(null);
  const [viewRoute, setViewRoute] = useState(null);
  const [viewLine, setViewLine] = useState([]);
  const [tileUrl, setTileUrl] = useState('');
  const [styleUrl, setStyleUrl] = useState('');

  async function load() {
    const { data } = await api.get('/api/schedules');
    setRows(data.schedules);
  }
  useEffect(() => {
    load();
    api.get('/api/routes').then(({ data }) => setRoutes(data.routes));
    api.get('/api/vehicles').then(({ data }) => setVehicles(data.vehicles || data));
    api.get('/api/drivers').then(({ data }) => setDrivers((data.drivers || []).filter((d) => d.status !== 'DISABLED')));
    api.get('/api/map/config').then(({ data }) => { setTileUrl(data.tileUrlTemplate); setStyleUrl(data.styleUrl || ''); }).catch(() => {});
  }, []);

  async function openView(s) {
    setViewSched(s); setViewRoute(null); setViewLine([]);
    try {
      const { data } = await api.get(`/api/routes/${s.route.id}`);
      setViewRoute(data.route);
      const stops = data.route.stops || [];
      if (stops.length >= 2) {
        const { data: r } = await api.post('/api/map/route', { waypoints: stops.map((x) => ({ lat: x.lat, lng: x.lng })) });
        setViewLine(polyline.decode(r.geometry).map(([lat, lng]) => [lng, lat]));
      }
    } catch { /* route may have been deleted; dialog will show what it has */ }
  }

  function set(k, v) { setForm((f) => ({ ...f, [k]: v })); }
  function openAdd() {
    setEditing(null);
    setForm({ ...empty, name: nextScheduleName(rows) });
    setError(''); setOpen(true);
  }
  function openEdit(s) {
    setEditing(s);
    setForm({ name: s.name || '', routeId: s.route.id, vehicleId: s.vehicle.id, driverId: s.driver.id,
      direction: s.direction, daysOfWeek: s.daysOfWeek || [], startTime: s.startTime });
    setError(''); setOpen(true);
  }

  async function save() {
    setError('');
    if (form.daysOfWeek.length === 0) return setError('Pick at least one day');
    try {
      if (editing) await api.patch(`/api/schedules/${editing.id}`, form);
      else await api.post('/api/schedules', form);
      setOpen(false); load();
    } catch (err) { setError(err.response?.data?.error || 'Failed'); }
  }

  async function archive(s) { await api.delete(`/api/schedules/${s.id}`); load(); }
  async function restore(s) { await api.patch(`/api/schedules/${s.id}`, { active: true }); load(); }

  return (
    <Box>
      <PageHeader title="Schedules" crumbs={[{ label: 'Schedules' }]}
        action={<Button variant="contained" startIcon={<AddIcon />} onClick={openAdd}>New Schedule</Button>} />
      <Card>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell>Route</TableCell>
              <TableCell>Vehicle</TableCell>
              <TableCell>Driver</TableCell>
              <TableCell>Direction</TableCell>
              <TableCell>Days</TableCell>
              <TableCell>Time</TableCell>
              <TableCell>Status</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((s) => {
              const off = !s.active;
              return (
                <TableRow key={s.id} hover onClick={() => openView(s)}
                  sx={{ cursor: 'pointer', ...(off ? { opacity: 0.55 } : {}) }}>
                  <TableCell><b>{s.name}</b></TableCell>
                  <TableCell>{s.route?.name}</TableCell>
                  <TableCell>{vehicleLabel(s.vehicle)}</TableCell>
                  <TableCell>{s.driver?.name}{s.driver?.loginId ? <Typography variant="caption" color="text.secondary" display="block">{s.driver.loginId}</Typography> : null}</TableCell>
                  <TableCell><Chip size="small" label={DIRECTIONS[s.direction]} /></TableCell>
                  <TableCell>{daysLabel(s.daysOfWeek)}</TableCell>
                  <TableCell><b>{s.startTime}</b></TableCell>
                  <TableCell><Chip size="small" label={off ? 'archived' : 'active'} color={off ? 'default' : 'success'} /></TableCell>
                  <TableCell align="right">
                    <Tooltip title="View details — passengers, stops & map" arrow>
                      <IconButton size="small" onClick={(e) => { e.stopPropagation(); openView(s); }}><VisibilityOutlinedIcon fontSize="small" color="primary" /></IconButton>
                    </Tooltip>
                    <Tooltip title="Edit schedule" arrow>
                      <IconButton size="small" onClick={(e) => { e.stopPropagation(); openEdit(s); }}><EditOutlinedIcon fontSize="small" /></IconButton>
                    </Tooltip>
                    {off ? (
                      <Tooltip title="Restore schedule" arrow>
                        <IconButton size="small" onClick={(e) => { e.stopPropagation(); restore(s); }}><UnarchiveOutlinedIcon fontSize="small" /></IconButton>
                      </Tooltip>
                    ) : (
                      <Tooltip title="Archive — stops this schedule running" arrow>
                        <IconButton size="small" onClick={(e) => { e.stopPropagation(); archive(s); }}><ArchiveOutlinedIcon fontSize="small" /></IconButton>
                      </Tooltip>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
            {rows.length === 0 && <TableRow><TableCell colSpan={9} align="center" sx={{ py: 5, color: 'text.secondary' }}>No schedules yet — map a route to a bus, driver, days & time.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editing ? 'Edit Schedule' : 'New Schedule'}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} mt={1}>
            {error && <Alert severity="error">{error}</Alert>}
            <TextField label="Schedule name" value={form.name} onChange={(e) => set('name', e.target.value)}
              helperText="Prefilled — rename it to something recognizable, e.g. “Morning pickup A”." />
            <TextField select label="Route" value={form.routeId} onChange={(e) => set('routeId', e.target.value)}>
              {routes.map((r) => <MenuItem key={r.id} value={r.id}>{r.name}</MenuItem>)}
              {routes.length === 0 && <MenuItem disabled value="">Create a route first</MenuItem>}
            </TextField>
            <Stack direction="row" spacing={2}>
              <TextField select fullWidth label="Vehicle" value={form.vehicleId} onChange={(e) => set('vehicleId', e.target.value)}>
                {vehicles.map((v) => <MenuItem key={v.id} value={v.id}>{vehicleLabel(v)}</MenuItem>)}
                {vehicles.length === 0 && <MenuItem disabled value="">Add a vehicle first</MenuItem>}
              </TextField>
              <TextField select fullWidth label="Driver" value={form.driverId} onChange={(e) => set('driverId', e.target.value)}>
                {drivers.map((d) => <MenuItem key={d.id} value={d.id}>{d.name} {d.loginId ? `(${d.loginId})` : ''}</MenuItem>)}
                {drivers.length === 0 && <MenuItem disabled value="">Add a driver first</MenuItem>}
              </TextField>
            </Stack>
            <Stack direction="row" spacing={2}>
              <TextField select fullWidth label="Direction" value={form.direction} onChange={(e) => set('direction', e.target.value)}>
                <MenuItem value="PICKUP">Pickup (morning)</MenuItem>
                <MenuItem value="DROP">Drop (evening)</MenuItem>
                <MenuItem value="BOTH">Both</MenuItem>
              </TextField>
              <TextField fullWidth type="time" label="Start time" value={form.startTime}
                onChange={(e) => set('startTime', e.target.value)} InputLabelProps={{ shrink: true }} />
            </Stack>
            <Box>
              <Stack direction="row" justifyContent="space-between" alignItems="center" mb={0.8}>
                <Typography variant="body2" color="text.secondary">Runs on</Typography>
                <Stack direction="row" spacing={0.5}>
                  <Button size="small" onClick={() => set('daysOfWeek', [1, 2, 3, 4, 5])}>Mon–Fri</Button>
                  <Button size="small" onClick={() => set('daysOfWeek', [1, 2, 3, 4, 5, 6, 7])}>All</Button>
                </Stack>
              </Stack>
              <ToggleButtonGroup value={form.daysOfWeek} onChange={(_e, v) => set('daysOfWeek', v)} size="small" sx={{ flexWrap: 'wrap' }}>
                {DAYS.map(([label, n]) => (
                  <ToggleButton key={n} value={n} sx={{ px: 1.5, borderRadius: 2 }}>{label}</ToggleButton>
                ))}
              </ToggleButtonGroup>
            </Box>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={save}
            disabled={form.name.trim().length < 2 || !form.routeId || !form.vehicleId || !form.driverId || form.daysOfWeek.length === 0}>
            {editing ? 'Save' : 'Create'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Schedule detail — map, stops and passengers for this run */}
      <Dialog open={!!viewSched} onClose={() => setViewSched(null)} maxWidth="md" fullWidth
        PaperProps={{ sx: { borderRadius: 4 } }}>
        <DialogTitle sx={{ pb: 1 }}>
          {viewSched?.name}
          <Typography variant="body2" color="text.secondary">{viewSched?.route?.name}</Typography>
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2}>
            {/* Run summary */}
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              <Chip size="small" label={DIRECTIONS[viewSched?.direction] || viewSched?.direction} color="primary" />
              <Chip size="small" label={daysLabel(viewSched?.daysOfWeek)} />
              <Chip size="small" label={`Starts ${viewSched?.startTime}`} />
              <Chip size="small" variant="outlined" label={vehicleLabel(viewSched?.vehicle)} />
              <Chip size="small" variant="outlined" label={`${viewSched?.driver?.name || '—'}${viewSched?.driver?.loginId ? ` (${viewSched.driver.loginId})` : ''}`} />
            </Stack>

            {/* Map — stops + road-snapped path (read-only) */}
            {!viewRoute && <Skeleton variant="rounded" height={300} />}
            {viewRoute && (styleUrl || tileUrl) && viewRoute.stops?.length > 0 && (
              <PlatformMap
                tileUrlTemplate={tileUrl}
                styleUrl={styleUrl}
                stops={viewRoute.stops.map((s) => ({ lat: s.lat, lng: s.lng, name: s.name }))}
                routeLine={viewLine}
                fitKey={1}
                height={300}
                center={[viewRoute.stops[0].lng, viewRoute.stops[0].lat]}
              />
            )}
            {viewRoute && viewRoute.stops?.length === 0 && (
              <Alert severity="info">This route has no stops yet — add them in Routes &amp; Stops.</Alert>
            )}

            {viewRoute && (() => {
              // passengerId -> their stop name, from the stops' assignments.
              const stopOf = {};
              viewRoute.stops?.forEach((st) => st.assignments?.forEach((a) => { stopOf[a.passenger.id] = st.name; }));
              const members = viewRoute.passengers || [];
              return (
                <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems="flex-start">
                  {/* Stops */}
                  <Box sx={{ flex: 1, width: '100%' }}>
                    <Typography variant="subtitle2" color="text.secondary" mb={0.5}>
                      STOPS ({viewRoute.stops?.length || 0})
                    </Typography>
                    <Divider sx={{ mb: 0.5 }} />
                    <Table size="small">
                      <TableBody>
                        {viewRoute.stops?.map((s) => (
                          <TableRow key={s.id}>
                            <TableCell sx={{ width: 30 }}>{s.sequence}</TableCell>
                            <TableCell><b>{s.name}</b></TableCell>
                            <TableCell align="right">
                              <Chip size="small" label={`${s.assignments?.length || 0} pax`} />
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </Box>
                  {/* Passengers */}
                  <Box sx={{ flex: 1.2, width: '100%' }}>
                    <Typography variant="subtitle2" color="text.secondary" mb={0.5}>
                      PASSENGERS ({members.length})
                    </Typography>
                    <Divider sx={{ mb: 0.5 }} />
                    <Table size="small">
                      <TableBody>
                        {members.map((p) => (
                          <TableRow key={p.id}>
                            <TableCell>
                              <b>{p.name}</b>
                              {p.category && <Typography component="span" variant="caption" color="text.secondary"> · {p.category}</Typography>}
                            </TableCell>
                            <TableCell align="right">
                              {stopOf[p.id]
                                ? <Chip size="small" variant="outlined" label={stopOf[p.id]} />
                                : <Typography variant="caption" color="text.secondary">no stop</Typography>}
                            </TableCell>
                          </TableRow>
                        ))}
                        {members.length === 0 && (
                          <TableRow><TableCell align="center" sx={{ py: 3, color: 'text.secondary' }}>
                            No passengers on this route yet — assign them in Routes &amp; Stops.
                          </TableCell></TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </Box>
                </Stack>
              );
            })()}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button variant="contained" onClick={() => setViewSched(null)} sx={{ px: 3 }}>Close</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
