import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import {
  AppBar, Toolbar, Typography, Box, Drawer, List, ListItemButton,
  ListItemIcon, ListItemText, Avatar, Menu, MenuItem, IconButton, Divider,
  InputBase, Badge, Tooltip, Chip, Dialog, DialogTitle, DialogContent,
  DialogActions, TextField, Button, Alert, Stack,
} from '@mui/material';
import { useState } from 'react';
import DashboardRoundedIcon from '@mui/icons-material/GridViewRounded';
import DirectionsBusRoundedIcon from '@mui/icons-material/DirectionsBusRounded';
import BadgeRoundedIcon from '@mui/icons-material/BadgeRounded';
import GroupsRoundedIcon from '@mui/icons-material/GroupsRounded';
import RouteRoundedIcon from '@mui/icons-material/RouteRounded';
import CalendarMonthRoundedIcon from '@mui/icons-material/CalendarMonthRounded';
import SensorsRoundedIcon from '@mui/icons-material/SensorsRounded';
import LogoutRoundedIcon from '@mui/icons-material/LogoutRounded';
import PersonRoundedIcon from '@mui/icons-material/PersonRounded';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import ApartmentRoundedIcon from '@mui/icons-material/ApartmentRounded';
import { useAuth } from '../lib/auth.jsx';
import NotificationBell from '../components/NotificationBell.jsx';

const WIDTH = 260;
const nav = [
  { to: '/', label: 'Dashboard', icon: <DashboardRoundedIcon /> },
  { to: '/live', label: 'Live Today', icon: <SensorsRoundedIcon /> },
  { to: '/vehicles', label: 'Vehicles', icon: <DirectionsBusRoundedIcon /> },
  { to: '/drivers', label: 'Drivers', icon: <BadgeRoundedIcon /> },
  { to: '/passengers', label: 'Passengers', icon: <GroupsRoundedIcon /> },
  { to: '/routes', label: 'Routes & Stops', icon: <RouteRoundedIcon /> },
  { to: '/schedules', label: 'Schedules', icon: <CalendarMonthRoundedIcon /> },
];

export default function Shell() {
  const { user, logout, updateName } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [anchor, setAnchor] = useState(null);
  const isActive = (to) => (to === '/' ? pathname === '/' : pathname.startsWith(to));
  // Name may be a placeholder the super admin set, or null on older invites —
  // fall back to the email rather than showing a blank avatar.
  const label = user?.name || user?.email || 'Admin';
  const initials = label.split(/[\s@.]+/).filter(Boolean).map((s) => s[0]).slice(0, 2).join('').toUpperCase();

  // "Primary Admin" / "Admin 2" are placeholders, not real names — nudge the
  // person to replace it with their own. We also treat the org's own name/id as
  // a placeholder: it's a personal-name field, so the company name landing here
  // (a common setup slip) shouldn't be shown as if it were who they are.
  const orgAliases = [user?.tenantName, user?.tenantSlug, user?.tenantSlug && `TF-${user.tenantSlug}`]
    .filter(Boolean)
    .map((s) => s.toLowerCase());
  const nameIsOrgish = !!user?.name && orgAliases.includes(user.name.toLowerCase());
  const isPlaceholder = !user?.name || /^(Primary Admin|Admin \d+)$/.test(user.name) || nameIsOrgish;
  const [nameDlg, setNameDlg] = useState(false);
  const [newName, setNewName] = useState('');
  const [savingName, setSavingName] = useState(false);
  const [nameErr, setNameErr] = useState('');

  async function saveName() {
    setNameErr(''); setSavingName(true);
    try {
      await updateName(newName.trim());
      setNameDlg(false);
    } catch (err) {
      setNameErr(err.response?.data?.error || 'Could not save your name');
    } finally { setSavingName(false); }
  }

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', bgcolor: 'background.default' }}>
      <AppBar position="fixed" sx={{ zIndex: (t) => t.zIndex.drawer + 1, bgcolor: '#fff', color: 'text.primary', borderBottom: '1px solid #eeeef4' }}>
        <Toolbar sx={{ gap: 2 }}>
          <Box sx={{ width: WIDTH - 32, display: 'flex', alignItems: 'center', gap: 1.2 }}>
            <Box sx={{ width: 38, height: 38, borderRadius: 2.5, display: 'grid', placeItems: 'center', background: 'linear-gradient(135deg,#3b82f6,#1d4ed8)' }}>
              <DirectionsBusRoundedIcon sx={{ color: '#fff', fontSize: 22 }} />
            </Box>
            <Typography variant="h6" fontWeight={800}>TrackFleet</Typography>
          </Box>

          <Box sx={{ display: { xs: 'none', sm: 'flex' }, alignItems: 'center', bgcolor: '#f4f4f8', borderRadius: 40, px: 2, py: 0.5, width: 320, maxWidth: '35%' }}>
            <SearchRoundedIcon sx={{ color: 'text.secondary', fontSize: 20, mr: 1 }} />
            <InputBase placeholder="Search…" sx={{ fontSize: 14, flex: 1 }} />
          </Box>

          <Box sx={{ flexGrow: 1 }} />
          {user?.tenantName && (
            <Chip icon={<ApartmentRoundedIcon sx={{ fontSize: 17, ml: 0.5 }} />} label={user.tenantName} size="small"
              sx={{ bgcolor: 'primary.light', color: 'primary.main', fontWeight: 700, maxWidth: 260,
                display: { xs: 'none', sm: 'flex' }, '& .MuiChip-label': { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }} />
          )}
          <NotificationBell />
          <IconButton onClick={(e) => setAnchor(e.currentTarget)} sx={{ ml: 0.5 }}>
            <Avatar sx={{ width: 38, height: 38, bgcolor: 'primary.main', fontSize: 14, fontWeight: 800 }}>{initials}</Avatar>
          </IconButton>
          <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} transformOrigin={{ vertical: 'top', horizontal: 'right' }}
            PaperProps={{ sx: { borderRadius: 3, minWidth: 220, mt: 1 } }}>
            <Box sx={{ px: 2, py: 1.2 }}>
              <Typography fontWeight={800} fontStyle={isPlaceholder ? 'italic' : 'normal'}
                color={isPlaceholder ? 'text.secondary' : 'text.primary'}>
                {label}
              </Typography>
              <Typography variant="caption" color="text.secondary">{user?.email}</Typography>
              {isPlaceholder && (
                <Typography variant="caption" color="warning.main" display="block" mt={0.5}>
                  This isn’t your real name yet
                </Typography>
              )}
            </Box>
            <Divider />
            <MenuItem sx={{ mt: 0.5 }}
              onClick={() => { setNewName(user?.name || ''); setNameErr(''); setNameDlg(true); setAnchor(null); }}>
              <PersonRoundedIcon fontSize="small" style={{ marginRight: 10 }} />
              {isPlaceholder ? 'Set your name' : 'Change your name'}
            </MenuItem>
            <MenuItem onClick={logout}><LogoutRoundedIcon fontSize="small" style={{ marginRight: 10 }} />Logout</MenuItem>
          </Menu>
        </Toolbar>
      </AppBar>

      <Drawer variant="permanent" sx={{ width: WIDTH, flexShrink: 0, [`& .MuiDrawer-paper`]: { width: WIDTH, boxSizing: 'border-box', border: 'none', bgcolor: '#fff', boxShadow: '0 0 40px rgba(41,52,78,0.04)' } }}>
        <Toolbar />
        <Box sx={{ py: 2 }}>
          <Typography variant="overline" color="text.secondary" sx={{ pl: 3.5 }}>Manage</Typography>
          <List>
            {nav.map((n) => (
              <ListItemButton key={n.to} selected={isActive(n.to)} onClick={() => navigate(n.to)}>
                <ListItemIcon>{n.icon}</ListItemIcon>
                <ListItemText primary={n.label} primaryTypographyProps={{ fontWeight: 700, fontSize: 14.5 }} />
              </ListItemButton>
            ))}
          </List>
        </Box>
      </Drawer>

      <Box component="main" sx={{ flexGrow: 1, p: { xs: 2, md: 4 } }}>
        <Toolbar />
        <Outlet />
      </Box>

      <Dialog open={nameDlg} onClose={() => setNameDlg(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ pb: 0.5 }}>
          {isPlaceholder ? 'What’s your name?' : 'Change your name'}
          <Typography variant="body2" color="text.secondary">{user?.email}</Typography>
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2} mt={1}>
            {nameErr && <Alert severity="error">{nameErr}</Alert>}
            {isPlaceholder && (
              <Typography variant="body2" color="text.secondary">
                You were set up as “{label}” — a placeholder. Put your real name in so your
                colleagues know who’s who.
              </Typography>
            )}
            <TextField autoFocus label="Your name" value={newName} fullWidth
              placeholder="e.g. Priya Kumar"
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && newName.trim().length >= 2) saveName(); }} />
            {/* Email is fixed for admins — only the super admin can change who a
                login belongs to. Shown disabled so it's clear it isn't editable. */}
            <TextField label="Email" value={user?.email || ''} fullWidth disabled
              helperText="Your email can’t be changed here — ask your platform admin if it’s wrong." />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setNameDlg(false)}>Cancel</Button>
          <Button variant="contained" onClick={saveName} disabled={savingName || newName.trim().length < 2}>
            {savingName ? 'Saving…' : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
