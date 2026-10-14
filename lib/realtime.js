// Live 1 Line and 2 Line trains from Sound Transit's GTFS-realtime feeds
// (served by OneBusAway), matched to the static schedule.
import GtfsRealtimeBindings from 'gtfs-realtime-bindings';
import { getStatic, stopDistances, localDate, serviceDayStart, serviceRuns } from './gtfs.js';
import { computeHeadways } from './headways.js';
import { project, scheduledTimeAt } from '../public/lib/motion.js';

const { transit_realtime: rt } = GtfsRealtimeBindings;

const FEED_BASE = 'https://api.pugetsound.onebusaway.org/api/gtfs_realtime';
const TIMEOUT_MS = 8000;
const DROP_AFTER_S = 10 * 60; // reports older than this are left out entirely

export class FeedError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function fetchFeed(name, key) {
  const url = `${FEED_BASE}/${name}-for-agency/40.pb?key=${encodeURIComponent(key)}`;
  let res;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    // Never echo the underlying error: it can include the request URL, and
    // with it the key.
    throw new FeedError(err.name === 'TimeoutError' ? `${name}: timed out` : `${name}: network error`, 504);
  }
  if (!res.ok) throw new FeedError(`${name}: HTTP ${res.status}`, res.status);
  const buf = new Uint8Array(await res.arrayBuffer());
  try {
    return rt.FeedMessage.toObject(rt.FeedMessage.decode(buf), { longs: Number });
  } catch {
    // OneBusAway answers some key errors with a non-protobuf body.
    throw new FeedError(`${name}: response was not GTFS-realtime`, 502);
  }
}

// The realtime feeds answer any key, even an invalid one, so check the key
// against the REST API, which does reject bad keys. Good results are trusted
// for 10 minutes, bad ones for 1.
const KEY_CHECK_URL = 'https://api.pugetsound.onebusaway.org/api/where/current-time.json';
let keyCheck = null; // { key, ok, at }

async function verifyKey(key) {
  const now = Date.now();
  if (keyCheck && keyCheck.key === key && now - keyCheck.at < (keyCheck.ok ? 600e3 : 60e3)) {
    if (!keyCheck.ok) throw new FeedError('key rejected', 401);
    return;
  }
  let res;
  try {
    res = await fetch(`${KEY_CHECK_URL}?key=${encodeURIComponent(key)}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    return; // can't tell; let the feed requests decide
  }
  if (res.status === 401 || res.status === 403) {
    keyCheck = { key, ok: false, at: now };
    throw new FeedError('key rejected', 401);
  }
  if (res.ok) keyCheck = { key, ok: true, at: now };
}

// OneBusAway can prefix IDs with the agency ("40_"); the static feed doesn't.
const bare = (id) => (id || '').replace(/^40_/, '');

export async function getTrains(key, now = Date.now() / 1000) {
  const [model, , vp, tu] = await Promise.all([
    getStatic(),
    verifyKey(key),
    fetchFeed('vehicle-positions', key),
    fetchFeed('trip-updates', key),
  ]);

  const updates = new Map();
  for (const e of tu.entity) if (e.tripUpdate?.trip) updates.set(bare(e.tripUpdate.trip.tripId), e.tripUpdate);

  const trains = [];
  const live = []; // the same trains with full geometry, for headways
  for (const e of vp.entity) {
    const v = e.vehicle;
    if (!v?.trip || !v.position) continue;
    if (!model.routeLine.has(bare(v.trip.routeId))) continue; // not 1 Line / 2 Line
    const tripId = bare(v.trip.tripId);
    const trip = model.trips.get(tripId);
    if (!trip) continue;
    const ts = v.timestamp || vp.header.timestamp;
    if (now - ts > DROP_AFTER_S) continue;
    const built = buildTrain(model, trip, tripId, v, ts, updates.get(tripId), now);
    if (!built) continue;
    trains.push(built.train);
    live.push(built.live);
  }

  return {
    now: Math.round(now),
    feedTs: vp.header.timestamp,
    trains,
    headways: computeHeadways(model, live, now),
  };
}

function buildTrain(model, trip, tripId, v, ts, update, now) {
  const shape = model.shapes.get(trip.shapeId);
  if (!shape || trip.stops.length < 2) return null;

  const base = pickServiceDay(model, trip, ts, v.trip.startDate);
  const dists = stopDistances(model, trip);
  const stops = trip.stops.map(([, , arr, dep], i) => ({ d: dists[i], a: base + arr, p: base + dep }));

  const lat = v.position.latitude;
  const lon = v.position.longitude;
  const dist = project(shape.coordinates, shape.cum, [lat, lon]).dist;

  // Delay from position: how far behind (or ahead of) the schedule the train
  // was at the moment it reported. The map draws the train and its ghost this
  // far apart, so the popup reports this same number. (The trip update's own
  // delay can differ from the reported position by a couple of minutes.)
  const delay = Math.round(ts - scheduledTimeAt(stops, dist, ts));

  // The trip update's prediction for the next stop, when there is one.
  let nextDelay = null;
  let nextIdx = -1;
  const stus = update?.stopTimeUpdate || [];
  for (const stu of stus) {
    const predicted = stu.arrival?.time || stu.departure?.time;
    if (!predicted || predicted < now) continue;
    nextIdx = stu.stopSequence != null
      ? trip.stops.findIndex((s) => s[0] === stu.stopSequence)
      : trip.stops.findIndex((s) => s[1] === bare(stu.stopId));
    if (nextIdx >= 0) {
      nextDelay = stu.arrival?.delay ?? predicted - (stu.arrival?.time ? stops[nextIdx].a : stops[nextIdx].p);
    }
    break;
  }
  if (nextIdx < 0) nextIdx = stops.findIndex((s) => s.d > dist + 40);

  const t0 = stops[0].a;

  const train = {
    id: v.vehicle?.id || tripId,
    line: trip.line,
    dir: trip.directionId,
    headsign: trip.headsign,
    lat: round5(lat),
    lon: round5(lon),
    ts,
    delay,
    nextStop: nextIdx >= 0 ? model.stopInfo.get(trip.stops[nextIdx][1]).name : null,
    nextDelay,
    shapeId: trip.shapeId,
    t0,
    // [meters along shape, arrival - t0, departure - t0]
    stops: stops.map((s) => [Math.round(s.d), s.a - t0, s.p - t0]),
  };
  return { train, live: { line: trip.line, dir: trip.directionId, ts, lat, lon, dist, stops, shape } };
}

// Realtime start_date isn't populated for Link, so try today's and
// yesterday's service days (after-midnight trips belong to yesterday) and
// keep the one whose timetable covers the report time.
function pickServiceDay(model, trip, ts, startDate) {
  const first = trip.stops[0][2];
  const last = trip.stops.at(-1)[3];
  if (startDate) return serviceDayStart(startDate);
  const candidates = [localDate(ts).ymd, localDate(ts - 86400).ymd];
  let fallback = null;
  for (const ymd of candidates) {
    if (!serviceRuns(model.calendar, trip.serviceId, ymd)) continue;
    const base = serviceDayStart(ymd);
    if (ts >= base + first - 3600 && ts <= base + last + 3600) return base;
    fallback ??= base;
  }
  return fallback ?? serviceDayStart(candidates[0]);
}

const round5 = (n) => Math.round(n * 1e5) / 1e5;
