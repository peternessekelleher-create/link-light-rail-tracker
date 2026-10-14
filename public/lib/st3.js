// ST3 future network: data model and shared toggle state.
//
// Everything comes from small files the weekly data build writes (see
// pipeline/): st3_network.json (tree structure, labels, roles),
// station_alternatives.geojson (points and attributes),
// st3_bus_connections.json and st3_bus_routes.geojson (King County Metro).
import { store } from './view.js';

const getJson = async (url) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} returned ${res.status}`);
  return res.json();
};

// Alternatives closer than this share a location (e.g. WSJ-3a and WSJ-5b).
const SAME_SPOT_M = 10;

const distM = (a, b) => {
  const dy = (a.lat - b.lat) * 111132;
  const dx = (a.lon - b.lon) * 111320 * Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot(dx, dy);
};

export async function loadSt3() {
  const [net, points, conn, routes] = await Promise.all([
    getJson('/data/st3_network.json'),
    getJson('/data/station_alternatives.geojson'),
    getJson('/data/st3_bus_connections.json'),
    getJson('/data/st3_bus_routes.geojson'),
  ]);
  const props = new Map(points.features.filter((f) => f.properties.project).map((f) => [f.properties.id, f.properties]));

  const projects = [];
  const stations = new Map();
  const alts = new Map();
  for (const p of net.projects) {
    const project = { ...p, stations: [] };
    for (const s of p.stations) {
      const station = { ...s, project, alts: [] };
      for (const a of s.alternatives) {
        const alt = { ...a, short: a.short || a.label, station, project, props: props.get(a.id), ox: 0, sameSpot: null };
        if (!alt.props) throw new Error(`${a.id} missing from station_alternatives.geojson`);
        station.alts.push(alt);
        alts.set(a.id, alt);
      }
      station.multi = station.alts.length > 1;
      project.stations.push(station);
      stations.set(s.id, station);
    }
    projects.push(project);
  }

  // Alternatives at the same point get side-by-side marker offsets.
  for (const station of stations.values()) {
    const placed = [];
    for (const a of station.alts) {
      const twin = placed.find((b) => distM(a.props, b.props) < SAME_SPOT_M);
      if (twin) {
        twin.ox = -1;
        a.ox = 1;
        twin.sameSpot = a;
        a.sameSpot = twin;
      }
      placed.push(a);
    }
  }

  const routeOrder = new Map(routes.features.map((f, i) => [f.properties.route_id, i]));
  const routeById = new Map(routes.features.map((f) => [f.properties.route_id, f]));
  const connections = conn.stations; // station -> alt -> [{route_id, number, stop_name, distance_m}]

  return {
    projects,
    stations,
    alts,
    routes,
    routeById,
    meta: conn.metadata,
    // Routes within the radius of one alternative, nearest stop first.
    altRoutes: (altId) => connections[alts.get(altId).station.id]?.[altId] || [],
    // Which of a station's alternatives a route serves.
    servedBy(station, routeId) {
      return station.alts.filter((a) => (connections[station.id]?.[a.id] || []).some((r) => r.route_id === routeId));
    },
    // Union of routes across the station's checked alternatives, in route order.
    stationRoutes(station, state) {
      const ids = new Set();
      for (const a of station.alts) {
        if (!state.alts[a.id]) continue;
        for (const r of connections[station.id]?.[a.id] || []) ids.add(r.route_id);
      }
      return [...ids].sort((x, y) => routeOrder.get(x) - routeOrder.get(y));
    },
  };
}

// What's switched on. The master switch hides everything without touching
// the children, so turning it back on restores each one's previous state.
export const st3 = store({
  master: true,
  projects: {}, // { ballard: true }
  alts: {}, // { "CID-DEARBORN": true }
  buses: {}, // { cid: false } — "Show Buses" per station
  hoverRoute: null,
  init(model) {
    for (const p of model.projects) {
      this.projects[p.id] = true;
      for (const s of p.stations) {
        this.buses[s.id] = false;
        for (const a of s.alts) this.alts[a.id] = a.role === 'selected';
      }
    }
  },
  projectOn(project) {
    return this.master && this.projects[project.id];
  },
  altShown(alt) {
    return this.projectOn(alt.project) && this.alts[alt.id];
  },
});
