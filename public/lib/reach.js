// Bus reach from a station: which window is picked, which station is shown,
// and turning a data/reach/<station>.json file into map features.
//
// File format (written by pipeline/reach.py; see README "Reach files"):
//   stops    [[stop_id, name, lat, lon]]
//   routes   [[route_id, number, agency, brt brand | null]]
//   patterns [[pattern_id, route index]]
//   hops     [[pattern index, stop position, encoded polyline]]  one stop-to-stop piece of route
//   windows  { "<day>-<period>": { samples, departures, routes, stops15, stops30,
//              reached:  [[stop, minutes, band, transfer 0|1, [[pattern, board stop, alight stop], ...]]],
//              segments: [[hop, band, transfer 0|1]] } }
import { loadReachFile, loadWalkShedFile } from './data.js';
import { decodePolyline } from './polyline.js';
import { topoFeatures } from './topojson.js';
import { store } from './view.js';

// What's shown. `hover` follows the pointer; `selected` is the station whose
// card is open. Hover wins while it lasts, then the selection comes back.
export const reachView = store({
  window: null, // "weekday-pm"
  hover: null, // station id
  selected: null, // station id
  active() {
    return this.hover || this.selected;
  },
});

// The window that covers the current time in Seattle. Between 1 and 6 am
// (no window), the coming AM rush.
export function currentWindow(meta, now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: meta.timezone, weekday: 'short', hour: 'numeric', hourCycle: 'h23' })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  let day = days.indexOf(parts.weekday);
  let hour = Number(parts.hour);
  // Night runs to 1 am: just after midnight belongs to the previous day.
  const night = meta.periods.find((p) => p.end > 24);
  if (night && hour < night.end - 24) {
    day = (day + 6) % 7;
    hour += 24;
  }
  const dayType = day === 6 ? 'saturday' : day === 0 ? 'sunday' : 'weekday';
  const period = meta.periods.find((p) => hour >= p.start && hour < p.end) || meta.periods[0];
  return `${dayType}-${period.id}`;
}

export function windowLabel(meta, wid) {
  const [day, period] = wid.split('-');
  const d = meta.day_types.find((x) => x.id === day);
  const p = meta.periods.find((x) => x.id === period);
  return `${d.label} ${p.label}`;
}

// Loaded files, with hop geometry decoded once.
const decoded = new Map();
export function loadReach(stationId) {
  if (!decoded.has(stationId)) {
    const p = loadReachFile(stationId).then((doc) => ({ ...doc, hopCoords: doc.hops.map((h) => decodePolyline(h[2])) }));
    p.catch(() => decoded.delete(stationId));
    decoded.set(stationId, p);
  }
  return decoded.get(stationId);
}

// The 5- and 10-minute walk sheds for a station and window, as GeoJSON
// features with property `minutes`. Decoded once per file.
const sheds = new Map();
export function loadWalkShed(stationId, wid) {
  const key = `${stationId}_${wid}`;
  if (!sheds.has(key)) {
    const p = loadWalkShedFile(key).then((topo) => topoFeatures(topo, 'walk'));
    p.catch(() => sheds.delete(key));
    sheds.set(key, p);
  }
  return sheds.get(key);
}

// Map features and summary for one window of a loaded file.
export function windowFeatures(doc, wid) {
  const w = doc.windows[wid];
  const routeOf = (pattern) => doc.routes[doc.patterns[pattern][1]];

  const segments = w.segments.map(([hop, band, transfer]) => ({
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: doc.hopCoords[hop] },
    properties: { band, transfer },
  }));

  const stops = [];
  const farthest = new Map(); // "route|band" -> reached row
  for (const r of w.reached) {
    const [stop, minutes, band] = r;
    const s = doc.stops[stop];
    stops.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [s[3], s[2]] }, properties: { band, minutes, name: s[1] } });
    const legs = r[4];
    const route = doc.patterns[legs.at(-1)[0]][1];
    const key = `${route}|${band}`;
    if (!farthest.has(key) || farthest.get(key)[1] < minutes) farthest.set(key, r);
  }

  // "7 → Rainier Beach · 27 min" at the farthest stop on each route in each band.
  const labels = [...farthest.values()].map((r) => {
    const s = doc.stops[r[0]];
    const route = routeOf(r[4].at(-1)[0]);
    return {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [s[3], s[2]] },
      properties: { band: r[2], minutes: r[1], label: `${route[1]} → ${shortStop(s[1])} · ${r[1]} min` },
    };
  });

  return {
    segments: { type: 'FeatureCollection', features: segments },
    stops: { type: 'FeatureCollection', features: stops },
    labels: { type: 'FeatureCollection', features: labels },
    summary: { routes: w.routes, stops15: w.stops15, stops30: w.stops30, departures: w.departures },
  };
}

// "Rainier Ave S & S Henderson St - Bay 2" -> "Rainier Ave S & S Henderson St"
const shortStop = (name) => name.replace(/\s+-\s+Bay\s+\w+$/i, '').replace(/\s+Bay\s+[A-Z]?\d+$/i, '');
