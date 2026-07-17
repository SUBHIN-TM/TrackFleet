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
import StopCircleRoundedIcon from '@mui/icons-material/StopCircleRounded';
import SensorsRoundedIcon from '@mui/icons-material/SensorsRounded';
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
const ageText = (s) => (s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)}m ago` : `${Math.round(s / 3600)}h ago`);

// Is the bus actually reporting? A trip can be "running" while the driver's
// phone has stopped sending — the admin must be able to see that difference,
// otherwise a frozen bus looks the same as a parked one.
function gpsHealth(lastLocation) {
  if (!lastLocation) {
    return {
      label: 'No GPS', color: 'error',
      help: 'The driver’s phone hasn’t sent any position yet. Ask them to open the app and allow location “All the time”.',
    };
  }
  const age = Math.round((Date.now() - new Date(lastLocation.recordedAt)) / 1000);
  if (age <= 45) {
    return { label: `GPS live · ${ageText(age)}`, color: 'success', help: 'The bus is reporting normally.' };
  }
  if (age <= 180) {
    return {
      label: `GPS delayed · ${ageText(age)}`, color: 'warning',
      help: 'No fix for a while — usually a weak mobile signal. It should catch up on its own.',
    };
  }
  return {
    label: `GPS lost · ${ageText(age)}`, color: 'error',
    help: 'The phone stopped sending. The app may be closed, location turned off, or the battery dead. Call the driver.',
  };
}

export default function LiveToday() {
  const [runs, setRuns] = useState(null);
  const [viewTripId, setViewTripId] = useState(null);
  const [live, setLive] = useState(null); // /trips/:id/live payload
  const [tileUrl, setTileUrl] = useState('');
  const [styleUrl, setStyleUrl] = useState('');
  const [follow, setFollow] = useState(true);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [ending, setEnding] = useState(false);
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
  const viewIsLive = live && ['STARTED', 'IN_PROGRESS'].includes(live.trip.status);
  const stillOnboard = live?.passengers?.filter((p) => p.status === 'ONBOARD') || [];

  // Force-end a run the driver left open (phone died, forgot to end, etc.).
  async function endTrip() {
    setEnding(true);
    try {
      await api.post(`/api/trips/${viewTripId}/end`, { reason: 'ended from the admin console' });
      setConfirmEnd(false);
      await Promise.all([loadRuns(), loadLive(viewTripId)]);
    } catch { /* surfaced by the refreshed state */ }
    finally { setEnding(false); }
  }

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
                    {/* Is the bus actually reporting? Not the same as "running". */}
                    {isLive && (() => {
                      const g = gpsHealth(r.trip.lastLocation);
                      return (
                        <Tooltip title={g.help} arrow>
                          <Chip size="small" color={g.color} icon={<SensorsRoundedIcon sx={{ fontSize: 15 }} />}
                            label={g.label} sx={{ fontWeight: 700 }} />
                        </Tooltip>
                      );
                    })()}
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
              {/* GPS health, stated plainly — a stalled feed must never look normal. */}
              {viewIsLive && (() => {
                const g = gpsHealth(lastLoc);
                return (
                  <Alert severity={g.color === 'success' ? 'success' : g.color === 'warning' ? 'warning' : 'error'}
                    icon={<SensorsRoundedIcon fontSize="inherit" />} sx={{ py: 0.5 }}>
                    <b>{g.label}</b>
                    {lastLoc?.speed != null ? ` · ${Math.round(lastLoc.speed)} km/h` : ''} — {g.help}
                  </Alert>
                );
              })()}
              {!viewIsLive && lastLoc && (
                <Typography variant="caption" color="text.secondary">
                  Last GPS fix {timeOf(lastLoc.recordedAt)} · trip finished.
                </Typography>
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
        <DialogActions sx={{ px: 3, pb: 2, justifyContent: 'space-between' }}>
          {viewIsLive ? (
            <Tooltip title="Force-end this run — use when the driver forgot, or their phone died" arrow>
              <Button color="error" startIcon={<StopCircleRoundedIcon />} onClick={() => setConfirmEnd(true)}>
                End trip
              </Button>
            </Tooltip>
          ) : <span />}
          <Button variant="contained" onClick={() => setViewTripId(null)} sx={{ px: 3 }}>Close</Button>
        </DialogActions>
      </Dialog>

      {/* Confirm force-end — spell out the consequences before we do it. */}
      <Dialog open={confirmEnd} onClose={() => setConfirmEnd(false)} maxWidth="xs" fullWidth>
        <DialogTitle>End this trip?</DialogTitle>
        <DialogContent>
          <Stack spacing={1.5} mt={0.5}>
            <Typography variant="body2">
              <b>{live?.trip?.scheduleName}</b> — {live?.route?.name}, driven by {live?.trip?.driver?.name}.
            </Typography>
            {stillOnboard.length > 0 && (
              <Alert severity="warning">
                {stillOnboard.length} passenger{stillOnboard.length > 1 ? 's are' : ' is'} still marked <b>onboard</b>:
                {' '}{stillOnboard.map((p) => p.name).join(', ')}. Ending now records that.
              </Alert>
            )}
            <Typography variant="caption" color="text.secondary">
              Live tracking stops for parents, and the run is marked completed. This is recorded in the trip's
              audit trail as ended by you. It can’t be reopened — the driver would need to start a new run.
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmEnd(false)}>Cancel</Button>
          <Button variant="contained" color="error" onClick={endTrip} disabled={ending}>
            {ending ? 'Ending…' : 'End trip'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
