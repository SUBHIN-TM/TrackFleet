import { useEffect, useRef, useState } from 'react';
import {
  Box, Typography, Card, CardContent, Stack, Chip, Avatar, Skeleton, Alert,
  Dialog, DialogTitle, DialogContent, DialogActions, Button, Table, TableBody,
  TableCell, TableHead, TableRow, LinearProgress, Tooltip, IconButton,
} from '@mui/material';
import Grid from '@mui/material/Grid2';
import DirectionsBusRoundedIcon from '@mui/icons-material/DirectionsBusRounded';
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import MyLocationRoundedIcon from '@mui/icons-material/MyLocationRounded';
import { api } from '../lib/api.js';
import PageHeader from '../components/PageHeader.jsx';
import PlatformMap from '../components/PlatformMap.jsx';

const POLL_MS = 5000;

const STATUS_META = {
  'not-started': { label: 'Not started', color: 'default' },
  IN_PROGRESS: { label: 'LIVE', color: 'success' },
  STARTED: { label: 'LIVE', color: 'success' },
  COMPLETED: { label: 'Completed', color: 'info' },
  CANCELLED: { label: 'Cancelled', color: 'default' },
  INTERRUPTED: { label: 'Interrupted', color: 'error' },
};
const P_STATUS = {
  EXPECTED: { label: 'Expected', color: 'default' },
  ONBOARD: { label: 'Onboard', color: 'success' },
  DROPPED: { label: 'Dropped', color: 'info' },
  NO_SHOW: { label: 'No-show', color: 'error' },
  ABSENT: { label: 'Absent', color: 'warning' },
};
const timeOf = (d) => (d ? new Date(d).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—');
const vehicleLabel = (v) => (v ? `${v.fleetNo ? v.fleetNo + ' · ' : ''}${v.regNumber}` : '—');

export default function LiveToday() {
  const [runs, setRuns] = useState(null);
  const [viewTripId, setViewTripId] = useState(null);
  const [live, setLive] = useState(null); // /trips/:id/live payload
  const [tileUrl, setTileUrl] = useState('');
  const [styleUrl, setStyleUrl] = useState('');
  const [follow, setFollow] = useState(true);
  const timer = useRef(null);

  async function loadRuns() {
    try {
      const { data } = await api.get('/api/trips/today');
      setRuns(data.runs);
    } catch { /* keep last data on a blip */ }
  }
  async function loadLive(id) {
    try {
      const { data } = await api.get(`/api/trips/${id}/live`);
      setLive(data);
    } catch { /* trip may have ended */ }
  }

  // Poll the board always; poll the open trip faster context too.
  useEffect(() => {
    loadRuns();
    api.get('/api/map/config').then(({ data }) => { setTileUrl(data.tileUrlTemplate); setStyleUrl(data.styleUrl || ''); }).catch(() => {});
    timer.current = setInterval(() => {
      loadRuns();
    }, POLL_MS);
    return () => clearInterval(timer.current);
  }, []);

  useEffect(() => {
    if (!viewTripId) { setLive(null); return; }
    loadLive(viewTripId);
    const t = setInterval(() => loadLive(viewTripId), POLL_MS);
    return () => clearInterval(t);
  }, [viewTripId]);

  const liveCount = runs?.filter((r) => r.trip && ['STARTED', 'IN_PROGRESS'].includes(r.trip.status)).length || 0;
  const lastLoc = live?.lastLocation;

  return (
    <Box>
      <PageHeader title="Live Today" crumbs={[{ label: 'Live Today' }]}
        action={
          <Stack direction="row" spacing={1} alignItems="center">
            {liveCount > 0 && <Chip color="success" label={`${liveCount} LIVE`} sx={{ fontWeight: 800 }} />}
            <Tooltip title="Refresh now (auto-refreshes every 5s)" arrow>
              <IconButton onClick={loadRuns}><RefreshRoundedIcon /></IconButton>
            </Tooltip>
          </Stack>
        } />

      {runs === null && (
        <Grid container spacing={2}>
          {[0, 1, 2].map((i) => <Grid key={i} size={{ xs: 12, md: 4 }}><Skeleton variant="rounded" height={150} /></Grid>)}
        </Grid>
      )}

      {runs?.length === 0 && (
        <Card><CardContent sx={{ py: 6, textAlign: 'center', color: 'text.secondary' }}>
          No runs scheduled for today. Schedules whose days include today appear here automatically.
        </CardContent></Card>
      )}

      <Grid container spacing={2}>
        {runs?.map((r) => {
          const st = r.trip ? r.trip.status : 'not-started';
          const meta = STATUS_META[st] || STATUS_META['not-started'];
          const c = r.trip?.counts;
          const isLive = ['STARTED', 'IN_PROGRESS'].includes(st);
          const progress = c && c.expected > 0 ? Math.round(((c.onboard + c.dropped + c.noShow) / c.expected) * 100) : 0;
          return (
            <Grid key={r.schedule.id} size={{ xs: 12, sm: 6, md: 4 }}>
              <Card
                onClick={() => r.trip && setViewTripId(r.trip.id)}
                sx={{
                  cursor: r.trip ? 'pointer' : 'default', height: '100%',
                  transition: 'transform .15s, box-shadow .15s',
                  ...(r.trip && { '&:hover': { transform: 'translateY(-2px)', boxShadow: '0 10px 30px rgba(46,41,78,.12)' } }),
                  ...(isLive && { border: '1.5px solid', borderColor: 'success.main' }),
                }}>
                <CardContent>
                  <Stack direction="row" justifyContent="space-between" alignItems="flex-start" mb={1}>
                    <Box sx={{ minWidth: 0 }}>
                      <Typography fontWeight={800} noWrap>{r.schedule.name}</Typography>
                      <Typography variant="body2" color="text.secondary" noWrap>{r.route?.name}</Typography>
                    </Box>
                    <Chip size="small" color={meta.color} label={meta.label}
                      sx={isLive ? { fontWeight: 800, animation: 'pulse 1.6s infinite', '@keyframes pulse': { '0%,100%': { opacity: 1 }, '50%': { opacity: 0.55 } } } : { fontWeight: 700 }} />
                  </Stack>

                  <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap mb={1.2}>
                    <Chip size="small" variant="outlined" label={`${r.schedule.direction === 'DROP' ? 'Drop' : r.schedule.direction === 'BOTH' ? 'Both' : 'Pickup'} · ${r.schedule.startTime}`} />
                    <Chip size="small" variant="outlined" icon={<DirectionsBusRoundedIcon sx={{ fontSize: 15 }} />} label={vehicleLabel(r.vehicle)} />
                  </Stack>
                  <Typography variant="caption" color="text.secondary" display="block">
                    Driver: <b>{r.driver?.name}</b>{r.driver?.phone ? ` · ${r.driver.phone}` : ''}
                  </Typography>

                  {c && (
                    <Box mt={1.2}>
                      <Stack direction="row" justifyContent="space-between" mb={0.4}>
                        <Typography variant="caption" color="text.secondary">
                          {c.onboard} onboard · {c.dropped} dropped · {c.noShow} no-show
                        </Typography>
                        <Typography variant="caption" fontWeight={700}>{c.expected} expected</Typography>
                      </Stack>
                      <LinearProgress variant="determinate" value={progress} sx={{ height: 6, borderRadius: 3 }} />
                    </Box>
                  )}
                  {!r.trip && (
                    <Typography variant="caption" color="text.secondary" display="block" mt={1.2}>
                      Waiting for the driver to start this run.
                    </Typography>
                  )}
                  {r.trip && (
                    <Typography variant="caption" color="text.secondary" display="block" mt={0.8}>
                      {st === 'COMPLETED' ? `Ran ${timeOf(r.trip.startedAt)} – ${timeOf(r.trip.endedAt)}` : `Started ${timeOf(r.trip.startedAt)} — click to watch live`}
                    </Typography>
                  )}
                </CardContent>
              </Card>
            </Grid>
          );
        })}
      </Grid>

      {/* Live trip detail — map + boarding board, refreshed every 5s */}
      <Dialog open={!!viewTripId} onClose={() => setViewTripId(null)} maxWidth="md" fullWidth
        PaperProps={{ sx: { borderRadius: 4 } }}>
        <DialogTitle sx={{ pb: 1 }}>
          <Stack direction="row" justifyContent="space-between" alignItems="center">
            <Box>
              {live?.trip?.scheduleName || 'Trip'}
              <Typography variant="body2" color="text.secondary">
                {live?.route?.name} · {vehicleLabel(live?.trip?.vehicle)} · {live?.trip?.driver?.name}
                {live?.trip?.driver?.phone ? ` (${live.trip.driver.phone})` : ''}
              </Typography>
            </Box>
            {live && (
              <Chip color={STATUS_META[live.trip.status]?.color || 'default'}
                label={STATUS_META[live.trip.status]?.label || live.trip.status} sx={{ fontWeight: 800 }} />
            )}
          </Stack>
        </DialogTitle>
        <DialogContent>
          {!live && <Skeleton variant="rounded" height={320} />}
          {live && (
            <Stack spacing={2}>
              {(styleUrl || tileUrl) && (
                <PlatformMap
                  tileUrlTemplate={tileUrl}
                  styleUrl={styleUrl}
                  stops={(live.route?.stops || []).map((s) => ({ lat: s.lat, lng: s.lng, name: s.name }))}
                  trail={live.trail || []}
                  vehicle={lastLoc ? [lastLoc.lng, lastLoc.lat] : null}
                  followVehicle={follow}
                  onToggleFollow={() => setFollow((f) => !f)}
                  fitKey={1}
                  height={360}
                  center={lastLoc ? [lastLoc.lng, lastLoc.lat]
                    : live.route?.stops?.[0] ? [live.route.stops[0].lng, live.route.stops[0].lat] : [76.93, 8.52]}
                />
              )}
              {lastLoc ? (
                <Typography variant="caption" color="text.secondary">
                  Last GPS fix {timeOf(lastLoc.recordedAt)}{lastLoc.speed != null ? ` · ${Math.round(lastLoc.speed)} km/h` : ''} — updates every 5s.
                </Typography>
              ) : (
                <Alert severity="info" sx={{ py: 0.5 }}>No GPS received yet — the bus appears the moment the driver's phone sends its first fix.</Alert>
              )}

              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Passenger</TableCell>
                    <TableCell>Stop</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell align="right">Time</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {live.passengers.map((p) => {
                    const m = P_STATUS[p.status] || P_STATUS.EXPECTED;
                    return (
                      <TableRow key={p.id}>
                        <TableCell>
                          <b>{p.name}</b>
                          {p.category && <Typography component="span" variant="caption" color="text.secondary"> · {p.category}</Typography>}
                        </TableCell>
                        <TableCell>{p.stopName || '—'}</TableCell>
                        <TableCell><Chip size="small" color={m.color} label={m.label} /></TableCell>
                        <TableCell align="right">{timeOf(p.droppedAt || p.boardedAt)}</TableCell>
                      </TableRow>
                    );
                  })}
                  {live.passengers.length === 0 && (
                    <TableRow><TableCell colSpan={4} align="center" sx={{ py: 3, color: 'text.secondary' }}>No passengers on this run.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </Stack>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button variant="contained" onClick={() => setViewTripId(null)} sx={{ px: 3 }}>Close</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
