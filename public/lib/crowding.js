// Estimated typical crowding (data/crowding.json): line -> direction ->
// segment -> time window -> load %. Not live: a model built from average
// ridership by pipeline/crowding.py.
import { getJson } from './data.js';

export const loadCrowding = () => getJson('/data/crowding.json');

// The segment of a line and direction nearest a point (straight lines
// between stations; good enough to tell which pair of stations a train is
// between).
function nearestSegment(segments, lon, lat) {
  const kx = Math.cos((lat * Math.PI) / 180);
  let best = null;
  let bestD = Infinity;
  for (const s of segments) {
    const [[ax, ay], [bx, by]] = s.coords;
    const dx = (bx - ax) * kx;
    const dy = by - ay;
    const L = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, (((lon - ax) * kx) * dx + (lat - ay) * dy) / L));
    const d = Math.hypot((lon - ax) * kx - dx * t, lat - ay - dy * t);
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best;
}

// Direction key in crowding.json for a line, by matching the direction's name
// ("Toward Lynnwood City Center") so the two feeds' direction ids can differ.
export function directionKey(doc, line, dir, name) {
  const dirs = doc.lines[line]?.directions || {};
  if (name) {
    const hit = Object.entries(dirs).find(([, d]) => d.name.toLowerCase() === `toward ${name}`.toLowerCase());
    if (hit) return hit[0];
  }
  return dirs[dir] ? dir : null;
}

export function levelOf(doc, pct) {
  return doc.levels.find((l) => l.max_pct == null || pct <= l.max_pct) || doc.levels.at(-1);
}

// { pct, label } for a train, or null if the model has no value.
export function trainLoad(doc, line, dirKey, lon, lat, wid) {
  const d = doc?.lines[line]?.directions[dirKey];
  if (!d) return null;
  const seg = nearestSegment(d.segments, lon, lat);
  const pct = seg?.load_pct[wid];
  if (pct == null) return null;
  return { pct, label: levelOf(doc, pct).label, segment: seg };
}

// "Est. 78% full · Crowded"
export const loadText = (l) => `Est. ${l.pct}% full · ${l.label}`;

// Fill level 0..10 for the marker icons (full at 100% of target max load).
export const fillLevel = (l) => (l ? Math.max(0, Math.min(10, Math.round(l.pct / 10))) : 0);
