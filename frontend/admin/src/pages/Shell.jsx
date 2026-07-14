import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import {
  AppBar, Toolbar, Typography, Box, Drawer, List, ListItemButton,
  ListItemIcon, ListItemText, Avatar, Menu, MenuItem, IconButton, Divider,
  InputBase, Badge, Tooltip, Chip,
} from '@mui/material';
import { useState } from 'react';
import DashboardRoundedIcon from '@mui/icons-material/GridViewRounded';
import DirectionsBusRoundedIcon from '@mui/icons-material/DirectionsBusRounded';
import BadgeRoundedIcon from '@mui/icons-material/BadgeRounded';
import GroupsRoundedIcon from '@mui/icons-material/GroupsRounded';
import RouteRoundedIcon from '@mui/icons-material/RouteRounded';
import LogoutRoundedIcon from '@mui/icons-material/LogoutRounded';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import NotificationsNoneRoundedIcon from '@mui/icons-material/NotificationsNoneRounded';
import { useAuth } from '../lib/auth.jsx';

const WIDTH = 260;
const nav = [
  { to: '/', label: 'Dashboard', icon: <DashboardRoundedIcon /> },
  { to: '/vehicles', label: 'Vehicles', icon: <DirectionsBusRoundedIcon /> },
  { to: '/drivers', label: 'Drivers', icon: <BadgeRoundedIcon /> },
  { to: '/passengers', label: 'Students', icon: <GroupsRoundedIcon /> },
  { to: '/routes', label: 'Routes & Stops', icon: <RouteRoundedIcon /> },
];

export default function Shell() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [anchor, setAnchor] = useState(null);
  const isActive = (to) => (to === '/' ? pathname === '/' : pathname.startsWith(to));
  const initials = (user?.name || 'A').split(' ').map((s) => s[0]).slice(0, 2).join('').toUpperCase();

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
          <Chip label="School Admin" size="small" sx={{ bgcolor: 'primary.light', color: 'primary.main', display: { xs: 'none', md: 'flex' } }} />
          <Tooltip title="Notifications"><IconButton><Badge color="error" variant="dot"><NotificationsNoneRoundedIcon /></Badge></IconButton></Tooltip>
          <IconButton onClick={(e) => setAnchor(e.currentTarget)} sx={{ ml: 0.5 }}>
            <Avatar sx={{ width: 38, height: 38, bgcolor: 'primary.main', fontSize: 14, fontWeight: 800 }}>{initials}</Avatar>
          </IconButton>
          <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} transformOrigin={{ vertical: 'top', horizontal: 'right' }}
            PaperProps={{ sx: { borderRadius: 3, minWidth: 220, mt: 1 } }}>
            <Box sx={{ px: 2, py: 1.2 }}>
              <Typography fontWeight={800}>{user?.name}</Typography>
              <Typography variant="caption" color="text.secondary">{user?.email}</Typography>
            </Box>
            <Divider />
            <MenuItem onClick={logout} sx={{ mt: 0.5 }}><LogoutRoundedIcon fontSize="small" style={{ marginRight: 10 }} />Logout</MenuItem>
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
    </Box>
  );
}
