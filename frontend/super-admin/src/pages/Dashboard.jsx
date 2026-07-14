import { useEffect, useState } from 'react';
import { Box, Card, CardContent, Stack, Button, Chip, Avatar, Typography, LinearProgress } from '@mui/material';
import Grid from '@mui/material/Grid2';
import ApartmentRoundedIcon from '@mui/icons-material/ApartmentRounded';
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import BlockRoundedIcon from '@mui/icons-material/BlockRounded';
import GroupsRoundedIcon from '@mui/icons-material/GroupsRounded';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import TrendingUpRoundedIcon from '@mui/icons-material/TrendingUpRounded';
import { useNavigate } from 'react-router-dom';
import { AreaChart, Area, ResponsiveContainer, Tooltip, XAxis, PieChart, Pie, Cell } from 'recharts';
import { api } from '../lib/api.js';
import PageHeader from '../components/PageHeader.jsx';
import { PRIMARY } from '../theme.js';

const growth = [
  { m: 'Feb', v: 2 }, { m: 'Mar', v: 3 }, { m: 'Apr', v: 5 },
  { m: 'May', v: 6 }, { m: 'Jun', v: 8 }, { m: 'Jul', v: 11 },
];

function Stat({ icon, label, value, tint, delta }) {
  return (
    <Card>
      <CardContent>
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
          <Box>
            <Typography variant="h4" fontWeight={800} lineHeight={1}>{value}</Typography>
            <Typography color="text.secondary" variant="body2" mt={0.5}>{label}</Typography>
          </Box>
          <Box sx={{ width: 48, height: 48, borderRadius: '50%', display: 'grid', placeItems: 'center', bgcolor: `${tint}18`, color: tint }}>{icon}</Box>
        </Stack>
        {delta != null && (
          <Stack direction="row" spacing={0.5} alignItems="center" mt={1.5}>
            <TrendingUpRoundedIcon sx={{ fontSize: 16, color: 'success.main' }} />
            <Typography variant="caption" color="success.main" fontWeight={700}>{delta}</Typography>
            <Typography variant="caption" color="text.secondary">vs last month</Typography>
          </Stack>
        )}
      </CardContent>
    </Card>
  );
}

const statusChip = (s) => ({ ACTIVE: 'success', SUSPENDED: 'error', TRIAL: 'warning' }[s] || 'default');

export default function Dashboard() {
  const nav = useNavigate();
  const [tenants, setTenants] = useState([]);
  useEffect(() => { api.get('/api/tenants').then(({ data }) => setTenants(data.tenants)); }, []);

  const active = tenants.filter((t) => t.status === 'ACTIVE').length;
  const suspended = tenants.filter((t) => t.status === 'SUSPENDED').length;
  const trial = tenants.filter((t) => t.status === 'TRIAL').length;
  const passengers = tenants.reduce((s, t) => s + (t._count?.passengers || 0), 0);

  const pie = [
    { name: 'Active', value: active || 0, color: '#22c55e' },
    { name: 'Suspended', value: suspended || 0, color: '#ef4444' },
    { name: 'Trial', value: trial || 0, color: '#f59e0b' },
  ].filter((p) => p.value > 0);

  return (
    <Box>
      <PageHeader
        title="Dashboard"
        crumbs={[{ label: 'Dashboard' }]}
        action={<Button variant="contained" startIcon={<AddRoundedIcon />} onClick={() => nav('/tenants')}>Manage Tenants</Button>}
      />

      <Grid container spacing={3}>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}><Stat icon={<ApartmentRoundedIcon />} label="Total tenants" value={tenants.length} tint={PRIMARY} delta="+2" /></Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}><Stat icon={<CheckCircleRoundedIcon />} label="Active" value={active} tint="#22c55e" delta="+1" /></Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}><Stat icon={<BlockRoundedIcon />} label="Suspended" value={suspended} tint="#ef4444" /></Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}><Stat icon={<GroupsRoundedIcon />} label="Passengers" value={passengers} tint="#06b6d4" delta="+18" /></Grid>

        {/* Growth chart */}
        <Grid size={{ xs: 12, md: 8 }}>
          <Card>
            <CardContent>
              <Stack direction="row" justifyContent="space-between" alignItems="center" mb={1}>
                <Box>
                  <Typography variant="h6">Tenant growth</Typography>
                  <Typography variant="body2" color="text.secondary">New organizations over time</Typography>
                </Box>
                <Chip label="Last 6 months" size="small" sx={{ bgcolor: 'primary.light', color: 'primary.main' }} />
              </Stack>
              <Box sx={{ height: 260 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={growth} margin={{ top: 10, right: 0, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={PRIMARY} stopOpacity={0.35} />
                        <stop offset="100%" stopColor={PRIMARY} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="m" axisLine={false} tickLine={false} tick={{ fill: '#9a9ab0', fontSize: 12 }} />
                    <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #eee' }} />
                    <Area type="monotone" dataKey="v" stroke={PRIMARY} strokeWidth={3} fill="url(#g)" isAnimationActive={false} dot={{ r: 3, fill: PRIMARY }} />
                  </AreaChart>
                </ResponsiveContainer>
              </Box>
            </CardContent>
          </Card>
        </Grid>

        {/* Status donut */}
        <Grid size={{ xs: 12, md: 4 }}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="h6" mb={1}>Tenant status</Typography>
              <Box sx={{ height: 200 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={pie.length ? pie : [{ name: 'None', value: 1, color: '#eee' }]} dataKey="value" innerRadius={60} outerRadius={85} paddingAngle={3}>
                      {(pie.length ? pie : [{ color: '#eee' }]).map((e, i) => <Cell key={i} fill={e.color} />)}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </Box>
              <Stack spacing={1} mt={1}>
                {pie.map((p) => (
                  <Stack key={p.name} direction="row" justifyContent="space-between" alignItems="center">
                    <Stack direction="row" spacing={1} alignItems="center">
                      <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: p.color }} />
                      <Typography variant="body2">{p.name}</Typography>
                    </Stack>
                    <Typography variant="body2" fontWeight={700}>{p.value}</Typography>
                  </Stack>
                ))}
              </Stack>
            </CardContent>
          </Card>
        </Grid>

        {/* Recent tenants */}
        <Grid size={12}>
          <Card>
            <CardContent>
              <Stack direction="row" justifyContent="space-between" alignItems="center" mb={2}>
                <Typography variant="h6">Recent tenants</Typography>
                <Button size="small" onClick={() => nav('/tenants')}>View all</Button>
              </Stack>
              <Grid container spacing={2}>
                {tenants.slice(0, 6).map((t) => (
                  <Grid size={{ xs: 12, sm: 6, md: 4 }} key={t.id}>
                    <Box sx={{ p: 2, borderRadius: 3, border: '1px solid #efeff5', cursor: 'pointer', transition: '.15s', '&:hover': { boxShadow: '0 10px 24px rgba(46,41,78,0.08)' } }} onClick={() => nav(`/tenants/${t.id}`)}>
                      <Stack direction="row" justifyContent="space-between" alignItems="center" mb={1}>
                        <Stack direction="row" spacing={1.5} alignItems="center">
                          <Avatar variant="rounded" sx={{ bgcolor: 'primary.light', color: 'primary.main', fontWeight: 800 }}>{t.name[0]}</Avatar>
                          <Box>
                            <Typography fontWeight={700} lineHeight={1.2}>{t.name}</Typography>
                            <Typography variant="caption" color="text.secondary">/{t.slug}</Typography>
                          </Box>
                        </Stack>
                        <Chip size="small" label={t.status} color={statusChip(t.status)} variant="outlined" />
                      </Stack>
                      <Typography variant="caption" color="text.secondary">Capacity usage</Typography>
                      <LinearProgress variant="determinate" value={Math.min(100, (t._count?.passengers || 0) * 5)} sx={{ height: 6, borderRadius: 3, mt: 0.5 }} />
                      <Typography variant="caption" color="text.secondary">{t._count?.passengers || 0} passengers · {t._count?.vehicles || 0} vehicles</Typography>
                    </Box>
                  </Grid>
                ))}
                {tenants.length === 0 && <Grid size={12}><Typography color="text.secondary" sx={{ p: 2 }}>No tenants yet.</Typography></Grid>}
              </Grid>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
}
