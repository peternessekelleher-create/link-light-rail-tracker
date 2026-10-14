// Fetches Sound Transit's GTFS feed and reduces it to the 1 Line and 2 Line
// stations and track geometry the map needs.
import { unzipSync, strFromU8 } from 'fflate';

// Official feed, listed on Sound Transit's Open Transit Data downloads page:
// https://www.soundtransit.org/help-contacts/business-information/open-transit-data-otd/otd-downloads
export const GTFS_URL = 'https://www.soundtransit.org/GTFS-rail/40_gtfs.zip';

// Matched on route_short_name (not route_id) so the filter survives route_id
// renumbering. route_type 0 = light rail; the T Line is also light rail, so
// the name check is what keeps it out.
export const LINES = ['1 Line', '2 Line'];

const NEEDED = new Set(['routes.txt', 'trips.txt', 'shapes.txt', 'stops.txt', 'stop_times.txt']);

export async function loadLinkData(url = GTFS_URL) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GTFS download failed: ${res.status} ${res.statusText}`);
  const zip = new Uint8Array(await res.arrayBuffer());
  const files = unzipSync(zip, { filter: (f) => NEEDED.has(f.name.split('/').pop()) });
  const text = {};
  for (const [name, bytes] of Object.entries(files)) text[name.split('/').pop()] = strFromU8(bytes);
  for (const name of NEEDED) if (!(name in text)) throw new Error(`GTFS zip is missing ${name}`);
  return buildLinkData(text);
}

export function buildLinkData(text) {
  // routes.txt -> route_id => { line, color }
  const routes = new Map();
  for (const r of readCsv(text['routes.txt'])) {
    if (r.route_type === '0' && LINES.includes(r.route_short_name)) {
      routes.set(r.route_id, { line: r.route_short_name, color: `#${(r.route_color || '').toUpperCase()}` });
    }
  }
  if (routes.size !== LINES.length) throw new Error(`Expected ${LINES.length} Link routes, found ${routes.size}`);

  // trips.txt -> trip_id => line, and trip counts per shape for each line
  const tripLine = new Map();
  const shapeTrips = new Map(LINES.map((l) => [l, new Map()]));
  for (const t of readCsv(text['trips.txt'])) {
    const route = routes.get(t.route_id);
    if (!route) continue;
    tripLine.set(t.trip_id, route.line);
    const counts = shapeTrips.get(route.line);
    counts.set(t.shape_id, (counts.get(t.shape_id) || 0) + 1);
  }

  // Each line has one full-length shape plus short-turn variants that run over
  // the same track. Drawing the most-used shape gives the whole line once.
  const mainShape = new Map();
  for (const [line, counts] of shapeTrips) {
    const [shapeId] = [...counts].sort((a, b) => b[1] - a[1])[0] || [];
    if (!shapeId) throw new Error(`No trips found for ${line}`);
    mainShape.set(shapeId, line);
  }

  const shapePts = new Map([...mainShape.keys()].map((id) => [id, []]));
  for (const s of readCsv(text['shapes.txt'])) {
    const pts = shapePts.get(s.shape_id);
    if (pts) pts.push([+s.shape_pt_sequence, round(+s.shape_pt_lat), round(+s.shape_pt_lon)]);
  }

  const routesOut = [];
  for (const [shapeId, line] of mainShape) {
    const coordinates = shapePts.get(shapeId).sort((a, b) => a[0] - b[0]).map(([, lat, lon]) => [lat, lon]);
    // Orient every line north-to-south so a fixed per-line offset on the map
    // always pushes shared track to opposite sides.
    if (coordinates.length && coordinates[0][0] < coordinates[coordinates.length - 1][0]) coordinates.reverse();
    const { color } = [...routes.values()].find((r) => r.line === line);
    routesOut.push({ line, color, coordinates });
  }

  // stop_times.txt is by far the largest file (~30 MB), so it gets a fast
  // line scan instead of the general CSV reader.
  const stopLines = scanStopTimes(text['stop_times.txt'], tripLine);

  // Platforms roll up to their parent station so each station appears once.
  const stops = new Map();
  for (const s of readCsv(text['stops.txt'])) stops.set(s.stop_id, s);
  const stations = new Map();
  for (const [stopId, lines] of stopLines) {
    const platform = stops.get(stopId);
    if (!platform) continue;
    const station = stops.get(platform.parent_station) || platform;
    let entry = stations.get(station.stop_id);
    if (!entry) {
      entry = { name: station.stop_name, lat: round(+station.stop_lat), lon: round(+station.stop_lon), lines: new Set() };
      stations.set(station.stop_id, entry);
    }
    for (const l of lines) entry.lines.add(l);
  }

  return {
    stations: [...stations.values()]
      .map((s) => ({ ...s, lines: LINES.filter((l) => s.lines.has(l)) }))
      .sort((a, b) => b.lat - a.lat),
    routes: routesOut.sort((a, b) => LINES.indexOf(a.line) - LINES.indexOf(b.line)),
  };
}

function scanStopTimes(csv, tripLine) {
  const lines = csv.split(/\r?\n/);
  const header = splitRow(lines[0]);
  const tripCol = header.indexOf('trip_id');
  const stopCol = header.indexOf('stop_id');
  const out = new Map();
  for (let i = 1; i < lines.length; i++) {
    const row = lines[i];
    if (!row) continue;
    const cells = row.includes('"') ? splitRow(row) : row.split(',');
    const line = tripLine.get(cells[tripCol]);
    if (!line) continue;
    let set = out.get(cells[stopCol]);
    if (!set) out.set(cells[stopCol], (set = new Set()));
    set.add(line);
  }
  return out;
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
