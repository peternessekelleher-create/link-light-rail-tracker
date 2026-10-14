// Fetches Sound Transit's GTFS feed and reduces it to the 1 Line and 2 Line:
// the stations and track the map draws (Step 1), plus every trip's shape and
// timetable for placing live and scheduled trains (Step 2).
import { unzipSync, strFromU8 } from 'fflate';
import { measure, project } from '../public/lib/motion.js';

// Official feed, listed on Sound Transit's Open Transit Data downloads page:
// https://www.soundtransit.org/help-contacts/business-information/open-transit-data-otd/otd-downloads
export const GTFS_URL = 'https://www.soundtransit.org/GTFS-rail/40_gtfs.zip';

// Matched on route_short_name (not route_id) so the filter survives route_id
// renumbering. route_type 0 = light rail; the T Line is also light rail, so
// the name check is what keeps it out.
export const LINES = ['1 Line', '2 Line'];

const NEEDED = new Set(['routes.txt', 'trips.txt', 'shapes.txt', 'stops.txt', 'stop_times.txt', 'calendar.txt', 'calendar_dates.txt']);
const CACHE_MS = 6 * 60 * 60 * 1000; // 6 hours

// Kept in module scope so a warm function instance answers from memory.
let cached = null; // { data, at }
let inflight = null;

// The parsed feed, refreshed every 6 hours. If Sound Transit is unreachable,
// a stale copy beats an empty map.
export async function getStatic() {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.data;
  inflight ??= loadStatic()
    .then((data) => (cached = { data, at: Date.now() }).data)
    .finally(() => (inflight = null));
  try {
    return await inflight;
  } catch (err) {
    if (cached) return cached.data;
    throw err;
  }
}

export async function loadStatic(url = GTFS_URL) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GTFS download failed: ${res.status} ${res.statusText}`);
  const zip = new Uint8Array(await res.arrayBuffer());
  const files = unzipSync(zip, { filter: (f) => NEEDED.has(f.name.split('/').pop()) });
  const text = {};
  for (const [name, bytes] of Object.entries(files)) text[name.split('/').pop()] = strFromU8(bytes);
  for (const name of NEEDED) if (!(name in text)) throw new Error(`GTFS zip is missing ${name}`);
  return buildStatic(text);
}

// Step 1's payload: { stations, routes }.
export async function loadLinkData(url) {
  return (await loadStatic(url)).link;
}

export function buildStatic(text) {
  // routes.txt -> route_id => { line, color }
  const routes = new Map();
  for (const r of readCsv(text['routes.txt'])) {
    if (r.route_type === '0' && LINES.includes(r.route_short_name)) {
      routes.set(r.route_id, { line: r.route_short_name, color: `#${(r.route_color || '').toUpperCase()}` });
    }
  }
  if (routes.size !== LINES.length) throw new Error(`Expected ${LINES.length} Link routes, found ${routes.size}`);

  // trips.txt -> Link trips, and trip counts per shape for each line
  const trips = new Map();
  const shapeTrips = new Map(LINES.map((l) => [l, new Map()]));
  for (const t of readCsv(text['trips.txt'])) {
    const route = routes.get(t.route_id);
    if (!route) continue;
    trips.set(t.trip_id, {
      line: route.line,
      shapeId: t.shape_id,
      serviceId: t.service_id,
      directionId: t.direction_id || '0',
      headsign: t.trip_headsign,
      stops: [], // [stop_sequence, stop_id, arrival s, departure s]
    });
    const counts = shapeTrips.get(route.line);
    counts.set(t.shape_id, (counts.get(t.shape_id) || 0) + 1);
  }

  // Every shape a Link trip uses, with cumulative distances for snapping.
  const shapes = new Map();
  for (const [line, counts] of shapeTrips) for (const id of counts.keys()) shapes.set(id, { line, pts: [] });
  for (const s of readCsv(text['shapes.txt'])) {
    const shape = shapes.get(s.shape_id);
    if (shape) shape.pts.push([+s.shape_pt_sequence, round(+s.shape_pt_lat), round(+s.shape_pt_lon)]);
  }
  for (const shape of shapes.values()) {
    shape.coordinates = shape.pts.sort((a, b) => a[0] - b[0]).map(([, lat, lon]) => [lat, lon]);
    shape.cum = measure(shape.coordinates);
    delete shape.pts;
  }

  // Each line has one full-length shape plus short-turn variants that run over
  // the same track. Drawing the most-used shape gives the whole line once.
  const routesOut = [];
  for (const [line, counts] of shapeTrips) {
    const [shapeId] = [...counts].sort((a, b) => b[1] - a[1])[0] || [];
    if (!shapeId) throw new Error(`No trips found for ${line}`);
    const coordinates = shapes.get(shapeId).coordinates.slice();
    // Orient every line north-to-south so a fixed per-line offset on the map
    // always pushes shared track to opposite sides.
    if (coordinates.length && coordinates[0][0] < coordinates[coordinates.length - 1][0]) coordinates.reverse();
    const { color } = [...routes.values()].find((r) => r.line === line);
    routesOut.push({ line, color, coordinates });
  }

  // stop_times.txt is by far the largest file (~30 MB), so it gets a fast
  // line scan instead of the general CSV reader.
  const stopLines = scanStopTimes(text['stop_times.txt'], trips);
  for (const trip of trips.values()) trip.stops.sort((a, b) => a[0] - b[0]);

  // Platforms roll up to their parent station so each station appears once.
  const stops = new Map();
  for (const s of readCsv(text['stops.txt'])) stops.set(s.stop_id, s);
  const stationOf = (stopId) => {
    const platform = stops.get(stopId);
    return platform && (stops.get(platform.parent_station) || platform);
  };
  const stations = new Map();
  for (const [stopId, lines] of stopLines) {
    const station = stationOf(stopId);
    if (!station) continue;
    let entry = stations.get(station.stop_id);
    if (!entry) {
      entry = { name: station.stop_name, lat: round(+station.stop_lat), lon: round(+station.stop_lon), lines: new Set() };
      stations.set(station.stop_id, entry);
    }
    for (const l of lines) entry.lines.add(l);
  }
  const stopInfo = new Map();
  for (const stopId of stopLines.keys()) {
    const s = stops.get(stopId);
    if (s) stopInfo.set(stopId, { name: stationOf(stopId).stop_name, lat: +s.stop_lat, lon: +s.stop_lon });
  }

  // Per line and direction_id: a name ("toward <most common headsign>",
  // falling back to the last stop) and the most-used shape, which serves as
  // the common yardstick for ordering trains along the line.
  const directions = {};
  const refShapes = new Map();
  const tally = new Map();
  for (const trip of trips.values()) {
    const key = `${trip.line}|${trip.directionId}`;
    let t = tally.get(key);
    if (!t) tally.set(key, (t = { headsigns: new Map(), shapes: new Map(), lastStop: trip.stops.at(-1)?.[1] }));
    const bump = (m, k) => m.set(k, (m.get(k) || 0) + 1);
    if (trip.headsign) bump(t.headsigns, trip.headsign);
    bump(t.shapes, trip.shapeId);
  }
  const top = (m) => [...m].sort((a, b) => b[1] - a[1])[0]?.[0];
  for (const [key, t] of [...tally].sort()) {
    const [line, dir] = key.split('|');
    (directions[line] ??= {})[dir] = top(t.headsigns) || stopInfo.get(t.lastStop)?.name || `Direction ${dir}`;
    refShapes.set(key, top(t.shapes));
  }

  return {
    link: {
      stations: [...stations.values()]
        .map((s) => ({ ...s, lines: LINES.filter((l) => s.lines.has(l)) }))
        .sort((a, b) => b.lat - a.lat),
      routes: routesOut.sort((a, b) => LINES.indexOf(a.line) - LINES.indexOf(b.line)),
      // { "1 Line": { "0": "<headsign>", "1": "<headsign>" }, ... }
      directions,
    },
    refShapes,
    routeLine: new Map([...routes].map(([id, r]) => [id, r.line])),
    trips,
    shapes,
    stopInfo,
    calendar: readCalendar(text['calendar.txt'], text['calendar_dates.txt']),
    patternDists: new Map(), // memo for stopDistances
  };
}

// Distance of each of a trip's stops along its shape. Trips that share a
// shape and stop list share the result.
export function stopDistances(model, trip) {
  const key = `${trip.shapeId}|${trip.stops.map((s) => s[1]).join(',')}`;
  let dists = model.patternDists.get(key);
  if (!dists) {
    const { coordinates, cum } = model.shapes.get(trip.shapeId);
    let seg = 0;
    dists = trip.stops.map(([, stopId]) => {
      const info = model.stopInfo.get(stopId);
      // Search forward only, so stops stay in order along the shape.
      const hit = project(coordinates, cum, [info.lat, info.lon], seg);
      seg = hit.seg;
      return hit.dist;
    });
    model.patternDists.set(key, dists);
  }
  return dists;
}

// ---- Service days ----------------------------------------------------------
// GTFS times count from "noon minus 12 hours" on the service date in the
// agency's time zone, which is midnight except on daylight-saving change days.

const TZ = 'America/Los_Angeles';
const tzParts = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short',
});

function partsAt(epochMs) {
  return Object.fromEntries(tzParts.formatToParts(epochMs).map((x) => [x.type, x.value]));
}

function tzOffsetMs(epochMs) {
  const p = partsAt(epochMs);
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(epochMs / 1000) * 1000;
}

// Local calendar date (YYYYMMDD) and weekday in Seattle at an epoch second.
export function localDate(epochS) {
  const p = partsAt(epochS * 1000);
  return { ymd: `${p.year}${p.month}${p.day}`, weekday: p.weekday.toLowerCase() };
}

// Epoch second that a service date's GTFS times count from.
export function serviceDayStart(ymd) {
  // Wall-clock noon read as if it were UTC, then shifted by the zone offset.
  const wall = Date.UTC(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8), 12);
  const noon = wall - tzOffsetMs(wall - tzOffsetMs(wall));
  return noon / 1000 - 12 * 3600;
}

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

function readCalendar(calendarCsv, datesCsv) {
  const weekly = new Map();
  for (const c of readCsv(calendarCsv)) weekly.set(c.service_id, c);
  const exceptions = new Map(); // `${service_id}|${date}` => '1' added / '2' removed
  for (const d of readCsv(datesCsv)) exceptions.set(`${d.service_id}|${d.date}`, d.exception_type);
  return { weekly, exceptions };
}

export function serviceRuns(calendar, serviceId, ymd) {
  const ex = calendar.exceptions.get(`${serviceId}|${ymd}`);
  if (ex === '1') return true;
  if (ex === '2') return false;
  const c = calendar.weekly.get(serviceId);
  if (!c || ymd < c.start_date || ymd > c.end_date) return false;
  const day = new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8))).getUTCDay();
  return c[WEEKDAYS[day]] === '1';
}

// ---- CSV -------------------------------------------------------------------

function scanStopTimes(csv, trips) {
  const lines = csv.split(/\r?\n/);
  const header = splitRow(lines[0].replace(/^﻿/, ''));
  const col = (name) => header.indexOf(name);
  const [tripCol, stopCol, seqCol, arrCol, depCol] = ['trip_id', 'stop_id', 'stop_sequence', 'arrival_time', 'departure_time'].map(col);
  const out = new Map(); // stop_id => Set of lines
  for (let i = 1; i < lines.length; i++) {
    const row = lines[i];
    if (!row) continue;
    const cells = row.includes('"') ? splitRow(row) : row.split(',');
    const trip = trips.get(cells[tripCol]);
    if (!trip) continue;
    const stopId = cells[stopCol];
    const arr = gtfsSeconds(cells[arrCol] || cells[depCol]);
    const dep = gtfsSeconds(cells[depCol] || cells[arrCol]);
    trip.stops.push([+cells[seqCol], stopId, arr, dep]);
    let set = out.get(stopId);
    if (!set) out.set(stopId, (set = new Set()));
    set.add(trip.line);
  }
  return out;
}

// "25:13:00" -> seconds after the start of the service day (may exceed 24 h).
function gtfsSeconds(hms) {
  const [h, m, s] = hms.split(':');
  return +h * 3600 + +m * 60 + +s;
}

// ~1 m precision is plenty for a map and keeps the payload small.
const round = (n) => Math.round(n * 1e5) / 1e5;

function* readCsv(csv) {
  const lines = csv.replace(/^﻿/, '').split(/\r?\n/);
  const header = splitRow(lines[0]).map((h) => h.trim());
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const cells = splitRow(lines[i]);
    const row = {};
    header.forEach((h, j) => (row[h] = cells[j] ?? ''));
    yield row;
  }
}

// Splits one CSV row, honoring double-quoted fields.
function splitRow(row) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < row.length; i++) {
    const c = row[i];
    if (quoted) {
      if (c === '"' && row[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}
