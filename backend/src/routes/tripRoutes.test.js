import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import { implausible } from './tripRoutes.js';

// The server-side outlier gate. This is the last thing between a broken
// receiver — or a forged request from a stolen driver token — and the position
// every watching parent believes. It must reject the impossible while never
// touching a legitimately large gap, because a bus really does emerge from a
// tunnel a kilometre from where it went in.

const at = (isoOffsetSeconds) => new Date(Date.UTC(2026, 0, 1, 12, 0, 0) + isoOffsetSeconds * 1000);

// ~111 m per 0.001° of latitude at the equator; near enough for these bounds.
const point = (lat, lng, seconds) => ({ lat, lng, recordedAt: at(seconds) });

test('the first fix of a trip is always accepted', () => {
  assert.equal(implausible(null, point(8.52, 76.93, 0)), null);
});

test('ordinary road movement passes', () => {
  const prev = point(8.5200, 76.9300, 0);
  // ~111 m in 10 s = 40 km/h.
  const next = point(8.5210, 76.9300, 10);
  assert.equal(implausible(prev, next), null);
});

test('a teleport across town is refused', () => {
  const prev = point(8.5200, 76.9300, 0);
  // ~11 km in 5 s. No vehicle does this.
  const next = point(8.6200, 76.9300, 5);
  const reason = implausible(prev, next);
  assert.match(reason, /^implausible-jump:/);
});

test('the rejection reason carries the distance and the gap, for the log', () => {
  const reason = implausible(point(8.52, 76.93, 0), point(8.62, 76.93, 5));
  assert.match(reason, /^implausible-jump:\d+m\/\d+s$/);
});

test('a long signal blackout legitimately covers real ground', () => {
  const prev = point(8.5200, 76.9300, 0);
  // 10 minutes of tunnel, ~11 km later — 66 km/h average. Entirely normal.
  const next = point(8.6200, 76.9300, 600);
  assert.equal(implausible(prev, next), null);
});

test('the ceiling is a speed, not a distance — 160 km/h is the limit', () => {
  const prev = point(8.5200, 76.9300, 0);
  // 100 s at 160 km/h ≈ 4444 m, plus 250 m grace. 4 km is inside it.
  assert.equal(implausible(prev, point(8.5560, 76.9300, 100)), null);
  // 20 km in the same 100 s is not.
  assert.match(implausible(prev, point(8.7000, 76.9300, 100)), /^implausible-jump:/);
});

test('two fixes at the same instant may not sit far apart', () => {
  const prev = point(8.5200, 76.9300, 0);
  assert.equal(implausible(prev, point(8.6200, 76.9300, 0)), 'duplicate-timestamp-jump');
});

test('but a same-instant duplicate within the grace radius is fine', () => {
  // Two readings stamped the same second a few metres apart is just jitter,
  // not a contradiction — the phone clock has one-second resolution.
  const prev = point(8.5200, 76.9300, 0);
  assert.equal(implausible(prev, point(8.52010, 76.9300, 0)), null);
});

test('a fix that arrives out of order is judged on elapsed time, not sign', () => {
  // A drained offline queue can present an OLDER fix than the stored one. The
  // gate measures the interval either way rather than trusting the ordering.
  const prev = { lat: 8.5200, lng: 76.9300, recordedAt: at(600) };
  const next = point(8.5210, 76.9300, 0); // 10 min earlier, ~111 m away
  assert.equal(implausible(prev, next), null);
});

test('prev may carry a string timestamp, as it does straight from the driver app', () => {
  const prev = { lat: 8.52, lng: 76.93, recordedAt: at(0).toISOString() };
  assert.equal(implausible(prev, point(8.5210, 76.93, 10)), null);
});
