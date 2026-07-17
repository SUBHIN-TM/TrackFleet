import { Box, Typography, Stack, Chip, LinearProgress } from '@mui/material';
import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import DirectionsBusRoundedIcon from '@mui/icons-material/DirectionsBusRounded';

// The four beats of a ride, as a parent experiences it. NO_SHOW/ABSENT are
// dead-ends, so they get their own copy rather than a broken-looking timeline.
const STEPS = ['Bus started', 'On the way', 'On board', 'Dropped off'];
const stepOf = (t) => {
  if (!t) return -1;
  if (t.myStatus === 'DROPPED') return 3;
  if (t.myStatus === 'ONBOARD') return 2;
  return t.live ? 1 : 0;
};

// The headline a parent opens the app for: how long until it matters to THEM.
export function EtaHero({ trip, childName }) {
  const eta = trip?.eta;
  const boarding = trip?.myStatus === 'EXPECTED';
  const onboard = trip?.myStatus === 'ONBOARD';

  if (trip?.myStatus === 'NO_SHOW') {
    return (
      <Hero bg="linear-gradient(135deg,#ef4444,#b91c1c)"
        title={`${childName} didn’t board`}
        sub="The driver marked them as not boarded. Contact your organization if that’s unexpected." />
    );
  }
  if (trip?.myStatus === 'ABSENT') {
    return (
      <Hero bg="linear-gradient(135deg,#f59e0b,#d97706)"
        title={`${childName} is marked absent today`}
        sub="You told the school they’re not travelling. Tap “Travelling again” to undo." />
    );
  }
  if (trip?.myStatus === 'DROPPED') {
    return (
      <Hero bg="linear-gradient(135deg,#0ea5e9,#0369a1)"
        title={`${childName} has been dropped off 🏁`}
        sub={trip.droppedAt ? `Left the bus at ${new Date(trip.droppedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.` : 'Journey complete.'} />
    );
  }

  // Live, with a road-network ETA — the Swiggy moment.
  if (eta?.minutes != null) {
    const km = eta.distanceMeters >= 1000 ? `${(eta.distanceMeters / 1000).toFixed(1)} km` : `${eta.distanceMeters} m`;
    return (
      <Hero bg="linear-gradient(135deg,#16a34a,#15803d)"
        title={`${eta.minutes} min away`}
        sub={boarding
          ? `Bus reaching ${eta.stopName} · ${km} away`
          : `${childName} arrives at ${eta.stopName} · ${km} to go`}
        badge={onboard ? 'On board' : 'Arriving'} />
    );
  }
  if (trip?.live) {
    return (
      <Hero bg="linear-gradient(135deg,#2563eb,#1d4ed8)"
        title={onboard ? `${childName} is on the bus` : 'Bus is on the way'}
        sub={onboard ? 'Following the bus to the destination.' : 'Live tracking is on — watch it move below.'}
        badge="Live" />
    );
  }
  return null;
}

function Hero({ bg, title, sub, badge }) {
  return (
    <Box sx={{ background: bg, color: '#fff', borderRadius: 3.5, p: 2.2, position: 'relative', overflow: 'hidden' }}>
      {/* soft light bloom, keeps the block from looking flat */}
      <Box sx={{ position: 'absolute', right: -30, top: -30, width: 140, height: 140, borderRadius: '50%', bgcolor: 'rgba(255,255,255,.13)' }} />
      <Stack direction="row" alignItems="center" spacing={1} mb={0.4}>
        <DirectionsBusRoundedIcon sx={{ fontSize: 20, opacity: 0.95 }} />
        {badge && (
          <Chip size="small" label={badge}
            sx={{ bgcolor: 'rgba(255,255,255,.25)', color: '#fff', fontWeight: 800, height: 20,
              animation: badge === 'Live' ? 'pulse 1.6s infinite' : 'none',
              '@keyframes pulse': { '0%,100%': { opacity: 1 }, '50%': { opacity: 0.5 } } }} />
        )}
      </Stack>
      <Typography variant="h4" fontWeight={800} sx={{ letterSpacing: '-0.02em', position: 'relative' }}>{title}</Typography>
      <Typography variant="body2" sx={{ opacity: 0.92, mt: 0.3, position: 'relative' }}>{sub}</Typography>
    </Box>
  );
}

// Where the ride has got to — reassuring even when nothing is moving.
export function JourneyTimeline({ trip }) {
  const at = stepOf(trip);
  if (at < 0 || ['NO_SHOW', 'ABSENT'].includes(trip?.myStatus)) return null;
  const pct = (at / (STEPS.length - 1)) * 100;

  return (
    <Box>
      <LinearProgress variant="determinate" value={pct}
        sx={{ height: 6, borderRadius: 3, mb: 1, bgcolor: '#e8eefb' }} />
      <Stack direction="row" justifyContent="space-between">
        {STEPS.map((label, i) => {
          const done = i <= at;
          return (
            <Stack key={label} alignItems="center" spacing={0.4} sx={{ flex: 1 }}>
              <Box sx={{
                width: 20, height: 20, borderRadius: '50%', display: 'grid', placeItems: 'center',
                bgcolor: done ? 'primary.main' : '#e2e8f0', color: '#fff',
                boxShadow: i === at ? '0 0 0 4px rgba(37,99,235,.18)' : 'none',
              }}>
                {done && <CheckRoundedIcon sx={{ fontSize: 13 }} />}
              </Box>
              <Typography variant="caption" sx={{ fontSize: 10.5, fontWeight: done ? 800 : 500,
                color: done ? 'text.primary' : 'text.secondary', textAlign: 'center', lineHeight: 1.2 }}>
                {label}
              </Typography>
            </Stack>
          );
        })}
      </Stack>
    </Box>
  );
}
