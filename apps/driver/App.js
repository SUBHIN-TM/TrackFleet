import { useCallback, useEffect, useRef, useState } from 'react';
import {
  SafeAreaView, View, Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, Alert, RefreshControl,
  Linking,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as Location from 'expo-location';
import polyline from '@mapbox/polyline';
import { apiFetch, tokenStore } from './src/api';
// Wrapped in an error boundary: if the native map misbehaves the trip screen
// must still work (v1.1.0 shipped a map crash that killed the whole app).
import SafeMap from './src/SafeMap';
// Importing this registers the background location task (must be module scope).
import { startTracking, stopTracking, lastFixAt, pushCurrentFix, flushQueue, queuedCount } from './src/locationTask';
import { checkForUpdate, APP_VERSION } from './src/updateCheck';

// ============================================================================
// TrackFleet Driver — sign in, see today's runs, start a trip, tick the
// boarding list, stream GPS, end the trip. The phone's GPS is the bus's GPS.
// ============================================================================

export default function App() {
  const [phase, setPhase] = useState('loading'); // loading | login | home
  const [user, setUser] = useState(null);

  useEffect(() => {
    (async () => {
      const token = await tokenStore.get();
      if (!token) return setPhase('login');
      try {
        const { user } = await apiFetch('/api/auth/me', { auth: true });
        setUser(user);
        setPhase('home');
      } catch {
        await tokenStore.clear();
        setPhase('login');
      }
    })();
  }, []);

  if (phase === 'loading') {
    return (
      <SafeAreaView style={[styles.screen, styles.center]}>
        <ActivityIndicator size="large" color="#3b82f6" />
      </SafeAreaView>
    );
  }
  if (phase === 'login') return <Login onDone={setUser} setPhase={setPhase} />;
  return <Main user={user} onLogout={async () => { await tokenStore.clear(); setUser(null); setPhase('login'); }} />;
}

// ----------------------------------------------------------------------------
// Login — Org ID + Driver ID + password
// ----------------------------------------------------------------------------
function Login({ onDone, setPhase }) {
  const [org, setOrg] = useState('');
  const [driverId, setDriverId] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    setError(''); setBusy(true);
    try {
      const data = await apiFetch('/api/auth/login', {
        method: 'POST',
        body: { tenantSlug: org.trim(), loginId: driverId.trim(), password },
      });
      if (!data.token) throw new Error('Couldn’t sign in — please contact your admin.');
      await tokenStore.set(data.token);
      onDone(data.user);
      setPhase('home');
    } catch (err) {
      setError(err.message || 'Sign in failed');
    } finally { setBusy(false); }
  }

  const ready = org.trim() && driverId.trim() && password;
  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="light" />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.loginBody} keyboardShouldPersistTaps="handled">
          <View style={styles.logoWrap}>
            <View style={styles.logo}><Text style={styles.logoEmoji}>🚌</Text></View>
            <Text style={styles.brand}>TrackFleet</Text>
            <Text style={styles.brandSub}>Driver sign in</Text>
          </View>
          {!!error && <View style={styles.errorBox}><Text style={styles.errorText}>{error}</Text></View>}
          <Field label="Organization ID" value={org} onChangeText={setOrg} placeholder="TF-INTERVAL" autoCapitalize="characters" />
          <Field label="Driver ID" value={driverId} onChangeText={setDriverId} placeholder="DRV-01" autoCapitalize="characters" />
          <Field label="Password" value={password} onChangeText={setPassword} placeholder="Your password"
            secureTextEntry={!showPw}
            right={
              <TouchableOpacity onPress={() => setShowPw((s) => !s)} style={styles.eyeBtn}>
                <Text style={styles.eyeText}>{showPw ? '🙈' : '👁️'}</Text>
              </TouchableOpacity>
            } />
          <TouchableOpacity style={[styles.primaryBtn, (!ready || busy) && styles.btnDisabled]} onPress={submit} disabled={!ready || busy}>
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Sign in</Text>}
          </TouchableOpacity>
          <Text style={styles.hint}>Your admin gives you these three details. Lost them? Ask your admin to re-share.</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ----------------------------------------------------------------------------
// Main — switches between today's runs and the active trip
// ----------------------------------------------------------------------------
function Main({ user, onLogout }) {
  const [activeTripId, setActiveTripId] = useState(null);
  if (activeTripId) {
    return <TripScreen tripId={activeTripId} onExit={() => setActiveTripId(null)} />;
  }
  return <Home user={user} onLogout={onLogout} onOpenTrip={setActiveTripId} />;
}

// ----------------------------------------------------------------------------
// Home — today's schedules with start/resume
// ----------------------------------------------------------------------------
function Home({ user, onLogout, onOpenTrip }) {
  const [schedules, setSchedules] = useState(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [startingId, setStartingId] = useState(null);
  const [update, setUpdate] = useState({ available: false });
  const [checking, setChecking] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await apiFetch('/api/trips/driver/today', { auth: true });
      setSchedules(data.schedules);
      setError('');
    } catch (err) { setError(err.message); if (!schedules) setSchedules([]); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { load(); }, [load]);

  // Nothing updates a sideloaded APK on its own — tell the driver instead.
  useEffect(() => { checkForUpdate().then(setUpdate); }, []);

  // Manual check, so a driver can confirm they're current instead of wondering.
  async function checkNow() {
    setChecking(true);
    const u = await checkForUpdate();
    setUpdate(u);
    setChecking(false);
    if (!u.available) {
      Alert.alert('You’re up to date', `TrackFleet Driver v${APP_VERSION} is the latest version.`);
    }
  }

  async function startTrip(s) {
    setStartingId(s.id);
    try {
      const data = await apiFetch('/api/trips/start', { method: 'POST', auth: true, body: { scheduleId: s.id } });
      onOpenTrip(data.trip.id);
    } catch (err) {
      Alert.alert('Couldn’t start', err.message);
    } finally { setStartingId(null); }
  }

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="light" />
      <View style={styles.homeHeader}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.homeHi}>Hi{user?.name ? `, ${user.name}` : ''} 👋</Text>
          <Text style={styles.homeOrg} numberOfLines={1}>
            {user?.tenantName || 'Your organization'} · {user?.loginId}
          </Text>
        </View>
        {/* Kept in the header: a driver must never hunt for these. */}
        <TouchableOpacity onPress={checkNow} disabled={checking} style={styles.headBtn}>
          {checking
            ? <ActivityIndicator size="small" color="#60a5fa" />
            : <Text style={styles.linkText}>{update.available ? 'Update!' : 'Update'}</Text>}
        </TouchableOpacity>
        <TouchableOpacity onPress={onLogout} style={styles.headBtn}>
          <Text style={styles.linkText}>Log out</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 20, paddingTop: 4 }}
        refreshControl={<RefreshControl refreshing={refreshing} tintColor="#94a3b8"
          onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}>
        {update.available && (
          <View style={styles.updateBox}>
            <Text style={styles.updateTitle}>Update available · v{update.version}</Text>
            {!!update.notes && <Text style={styles.updateNotes}>{update.notes}</Text>}
            <Text style={styles.updateNotes}>You’re on v{APP_VERSION}. Downloading installs over this app — your login stays.</Text>
            <TouchableOpacity style={styles.updateBtn} onPress={() => Linking.openURL(update.apkUrl)}>
              <Text style={styles.primaryBtnText}>Download update</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Always visible: which build this is, and a way to check on demand. */}
        {!update.available && (
          <TouchableOpacity style={styles.versionCard} onPress={checkNow} disabled={checking}>
            <View style={{ flex: 1 }}>
              <Text style={styles.versionCardTitle}>App version {APP_VERSION}</Text>
              <Text style={styles.versionCardSub}>
                {checking ? 'Checking…' : 'Tap to check for updates'}
              </Text>
            </View>
            {checking
              ? <ActivityIndicator size="small" color="#60a5fa" />
              : <Text style={styles.versionCardIcon}>{'>'}</Text>}
          </TouchableOpacity>
        )}

        <Text style={styles.sectionTitle}>TODAY’S RUNS</Text>
        {!!error && <View style={styles.errorBox}><Text style={styles.errorText}>{error}</Text></View>}
        {schedules === null && <ActivityIndicator color="#3b82f6" style={{ marginTop: 30 }} />}
        {schedules?.length === 0 && !error && (
          <View style={styles.cardBox}>
            <Text style={styles.cardBody}>No runs assigned for today. Pull down to refresh.</Text>
          </View>
        )}
        {schedules?.map((s) => {
          const t = s.trip;
          const live = t && ['STARTED', 'IN_PROGRESS'].includes(t.status);
          const done = t && t.status === 'COMPLETED';
          return (
            <View key={s.id} style={[styles.cardBox, live && styles.cardLive]}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={styles.cardTitle}>{s.name}</Text>
                {live && <Text style={styles.liveBadge}>● LIVE</Text>}
                {done && <Text style={styles.doneBadge}>Completed</Text>}
              </View>
              <Text style={styles.cardBody}>{s.route?.name}</Text>
              <Text style={styles.cardMeta}>
                {s.direction === 'DROP' ? 'Drop' : s.direction === 'BOTH' ? 'Pickup & drop' : 'Pickup'} · starts {s.startTime}
                {s.vehicle ? ` · ${s.vehicle.fleetNo ? s.vehicle.fleetNo + ' / ' : ''}${s.vehicle.regNumber}` : ''}
              </Text>
              {t?.counts && (
                <Text style={styles.cardMeta}>
                  {t.counts.onboard} onboard · {t.counts.dropped} dropped · {t.counts.noShow} no-show · {t.counts.expected} expected
                </Text>
              )}
              {live ? (
                <TouchableOpacity style={styles.primaryBtn} onPress={() => onOpenTrip(t.id)}>
                  <Text style={styles.primaryBtnText}>Continue trip</Text>
                </TouchableOpacity>
              ) : done ? (
                <View style={[styles.primaryBtn, styles.btnGhost]}>
                  <Text style={styles.ghostBtnText}>Run finished for today ✓</Text>
                </View>
              ) : (
                <TouchableOpacity style={[styles.primaryBtn, styles.btnStart, startingId === s.id && styles.btnDisabled]}
                  disabled={startingId === s.id}
                  onPress={() => Alert.alert('Start trip?', `${s.name} — ${s.route?.name}. Parents will be notified and live tracking begins.`,
                    [{ text: 'Cancel', style: 'cancel' }, { text: 'Start', onPress: () => startTrip(s) }])}>
                  {startingId === s.id
                    ? <ActivityIndicator color="#fff" />
                    : <Text style={styles.primaryBtnText}>Start trip</Text>}
                </TouchableOpacity>
              )}
            </View>
          );
        })}

        {/* Current version + a way to check on demand. */}
        <TouchableOpacity style={styles.versionRow} onPress={checkNow} disabled={checking}>
          {checking ? (
            <ActivityIndicator size="small" color="#60a5fa" />
          ) : (
            <Text style={styles.versionText}>
              TrackFleet Driver v{APP_VERSION} · {update.available ? 'Update available' : 'Tap to check for updates'}
            </Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

// ----------------------------------------------------------------------------
// Trip screen — GPS streaming + boarding checklist + end trip
// ----------------------------------------------------------------------------
const P_LABEL = { EXPECTED: 'Expected', ONBOARD: 'ONBOARD', DROPPED: 'Dropped', NO_SHOW: 'No-show', ABSENT: 'Absent' };
const P_COLOR = { EXPECTED: '#94a3b8', ONBOARD: '#22c55e', DROPPED: '#38bdf8', NO_SHOW: '#ef4444', ABSENT: '#f59e0b' };

function TripScreen({ tripId, onExit }) {
  const [live, setLive] = useState(null);
  const [gps, setGps] = useState('starting'); // starting | on | foreground-only | denied | error
  const [fixAge, setFixAge] = useState(null); // seconds since the last sent fix
  const [busyId, setBusyId] = useState(null);
  const [ending, setEnding] = useState(false);

  const [me, setMe] = useState(null);          // driver's own position, for the map
  const [routeLine, setRouteLine] = useState([]);
  // Page scrolling is frozen while a finger is on the map, or the ScrollView
  // and the map fight over the same gesture and panning judders.
  const [pageScroll, setPageScroll] = useState(true);

  const load = useCallback(async () => {
    try {
      const data = await apiFetch(`/api/trips/${tripId}/live`, { auth: true });
      setLive(data);
    } catch { /* keep last */ }
  }, [tripId]);
  // Poll so the checklist and counts stay right if the admin changes something.
  useEffect(() => {
    load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [load]);

  // While the trip screen is open, WE are the source of truth: actively pull a
  // fresh fix and send that exact fix on. Reading Android's cached location
  // instead let the driver see one place while the admin saw a frozen fix from
  // minutes earlier. The background task still covers a locked screen.
  const [offline, setOffline] = useState(0); // fixes waiting for a connection

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const { pos, offline: isOffline, queued } = await pushCurrentFix(tripId);
        if (!alive) return;
        setMe(pos);
        // Only warn when THIS send failed on the network. A leftover queue is
        // not "no connection" — showing the banner while fixes were uploading
        // fine told the driver they were untracked when they were.
        setOffline(isOffline ? queued || 1 : 0);
      } catch {
        // No fix available right now — leave the map where it is.
      }
    };
    tick();
    const t = setInterval(tick, 5000);
    return () => { alive = false; clearInterval(t); };
  }, [tripId]);

  // Manual re-sync. Reports what ACTUALLY happened: claiming "sent" while
  // offline is how a driver ends up believing they're tracked when they're not.
  const [syncing, setSyncing] = useState(false);
  async function syncNow() {
    setSyncing(true);
    try {
      const { pos, sent, offline: isOffline, queued } = await pushCurrentFix(tripId);
      setMe(pos);
      setOffline(isOffline ? queued || 1 : 0);
      const at = await lastFixAt();
      setFixAge(at ? Math.round((Date.now() - at) / 1000) : null);
      const where = `${pos[1].toFixed(5)}, ${pos[0].toFixed(5)}`;
      if (sent) {
        Alert.alert('Position shared ✅', `The organization and parents can now see you here:\n${where}`);
      } else {
        Alert.alert(
          'No connection — not shared yet',
          `Your position (${where}) is saved on the phone and will be sent automatically the moment you're back online.` +
          (queued > 1 ? `\n\n${queued} positions are waiting.` : '')
        );
      }
    } catch {
      Alert.alert('Couldn’t get a fix', 'Make sure location is on and you have a clear view of the sky, then try again.');
    } finally { setSyncing(false); }
  }

  // Road-snapped path through the stops — fetched once; stops don't move.
  useEffect(() => {
    const stops = live?.route?.stops || [];
    if (stops.length < 2 || routeLine.length) return;
    apiFetch('/api/map/route', {
      method: 'POST', auth: true,
      body: { waypoints: stops.map((s) => ({ lat: s.lat, lng: s.lng })) },
    })
      .then((r) => setRouteLine(polyline.decode(r.geometry).map(([lat, lng]) => [lng, lat])))
      .catch(() => { /* routing down — the map still shows stops + position */ });
  }, [live?.route?.stops?.length]);

  // GPS runs as a background task + foreground service, so it KEEPS streaming
  // when the phone locks or the driver switches apps — a foreground-only
  // watcher froze the bus on everyone's map the moment the screen went off.
  useEffect(() => {
    let alive = true;
    (async () => {
      const state = await startTracking(tripId);
      if (alive) setGps(state);
    })();
    // Show how fresh the last SENT fix is, so a stalled feed is obvious, and
    // keep retrying the backlog — signal comes back without anyone noticing.
    const t = setInterval(async () => {
      const at = await lastFixAt();
      if (alive) setFixAge(at ? Math.round((Date.now() - at) / 1000) : null);
      // Drain any backlog quietly; the banner is driven by live send results,
      // not by the mere presence of a queue.
      if ((await queuedCount()) > 0) await flushQueue();
    }, 4000);
    return () => { alive = false; clearInterval(t); };
  }, [tripId]);

  async function mark(passengerId, status) {
    setBusyId(passengerId);
    try {
      await apiFetch(`/api/trips/${tripId}/board`, { method: 'POST', auth: true, body: { passengerId, status } });
      // Optimistic local update — instant feedback on a moving bus.
      setLive((l) => l && {
        ...l,
        passengers: l.passengers.map((p) => (p.id === passengerId ? { ...p, status } : p)),
      });
    } catch (err) {
      Alert.alert('Couldn’t update', err.message);
    } finally { setBusyId(null); }
  }

  function confirmEnd() {
    const onboard = live?.passengers?.filter((p) => p.status === 'ONBOARD') || [];
    Alert.alert(
      'End trip?',
      onboard.length
        ? `⚠️ ${onboard.length} passenger(s) still marked ONBOARD:\n${onboard.map((p) => '· ' + p.name).join('\n')}\n\nEnd anyway?`
        : 'This finishes the run and stops live tracking.',
      [{ text: 'Cancel', style: 'cancel' }, { text: 'End trip', style: 'destructive', onPress: endTrip }]
    );
  }
  async function endTrip() {
    setEnding(true);
    try {
      await apiFetch(`/api/trips/${tripId}/end`, { method: 'POST', auth: true });
      await stopTracking(); // release GPS + drop the foreground notification
      onExit();
    } catch (err) { Alert.alert('Couldn’t end trip', err.message); }
    finally { setEnding(false); }
  }

  const counts = live?.trip?.counts;
  // "Next" = the earliest stop that still has someone waiting — what the driver
  // is actually driving towards.
  const nextStop = live?.route?.stops?.find((s) =>
    live.passengers?.some((p) => p.stopSequence === s.sequence && p.status === 'EXPECTED')
  ) || null;
  const waitingAtNext = nextStop
    ? live.passengers.filter((p) => p.stopSequence === nextStop.sequence && p.status === 'EXPECTED').length
    : 0;

  // Only claim "live" once a fix has actually reached the server. Saying
  // "GPS live" merely because tracking started was a lie: the driver saw green
  // while the admin saw no bus at all.
  const gpsLabel = {
    starting: '⏳ GPS starting…',
    on: fixAge == null ? '⏳ Waiting for first GPS fix…'
      : fixAge < 30 ? `🟢 GPS live · sent ${fixAge}s ago`
      : fixAge < 120 ? `🟠 last fix ${fixAge}s ago — weak signal`
      : `🔴 no fix for ${Math.round(fixAge / 60)}m — check location is on`,
    'foreground-only': '🟠 Background location OFF — tracking stops when the screen locks. Allow “Always” in settings.',
    denied: '🔴 GPS permission denied — parents cannot see the bus',
    error: '🔴 GPS unavailable',
  }[gps];

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="light" />
      <View style={styles.tripHeader}>
        {/* Plain text only: a "←" here rendered as "IJ" on a real phone, because
            the glyph is missing from that device's font. ASCII always renders. */}
        <TouchableOpacity onPress={onExit} style={styles.backBtn}>
          <Text style={styles.linkText}>{'<  Back to runs'}</Text>
        </TouchableOpacity>
        <Text style={styles.tripTitle}>{live?.trip?.scheduleName || 'Trip'}</Text>
        <Text style={[styles.gpsBadge, gps === 'on' ? styles.gpsOn : styles.gpsOff]}>{gpsLabel}</Text>
      </View>

      {/* Offline is not a footnote: while this shows, nobody can see the bus. */}
      {offline > 0 && (
        <View style={styles.offlineBox}>
          <Text style={styles.offlineTitle}>⚠️ No connection — you are not being tracked</Text>
          <Text style={styles.offlineSub}>
            {offline} position{offline === 1 ? '' : 's'} saved on this phone. They’ll send automatically
            when the signal returns — keep the app open.
          </Text>
        </View>
      )}

      {/* Proof the GPS is alive: the driver's own coordinates, ticking — plus a
          way to force a fresh position if the admin says it looks stuck. */}
      <View style={styles.gpsRow}>
        <Text style={styles.gpsCoords}>
          {me ? `📍 ${me[1].toFixed(5)}, ${me[0].toFixed(5)}` : '📍 waiting for GPS…'}
          {fixAge != null ? ` · sent ${fixAge}s ago` : ''}
        </Text>
        <TouchableOpacity style={styles.syncBtn} onPress={syncNow} disabled={syncing}>
          {syncing
            ? <ActivityIndicator size="small" color="#60a5fa" />
            : <Text style={styles.syncText}>Sync position</Text>}
        </TouchableOpacity>
      </View>

      {counts && (
        <View style={styles.countRow}>
          <Count n={counts.onboard} label="Onboard" color="#22c55e" />
          <Count n={counts.dropped} label="Dropped" color="#38bdf8" />
          <Count n={counts.noShow} label="No-show" color="#ef4444" />
          <Count n={counts.expected} label="Expected" color="#94a3b8" />
        </View>
      )}

      <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 8, paddingBottom: 110 }}
        scrollEnabled={pageScroll}>
        {/* Where I am, the road ahead, and proof the GPS is alive. */}
        {live?.route?.stops?.length > 0 && (
          <SafeMap stops={live.route.stops} me={me} routeLine={routeLine} nextStop={nextStop} height={280}
            onGrab={() => setPageScroll(false)} onRelease={() => setPageScroll(true)} />
        )}

        {nextStop && (
          <View style={styles.nextStopBox}>
            <Text style={styles.nextStopLabel}>NEXT STOP</Text>
            <Text style={styles.nextStopName}>{nextStop.sequence}. {nextStop.name}</Text>
            <Text style={styles.nextStopSub}>
              {waitingAtNext} passenger{waitingAtNext === 1 ? '' : 's'} waiting here
            </Text>
          </View>
        )}

        <Text style={styles.sectionTitle}>PASSENGERS{live?.route?.name ? ` — ${live.route.name}` : ''}</Text>
        {!live && <ActivityIndicator color="#3b82f6" style={{ marginTop: 30 }} />}
        {live?.passengers?.map((p) => (
          <View key={p.id} style={styles.paxRow}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.paxName}>{p.name}</Text>
              <Text style={styles.paxMeta}>
                {p.stopName ? `📍 ${p.stopName}` : 'No stop set'}{p.category ? ` · ${p.category}` : ''}
              </Text>
              <Text style={[styles.paxStatus, { color: P_COLOR[p.status] }]}>{P_LABEL[p.status]}</Text>
            </View>
            <View style={styles.paxActions}>
              {busyId === p.id ? <ActivityIndicator color="#3b82f6" /> : (
                <>
                  {p.status === 'EXPECTED' && (
                    <>
                      <TouchableOpacity style={[styles.chipBtn, styles.chipGreen]} onPress={() => mark(p.id, 'ONBOARD')}>
                        <Text style={styles.chipText}>Board</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={[styles.chipBtn, styles.chipRed]} onPress={() => mark(p.id, 'NO_SHOW')}>
                        <Text style={styles.chipText}>No-show</Text>
                      </TouchableOpacity>
                    </>
                  )}
                  {p.status === 'ONBOARD' && (
                    <>
                      <TouchableOpacity style={[styles.chipBtn, styles.chipBlue]} onPress={() => mark(p.id, 'DROPPED')}>
                        <Text style={styles.chipText}>Drop</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={[styles.chipBtn, styles.chipGray]} onPress={() => mark(p.id, 'EXPECTED')}>
                        <Text style={styles.chipText}>Undo</Text>
                      </TouchableOpacity>
                    </>
                  )}
                  {(p.status === 'NO_SHOW' || p.status === 'DROPPED') && (
                    <TouchableOpacity style={[styles.chipBtn, styles.chipGray]} onPress={() => mark(p.id, 'EXPECTED')}>
                      <Text style={styles.chipText}>Undo</Text>
                    </TouchableOpacity>
                  )}
                </>
              )}
            </View>
          </View>
        ))}
        {live?.passengers?.length === 0 && (
          <View style={styles.cardBox}><Text style={styles.cardBody}>No passengers are mapped to this route yet.</Text></View>
        )}
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity style={[styles.endBtn, ending && styles.btnDisabled]} onPress={confirmEnd} disabled={ending}>
          {ending
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.primaryBtnText}>End trip</Text>}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

function Count({ n, label, color }) {
  return (
    <View style={styles.countBox}>
      <Text style={[styles.countN, { color }]}>{n}</Text>
      <Text style={styles.countLabel}>{label}</Text>
    </View>
  );
}

function Field({ label, right, ...props }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.inputRow}>
        <TextInput style={[styles.input, { flex: 1, backgroundColor: 'transparent' }]}
          placeholderTextColor="#9aa0b4" autoCorrect={false} {...props} />
        {right}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0f172a' },
  center: { alignItems: 'center', justifyContent: 'center' },
  loginBody: { padding: 24, paddingTop: 48, flexGrow: 1 },
  logoWrap: { alignItems: 'center', marginBottom: 28 },
  logo: { width: 72, height: 72, borderRadius: 20, backgroundColor: '#1d4ed8', alignItems: 'center', justifyContent: 'center' },
  logoEmoji: { fontSize: 36 },
  brand: { color: '#fff', fontSize: 26, fontWeight: '800', marginTop: 12 },
  brandSub: { color: '#94a3b8', fontSize: 15, marginTop: 2 },
  field: { marginBottom: 16 },
  fieldLabel: { color: '#cbd5e1', fontSize: 13, fontWeight: '600', marginBottom: 6 },
  inputRow: { backgroundColor: '#1e293b', borderRadius: 12, flexDirection: 'row', alignItems: 'center' },
  input: { backgroundColor: '#1e293b', color: '#fff', borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14, fontSize: 16 },
  eyeBtn: { paddingHorizontal: 14, paddingVertical: 12 },
  eyeText: { fontSize: 18 },
  primaryBtn: { backgroundColor: '#2563eb', borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 12 },
  btnStart: { backgroundColor: '#16a34a' },
  btnGhost: { backgroundColor: 'transparent', borderWidth: 1, borderColor: '#334155' },
  ghostBtnText: { color: '#94a3b8', fontSize: 14, fontWeight: '600' },
  primaryBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  btnDisabled: { opacity: 0.5 },
  hint: { color: '#64748b', fontSize: 13, textAlign: 'center', marginTop: 20, lineHeight: 18 },
  errorBox: { backgroundColor: '#7f1d1d', borderRadius: 10, padding: 12, marginBottom: 16 },
  errorText: { color: '#fecaca', fontSize: 14 },
  linkText: { color: '#60a5fa', fontSize: 14, fontWeight: '700' },
  homeHeader: { padding: 20, paddingTop: 46, flexDirection: 'row', alignItems: 'center' },
  homeHi: { color: '#fff', fontSize: 24, fontWeight: '800' },
  homeOrg: { color: '#94a3b8', fontSize: 13, marginTop: 2 },
  updateBox: { backgroundColor: '#1e3a8a', borderRadius: 14, padding: 14, marginBottom: 16, borderWidth: 1, borderColor: '#3b82f6' },
  updateTitle: { color: '#fff', fontWeight: '800', fontSize: 15 },
  updateNotes: { color: '#bfdbfe', fontSize: 12.5, marginTop: 4, lineHeight: 17 },
  updateBtn: { backgroundColor: '#2563eb', borderRadius: 10, paddingVertical: 11, alignItems: 'center', marginTop: 10 },
  versionRow: { paddingVertical: 16, alignItems: 'center' },
  versionText: { color: '#64748b', fontSize: 12.5, fontWeight: '600' },
  headBtn: { paddingHorizontal: 8, paddingVertical: 6 },
  headBtnRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  btnRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 2, alignSelf: 'flex-start' },
  versionCard: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#1e293b',
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 16,
    borderWidth: 1, borderColor: '#334155',
  },
  versionCardTitle: { color: '#e2e8f0', fontSize: 14, fontWeight: '700' },
  versionCardSub: { color: '#94a3b8', fontSize: 12, marginTop: 2 },
  versionCardIcon: { color: '#60a5fa', fontSize: 18, fontWeight: '800' },
  sectionTitle: { color: '#64748b', fontSize: 12, fontWeight: '800', letterSpacing: 1, marginBottom: 10 },
  cardBox: { backgroundColor: '#1e293b', borderRadius: 16, padding: 16, marginBottom: 14 },
  cardLive: { borderWidth: 1.5, borderColor: '#22c55e' },
  cardTitle: { color: '#fff', fontSize: 17, fontWeight: '800' },
  cardBody: { color: '#cbd5e1', fontSize: 14, marginTop: 3 },
  cardMeta: { color: '#94a3b8', fontSize: 12.5, marginTop: 4 },
  liveBadge: { color: '#22c55e', fontWeight: '800', fontSize: 12 },
  doneBadge: { color: '#38bdf8', fontWeight: '700', fontSize: 12 },
  tripHeader: { padding: 20, paddingTop: 46, gap: 6 },
  tripTitle: { color: '#fff', fontSize: 22, fontWeight: '800' },
  gpsBadge: { fontSize: 12.5, fontWeight: '700' },
  offlineBox: { backgroundColor: '#7c2d12', borderColor: '#f97316', borderWidth: 1, borderRadius: 12, padding: 12, marginHorizontal: 20, marginBottom: 8 },
  offlineTitle: { color: '#fed7aa', fontWeight: '800', fontSize: 13.5 },
  offlineSub: { color: '#fdba74', fontSize: 12, marginTop: 3, lineHeight: 16 },
  gpsRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingBottom: 8, gap: 10 },
  gpsCoords: { color: '#64748b', fontSize: 11.5, flex: 1, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  syncBtn: { backgroundColor: '#1e293b', borderWidth: 1, borderColor: '#3b82f6', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  syncText: { color: '#60a5fa', fontSize: 12, fontWeight: '800' },
  gpsOn: { color: '#22c55e' },
  gpsOff: { color: '#f59e0b' },
  nextStopBox: { backgroundColor: '#14532d', borderRadius: 12, padding: 14, marginBottom: 16, borderWidth: 1, borderColor: '#16a34a' },
  nextStopLabel: { color: '#86efac', fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  nextStopName: { color: '#fff', fontSize: 18, fontWeight: '800', marginTop: 2 },
  nextStopSub: { color: '#bbf7d0', fontSize: 12.5, marginTop: 2 },
  countRow: { flexDirection: 'row', paddingHorizontal: 20, gap: 10, marginBottom: 6 },
  countBox: { flex: 1, backgroundColor: '#1e293b', borderRadius: 12, paddingVertical: 10, alignItems: 'center' },
  countN: { fontSize: 20, fontWeight: '800' },
  countLabel: { color: '#94a3b8', fontSize: 11, marginTop: 2 },
  paxRow: { backgroundColor: '#1e293b', borderRadius: 14, padding: 14, marginBottom: 10, flexDirection: 'row', alignItems: 'center' },
  paxName: { color: '#fff', fontSize: 16, fontWeight: '700' },
  paxMeta: { color: '#94a3b8', fontSize: 12.5, marginTop: 2 },
  paxStatus: { fontSize: 12, fontWeight: '800', marginTop: 4 },
  paxActions: { flexDirection: 'row', gap: 8, marginLeft: 10 },
  chipBtn: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10 },
  chipGreen: { backgroundColor: '#16a34a' },
  chipRed: { backgroundColor: '#b91c1c' },
  chipBlue: { backgroundColor: '#0284c7' },
  chipGray: { backgroundColor: '#334155' },
  chipText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: 16, paddingBottom: 26, backgroundColor: '#0f172acc' },
  endBtn: { backgroundColor: '#dc2626', borderRadius: 12, paddingVertical: 15, alignItems: 'center' },
});
