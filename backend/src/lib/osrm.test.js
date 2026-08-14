import test from 'node:test';
import assert from 'node:assert/strict';

// osrm.js reads its URL once at module load, so the env has to be in place
// before the import — hence the dynamic import rather than a static one.
process.env.OSRM_URL = 'http://osrm.test';
process.env.OSRM_TOKEN = 'test-token';
const { osrmMatch } = await import('./osrm.js');

// These tests stand in for a live OSRM server: they pin down the REQUEST we
// build and how we read the reply. What they cannot prove is that a real OSRM
// deployment agrees with our reading of its API — that needs a reachable
// server and is tracked separately.

// Records the last URL requested and replies with whatever the test sets.
function stubOsrm(reply) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    if (reply instanceof Error) throw reply;
    return { json: async () => reply };
  };
  return calls;
}

const realFetch = globalThis.fetch;
test.after(() => { globalThis.fetch = realFetch; });

// A reply shaped the way OSRM shapes one: tracepoints parallel to the input,
// each with a [lng, lat] location, null where the point was dropped.
const okReply = (locations) => ({
  code: 'Ok',
  tracepoints: locations.map((l) => (l ? { location: l } : null)),
});

const trace = [
  { lat: 8.5200, lng: 76.9300, accuracy: 12, recordedAt: '2026-01-01T12:00:00Z' },
  { lat: 8.5210, lng: 76.9305, accuracy: 30, recordedAt: '2026-01-01T12:00:10Z' },
  { lat: 8.5220, lng: 76.9310, accuracy: 8, recordedAt: '2026-01-01T12:00:20Z' },
];

const paramOf = (url, name) => new URL(url).searchParams.get(name);

test('a single point is never matched — one point is just nearest-road snapping', async () => {
  const calls = stubOsrm(okReply([[76.93, 8.52]]));
  assert.equal(await osrmMatch([trace[0]]), null);
  assert.equal(calls.length, 0, 'and it must not cost an OSRM call');
});

test('an empty or missing trace is handled without throwing', async () => {
  stubOsrm(okReply([]));
  assert.equal(await osrmMatch([]), null);
  assert.equal(await osrmMatch(null), null);
});

test('snapped positions come back in the input order', async () => {
  stubOsrm(okReply([[76.9301, 8.5201], [76.9306, 8.5211], [76.9311, 8.5221]]));
  const out = await osrmMatch(trace);
  assert.equal(out.length, 3);
  assert.deepEqual(out[0], { lat: 8.5201, lng: 76.9301 });
  assert.deepEqual(out[2], { lat: 8.5221, lng: 76.9311 });
});

test('a point OSRM refuses to place comes back null, not guessed', async () => {
  stubOsrm(okReply([[76.9301, 8.5201], null, [76.9311, 8.5221]]));
  const out = await osrmMatch(trace);
  assert.equal(out[1], null, 'the caller keeps the raw fix for this one');
  assert.deepEqual(out[0], { lat: 8.5201, lng: 76.9301 });
});

test('coordinates go out as lng,lat — the order OSRM expects, not the one we store', async () => {
  const calls = stubOsrm(okReply([[76.93, 8.52], [76.93, 8.52], [76.93, 8.52]]));
  await osrmMatch(trace);
  assert.match(calls[0].url, /\/match\/v1\/driving\/76\.93,8\.52;76\.9305,8\.521;76\.931,8\.522/);
});

test('the search radius is the reported accuracy, clamped to sane bounds', async () => {
  const calls = stubOsrm(okReply([null, null, null]));
  await osrmMatch(trace);
  // 12 → floor of 10 does not bite; 30 passes through; 8 is raised to 10.
  assert.equal(paramOf(calls[0].url, 'radiuses'), '12;30;10');
});

test('a wildly vague fix does not blow the search radius open', async () => {
  const calls = stubOsrm(okReply([null, null]));
  await osrmMatch([
    { ...trace[0], accuracy: 5000 },
    { ...trace[1], accuracy: 51 },
  ]);
  assert.equal(paramOf(calls[0].url, 'radiuses'), '50;50', 'capped at 50 m');
});

test('a fix with no accuracy at all still gets a workable radius', async () => {
  const calls = stubOsrm(okReply([null, null]));
  await osrmMatch([
    { lat: 8.52, lng: 76.93 },
    { lat: 8.521, lng: 76.9305 },
  ]);
  assert.equal(paramOf(calls[0].url, 'radiuses'), '15;15');
});

test('timestamps are sent when they ascend, so the HMM can reason about travel', async () => {
  const calls = stubOsrm(okReply([null, null, null]));
  await osrmMatch(trace);
  const ts = paramOf(calls[0].url, 'timestamps').split(';').map(Number);
  assert.equal(ts.length, 3);
  assert.ok(ts.every((s, i) => i === 0 || s > ts[i - 1]), 'strictly ascending');
});

test('timestamps are withheld when they are NOT strictly ascending', async () => {
  // OSRM rejects the whole request over this, so a trace with two fixes in the
  // same second must still match — just without the timing evidence.
  const calls = stubOsrm(okReply([null, null, null]));
  await osrmMatch([
    trace[0],
    { ...trace[1], recordedAt: '2026-01-01T12:00:00Z' }, // same second as the first
    trace[2],
  ]);
  assert.equal(paramOf(calls[0].url, 'timestamps'), null);
  assert.ok(paramOf(calls[0].url, 'radiuses'), 'the rest of the request is unaffected');
});

test('only the live tail of a long trip is matched, and the result still lines up', async () => {
  const long = Array.from({ length: 130 }, (_, i) => ({
    lat: 8.52 + i * 0.0001,
    lng: 76.93,
    accuracy: 15,
    recordedAt: new Date(Date.UTC(2026, 0, 1, 12, 0, i)).toISOString(),
  }));
  const calls = stubOsrm(okReply(Array.from({ length: 100 }, () => [76.93, 8.52])));
  const out = await osrmMatch(long);

  assert.equal(calls[0].url.split('/match/v1/driving/')[1].split('?')[0].split(';').length, 100);
  assert.equal(out.length, 130, 'parallel to the INPUT, not to what we sent');
  assert.equal(out[0], null, 'the un-sent head is padded with nulls');
  assert.equal(out[29], null);
  assert.deepEqual(out[30], { lat: 8.52, lng: 76.93 }, 'the tail carries the snaps');
});

test('the token travels as a header, never in the query string', async () => {
  const calls = stubOsrm(okReply([null, null, null]));
  await osrmMatch(trace);
  assert.equal(calls[0].init.headers['X-OSRM-Token'], 'test-token');
  assert.equal(paramOf(calls[0].url, 'token'), null);
});

test('an OSRM "NoMatch" answer falls back rather than inventing positions', async () => {
  stubOsrm({ code: 'NoMatch', message: 'Could not match the trace.' });
  assert.equal(await osrmMatch(trace), null);
});

test('a malformed reply is treated as no match', async () => {
  stubOsrm({ code: 'Ok' }); // no tracepoints array
  assert.equal(await osrmMatch(trace), null);
});

test('OSRM being down never breaks the trail — matching is an improvement, not a dependency', async () => {
  stubOsrm(new Error('ECONNREFUSED'));
  assert.equal(await osrmMatch(trace), null, 'null, and no throw for the route to catch');
});
