import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';

// ============================================================================
// Live position over the realtime gateway.
//
// The bus position and the passenger board have completely different shapes:
// the position is tiny and changes every 3s, the board is large and barely
// changes at all. Polling both on one 5s timer meant refetching the whole live
// payload — trip, every passenger, the route, hundreds of trail points — to
// learn that a bus had moved twenty metres, and STILL showing it up to 8s late.
//
// So they're split. Position arrives pushed, the moment the driver's phone
// reports it. The board keeps polling, just far more slowly.
//
// The socket refuses unauthenticated connections (see backend/src/lib/
// realtime.js), so the token goes up on the handshake.
// ============================================================================

const API = import.meta.env.VITE_API_URL || 'http://localhost:4004';

// One socket for the whole tab. Every live view shares it rather than opening
// its own connection.
let shared = null;

function getSocket() {
  const token = localStorage.getItem('tf_parent_token');
  if (!token) return null;

  // A new login means a new identity — the old socket's authorization was
  // decided at handshake time and cannot be re-negotiated.
  if (shared && shared.auth?.token !== token) {
    shared.close();
    shared = null;
  }
  if (!shared) {
    shared = io(API, { auth: { token }, transports: ['websocket'] });
  }
  return shared;
}

// Subscribe to one trip's live position.
//
// Returns { fix, live }. `fix` mirrors the shape of the REST `lastLocation` —
// including recordedAt — so the caller can substitute it wholesale. Carrying
// the position without its timestamp would leave the staleness indicator
// reading off the last poll, showing "no fresh position" seconds after one
// arrived.
//
// `live` says whether the push channel is actually working. That's why the slow
// poll is a FALLBACK and not merely a supplement: if the socket is blocked or
// refused, the view must still update, just less promptly.
export function useLivePosition(tripId) {
  const [fix, setFix] = useState(null);
  const [live, setLive] = useState(false);
  const currentTrip = useRef(null);

  useEffect(() => {
    setFix(null);
    if (!tripId) { setLive(false); return; }

    const socket = getSocket();
    if (!socket) { setLive(false); return; }
    currentTrip.current = tripId;

    const onLocation = (msg) => {
      // One socket serves every open view, so ignore other trips' traffic.
      if (msg?.tripId !== currentTrip.current) return;
      if (typeof msg.lat !== 'number' || typeof msg.lng !== 'number') return;
      setFix({
        lat: msg.lat, lng: msg.lng,
        speed: msg.speed, heading: msg.heading,
        accuracy: msg.accuracy, held: msg.held,
        // The server sends the DEVICE's timestamp, so freshness is measured
        // from when the fix was taken, not when it happened to arrive.
        recordedAt: msg.at,
      });
    };

    const join = () => socket.emit('subscribe:trip', tripId, (ack) => setLive(Boolean(ack?.ok)));

    socket.on('trip:location', onLocation);
    // Re-join after a reconnect — rooms don't survive a dropped connection.
    socket.on('connect', join);
    if (socket.connected) join(); else socket.once('connect', join);

    return () => {
      socket.emit('unsubscribe:trip', tripId);
      socket.off('trip:location', onLocation);
      socket.off('connect', join);
      setLive(false);
    };
  }, [tripId]);

  return { fix, live };
}

// Called on logout so the next user doesn't inherit this one's rooms.
export function closeLiveSocket() {
  shared?.close();
  shared = null;
}
