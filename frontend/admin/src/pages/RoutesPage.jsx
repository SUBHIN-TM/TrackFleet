import { useEffect, useMemo, useState } from 'react';
import {
  Box, Typography, Button, Card, CardContent, List, ListItemButton, ListItemText,
  Dialog, DialogTitle, DialogContent, DialogActions, TextField, Stack, Alert,
  MenuItem, Divider, IconButton, Chip, Table, TableBody, TableCell, TableRow, TableHead, Tooltip,
  Paper, InputBase, CircularProgress, Checkbox, ListItemIcon, FormControlLabel,
} from '@mui/material';
import Grid from '@mui/material/Grid2';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import PersonAddIcon from '@mui/icons-material/PersonAdd';
import SearchIcon from '@mui/icons-material/Search';
import PlaceRoundedIcon from '@mui/icons-material/PlaceRounded';
import { api } from '../lib/api.js';
import PageHeader from '../components/PageHeader.jsx';
import PlatformMap from '../components/PlatformMap.jsx';
import polyline from '@mapbox/polyline';

export default function RoutesPage() {
  const [routes, setRoutes] = useState([]);
  const [selected, setSelected] = useState(null);
  const [passengers, setPassengers] = useState([]);
  const [routeDlg, setRouteDlg] = useState(false);
  const [stopDlg, setStopDlg] = useState(false);
  const [assignDlg, setAssignDlg] = useState(false);
  const [routeForm, setRouteForm] = useState({ name: '', direction: 'PICKUP' });
  const [stopForm, setStopForm] = useState({ name: '', lat: '', lng: '', geofenceRadius: 150 });
  // Multi-select passenger membership for the selected route.
  const [assignSel, setAssignSel] = useState([]);
  // Checked set at open / last save — whoever is checked BEYOND this baseline is
  // the current batch, and the stop dropdown applies only to that batch. Keeps
  // batch 2's stop from silently re-mapping batch 1 while the dialog stays open.
  const [assignBase, setAssignBase] = useState([]);
  // Optional boarding stop applied to the newly selected passengers on save.
  const [assignStop, setAssignStop] = useState('');
  const [assignMsg, setAssignMsg] = useState('');
  // Per-stop "who boards here" picker: the stop being edited + its selection.
  const [stopAssignFor, setStopAssignFor] = useState(null);
  const [stopAssignSel, setStopAssignSel] = useState([]);
  const [error, setError] = useState('');
  // Map state
  const [tileUrl, setTileUrl] = useState('');
  const [styleUrl, setStyleUrl] = useState('');
  const [routeLine, setRouteLine] = useState([]);
  const [routeInfo, setRouteInfo] = useState(null);
  const [fitKey, setFitKey] = useState(0);
  // Place search
  const [searchQ, setSearchQ] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [flyTo, setFlyTo] = useState(null);
  const [flyKey, setFlyKey] = useState(0);

  async function loadRoutes(keepId) {
    const { data } = await api.get('/api/routes');
    setRoutes(data.routes);
    const keep = keepId || selected?.id;
    setSelected(keep ? data.routes.find((r) => r.id === keep) || data.routes[0] : data.routes[0] || null);
  }
  async function loadPassengers() {
    const { data } = await api.get('/api/passengers');
    setPassengers(data.passengers);
  }
  useEffect(() => {
    loadRoutes();
    loadPassengers();
    api.get('/api/map/config').then(({ data }) => { setTileUrl(data.tileUrlTemplate); setStyleUrl(data.styleUrl || ''); }).catch(() => {});
  }, []);

  // Snap the selected route's stops to the road network via OSRM (VPS). This
  // only redraws the line — it must NOT move the camera, so adding a stop keeps
  // the map exactly where (and how rotated) you left it.
  useEffect(() => {
    const stops = selected?.stops || [];
    if (stops.length < 2) { setRouteLine([]); setRouteInfo(null); return; }
    const waypoints = stops.map((s) => ({ lat: s.lat, lng: s.lng }));
    api.post('/api/map/route', { waypoints })
      .then(({ data }) => {
        setRouteLine(polyline.decode(data.geometry).map(([lat, lng]) => [lng, lat]));
        setRouteInfo({ distance: data.distanceMeters, duration: data.durationSeconds });
      })
      .catch(() => { setRouteLine([]); setRouteInfo(null); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id, selected?.stops?.length]);

  // Fit the view to the stops ONLY when the selected route changes — never on a
  // stop add/remove — so the camera doesn't jump while you're marking stops.
  useEffect(() => {
    setFitKey((k) => k + 1);
  }, [selected?.id]);

  // Click the map to drop a stop — prefill the add-stop dialog with the coords.
  function handleMapClick(lng, lat) {
    setStopForm((f) => ({ ...f, lat: lat.toFixed(6), lng: lng.toFixed(6) }));
    setStopDlg(true);
  }

  // Search a place name/address; results come from the server geocoder.
  async function searchPlaces(e) {
    e?.preventDefault();
    if (searchQ.trim().length < 3) return;
    setSearching(true);
    try {
      const { data } = await api.get('/api/map/search', { params: { q: searchQ.trim() } });
      setSearchResults(data.results);
    } catch { setSearchResults([]); }
    finally { setSearching(false); }
  }

  // Pick a search hit: fly there, drop a preview pin, and open Add Stop prefilled.
  function pickPlace(r) {
    setFlyTo([r.lng, r.lat]);
    setFlyKey((k) => k + 1);
    setStopForm((f) => ({ ...f, name: r.name.split(',')[0], lat: r.lat.toFixed(6), lng: r.lng.toFixed(6) }));
    setSearchResults([]);
    setStopDlg(true);
  }
  const fmtKm = (m) => (m / 1000).toFixed(1) + ' km';
  const fmtMin = (s) => Math.round(s / 60) + ' min';

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
        geofenceRadius: Number(stopForm.geofenceRadius), sequence: seq,
      });
      setStopDlg(false); setStopForm({ name: '', lat: '', lng: '', geofenceRadius: 150 });
      await loadRoutes(selected.id);
    } catch (err) { setError(err.response?.data?.error || 'Failed'); }
  }

  async function delStop(stopId) {
    await api.delete(`/api/routes/${selected.id}/stops/${stopId}`);
    await loadRoutes(selected.id);
  }

  function openAssign() {
    setError(''); setAssignStop(''); setAssignMsg('');
    // Pre-check passengers already riding this route; they form the baseline.
    const members = passengers.filter((p) => p.route?.id === selected.id).map((p) => p.id);
    setAssignSel(members);
    setAssignBase(members);
    setAssignDlg(true);
  }
  async function saveAssign() {
    setError(''); setAssignMsg('');
    const batch = assignBatch;
    try {
      await api.put(`/api/routes/${selected.id}/passengers`, { passengerIds: assignSel });
      // The stop applies ONLY to the current batch — earlier batches keep theirs.
      if (assignStop && batch.length) {
        await api.post(`/api/routes/${selected.id}/stops/${assignStop}/board`, { passengerIds: batch });
      }
      await Promise.all([loadRoutes(selected.id), loadPassengers()]);
      // Stay open for the next batch: saved state becomes the new baseline.
      setAssignBase(assignSel);
      const stopName = selected?.stops?.find((s) => s.id === assignStop)?.name;
      setAssignMsg(assignStop && batch.length
        ? `✓ ${batch.length} passenger${batch.length === 1 ? '' : 's'} saved with stop “${stopName}”. They're locked in — ticking the next batch won't change them.`
        : '✓ Saved. Pick the next passengers, or close.');
      setAssignStop('');
    } catch (err) { setError(err.response?.data?.error || 'Failed'); }
  }

  function openStopAssign(stop) {
    setError('');
    // Pre-check passengers who already board at this stop.
    setStopAssignSel(passengers.filter((p) => p.stopAssignments?.some((a) => a.stopId === stop.id)).map((p) => p.id));
    setStopAssignFor(stop);
  }
  async function saveStopAssign() {
    setError('');
    try {
      await api.put(`/api/routes/${selected.id}/stops/${stopAssignFor.id}/passengers`, { passengerIds: stopAssignSel });
      setStopAssignFor(null);
      await Promise.all([loadRoutes(selected.id), loadPassengers()]);
    } catch (err) { setError(err.response?.data?.error || 'Failed'); }
  }

  // stopId -> { stop name, route name } across all routes, for the "will move" note.
  const stopIndex = useMemo(() => {
    const m = {};
    for (const r of routes) for (const s of r.stops || []) m[s.id] = { stop: s.name, route: r.name };
    return m;
  }, [routes]);
  const passengerById = useMemo(() => Object.fromEntries(passengers.map((p) => [p.id, p])), [passengers]);
  // Batch = ticked since last save (gets the stop); removed = unticked members.
  const assignBatch = assignSel.filter((id) => !assignBase.includes(id));
  const assignRemoved = assignBase.filter((id) => !assignSel.includes(id));

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
                  <Stack direction="row" spacing={1} alignItems="center">
                    {selected.passengers?.length > 0 && (
                      <Chip size="small" color="primary" variant="outlined" label={`${selected.passengers.length} passenger${selected.passengers.length > 1 ? 's' : ''}`} />
                    )}
                    <Button size="small" startIcon={<PersonAddIcon />} onClick={openAssign}>Assign Passengers</Button>
                    <Button size="small" variant="contained" startIcon={<AddIcon />} onClick={() => setStopDlg(true)}>Add Stop</Button>
                  </Stack>
                </Stack>

                {/* Map — search a place OR click to drop a stop; blue line = road path */}
                {(styleUrl || tileUrl) && (
                  <Box sx={{ mb: 1.5 }}>
                    <Box component="form" onSubmit={searchPlaces} sx={{ position: 'relative', mb: 1 }}>
                      <Paper variant="outlined" sx={{ display: 'flex', alignItems: 'center', px: 1.5, py: 0.3, borderRadius: 2 }}>
                        <SearchIcon fontSize="small" sx={{ color: 'text.secondary', mr: 1 }} />
                        <InputBase fullWidth placeholder="Search a place to add a stop… (e.g. Technopark, Kazhakkoottam)"
                          value={searchQ} onChange={(e) => setSearchQ(e.target.value)} sx={{ fontSize: 14 }} />
                        {searching
                          ? <CircularProgress size={18} sx={{ mr: 1 }} />
                          : <Button size="small" type="submit" disabled={searchQ.trim().length < 3}>Search</Button>}
                      </Paper>
                      {searchResults.length > 0 && (
                        <Paper sx={{ position: 'absolute', zIndex: 20, mt: 0.5, left: 0, right: 0, maxHeight: 260, overflow: 'auto' }}>
                          <List dense>
                            {searchResults.map((r, i) => (
                              <ListItemButton key={i} onClick={() => pickPlace(r)}>
                                <PlaceRoundedIcon fontSize="small" color="primary" style={{ marginRight: 8 }} />
                                <ListItemText primary={r.name.split(',')[0]} secondary={r.name}
                                  secondaryTypographyProps={{ noWrap: true }} />
                              </ListItemButton>
                            ))}
                          </List>
                        </Paper>
                      )}
                    </Box>
                    <PlatformMap
                      tileUrlTemplate={tileUrl}
                      styleUrl={styleUrl}
                      stops={(selected.stops || []).map((s) => ({ lat: s.lat, lng: s.lng, name: s.name }))}
                      routeLine={routeLine}
                      fitKey={fitKey}
                      flyTo={flyTo}
                      flyKey={flyKey}
                      onMapClick={handleMapClick}
                      height={340}
                      center={selected.stops?.[0] ? [selected.stops[0].lng, selected.stops[0].lat] : [76.93, 8.52]}
                    />
                    <Stack direction="row" spacing={2} alignItems="center" mt={1}>
                      <Typography variant="caption" color="text.secondary">💡 Search a place above, or click the map, to add a stop</Typography>
                      {routeInfo && (
                        <>
                          <Chip size="small" color="primary" variant="outlined" label={`Distance: ${fmtKm(routeInfo.distance)}`} />
                          <Chip size="small" color="primary" variant="outlined" label={`Drive time: ${fmtMin(routeInfo.duration)}`} />
                        </>
                      )}
                    </Stack>
                  </Box>
                )}
                <Divider sx={{ my: 1 }} />
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>#</TableCell>
                      <TableCell>Stop</TableCell>
                      <TableCell>Coords</TableCell>
                      <TableCell>Passengers</TableCell>
                      <TableCell />
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {selected.stops?.map((s) => (
                      <TableRow key={s.id}>
                        <TableCell>{s.sequence}</TableCell>
                        <TableCell><b>{s.name}</b></TableCell>
                        <TableCell>{s.lat.toFixed(3)}, {s.lng.toFixed(3)}</TableCell>
                        <TableCell>
                          {s.assignments?.length ? (
                            <Tooltip title={s.assignments.map((a) => a.passenger.name).join(', ')} arrow>
                              <Chip size="small" label={`${s.assignments.length} passenger${s.assignments.length === 1 ? '' : 's'}`} />
                            </Tooltip>
                          ) : <span style={{ color: '#999' }}>none</span>}
                        </TableCell>
                        <TableCell align="right">
                          <Tooltip title="Choose the passengers for this stop"><IconButton size="small" onClick={() => openStopAssign(s)}><PersonAddIcon fontSize="small" color="primary" /></IconButton></Tooltip>
                          <Tooltip title="Delete stop"><IconButton size="small" onClick={() => delStop(s.id)}><DeleteIcon fontSize="small" color="error" /></IconButton></Tooltip>
                        </TableCell>
                      </TableRow>
                    ))}
                    {!selected.stops?.length && <TableRow><TableCell colSpan={5} align="center" sx={{ py: 3, color: 'text.secondary' }}>No stops — add the first stop.</TableCell></TableRow>}
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
            <TextField label="Geofence (m)" type="number" value={stopForm.geofenceRadius}
              onChange={(e) => setStopForm({ ...stopForm, geofenceRadius: e.target.value })}
              helperText="Arrival & 'bus approaching' radius. Pickup times are set in Schedules." />
          </Stack>
        </DialogContent>
        <DialogActions><Button onClick={() => setStopDlg(false)}>Cancel</Button><Button variant="contained" onClick={addStop}>Add</Button></DialogActions>
      </Dialog>

      {/* Assign passengers — multi-select membership for this route */}
      <Dialog open={assignDlg} onClose={() => setAssignDlg(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ pb: 1 }}>
          Assign passengers
          <Typography variant="body2" color="text.secondary">to {selected?.name}</Typography>
        </DialogTitle>
        <DialogContent>
          <Stack spacing={1.5} mt={0.5}>
            {error && <Alert severity="error">{error}</Alert>}
            {assignMsg && <Alert severity="success" onClose={() => setAssignMsg('')}>{assignMsg}</Alert>}
            <PassengerPicker
              passengers={passengers.filter((p) => p.active)}
              selected={assignSel} setSelected={setAssignSel}
              flag={(p) => {
                const inSel = assignSel.includes(p.id);
                const inBase = assignBase.includes(p.id);
                if (inSel && !inBase) return 'new';
                if (!inSel && inBase) return 'remove';
                if (inSel && inBase) return 'saved';
                return null;
              }}
              annotate={(p) => {
                const sid = p.stopAssignments?.[0]?.stopId;
                if (p.route && p.route.id !== selected?.id) {
                  return `In ${p.route.name}${sid && stopIndex[sid] ? ` (${stopIndex[sid].stop})` : ''} — will move here`;
                }
                if (sid && stopIndex[sid]) return `Stop: ${stopIndex[sid].stop}`;
                if (p.route?.id === selected?.id) return 'No stop yet';
                return null;
              }}
            />

            {/* Batch panel — makes it explicit WHO the chosen stop applies to. */}
            <Box sx={{
              border: '1.5px dashed', borderRadius: 3, p: 1.5,
              borderColor: assignBatch.length ? 'primary.main' : 'divider',
              bgcolor: assignBatch.length ? '#f2f6ff' : '#fafafd',
            }}>
              {assignBatch.length > 0 ? (
                <>
                  <Typography variant="subtitle2" color="primary.main" mb={0.8}>
                    This batch — {assignBatch.length} new passenger{assignBatch.length === 1 ? '' : 's'}
                  </Typography>
                  <Stack direction="row" spacing={0.5} useFlexGap flexWrap="wrap" mb={1.2}>
                    {assignBatch.slice(0, 6).map((id) => (
                      <Chip key={id} size="small" color="primary" variant="outlined" label={passengerById[id]?.name || '—'} />
                    ))}
                    {assignBatch.length > 6 && <Chip size="small" variant="outlined" label={`+${assignBatch.length - 6} more`} />}
                  </Stack>
                  <TextField select fullWidth label="Stop for this batch" value={assignStop}
                    onChange={(e) => setAssignStop(e.target.value)}
                    disabled={!selected?.stops?.length}
                    helperText={!selected?.stops?.length
                      ? 'This route has no stops yet'
                      : 'Applies only to the passengers listed above — “Saved” passengers keep their stop.'}>
                    <MenuItem value=""><em>No stop for now</em></MenuItem>
                    {selected?.stops?.map((s) => <MenuItem key={s.id} value={s.id}>{s.sequence}. {s.name}</MenuItem>)}
                  </TextField>
                </>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  Tick passengers above to start the next batch — rows marked <b>Saved</b> are already stored and won’t be touched.
                </Typography>
              )}
              {assignRemoved.length > 0 && (
                <Typography variant="caption" color="error.main" display="block" mt={0.8}>
                  ⚠ {assignRemoved.length} unticked passenger{assignRemoved.length === 1 ? '' : 's'} will be removed from this route when you save.
                </Typography>
              )}
            </Box>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAssignDlg(false)}>Close</Button>
          <Button variant="contained" onClick={saveAssign} disabled={assignBatch.length === 0 && assignRemoved.length === 0}>
            {assignBatch.length > 0
              ? `Save ${assignBatch.length} passenger${assignBatch.length === 1 ? '' : 's'}`
              : 'Save changes'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Board-at-stop — multi-select which passengers board at one stop */}
      <Dialog open={!!stopAssignFor} onClose={() => setStopAssignFor(null)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ pb: 1 }}>
          Passengers at this stop
          <Typography variant="body2" color="text.secondary">{stopAssignFor?.name} · {selected?.name}</Typography>
        </DialogTitle>
        <DialogContent>
          <Stack spacing={1.5} mt={0.5}>
            {error && <Alert severity="error">{error}</Alert>}
            <PassengerPicker
              passengers={passengers.filter((p) => p.active)}
              selected={stopAssignSel} setSelected={setStopAssignSel}
              annotate={(p) => {
                const sid = p.stopAssignments?.[0]?.stopId;
                if (sid === stopAssignFor?.id) return null;
                if (sid && stopIndex[sid]) return `At ${stopIndex[sid].stop} (${stopIndex[sid].route}) — will move here`;
                if (p.route && p.route.id !== selected?.id) return `In ${p.route.name} — will move here`;
                return null;
              }}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setStopAssignFor(null)}>Cancel</Button>
          <Button variant="contained" onClick={saveStopAssign}>Save</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

// Per-row state chips: what will happen to this passenger on save.
const ROW_FLAGS = {
  new: { label: 'New', color: 'primary', variant: 'filled' },
  saved: { label: 'Saved ✓', color: 'success', variant: 'outlined' },
  remove: { label: 'Will remove', color: 'error', variant: 'outlined' },
};

// Reusable passenger checklist: filter box, select-all, a per-row note, and an
// optional per-row status flag (New / Saved / Will remove).
function PassengerPicker({ passengers, selected, setSelected, annotate, flag }) {
  const [filter, setFilter] = useState('');
  const list = passengers.filter((p) =>
    !filter || p.name.toLowerCase().includes(filter.toLowerCase()) || (p.category || '').toLowerCase().includes(filter.toLowerCase()));
  const allChecked = list.length > 0 && list.every((p) => selected.includes(p.id));
  const someChecked = list.some((p) => selected.includes(p.id));
  const toggle = (id) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const toggleAll = () => {
    const ids = list.map((p) => p.id);
    setSelected((s) => (allChecked ? s.filter((x) => !ids.includes(x)) : [...new Set([...s, ...ids])]));
  };
  return (
    <>
      <Paper variant="outlined" sx={{ display: 'flex', alignItems: 'center', px: 1.5, py: 0.3, borderRadius: 2 }}>
        <SearchIcon fontSize="small" sx={{ color: 'text.secondary', mr: 1 }} />
        <InputBase fullWidth placeholder="Filter passengers…" value={filter} onChange={(e) => setFilter(e.target.value)} sx={{ fontSize: 14 }} />
      </Paper>
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <FormControlLabel
          control={<Checkbox size="small" checked={allChecked} indeterminate={!allChecked && someChecked} onChange={toggleAll} />}
          label={<Typography variant="body2">Select all</Typography>} />
        <Typography variant="caption" color="text.secondary">{selected.length} selected</Typography>
      </Stack>
      <Divider />
      <List dense sx={{ maxHeight: 320, overflow: 'auto', py: 0 }}>
        {list.map((p) => {
          const note = annotate?.(p);
          const f = flag ? ROW_FLAGS[flag(p)] : null;
          return (
            <ListItemButton key={p.id} onClick={() => toggle(p.id)} sx={{ borderRadius: 2 }}>
              <ListItemIcon sx={{ minWidth: 36 }}>
                <Checkbox edge="start" size="small" checked={selected.includes(p.id)} tabIndex={-1} disableRipple />
              </ListItemIcon>
              <ListItemText
                primary={<>{p.name}{p.category ? <Typography component="span" variant="caption" color="text.secondary"> · {p.category}</Typography> : null}</>}
                secondary={note} />
              {f && <Chip size="small" label={f.label} color={f.color} variant={f.variant} sx={{ ml: 1, flexShrink: 0, fontSize: 11 }} />}
            </ListItemButton>
          );
        })}
        {list.length === 0 && <Box sx={{ p: 2, textAlign: 'center', color: 'text.secondary' }}>No passengers.</Box>}
      </List>
    </>
  );
}
