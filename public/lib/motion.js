// Track geometry and schedule math, shared by the server (api/trains) and the
// browser so both measure distance along a shape exactly the same way.
// Coordinates are [lat, lon]; distances are feet; times are epoch seconds.

const R = 20_902_231; // mean Earth radius in feet (6,371,008.8 m)
const RAD = Math.PI / 180;
const AT_PLATFORM_FT = 130; // a train this close to a stop counts as at it

export function haversine([lat1, lon1], [lat2, lon2]) {
  const dLat = (lat2 - lat1) * RAD;
  const dLon = (lon2 - lon1) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Cumulative distance at each vertex of a polyline.
export function measure(coords) {
  const cum = new Float64Array(coords.length);
  for (let i = 1; i < coords.length; i++) cum[i] = cum[i - 1] + haversine(coords[i - 1], coords[i]);
  return cum;
}

// Distance along the polyline of the point nearest to p, searching segments
// from index `from` on. Uses a local flat projection, accurate at city scale.
export function project(coords, cum, p, from = 0) {
  const kx = Math.cos(p[0] * RAD);
  let best = Infinity;
  let bestDist = 0;
  let bestSeg = from;
  for (let i = Math.max(from, 0); i < coords.length - 1; i++) {
    const [ay, ax] = coords[i];
    const [by, bx] = coords[i + 1];
    const dx = (bx - ax) * kx;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 ? (((p[1] - ax) * kx) * dx + (p[0] - ay) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const ex = (ax + (bx - ax) * t - p[1]) * kx;
    const ey = ay + (by - ay) * t - p[0];
    const d2 = ex * ex + ey * ey;
    if (d2 < best) {
      best = d2;
      bestSeg = i;
      bestDist = cum[i] + (cum[i + 1] - cum[i]) * t;
    }
  }
  return { dist: bestDist, seg: bestSeg, offFt: Math.sqrt(best) * RAD * R };
}

function segmentAt(cum, d) {
  let lo = 0;
  let hi = cum.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= d) lo = mid;
    else hi = mid;
  }
  return lo;
}

// Point and heading (degrees clockwise from north) at distance d along the line.
export function pointAt(coords, cum, d) {
  if (coords.length < 2) return { lat: coords[0][0], lon: coords[0][1], bearing: 0 };
  d = Math.max(0, Math.min(cum[cum.length - 1], d));
  let i = segmentAt(cum, d);
  // Skip zero-length segments so the heading is always defined.
  while (i < coords.length - 2 && cum[i + 1] === cum[i]) i++;
  const span = cum[i + 1] - cum[i];
  const t = span ? (d - cum[i]) / span : 0;
  const [ay, ax] = coords[i];
  const [by, bx] = coords[i + 1];
  const bearing = (Math.atan2((bx - ax) * Math.cos(ay * RAD), by - ay) / RAD + 360) % 360;
  return { lat: ay + (by - ay) * t, lon: ax + (bx - ax) * t, bearing };
}

// The polyline between two distances, as GeoJSON [lon, lat] pairs.
export function sliceLine(coords, cum, d0, d1) {
  if (d1 < d0) [d0, d1] = [d1, d0];
  const a = pointAt(coords, cum, d0);
  const b = pointAt(coords, cum, d1);
  const out = [[a.lon, a.lat]];
  for (let i = segmentAt(cum, d0) + 1; i < coords.length && cum[i] < d1; i++) out.push([coords[i][1], coords[i][0]]);
  out.push([b.lon, b.lat]);
  return out;
}

// A trip's schedule is a list of stops { d, a, p }: distance along the shape,
// scheduled arrival and departure (epoch s).

// Where the schedule puts the train at time t. Holds at the terminals before
// the first departure and after the last arrival, and at platforms while dwelling.
export function scheduledDist(stops, t) {
  const n = stops.length;
  if (t <= stops[0].p) return stops[0].d;
  if (t >= stops[n - 1].a) return stops[n - 1].d;
  for (let i = 0; i < n - 1; i++) {
    const s = stops[i];
    const next = stops[i + 1];
    if (t <= s.p) return s.d;
    if (t < next.a) return s.d + ((next.d - s.d) * (t - s.p)) / (next.a - s.p || 1);
  }
  return stops[n - 1].d;
}

// Inverse of scheduledDist: the scheduled time the train should be at
// distance d, seen at time `seenAt`. At a platform the answer is any time in
// the dwell window, so seenAt is clamped into it (inside the window = on time).
export function scheduledTimeAt(stops, d, seenAt) {
  const n = stops.length;
  const clamp = (lo, hi) => Math.max(lo, Math.min(hi, seenAt));
  if (d <= stops[0].d + AT_PLATFORM_FT) return clamp(-Infinity, stops[0].p);
  if (d >= stops[n - 1].d - AT_PLATFORM_FT) return clamp(stops[n - 1].a, Infinity);
  for (let i = 0; i < n - 1; i++) {
    const s = stops[i];
    const next = stops[i + 1];
    if (Math.abs(d - s.d) <= AT_PLATFORM_FT) return clamp(s.a, s.p);
    if (d < next.d - AT_PLATFORM_FT) {
      const f = (d - s.d) / (next.d - s.d || 1);
      return s.p + f * (next.a - s.p);
    }
  }
  return stops[n - 1].a;
}

// Scheduled running time from distance d0 to distance d1 along a trip:
// departure from d0 to arrival at d1, with stops in between at their dwell.
export function runningTime(stops, d0, d1) {
  return timeAt(stops, d1, 'a') - timeAt(stops, d0, 'p');
}

// Scheduled time at distance d. At a platform, `key` picks arrival ('a') or
// departure ('p'); before the first stop it is the first departure, past the
// last stop the last arrival.
function timeAt(stops, d, key) {
  const n = stops.length;
  if (d <= stops[0].d + AT_PLATFORM_FT) return stops[0].p;
  if (d >= stops[n - 1].d - AT_PLATFORM_FT) return stops[n - 1].a;
  for (let i = 0; i < n - 1; i++) {
    const s = stops[i];
    const next = stops[i + 1];
    if (d <= s.d + AT_PLATFORM_FT) return s[key];
    if (d < next.d - AT_PLATFORM_FT) return s.p + ((d - s.d) / (next.d - s.d || 1)) * (next.a - s.p);
  }
  return stops[n - 1].a;
}
