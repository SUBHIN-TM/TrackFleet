import { useEffect, useState } from 'react';
import { Box, Card, CardContent, Stack, Typography, Button, Avatar } from '@mui/material';
import Grid from '@mui/material/Grid2';
import DirectionsBusRoundedIcon from '@mui/icons-material/DirectionsBusRounded';
import BadgeRoundedIcon from '@mui/icons-material/BadgeRounded';
import GroupsRoundedIcon from '@mui/icons-material/GroupsRounded';
import RouteRoundedIcon from '@mui/icons-material/RouteRounded';
import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded';
import { BarChart, Bar, ResponsiveContainer, XAxis, YAxis, Tooltip, Cell } from 'recharts';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import PageHeader from '../components/PageHeader.jsx';
import { PRIMARY } from '../theme.js';

function Stat({ icon, label, value, tint, onClick }) {
  return (
    <Card sx={{ cursor: 'pointer', transition: '.15s', '&:hover': { transform: 'translateY(-2px)', boxShadow: '0 12px 28px rgba(41,52,78,0.08)' } }} onClick={onClick}>
      <CardContent>
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
          <Box>
            <Typography variant="h4" fontWeight={800} lineHeight={1}>{value}</Typography>
            <Typography color="text.secondary" variant="body2" mt={0.5}>{label}</Typography>
          </Box>
          <Box sx={{ width: 48, height: 48, borderRadius: '50%', display: 'grid', placeItems: 'center', bgcolor: `${tint}18`, color: tint }}>{icon}</Box>
        </Stack>
      </CardContent>
    </Card>
  );
}

export default function Dashboard() {
  const nav = useNavigate();
  const [c, setC] = useState({ vehicles: 0, drivers: 0, passengers: 0, routes: 0 });

  useEffect(() => {
    (async () => {
      const [v, d, p, r] = await Promise.all([
        api.get('/api/vehicles'), api.get('/api/drivers'), api.get('/api/passengers'), api.get('/api/routes'),
      ]);
      setC({ vehicles: v.data.vehicles.length, drivers: d.data.drivers.length, passengers: p.data.passengers.length, routes: r.data.routes.length });
    })();
  }, []);

  const bars = [
    { name: 'Vehicles', value: c.vehicles, color: '#2f6df6' },
    { name: 'Drivers', value: c.drivers, color: '#06b6d4' },
    { name: 'Passengers', value: c.passengers, color: '#8b5cf6' },
    { name: 'Routes', value: c.routes, color: '#f59e0b' },
  ];

  const setup = [
    { label: 'Add a vehicle', to: '/vehicles', icon: <DirectionsBusRoundedIcon />, done: c.vehicles > 0 },
    { label: 'Add a driver', to: '/drivers', icon: <BadgeRoundedIcon />, done: c.drivers > 0 },
    { label: 'Add passengers', to: '/passengers', icon: <GroupsRoundedIcon />, done: c.passengers > 0 },
    { label: 'Build a route', to: '/routes', icon: <RouteRoundedIcon />, done: c.routes > 0 },
  ];

  return (
    <Box>
      <PageHeader title="Dashboard" crumbs={[{ label: 'Dashboard' }]}
        action={<Button variant="contained" endIcon={<ArrowForwardRoundedIcon />} onClick={() => nav('/routes')}>Build a route</Button>} />

      <Grid container spacing={3}>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}><Stat icon={<DirectionsBusRoundedIcon />} label="Vehicles" value={c.vehicles} tint="#2f6df6" onClick={() => nav('/vehicles')} /></Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}><Stat icon={<BadgeRoundedIcon />} label="Drivers" value={c.drivers} tint="#06b6d4" onClick={() => nav('/drivers')} /></Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}><Stat icon={<GroupsRoundedIcon />} label="Passengers" value={c.passengers} tint="#8b5cf6" onClick={() => nav('/passengers')} /></Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}><Stat icon={<RouteRoundedIcon />} label="Routes" value={c.routes} tint="#f59e0b" onClick={() => nav('/routes')} /></Grid>

        <Grid size={{ xs: 12, md: 7 }}>
          <Card>
            <CardContent>
              <Typography variant="h6" mb={0.5}>Fleet overview</Typography>
              <Typography variant="body2" color="text.secondary" mb={1}>Records in your organization</Typography>
              <Box sx={{ height: 260 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={bars} margin={{ top: 10, right: 0, left: -20, bottom: 0 }} barCategoryGap="35%">
                    <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#9a9ab0', fontSize: 12 }} />
                    <YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fill: '#9a9ab0', fontSize: 12 }} domain={[0, (max) => Math.max(4, max + 2)]} />
                    <Tooltip cursor={{ fill: '#f4f6fb' }} contentStyle={{ borderRadius: 12, border: '1px solid #eee' }} />
                    <Bar dataKey="value" radius={[8, 8, 0, 0]} isAnimationActive={false} maxBarSize={54}>
                      {bars.map((b, i) => <Cell key={i} fill={b.color} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </Box>
            </CardContent>
          </Card>
        </Grid>

        <Grid size={{ xs: 12, md: 5 }}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="h6" mb={1.5}>Setup checklist</Typography>
              <Stack spacing={1.5}>
                {setup.map((s) => (
                  <Stack key={s.to} direction="row" alignItems="center" spacing={1.5} sx={{ p: 1.2, borderRadius: 2, border: '1px solid #efeff5', cursor: 'pointer', '&:hover': { bgcolor: '#f7f9ff' } }} onClick={() => nav(s.to)}>
                    <Avatar variant="rounded" sx={{ bgcolor: s.done ? 'success.light' : 'primary.light', color: s.done ? 'success.main' : 'primary.main' }}>{s.icon}</Avatar>
                    <Box sx={{ flex: 1 }}>
                      <Typography fontWeight={700} variant="body2">{s.label}</Typography>
                      <Typography variant="caption" color={s.done ? 'success.main' : 'text.secondary'}>{s.done ? 'Done' : 'Pending'}</Typography>
                    </Box>
                    <ArrowForwardRoundedIcon sx={{ color: 'text.secondary', fontSize: 18 }} />
                  </Stack>
                ))}
              </Stack>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
}
