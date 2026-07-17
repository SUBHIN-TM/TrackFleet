import { useCallback, useEffect, useRef, useState } from 'react';
import {
  IconButton, Badge, Tooltip, Popover, Box, Typography, List, ListItemButton,
  ListItemAvatar, Avatar, ListItemText, Button, Divider,
} from '@mui/material';
import NotificationsNoneRoundedIcon from '@mui/icons-material/NotificationsNoneRounded';
import DirectionsBusRoundedIcon from '@mui/icons-material/DirectionsBusRounded';
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import FlagRoundedIcon from '@mui/icons-material/FlagRounded';
import ReportProblemRoundedIcon from '@mui/icons-material/ReportProblemRounded';
import DoneAllRoundedIcon from '@mui/icons-material/DoneAllRounded';
import { api } from '../lib/api.js';

// The moments a parent cares about, each with its own colour so the list is
// scannable at a glance. Unknown types fall back to a neutral bell.
const STYLES = {
  TRIP_STARTED: { icon: <DirectionsBusRoundedIcon fontSize="small" />, color: '#1d4ed8', bg: '#e8f0fe' },
  BOARDED: { icon: <CheckCircleRoundedIcon fontSize="small" />, color: '#1f9d4e', bg: '#e6f6ec' },
  DROPPED: { icon: <FlagRoundedIcon fontSize="small" />, color: '#0284c7', bg: '#e0f2fe' },
  NO_SHOW: { icon: <ReportProblemRoundedIcon fontSize="small" />, color: '#dc2626', bg: '#fdeced' },
  ACCOUNT_READY: { icon: <CheckCircleRoundedIcon fontSize="small" />, color: '#7c3aed', bg: '#efe9fe' },
};
const FALLBACK = { icon: <NotificationsNoneRoundedIcon fontSize="small" />, color: '#64748b', bg: '#f1f5f9' };

const ago = (d) => {
  const s = Math.round((Date.now() - new Date(d)) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return new Date(d).toLocaleDateString([], { day: '2-digit', month: 'short' });
};

export default function NotificationBell() {
  const [anchor, setAnchor] = useState(null);
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const timer = useRef(null);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get('/api/notifications', { params: { limit: 30 } });
      setItems(data.notifications);
      setUnread(data.unreadCount);
    } catch { /* the bell is never worth an error toast */ }
  }, []);

  useEffect(() => {
    load();
    timer.current = setInterval(load, 20000);
    return () => clearInterval(timer.current);
  }, [load]);

  async function openOne(n) {
    if (!n.read) {
      setItems((l) => l.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
      setUnread((u) => Math.max(0, u - 1));
      api.post(`/api/notifications/${n.id}/read`).catch(() => load());
    }
  }
  async function readAll() {
    setItems((l) => l.map((x) => ({ ...x, read: true })));
    setUnread(0);
    api.post('/api/notifications/read-all').catch(() => load());
  }

  return (
    <>
      <Tooltip title="Updates about your child’s ride" arrow>
        <IconButton onClick={(e) => { setAnchor(e.currentTarget); load(); }}>
          <Badge badgeContent={unread} color="error" max={9}>
            <NotificationsNoneRoundedIcon />
          </Badge>
        </IconButton>
      </Tooltip>
      <Popover open={!!anchor} anchorEl={anchor} onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        PaperProps={{ sx: { width: 360, maxWidth: '92vw', borderRadius: 3, mt: 1 } }}>
        <Box sx={{ px: 2, py: 1.4, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Typography fontWeight={800}>Updates</Typography>
          {unread > 0 && (
            <Button size="small" startIcon={<DoneAllRoundedIcon />} onClick={readAll}>Mark all read</Button>
          )}
        </Box>
        <Divider />
        <List dense sx={{ maxHeight: 380, overflow: 'auto', py: 0 }}>
          {items.map((n) => {
            const s = STYLES[n.type] || FALLBACK;
            return (
              <ListItemButton key={n.id} onClick={() => openOne(n)}
                sx={{ alignItems: 'flex-start', bgcolor: n.read ? 'transparent' : 'rgba(37,99,235,.05)' }}>
                <ListItemAvatar sx={{ minWidth: 44 }}>
                  <Avatar sx={{ bgcolor: s.bg, color: s.color, width: 34, height: 34 }}>{s.icon}</Avatar>
                </ListItemAvatar>
                <ListItemText
                  primary={<Typography variant="body2" fontWeight={n.read ? 600 : 800}>{n.title}</Typography>}
                  secondary={
                    <>
                      <Typography variant="caption" color="text.secondary" display="block">{n.body}</Typography>
                      <Typography variant="caption" color="text.disabled">{ago(n.createdAt)}</Typography>
                    </>
                  } />
              </ListItemButton>
            );
          })}
          {items.length === 0 && (
            <Box sx={{ py: 5, textAlign: 'center', color: 'text.secondary' }}>
              <Typography variant="body2">No updates yet.</Typography>
              <Typography variant="caption">You’ll be told when the bus starts and when your child boards.</Typography>
            </Box>
          )}
        </List>
      </Popover>
    </>
  );
}
