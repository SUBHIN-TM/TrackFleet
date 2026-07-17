import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Box, Typography, Card, CardContent, Stack, Chip, Avatar, Skeleton, Alert, Divider,
  Tabs, Tab, TextField, MenuItem, Table, TableBody, TableCell, TableRow, TableHead, Button,
} from '@mui/material';
import PersonRoundedIcon from '@mui/icons-material/PersonRounded';
import PlaceRoundedIcon from '@mui/icons-material/PlaceRounded';
import ScheduleRoundedIcon from '@mui/icons-material/ScheduleRounded';
import DirectionsBusRoundedIcon from '@mui/icons-material/DirectionsBusRounded';
import PhoneRoundedIcon from '@mui/icons-material/PhoneRounded';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import EventBusyRoundedIcon from '@mui/icons-material/EventBusyRounded';
import EventAvailableRoundedIcon from '@mui/icons-material/EventAvailableRounded';
import { api } from '../lib/api.js';
import LiveMap from '../components/LiveMap.jsx';
import { EtaHero, JourneyTimeline } from '../components/RideStatus.jsx';

const POLL_MS = 5000;
const DAYS = [['Mon', 1], ['Tue', 2], ['Wed', 3], ['Thu', 4], ['Fri', 5], ['Sat', 6], ['Sun', 7]];
const daysLabel = (arr) => {
  const s = [...(arr || [])].sort((a, b) => a - b);
  if (s.join() === '1,2,3,4,5') return 'Mon–Fri';
  if (s.join() === '1,2,3,4,5,6,7') return 'Every day';
  return DAYS.filter(([, n]) => s.includes(n)).map(([l]) => l).join(', ') || '—';
};
const MY_STATUS = {
  EXPECTED: { label: 'Waiting to board', color: 'default' },
  ONBOARD: { label: 'On the bus', color: 'success' },
  DROPPED: { label: 'Dropped off', color: 'info' },
  NO_SHOW: { label: 'Did not board', color: 'error' },
  ABSENT: { label: 'Marked absent', color: 'warning' },
};
const timeOf = (d) => (d ? new Date(d).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—');
const dateOf = (d) => (d ? new Date(d).toLocaleDateString([], { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
const busLabel = (v) => (v ? `${v.fleetNo ? v.fleetNo + ' · ' : ''}${v.regNumber}` : '—');

// One child's full picture: today (live/upcoming), their route, and past rides.
export default function ChildDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const [tab, setTab] = useState(0);
  const [children, setChildren] = useState(null); // for the switcher + live data
  const [detail, setDetail] = useState(null);     // route + schedules
  const [journeys, setJourneys] = useState(null); // history
  const [absences, setAbsences] = useState([]);   // days they won't travel
  const [absBusy, setAbsBusy] = useState(false);
  const [tileUrl, setTileUrl] = useState('');
  const [styleUrl, setStyleUrl] = useState('');
  const [error, setError] = useState('');
  const timer = useRef(null);

  const todayISO = new Date().toISOString().slice(0, 10);
  const absentToday = absences.some((a) => new Date(a.date).toISOString().slice(0, 10) === todayISO);

  async function loadAbsences() {
    try {
      const { data } = await api.get(`/api/guardian/passengers/${id}/absences`);
      setAbsences(data.absences);
    } catch { setAbsences([]); }
  }
  // Tell the school the child isn't travelling — the driver's list updates too.
  async function markAbsent(dateISO) {
    setAbsBusy(true);
    try {
      await api.post(`/api/guardian/passengers/${id}/absences`, { date: dateISO });
      await Promise.all([loadAbsences(), loadLive()]);
    } catch (err) { setError(err.response?.data?.error || 'Could not save'); }
    finally { setAbsBusy(false); }
  }
  async function unmarkAbsent(absenceId) {
    setAbsBusy(true);
    try {
      await api.delete(`/api/guardian/passengers/${id}/absences/${absenceId}`);
      await Promise.all([loadAbsences(), loadLive()]);
    } catch (err) { setError(err.response?.data?.error || 'Could not undo'); }
    finally { setAbsBusy(false); }
  }

  const child = children?.find((c) => c.id === id) || null;
  const t = child?.trip;
  const live = t?.live;

  async function loadLive() {
    try {
      const { data } = await api.get('/api/trips/guardian/live');
      setChildren(data.children);
    } catch (err) { setError(err.response?.data?.error || 'Could not load'); }
  }

  useEffect(() => {
    loadLive();
    api.get('/api/map/config').then(({ data }) => { setTileUrl(data.tileUrlTemplate); setStyleUrl(data.styleUrl || ''); }).catch(() => {});
    timer.current = setInterval(loadLive, POLL_MS);
    return () => clearInterval(timer.current);
  }, []);

  // Per-child data reloads when the switcher changes.
  useEffect(() => {
    setDetail(null); setJourneys(null);
    api.get(`/api/guardian/passengers/${id}`).then(({ data }) => setDetail(data)).catch(() => setDetail({ route: null, schedules: [] }));
    api.get(`/api/guardian/passengers/${id}/journeys`).then(({ data }) => setJourneys(data.journeys)).catch(() => setJourneys([]));
    loadAbsences();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const loc = t?.lastLocation;
  const myStop = detail?.route?.stops?.find((s) => s.id === detail?.myStopId) || null;

  return (
    <Box>
      <Button startIcon={<ArrowBackRoundedIcon />} onClick={() => nav('/')} sx={{ mb: 1.5 }}>All children</Button>

      {/* Switcher — a guardian often has several children on different routes */}
      {children?.length > 1 && (
        <TextField select fullWidth size="small" label="Viewing" value={id}
          onChange={(e) => nav(`/child/${e.target.value}`)} sx={{ mb: 2, maxWidth: 360 }}>
          {children.map((c) => (
            <MenuItem key={c.id} value={c.id}>
              {c.name}{c.category ? ` · ${c.category}` : ''}{c.trip?.live ? ' — LIVE' : ''}
            </MenuItem>
          ))}
        </TextField>
      )}

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {!children && <Skeleton variant="rounded" height={120} />}

      {child && (
        <Card sx={live ? { border: '1.5px solid', borderColor: 'success.main' } : undefined}>
          <CardContent>
            <Stack direction="row" spacing={2} alignItems="center">
              <Avatar sx={{ bgcolor: 'primary.light', color: 'primary.main', width: 52, height: 52 }}>
                <PersonRoundedIcon />
              </Avatar>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="h6" fontWeight={800} noWrap>{child.name}</Typography>
                <Stack direction="row" spacing={1} sx={{ mt: 0.3 }} flexWrap="wrap" useFlexGap>
                  {child.category && <Chip size="small" label={child.category} />}
                  {t && <Chip size="small" color={(MY_STATUS[t.myStatus] || MY_STATUS.EXPECTED).color}
                    label={(MY_STATUS[t.myStatus] || MY_STATUS.EXPECTED).label} sx={{ fontWeight: 700 }} />}
                  {live && <Chip size="small" color="success" label="LIVE"
                    sx={{ fontWeight: 800, animation: 'pulse 1.6s infinite', '@keyframes pulse': { '0%,100%': { opacity: 1 }, '50%': { opacity: 0.55 } } }} />}
                </Stack>
              </Box>
            </Stack>

            <Tabs value={tab} onChange={(_e, v) => setTab(v)} sx={{ mt: 1.5, borderBottom: 1, borderColor: 'divider' }}>
              <Tab label="Today" />
              <Tab label="Route" />
              <Tab label={`History${journeys?.length ? ` (${journeys.length})` : ''}`} />
            </Tabs>

            {/* ---------------- TODAY: live map or what's coming ------------- */}
            {tab === 0 && (
              <Box mt={2}>
                {/* The headline: minutes away, or the outcome of today's ride. */}
                {t && (
                  <Box mb={2}>
                    <EtaHero trip={t} childName={child.name} />
                  </Box>
                )}
                {t && <Box mb={2}><JourneyTimeline trip={t} /></Box>}

                {/* Plans change — let parents say so without phoning the school. */}
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap mb={2}>
                  {absentToday ? (
                    <Button size="small" variant="outlined" color="warning" disabled={absBusy}
                      startIcon={<EventAvailableRoundedIcon />}
                      onClick={() => unmarkAbsent(absences.find((a) => new Date(a.date).toISOString().slice(0, 10) === todayISO).id)}>
                      Travelling again today
                    </Button>
                  ) : (
                    <Button size="small" variant="outlined" disabled={absBusy}
                      startIcon={<EventBusyRoundedIcon />} onClick={() => markAbsent(todayISO)}>
                      Not travelling today
                    </Button>
                  )}
                  <Button size="small" variant="outlined" disabled={absBusy}
                    startIcon={<EventBusyRoundedIcon />}
                    onClick={() => markAbsent(new Date(Date.now() + 864e5).toISOString().slice(0, 10))}>
                    Not travelling tomorrow
                  </Button>
                </Stack>
                {absences.length > 0 && (
                  <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap mb={2}>
                    {absences.map((a) => (
                      <Chip key={a.id} size="small" color="warning" variant="outlined"
                        label={`Absent ${dateOf(a.date)}`} onDelete={() => unmarkAbsent(a.id)} />
                    ))}
                  </Stack>
                )}

                {live ? (
                  <Stack spacing={1.2}>
                    <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                      <Chip size="small" variant="outlined" icon={<DirectionsBusRoundedIcon sx={{ fontSize: 15 }} />} label={busLabel(t.vehicle)} />
                      <Chip size="small" variant="outlined" icon={<PhoneRoundedIcon sx={{ fontSize: 15 }} />}
                        label={`${t.driver?.name || 'Driver'}${t.driver?.phone ? ' · ' + t.driver.phone : ''}`}
                        component={t.driver?.phone ? 'a' : 'div'} href={t.driver?.phone ? `tel:${t.driver.phone}` : undefined}
                        clickable={!!t.driver?.phone} />
                    </Stack>
                    {(styleUrl || tileUrl) && (
                      <LiveMap styleUrl={styleUrl} tileUrlTemplate={tileUrl} stop={child.stop}
                        vehicle={loc ? [loc.lng, loc.lat] : null} trail={t.trail || []} height={320} />
                    )}
                    <Typography variant="caption" color="text.secondary">
                      {loc ? `Bus updated ${timeOf(loc.recordedAt)} · started ${timeOf(t.startedAt)}` : 'Waiting for the bus GPS…'}
                      {t.boardedAt ? ` · boarded ${timeOf(t.boardedAt)}` : ''}
                    </Typography>
                  </Stack>
                ) : child.upcoming?.length > 0 ? (
                  <Stack spacing={1}>
                    <Typography variant="subtitle2" color="primary.dark">Coming up today</Typography>
                    {child.upcoming.map((u) => (
                      <Box key={u.id} sx={{ bgcolor: 'primary.light', borderRadius: 2.5, p: 1.5 }}>
                        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                          <Chip size="small" color="primary" icon={<ScheduleRoundedIcon sx={{ fontSize: 15 }} />} label={u.startTime} sx={{ fontWeight: 800 }} />
                          <Typography variant="body2" fontWeight={700}>{u.direction === 'DROP' ? 'Drop' : 'Pickup'}</Typography>
                          <Typography variant="caption" color="text.secondary">{u.name}</Typography>
                        </Stack>
                        <Typography variant="caption" color="text.secondary" display="block" mt={0.4}>
                          🚌 {busLabel(u.vehicle)}{u.driver?.name ? ` · Driver ${u.driver.name}` : ''}
                        </Typography>
                      </Box>
                    ))}
                    <Typography variant="caption" color="text.secondary">
                      Live tracking starts the moment the driver begins the trip.
                    </Typography>
                  </Stack>
                ) : t ? (
                  <Alert severity="info">
                    Today’s ride is finished — started {timeOf(t.startedAt)}, ended {timeOf(t.endedAt)}. See <b>History</b> for details.
                  </Alert>
                ) : (
                  <Typography variant="body2" color="text.secondary">No rides scheduled for today.</Typography>
                )}
              </Box>
            )}

            {/* ---------------- ROUTE: stops + weekly plan ------------------- */}
            {tab === 1 && (
              <Box mt={2}>
                {!detail && <Skeleton variant="rounded" height={160} />}
                {detail && !detail.route && (
                  <Typography variant="body2" color="text.secondary">
                    {child.name} isn’t assigned to a route yet — your organization will set this up.
                  </Typography>
                )}
                {detail?.route && (
                  <Stack spacing={2}>
                    <Box>
                      <Typography fontWeight={800}>{detail.route.name}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {detail.route.direction === 'DROP' ? 'Drop route' : detail.route.direction === 'BOTH' ? 'Pickup & drop' : 'Pickup route'}
                        {' · '}{detail.route.stops.length} stops
                      </Typography>
                    </Box>

                    {(styleUrl || tileUrl) && detail.route.stops.length > 0 && (
                      <LiveMap styleUrl={styleUrl} tileUrlTemplate={tileUrl}
                        stop={myStop ? { lat: myStop.lat, lng: myStop.lng, name: myStop.name } : null}
                        vehicle={live && loc ? [loc.lng, loc.lat] : null} trail={live ? t.trail || [] : []} height={240} />
                    )}

                    <Box>
                      <Typography variant="subtitle2" color="text.secondary" mb={0.5}>STOPS</Typography>
                      <Divider />
                      <Table size="small">
                        <TableBody>
                          {detail.route.stops.map((s) => {
                            const mine = s.id === detail.myStopId;
                            return (
                              <TableRow key={s.id} sx={mine ? { bgcolor: 'primary.light' } : undefined}>
                                <TableCell sx={{ width: 32 }}>{s.sequence}</TableCell>
                                <TableCell>
                                  <b>{s.name}</b>
                                  {mine && <Chip size="small" color="primary" label={`${child.name}’s stop`} sx={{ ml: 1, fontWeight: 700 }} />}
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </Box>

                    <Box>
                      <Typography variant="subtitle2" color="text.secondary" mb={0.5}>WEEKLY PLAN</Typography>
                      <Divider sx={{ mb: 1 }} />
                      {detail.schedules.length === 0 && (
                        <Typography variant="body2" color="text.secondary">No schedules set on this route yet.</Typography>
                      )}
                      <Stack spacing={1}>
                        {detail.schedules.map((s) => (
                          <Stack key={s.id} direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                            <Chip size="small" color="primary" variant="outlined" label={s.startTime} sx={{ fontWeight: 800 }} />
                            <Typography variant="body2" fontWeight={700}>{s.direction === 'DROP' ? 'Drop' : 'Pickup'}</Typography>
                            <Typography variant="caption" color="text.secondary">
                              {daysLabel(s.daysOfWeek)} · 🚌 {busLabel(s.vehicle)}{s.driver?.name ? ` · ${s.driver.name}` : ''}
                            </Typography>
                          </Stack>
                        ))}
                      </Stack>
                    </Box>
                  </Stack>
                )}
              </Box>
            )}

            {/* ---------------- HISTORY: past rides -------------------------- */}
            {tab === 2 && (
              <Box mt={2}>
                {!journeys && <Skeleton variant="rounded" height={160} />}
                {journeys?.length === 0 && (
                  <Typography variant="body2" color="text.secondary">
                    No past rides yet — completed trips appear here with boarding times.
                  </Typography>
                )}
                {journeys?.length > 0 && (
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Date</TableCell>
                        <TableCell>Ride</TableCell>
                        <TableCell>Status</TableCell>
                        <TableCell align="right">Boarded / Dropped</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {journeys.map((j) => {
                        const m = MY_STATUS[j.myStatus] || MY_STATUS.EXPECTED;
                        return (
                          <TableRow key={j.tripId}>
                            <TableCell>{dateOf(j.date)}</TableCell>
                            <TableCell>
                              <b>{j.direction === 'DROP' ? 'Drop' : 'Pickup'}</b>
                              <Typography variant="caption" color="text.secondary" display="block">
                                {j.routeName}{j.driver?.name ? ` · ${j.driver.name}` : ''}
                              </Typography>
                            </TableCell>
                            <TableCell><Chip size="small" color={m.color} label={m.label} /></TableCell>
                            <TableCell align="right">
                              {timeOf(j.boardedAt)}{j.droppedAt ? ` → ${timeOf(j.droppedAt)}` : ''}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                )}
              </Box>
            )}
          </CardContent>
        </Card>
      )}
    </Box>
  );
}
