// Average headway (time between consecutive trains) per line and direction,
// for live trains and for the timetable, measured the same way for both.
import { project, pointAt, scheduledDist, runningTime } from '../public/lib/motion.js';
import { stopDistances, localDate, serviceDayStart, serviceRuns } from './gtfs.js';

const STALE_AFTER_S = 3 * 60; // matches the browser's stale threshold
const AT_ORIGIN_M = 40;
const OFF_TRACK_M = 200; // a leader farther than this from the follower's track isn't on its route

// live: [{ line, dir, ts, lat, lon, dist, stops, shape }]
// Returns { [line]: { [dir]: { actual, scheduled, trains, scheduledTrains } } } in seconds.
export function computeHeadways(model, live, now) {
  const out = {};
  const days = serviceDays(now);
  for (const [key, refId] of model.refShapes) {
    const [line, dir] = key.split('|');
    const ref = model.shapes.get(refId);
    const actual = live.filter(
      (t) => t.line === line && t.dir === dir && now - t.ts <= STALE_AFTER_S && t.dist > t.stops[0].d + AT_ORIGIN_M,
    );
    const scheduled = scheduledPositions(model, line, dir, now, days);
    (out[line] ??= {})[dir] = {
      actual: averageGap(actual, ref),
      scheduled: averageGap(scheduled, ref),
      trains: actual.length,
      scheduledTrains: scheduled.length,
    };
  }
  return out;
}

// Orders trains by progress along the direction's main shape, then, for each
// consecutive pair, times the follower's scheduled run from where it is to
// where the leader is.
function averageGap(trains, ref) {
  if (trains.length < 2) return null;
  const ordered = trains
    .map((t) => ({ t, progress: project(ref.coordinates, ref.cum, [t.lat, t.lon]).dist }))
    .sort((a, b) => b.progress - a.progress)
    .map((x) => x.t);
  const gaps = [];
  for (let i = 0; i < ordered.length - 1; i++) {
    const leader = ordered[i];
    const follower = ordered[i + 1];
    const at = project(follower.shape.coordinates, follower.shape.cum, [leader.lat, leader.lon]);
    if (at.offMeters > OFF_TRACK_M) continue;
    if (at.dist > follower.stops.at(-1).d + AT_ORIGIN_M) continue; // leader is past the end of the follower's trip
    const gap = runningTime(follower.stops, follower.dist, at.dist);
    if (gap > 0) gaps.push(gap);
  }
  return gaps.length ? Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length) : null;
}

// Where the timetable puts every trip that should be under way right now
// (departed its first stop, not yet at its last), live data or not.
function scheduledPositions(model, line, dir, now, days) {
  const out = [];
  const runs = new Map();
  for (const trip of model.trips.values()) {
    if (trip.line !== line || trip.directionId !== dir || trip.stops.length < 2) continue;
    const first = trip.stops[0][3];
    const last = trip.stops.at(-1)[2];
    for (const { ymd, base } of days) {
      if (now <= base + first || now >= base + last) continue;
      const runKey = `${trip.serviceId}|${ymd}`;
      if (!runs.has(runKey)) runs.set(runKey, serviceRuns(model.calendar, trip.serviceId, ymd));
      if (!runs.get(runKey)) continue;
      const shape = model.shapes.get(trip.shapeId);
      const dists = stopDistances(model, trip);
      const stops = trip.stops.map(([, , a, p], i) => ({ d: dists[i], a: base + a, p: base + p }));
      const dist = scheduledDist(stops, now);
      const pt = pointAt(shape.coordinates, shape.cum, dist);
      out.push({ stops, shape, dist, lat: pt.lat, lon: pt.lon });
      break;
    }
  }
  return out;
}

// Today's and yesterday's service days (after-midnight trips belong to yesterday).
function serviceDays(now) {
  return [localDate(now).ymd, localDate(now - 86400).ymd].map((ymd) => ({ ymd, base: serviceDayStart(ymd) }));
}
