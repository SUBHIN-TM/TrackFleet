import { useEffect, useRef, useState } from 'react';
import {
  Box, Typography, Card, CardContent, Stack, Chip, Avatar, Skeleton, Alert, Divider,
} from '@mui/material';
import PersonRoundedIcon from '@mui/icons-material/PersonRounded';
import PlaceRoundedIcon from '@mui/icons-material/PlaceRounded';
import ScheduleRoundedIcon from '@mui/icons-material/ScheduleRounded';
import RouteRoundedIcon from '@mui/icons-material/RouteRounded';
import DirectionsBusRoundedIcon from '@mui/icons-material/DirectionsBusRounded';
import PhoneRoundedIcon from '@mui/icons-material/PhoneRounded';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import LiveMap from '../components/LiveMap.jsx';

const POLL_MS = 5000;

// What the parent actually wants to know, per state of the day.
const MY_STATUS = {
  EXPECTED: { label: 'Waiting to board', color: 'default' },
  ONBOARD: { label: 'On the bus', color: 'success' },
  DROPPED: { label: 'Dropped off', color: 'info' },
  NO_SHOW: { label: 'Did not board', color: 'error' },
  ABSENT: { label: 'Marked absent', color: 'warning' },
};
const timeOf = (d) => (d ? new Date(d).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '');

export default function Dashboard() {
  const { user } = useAuth();
  const [children, setChildren] = useState(null);
  const [error, setError] = useState('');
  const [tileUrl, setTileUrl] = useState('');
  const [styleUrl, setStyleUrl] = useState('');
  const timer = useRef(null);

  async function load() {
    try {
      const { data } = await api.get('/api/trips/guardian/live');
      setChildren(data.children);
      setError('');
    } catch (err) {
      if (children === null) {
        setError(err.response?.data?.error || 'Could not load your details');
        setChildren([]);
      }
    }
  }

  useEffect(() => {
    load();
    api.get('/api/map/config').then(({ data }) => { setTileUrl(data.tileUrlTemplate); setStyleUrl(data.styleUrl || ''); }).catch(() => {});
    timer.current = setInterval(load, POLL_MS);
    return () => clearInterval(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const anyLive = children?.some((c) => c.trip?.live);
  const anyUpcoming = children?.some((c) => !c.trip && c.upcoming?.length > 0);

  return (
    <Box>
      <Typography variant="h4" mb={0.5}>Hi{user?.name ? `, ${user.name}` : ''} 👋</Typography>
      <Typography color="text.secondary" mb={3}>
        {user?.tenantName ? `${user.tenantName} · ` : ''}
        {anyLive
          ? 'A bus is on the move — following it live.'
          : anyUpcoming
            ? 'Today’s rides are scheduled — tracking begins when the bus starts.'
            : 'Here’s who you’re following.'}
      </Typography>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {children === null && (
        <Stack spacing={2}>{[0, 1].map((i) => <Skeleton key={i} variant="rounded" height={130} />)}</Stack>
      )}

      {children && children.length === 0 && !error && (
        <Card><CardContent sx={{ py: 6, textAlign: 'center', color: 'text.secondary' }}>
          No one is linked to your account yet. Your organization will add them.
        </CardContent></Card>
      )}

      <Stack spacing={2.5}>
        {children?.map((c) => {
          const t = c.trip;
          const live = t?.live;
          const st = t ? (MY_STATUS[t.myStatus] || MY_STATUS.EXPECTED) : null;
          const loc = t?.lastLocation;
          return (
            <Card key={c.id} sx={live ? { border: '1.5px solid', borderColor: 'success.main' } : undefined}>
              <CardContent>
                {/* Who */}
                <Stack direction="row" spacing={2} alignItems="center">
                  <Avatar sx={{ bgcolor: 'primary.light', color: 'primary.main', width: 52, height: 52 }}>
                    <PersonRoundedIcon />
                  </Avatar>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="h6" fontWeight={800} noWrap>{c.name}</Typography>
                    <Stack direction="row" spacing={1} sx={{ mt: 0.3 }} flexWrap="wrap" useFlexGap>
                      {c.category && <Chip size="small" label={c.category} />}
                      {t && <Chip size="small" color={st.color} label={st.label} sx={{ fontWeight: 700 }} />}
                      {live && (
                        <Chip size="small" color="success" label="LIVE"
                          sx={{ fontWeight: 800, animation: 'pulse 1.6s infinite', '@keyframes pulse': { '0%,100%': { opacity: 1 }, '50%': { opacity: 0.55 } } }} />
                      )}
                    </Stack>
                  </Box>
                </Stack>

                <Divider sx={{ my: 1.5 }} />

                {/* No live trip: show today's upcoming runs + standing details */}
                {!t && (
                  <Stack spacing={1.2}>
                    {c.route && <Info icon={<RouteRoundedIcon fontSize="small" />} label="Route" value={c.route.name} />}
                    {c.stop
                      ? <Info icon={<PlaceRoundedIcon fontSize="small" />} label="Stop" value={c.stop.name} />
                      : <Typography variant="body2" color="text.secondary">No stop assigned yet.</Typography>}

                    {c.upcoming?.length > 0 ? (
                      <Box sx={{ bgcolor: 'primary.light', borderRadius: 2.5, p: 1.5, mt: 0.5 }}>
                        <Typography variant="subtitle2" color="primary.dark" mb={0.8}>
                          Coming up today
                        </Typography>
                        <Stack spacing={1}>
                          {c.upcoming.map((u) => (
                            <Box key={u.id}>
                              <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                                <Chip size="small" color="primary" icon={<ScheduleRoundedIcon sx={{ fontSize: 15 }} />}
                                  label={u.startTime} sx={{ fontWeight: 800 }} />
                                <Typography variant="body2" fontWeight={700}>
                                  {u.direction === 'DROP' ? 'Drop' : 'Pickup'}
                                </Typography>
                                <Typography variant="caption" color="text.secondary">{u.name}</Typography>
                              </Stack>
                              <Typography variant="caption" color="text.secondary" display="block" mt={0.3}>
                                🚌 {u.vehicle?.fleetNo ? u.vehicle.fleetNo + ' · ' : ''}{u.vehicle?.regNumber || 'Bus'}
                                {u.driver?.name ? ` · Driver ${u.driver.name}` : ''}
                                {u.driver?.phone ? ` · ${u.driver.phone}` : ''}
                              </Typography>
                            </Box>
                          ))}
                        </Stack>
                        <Typography variant="caption" color="text.secondary" display="block" mt={1}>
                          Live tracking starts the moment the driver begins the trip.
                        </Typography>
                      </Box>
                    ) : (
                      <Typography variant="caption" color="text.secondary">
                        {c.route ? 'No more runs scheduled for today.' : 'Not assigned to a route yet — your organization will set this up.'}
                      </Typography>
                    )}
                  </Stack>
                )}

                {/* Trip today (live or finished) */}
                {t && (
                  <Stack spacing={1.2}>
                    <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                      <Chip size="small" variant="outlined" icon={<RouteRoundedIcon sx={{ fontSize: 15 }} />}
                        label={`${t.routeName || 'Route'} · ${t.direction === 'DROP' ? 'Drop' : 'Pickup'}`} />
                      <Chip size="small" variant="outlined" icon={<DirectionsBusRoundedIcon sx={{ fontSize: 15 }} />}
                        label={`${t.vehicle?.fleetNo ? t.vehicle.fleetNo + ' · ' : ''}${t.vehicle?.regNumber || 'Bus'}`} />
                      <Chip size="small" variant="outlined" icon={<PhoneRoundedIcon sx={{ fontSize: 15 }} />}
                        label={`${t.driver?.name || 'Driver'}${t.driver?.phone ? ' · ' + t.driver.phone : ''}`}
                        component={t.driver?.phone ? 'a' : 'div'}
                        href={t.driver?.phone ? `tel:${t.driver.phone}` : undefined}
                        clickable={!!t.driver?.phone} />
                    </Stack>

                    <Typography variant="caption" color="text.secondary">
                      {t.status === 'COMPLETED'
                        ? `Trip finished · started ${timeOf(t.startedAt)}, ended ${timeOf(t.endedAt)}`
                        : `Started ${timeOf(t.startedAt)}`}
                      {t.boardedAt ? ` · boarded ${timeOf(t.boardedAt)}` : ''}
                      {t.droppedAt ? ` · dropped ${timeOf(t.droppedAt)}` : ''}
                    </Typography>

                    {live && (styleUrl || tileUrl) && (
                      <>
                        <LiveMap
                          styleUrl={styleUrl}
                          tileUrlTemplate={tileUrl}
                          stop={c.stop}
                          vehicle={loc ? [loc.lng, loc.lat] : null}
                          trail={t.trail || []}
                          height={260}
                        />
                        <Typography variant="caption" color="text.secondary">
                          {loc
                            ? `Bus location updated ${timeOf(loc.recordedAt)} — refreshes every few seconds. 📍 is ${c.name}’s stop.`
                            : 'Waiting for the bus GPS — it appears within seconds of the driver starting.'}
                        </Typography>
                      </>
                    )}
                  </Stack>
                )}
              </CardContent>
            </Card>
          );
        })}
      </Stack>
    </Box>
  );
}

function Info({ icon, label, value }) {
  return (
    <Stack direction="row" spacing={1.5} alignItems="center">
      <Box sx={{ color: 'text.secondary', display: 'flex' }}>{icon}</Box>
      <Typography variant="body2" color="text.secondary" sx={{ minWidth: 90 }}>{label}</Typography>
      <Typography variant="body2" fontWeight={700}>{value}</Typography>
    </Stack>
  );
}
