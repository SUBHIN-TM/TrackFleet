import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import http from 'http';
import { Server as SocketServer } from 'socket.io';
import { prisma } from './lib/prisma.js';
import { errorHandler } from './lib/http.js';
import authRoutes from './routes/authRoutes.js';
import tenantRoutes from './routes/tenantRoutes.js';
import orgTypeRoutes from './routes/orgTypeRoutes.js';
import vehicleRoutes from './routes/vehicleRoutes.js';
import driverRoutes from './routes/driverRoutes.js';
import passengerRoutes from './routes/passengerRoutes.js';
import guardianRoutes from './routes/guardianRoutes.js';
import routeRoutes from './routes/routeRoutes.js';
import scheduleRoutes from './routes/scheduleRoutes.js';
import tripRoutes from './routes/tripRoutes.js';
import mapRoutes from './routes/mapRoutes.js';
import notificationRoutes from './routes/notificationRoutes.js';
import { verifyMailer } from './lib/mailer.js';

const app = express();
app.use(express.json());

const corsOrigins = (process.env.CORS_ORIGINS || '').split(',').filter(Boolean);
app.use(cors({ origin: corsOrigins.length ? corsOrigins : true }));

// --- Root landing page (friendly status screen when opened in a browser) ---
app.get('/', async (_req, res) => {
  let dbUp = true;
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    dbUp = false;
  }
  res.type('html').send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>TrackFleet API</title>
  <style>
    * { box-sizing: border-box; margin: 0; }
    body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
      background: linear-gradient(135deg,#0f2027,#203a43,#2c5364); color:#fff;
      min-height:100vh; display:grid; place-items:center; padding:24px; }
    .card { background:rgba(255,255,255,.06); border:1px solid rgba(255,255,255,.15);
      backdrop-filter:blur(10px); border-radius:18px; padding:40px 44px; max-width:520px;
      width:100%; box-shadow:0 20px 60px rgba(0,0,0,.35); text-align:center; }
    .bus { font-size:56px; }
    h1 { font-size:26px; margin:10px 0 4px; font-weight:800; letter-spacing:.5px; }
    .ok { display:inline-flex; align-items:center; gap:8px; margin:16px 0 22px;
      background:${dbUp ? 'rgba(46,204,113,.15)' : 'rgba(231,76,60,.15)'};
      color:${dbUp ? '#2ecc71' : '#ff6b6b'}; padding:8px 16px; border-radius:999px;
      font-weight:700; border:1px solid ${dbUp ? 'rgba(46,204,113,.4)' : 'rgba(231,76,60,.4)'}; }
    .dot { width:10px; height:10px; border-radius:50%;
      background:${dbUp ? '#2ecc71' : '#ff6b6b'}; box-shadow:0 0 10px ${dbUp ? '#2ecc71' : '#ff6b6b'};
      animation:pulse 1.4s infinite; }
    @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.35} }
    table { width:100%; border-collapse:collapse; margin-top:8px; font-size:14px; }
    td { padding:8px 10px; border-bottom:1px solid rgba(255,255,255,.1); text-align:left; }
    td:last-child { text-align:right; color:#9fe6c9; font-family:ui-monospace,monospace; }
    .muted { color:rgba(255,255,255,.55); font-size:13px; margin-top:20px; }
    code { background:rgba(255,255,255,.12); padding:2px 7px; border-radius:6px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="bus">🚌</div>
    <h1>TrackFleet Backend</h1>
    <div class="ok"><span class="dot"></span>${dbUp ? 'Running successfully' : 'Running — database unreachable'}</div>
    <table>
      <tr><td>API server</td><td>online :${process.env.PORT || 4004}</td></tr>
      <tr><td>Database</td><td>${dbUp ? 'connected' : 'DOWN'}</td></tr>
      <tr><td>Realtime (Socket.IO)</td><td>ready</td></tr>
      <tr><td>Environment</td><td>${process.env.NODE_ENV || 'development'}</td></tr>
    </table>
    <p class="muted">This is the API engine — it has no UI of its own.<br/>
    Open the console at <code>http://localhost:5173</code>. Health JSON: <code>/health</code></p>
  </div>
</body>
</html>`);
});

// --- Health check ---
app.get('/health', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ ok: true, db: 'up' });
  } catch (err) {
    res.status(500).json({ ok: false, db: 'down', error: err.message });
  }
});

// --- Routes ---
app.use('/api/auth', authRoutes);
app.use('/api/tenants', tenantRoutes);
app.use('/api/org-types', orgTypeRoutes);
app.use('/api/vehicles', vehicleRoutes);
app.use('/api/drivers', driverRoutes);
app.use('/api/passengers', passengerRoutes);
app.use('/api/guardian', guardianRoutes);
app.use('/api/routes', routeRoutes);
app.use('/api/schedules', scheduleRoutes);
app.use('/api/trips', tripRoutes);
app.use('/api/map', mapRoutes);
app.use('/api/notifications', notificationRoutes);

// Central error handler — must be after routes.
app.use(errorHandler);

const server = http.createServer(app);

// --- Realtime gateway (live GPS + boarding events) ---
const io = new SocketServer(server, {
  cors: { origin: corsOrigins.length ? corsOrigins : true },
});

io.on('connection', (socket) => {
  // Clients join a room per trip so parents only get their bus, and admins a
  // room per tenant for the whole-fleet live board.
  socket.on('subscribe:trip', (tripId) => socket.join(`trip:${tripId}`));
  socket.on('unsubscribe:trip', (tripId) => socket.leave(`trip:${tripId}`));
  socket.on('subscribe:tenant', (tenantId) => socket.join(`tenant:${tenantId}`));
  socket.on('unsubscribe:tenant', (tenantId) => socket.leave(`tenant:${tenantId}`));
});

// Expose io to route handlers via app.locals
app.locals.io = io;

const PORT = process.env.PORT || 4004;
server.listen(PORT, async () => {
  console.log(`TrackFleet API listening on http://localhost:${PORT}`);
  // Invites and OTPs are useless if SMTP is misconfigured, and a bad key would
  // otherwise only surface when a real admin tries to sign in.
  const mail = await verifyMailer();
  console.log(mail.ok ? '  mail: SMTP ready' : `  mail: ${mail.reason}`);
});
