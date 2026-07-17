// Run: node src/gpsFilter.test.js
//
// The bug this guards against: "sometimes the bus is moving without driver
// movement". Simulates real receiver behaviour — a stationary phone whose
// reported position wanders every fix — and asserts the bus stays put, while
// genuine driving still gets through.

import assert from 'node:assert';
import { decideFix, metresBetween, deadbandFor, MAX_ACCURACY_M } from './gpsFilter.js';

const BASE = { lat: 11.24635, lng: 76.04673 }; // a real fix from production
const M_PER_DEG_LAT = 111320;
const mLat = (m) => m / M_PER_DEG_LAT;
const mLng = (m, lat) => m / (M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180));

const at = (northM, eastM, extra = {}) => ({
  lat: BASE.lat + mLat(northM),
  lng: BASE.lng + mLng(eastM, BASE.lat),
  accuracy: 8,
  speed: 0,
  ...extra,
});
const anchorAt = (northM, eastM) => ({ anchor: pointOf(at(northM, eastM)), strikes: 0 });
const pointOf = (f) => ({ lat: f.lat, lng: f.lng });

// Deterministic pseudo-random, so a failure is always reproducible.
let seed = 42;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
// GPS error is roughly Gaussian, and `accuracy` is its 68% radius (1 sigma) —
// so ~32% of fixes land outside it and 3-sigma excursions do happen. A uniform
// ±accuracy model is far kinder than a real receiver, and would let a broken
// filter pass.
const gauss = (sigma) =>
  sigma * Math.sqrt(-2 * Math.log(rnd() || 1e-9)) * Math.cos(2 * Math.PI * rnd());

let passed = 0;
const test = (name, fn) => { fn(); console.log(`  ok  ${name}`); passed++; };

console.log('\nGPS filter\n');

test('haversine is accurate over short distances', () => {
  const d = metresBetween(BASE, at(100, 0));
  assert.ok(Math.abs(d - 100) < 0.5, `expected ~100m, got ${d.toFixed(2)}m`);
});

test('a parked bus does not move, however long it sits', () => {
  // 600 fixes = 30 minutes at 3s, Gaussian noise at the accuracy the phone
  // itself reports. Before the filter, every one of these was uploaded
  // verbatim, which is exactly what the driver saw as a bus driving in circles.
  let state = anchorAt(0, 0);
  let moves = 0;
  for (let i = 0; i < 600; i++) {
    const acc = 6 + rnd() * 6;
    const raw = at(gauss(acc), gauss(acc), { accuracy: acc });
    const d = decideFix(state, raw);
    state = d.state;
    if (d.action === 'move') moves++;
    else if (d.action === 'hold') {
      // The reported position must be EXACTLY the anchor: the whole point.
      assert.strictEqual(d.fix.lat, state.anchor.lat);
      assert.strictEqual(d.fix.lng, state.anchor.lng);
      assert.strictEqual(d.fix.speed, 0, 'a held fix must not report speed');
    }
  }
  assert.strictEqual(moves, 0, `parked bus moved ${moves} times in 30 minutes`);
  assert.ok(metresBetween(BASE, state.anchor) < 0.001, 'anchor drifted');
});

test('a parked bus survives sustained multipath, not just random noise', () => {
  // The nastier case: a wall reflection biases every fix ~14m the same way for
  // a minute. Correlated error is why one escape can't be trusted.
  let state = anchorAt(0, 0);
  let moves = 0;
  for (let i = 0; i < 20; i++) {
    const d = decideFix(state, at(14 + gauss(3), 4 + gauss(3), { accuracy: 12 }));
    state = d.state;
    if (d.action === 'move') moves++;
  }
  assert.strictEqual(moves, 0, `multipath moved the bus ${moves} times`);
});

test('a held fix still carries a fresh timestamp (heartbeat survives)', () => {
  const raw = at(2, 2, { recordedAt: '2026-07-17T10:00:00.000Z', ts: 1000 });
  const d = decideFix(anchorAt(0, 0), raw);
  assert.strictEqual(d.action, 'hold');
  assert.strictEqual(d.fix.recordedAt, raw.recordedAt);
  assert.strictEqual(d.fix.ts, raw.ts);
  assert.strictEqual(d.fix.held, true);
});

test('a driving bus is tracked normally', () => {
  // 12 m/s ≈ 43 km/h, a fix every 3s → ~36m per fix.
  let state = anchorAt(0, 0);
  let travelled = 0;
  for (let i = 1; i <= 30; i++) {
    const raw = at(36 * i + gauss(4), gauss(4), { accuracy: 8, speed: 43 });
    const d = decideFix(state, raw);
    assert.strictEqual(d.action, 'move', `fix ${i} was not treated as movement`);
    travelled += metresBetween(state.anchor, d.fix);
    state = d.state;
  }
  // ~30 fixes * 36m ≈ 1080m. The filter must not shorten the trail.
  assert.ok(travelled > 1000, `only ${travelled.toFixed(0)}m of ~1080m tracked`);
});

test('a slow creep in traffic is not swallowed by the deadband', () => {
  // 3 km/h ≈ 0.83 m/s → only 2.5m per 3s fix: far INSIDE the deadband. The
  // receiver's own speed is what saves this — position differencing alone
  // would freeze the bus at a crawl.
  const d = decideFix(anchorAt(0, 0), at(2.5, 0, { accuracy: 8, speed: 3 }));
  assert.strictEqual(d.action, 'move', 'a creeping bus was held still');
});

test('movement with no speed reading still gets through, once it persists', () => {
  // Some Android devices report speed as unknown. Movement must then be proven
  // by distance alone: one escape is not enough, two consecutive is.
  const slow = { speed: undefined, accuracy: 8 };
  let state = anchorAt(0, 0);

  state = decideFix(state, at(10, 0, slow)).state;            // inside deadband
  const first = decideFix(state, at(30, 0, slow));
  assert.strictEqual(first.action, 'hold', 'one escape should not move the bus');
  const second = decideFix(first.state, at(60, 0, slow));
  assert.strictEqual(second.action, 'move', 'sustained movement must get through');
});

test('a single noise spike does not move the bus, and is forgotten', () => {
  let state = anchorAt(0, 0);
  const spike = decideFix(state, at(40, 0, { accuracy: 8 }));
  assert.strictEqual(spike.action, 'hold');
  assert.strictEqual(spike.state.strikes, 1, 'the escape should be remembered');
  // Back to normal: the strike must be cleared, or two unrelated spikes minutes
  // apart would add up and teleport the bus.
  const back = decideFix(spike.state, at(2, 0, { accuracy: 8 }));
  assert.strictEqual(back.action, 'hold');
  assert.strictEqual(back.state.strikes, 0, 'strikes must reset inside the deadband');
});

test('a vague fix is dropped rather than moving the bus somewhere wrong', () => {
  const d = decideFix(anchorAt(0, 0), at(120, 0, { accuracy: 90 }));
  assert.strictEqual(d.action, 'drop');
  assert.strictEqual(d.reason, 'accuracy');
});

test('a vague fix is dropped even when it looks like movement', () => {
  // The dangerous case: a ±90m wifi fix 300m away with a plausible speed.
  // Believing it teleports the bus across town and back.
  const d = decideFix(anchorAt(0, 0), at(300, 0, { accuracy: 90, speed: 40 }));
  assert.strictEqual(d.action, 'drop');
});

test('a dropped fix preserves the anchor and the strikes', () => {
  const watching = { anchor: pointOf(at(0, 0)), strikes: 1 };
  const d = decideFix(watching, at(300, 0, { accuracy: 90 }));
  assert.deepStrictEqual(d.state, watching);
});

test('deadband is measured in confidence radii, within sane bounds', () => {
  assert.strictEqual(deadbandFor(2), 25);   // a superb fix still needs 25m
  assert.strictEqual(deadbandFor(12), 36);
  assert.strictEqual(deadbandFor(45), 60);  // a poor fix never demands >60m
  assert.strictEqual(deadbandFor(null), 45);
  assert.strictEqual(deadbandFor(undefined), 45);
});

test('the first fix of a trip always places the bus', () => {
  const d = decideFix(null, at(0, 0, { accuracy: 30 }));
  assert.strictEqual(d.action, 'move');
});

test('"Locate me" overrides the deadband', () => {
  // 3m away and stationary: normally a hold. The driver asked, so it moves.
  assert.strictEqual(decideFix(anchorAt(0, 0), at(3, 0)).action, 'hold');
  assert.strictEqual(decideFix(anchorAt(0, 0), at(3, 0), { force: true }).action, 'move');
});

test('"Locate me" accepts a vague fix rather than doing nothing', () => {
  // Trip start forces the first fix so the bus appears immediately, even if the
  // GPS is still warming up. The stream sharpens it seconds later.
  const d = decideFix(null, at(0, 0, { accuracy: MAX_ACCURACY_M + 40 }), { force: true });
  assert.strictEqual(d.action, 'move');
});

test('an accurate fix escapes a vague anchor (warm-up self-corrects)', () => {
  // Trip started on a vague guess; 30s later the GPS locks on, 80m away. That
  // must be believed, or the bus sits on the wrong street for the whole trip.
  const vague = anchorAt(80, 0);
  const sharp = at(0, 0, { accuracy: 5 });
  const first = decideFix(vague, sharp);
  assert.strictEqual(first.action, 'hold', 'one fix is never enough on its own');
  assert.strictEqual(decideFix(first.state, sharp).action, 'move', 'the lock-on must win');
});

console.log(`\n${passed} passed\n`);
