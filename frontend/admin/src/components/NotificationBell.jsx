import { useCallback, useEffect, useRef, useState } from 'react';
import {
  IconButton, Badge, Tooltip, Popover, Box, Typography, List, ListItemButton,
  ListItemAvatar, Avatar, ListItemText, Button, Divider, CircularProgress,
} from '@mui/material';
import NotificationsNoneRoundedIcon from '@mui/icons-material/NotificationsNoneRounded';
import CelebrationRoundedIcon from '@mui/icons-material/CelebrationRounded';
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import HowToRegRoundedIcon from '@mui/icons-material/HowToRegRounded';
import ApartmentRoundedIcon from '@mui/icons-material/ApartmentRounded';
import PersonAddAlt1RoundedIcon from '@mui/icons-material/PersonAddAlt1Rounded';
import CampaignRoundedIcon from '@mui/icons-material/CampaignRounded';
import DoneAllRoundedIcon from '@mui/icons-material/DoneAllRounded';
import { api } from '../lib/api.js';

// How each notification type renders in the list: an icon + a colour. Anything
// unmapped falls back to a neutral bell, so new server-side types still show up.
const STYLES = {
  WELCOME: { icon: <CelebrationRoundedIcon fontSize="small" />, color: '#7c3aed', bg: '#efe9fe' },
  ACCOUNT_READY: { icon: <CheckCircleRoundedIcon fontSize="small" />, color: '#1f9d4e', bg: '#e6f6ec' },
  ADMIN_ONBOARDED: { icon: <HowToRegRoundedIcon fontSize="small" />, color: '#1f9d4e', bg: '#e6f6ec' },
  TENANT_CREATED: { icon: <ApartmentRoundedIcon fontSize="small" />, color: '#2f6df6', bg: '#e7effe' },
  ADMIN_INVITED: { icon: <PersonAddAlt1RoundedIcon fontSize="small" />, color: '#2f6df6', bg: '#e7effe' },
  DEFAULT: { icon: <CampaignRoundedIcon fontSize="small" />, color: '#64748b', bg: '#eef1f6' },
};

function timeAgo(iso) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 45) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

const POLL_MS = 45000;

export default function NotificationBell() {
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const [anchor, setAnchor] = useState(null);
  const [loading, setLoading] = useState(false);
  // Avoid overlapping requests when a poll and an open-refresh coincide.
  const inFlight = useRef(false);

  const load = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const { data } = await api.get('/api/notifications');
      setItems(data.notifications);
      setUnread(data.unreadCount);
    } catch {
      // A failed poll is harmless — keep whatever we last had and try again.
    } finally {
      inFlight.current = false;
    }
  }, []);

  // Poll in the background, and refresh whenever the tab regains focus so the
  // badge is current the moment someone comes back.
  useEffect(() => {
    load();
    const id = setInterval(load, POLL_MS);
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    return () => { clearInterval(id); window.removeEventListener('focus', onFocus); };
  }, [load]);

  const open = (e) => { setAnchor(e.currentTarget); setLoading(true); load().finally(() => setLoading(false)); };
  const close = () => setAnchor(null);

  async function markOne(n) {
    if (n.read) return;
    setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
    setUnread((u) => Math.max(0, u - 1));
    try { await api.post(`/api/notifications/${n.id}/read`); } catch { load(); }
  }

  async function markAll() {
    if (!unread) return;
    setItems((prev) => prev.map((x) => ({ ...x, read: true })));
    setUnread(0);
    try { await api.post('/api/notifications/read-all'); } catch { load(); }
  }

  return (
    <>
      <Tooltip title="Notifications">
        <IconButton onClick={open}>
          <Badge color="error" badgeContent={unread} max={9}
            overlap="circular" invisible={unread === 0}>
            <NotificationsNoneRoundedIcon />
          </Badge>
        </IconButton>
      </Tooltip>

      <Popover
        open={!!anchor} anchorEl={anchor} onClose={close}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        PaperProps={{ sx: { width: 380, maxWidth: '92vw', borderRadius: 3, mt: 1, overflow: 'hidden' } }}
      >
        <Box sx={{ px: 2, py: 1.5, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography fontWeight={800}>Notifications</Typography>
            {unread > 0 && (
              <Box sx={{ bgcolor: 'error.main', color: '#fff', fontSize: 12, fontWeight: 700, px: 1, borderRadius: 10 }}>
                {unread} new
              </Box>
            )}
          </Box>
          <Button size="small" startIcon={<DoneAllRoundedIcon />} onClick={markAll} disabled={!unread}>
            Mark all read
          </Button>
        </Box>
        <Divider />

        {loading && !items.length ? (
          <Box sx={{ py: 5, display: 'grid', placeItems: 'center' }}><CircularProgress size={24} /></Box>
        ) : items.length === 0 ? (
          <Box sx={{ py: 6, textAlign: 'center', color: 'text.secondary' }}>
            <NotificationsNoneRoundedIcon sx={{ fontSize: 40, opacity: 0.4 }} />
            <Typography sx={{ mt: 1 }}>You’re all caught up</Typography>
          </Box>
        ) : (
          <List sx={{ p: 0, maxHeight: 440, overflowY: 'auto' }}>
            {items.map((n) => {
              const s = STYLES[n.type] || STYLES.DEFAULT;
              return (
                <ListItemButton
                  key={n.id} onClick={() => markOne(n)} alignItems="flex-start"
                  sx={{ py: 1.4, px: 2, bgcolor: n.read ? 'transparent' : 'rgba(47,109,246,0.05)',
                    '&:hover': { bgcolor: n.read ? 'action.hover' : 'rgba(47,109,246,0.09)' } }}
                >
                  <ListItemAvatar sx={{ minWidth: 46 }}>
                    <Avatar sx={{ bgcolor: s.bg, color: s.color, width: 36, height: 36 }}>{s.icon}</Avatar>
                  </ListItemAvatar>
                  <ListItemText
                    primary={
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Typography fontWeight={n.read ? 600 : 800} fontSize={14.5} sx={{ flex: 1 }}>
                          {n.title}
                        </Typography>
                        {!n.read && <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: 'primary.main', flexShrink: 0 }} />}
                      </Box>
                    }
                    secondary={
                      <>
                        <Typography component="span" variant="body2" color="text.primary" sx={{ display: 'block', lineHeight: 1.4 }}>
                          {n.body}
                        </Typography>
                        <Typography component="span" variant="caption" color="text.secondary">
                          {timeAgo(n.createdAt)}
                        </Typography>
                      </>
                    }
                  />
                </ListItemButton>
              );
            })}
          </List>
        )}
      </Popover>
    </>
  );
}
