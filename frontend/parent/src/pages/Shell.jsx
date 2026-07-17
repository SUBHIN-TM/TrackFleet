import { Outlet } from 'react-router-dom';
import {
  AppBar, Toolbar, Typography, Box, Avatar, Menu, MenuItem, IconButton, Divider, Chip,
} from '@mui/material';
import { useState } from 'react';
import DirectionsBusRoundedIcon from '@mui/icons-material/DirectionsBusRounded';
import LogoutRoundedIcon from '@mui/icons-material/LogoutRounded';
import ApartmentRoundedIcon from '@mui/icons-material/ApartmentRounded';
import { useAuth } from '../lib/auth.jsx';
import NotificationBell from '../components/NotificationBell.jsx';

export default function Shell() {
  const { user, logout } = useAuth();
  const [anchor, setAnchor] = useState(null);
  const label = user?.name || 'Parent';
  const initials = label.split(/[\s@.]+/).filter(Boolean).map((s) => s[0]).slice(0, 2).join('').toUpperCase();

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
      <AppBar position="sticky" sx={{ bgcolor: '#fff', color: 'text.primary', borderBottom: '1px solid #eef0f7' }}>
        <Toolbar sx={{ gap: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.2 }}>
            <Box sx={{ width: 38, height: 38, borderRadius: 2.5, display: 'grid', placeItems: 'center', background: 'linear-gradient(135deg,#3b82f6,#1d4ed8)' }}>
              <DirectionsBusRoundedIcon sx={{ color: '#fff', fontSize: 22 }} />
            </Box>
            <Typography variant="h6" fontWeight={800}>TrackFleet</Typography>
          </Box>

          <Box sx={{ flexGrow: 1 }} />
          {user?.tenantName && (
            <Chip icon={<ApartmentRoundedIcon sx={{ fontSize: 17, ml: 0.5 }} />} label={user.tenantName} size="small"
              sx={{ bgcolor: 'primary.light', color: 'primary.main', fontWeight: 700, maxWidth: 240,
                display: { xs: 'none', sm: 'flex' }, '& .MuiChip-label': { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }} />
          )}
          <NotificationBell />
          <IconButton onClick={(e) => setAnchor(e.currentTarget)} sx={{ ml: 0.5 }}>
            <Avatar sx={{ width: 38, height: 38, bgcolor: 'primary.main', fontSize: 14, fontWeight: 800 }}>{initials}</Avatar>
          </IconButton>
          <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} transformOrigin={{ vertical: 'top', horizontal: 'right' }}
            PaperProps={{ sx: { borderRadius: 3, minWidth: 220, mt: 1 } }}>
            <Box sx={{ px: 2, py: 1.2 }}>
              <Typography fontWeight={800}>{label}</Typography>
              <Typography variant="caption" color="text.secondary">{user?.loginId || user?.phone}</Typography>
            </Box>
            <Divider />
            <MenuItem onClick={logout} sx={{ mt: 0.5 }}><LogoutRoundedIcon fontSize="small" style={{ marginRight: 10 }} />Logout</MenuItem>
          </Menu>
        </Toolbar>
      </AppBar>

      <Box component="main" sx={{ p: { xs: 2, md: 4 }, maxWidth: 900, mx: 'auto' }}>
        <Outlet />
      </Box>
    </Box>
  );
}
