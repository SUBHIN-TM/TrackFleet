import { useCallback, useEffect, useRef, useState } from 'react';
import {
  SafeAreaView, View, Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, Alert, RefreshControl,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as Location from 'expo-location';
import { apiFetch, tokenStore } from './src/api';

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
          <Field label="Password" value={password} onChangeText={setPassword} placeholder="Your password" secureTextEntry />
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

  const load = useCallback(async () => {
    try {
      const data = await apiFetch('/api/trips/driver/today', { auth: true });
      setSchedules(data.schedules);
      setError('');
    } catch (err) { setError(err.message); if (!schedules) setSchedules([]); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { load(); }, [load]);

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
        <View style={{ flex: 1 }}>
          <Text style={styles.homeHi}>Hi{user?.name ? `, ${user.name}` : ''} 👋</Text>
          <Text style={styles.homeOrg}>{user?.tenantName || 'Your organization'} · {user?.loginId}</Text>
        </View>
        <TouchableOpacity onPress={onLogout}><Text style={styles.linkText}>Log out</Text></TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 20, paddingTop: 4 }}
        refreshControl={<RefreshControl refreshing={refreshing} tintColor="#94a3b8"
          onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}>
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
                  <Text style={styles.primaryBtnText}>Continue trip →</Text>
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
                  {startingId === s.id ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>▶ Start trip</Text>}
                </TouchableOpacity>
              )}
            </View>
          );
        })}
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
  const [gps, setGps] = useState('starting'); // starting | on | denied | error
  const [busyId, setBusyId] = useState(null);
  const [ending, setEnding] = useState(false);
  const watcher = useRef(null);

  const load = useCallback(async () => {
    try {
      const data = await apiFetch(`/api/trips/${tripId}/live`, { auth: true });
      setLive(data);
    } catch { /* keep last */ }
  }, [tripId]);
  useEffect(() => { load(); }, [load]);

  // GPS: the phone becomes the bus tracker while this screen is open.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') { setGps('denied'); return; }
      try {
        watcher.current = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.High, timeInterval: 6000, distanceInterval: 20 },
          (pos) => {
            if (cancelled) return;
            setGps('on');
            apiFetch(`/api/trips/${tripId}/location`, {
              method: 'POST', auth: true,
              body: {
                lat: pos.coords.latitude,
                lng: pos.coords.longitude,
                speed: pos.coords.speed != null && pos.coords.speed >= 0 ? pos.coords.speed * 3.6 : undefined, // m/s -> km/h
                heading: pos.coords.heading ?? undefined,
                recordedAt: new Date(pos.timestamp).toISOString(),
              },
            }).catch(() => {});
          }
        );
      } catch { setGps('error'); }
    })();
    return () => { cancelled = true; watcher.current?.remove(); };
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
      onExit();
    } catch (err) { Alert.alert('Couldn’t end trip', err.message); }
    finally { setEnding(false); }
  }

  const counts = live?.trip?.counts;
  const gpsLabel = { starting: '⏳ GPS starting…', on: '🟢 GPS live', denied: '🔴 GPS permission denied — enable location for live tracking', error: '🔴 GPS unavailable' }[gps];

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="light" />
      <View style={styles.tripHeader}>
        <TouchableOpacity onPress={onExit}><Text style={styles.linkText}>← Runs</Text></TouchableOpacity>
        <Text style={styles.tripTitle}>{live?.trip?.scheduleName || 'Trip'}</Text>
        <Text style={[styles.gpsBadge, gps === 'on' ? styles.gpsOn : styles.gpsOff]}>{gpsLabel}</Text>
      </View>

      {counts && (
        <View style={styles.countRow}>
          <Count n={counts.onboard} label="Onboard" color="#22c55e" />
          <Count n={counts.dropped} label="Dropped" color="#38bdf8" />
          <Count n={counts.noShow} label="No-show" color="#ef4444" />
          <Count n={counts.expected} label="Expected" color="#94a3b8" />
        </View>
      )}

      <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 8, paddingBottom: 110 }}>
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
          {ending ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>■ End trip</Text>}
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

function Field({ label, ...props }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput style={styles.input} placeholderTextColor="#9aa0b4" autoCorrect={false} {...props} />
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
  input: { backgroundColor: '#1e293b', color: '#fff', borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14, fontSize: 16 },
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
  gpsOn: { color: '#22c55e' },
  gpsOff: { color: '#f59e0b' },
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
