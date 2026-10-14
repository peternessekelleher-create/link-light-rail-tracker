// ST3 future network: data model and its one on/off switch.
//
// Stations are the preferred options (preferred = true in
// station_alternatives.geojson), as listed in data/connections.json by the
// weekly build. data/st3_network.json gives each project's color and the
// order the approximate alignment goes through. Other options are loaded only
// when SHOW_ALTERNATIVES is on.
import { SHOW_ALTERNATIVES } from '../config.js';
import { loadAlternatives, loadNetwork } from './data.js';
import { store } from './view.js';

export async function loadSt3(conn) {
  const net = await loadNetwork();
  const byId = new Map(conn.stations.filter((s) => s.kind === 'st3').map((s) => [s.id, s]));

  const projects = net.projects.map((p) => ({
    id: p.id,
    name: p.name,
    color: p.color,
    opening: p.opening,
    // Alignment through the preferred stations, in order, with each station's phase.
    alignment: p.alignment.map((sid) => byId.get(`st3-${sid}`)).filter(Boolean),
  }));
  const color = Object.fromEntries(projects.map((p) => [p.id, p.color]));
  const stations = [...byId.values()].map((s) => ({ ...s, color: color[s.project] }));

  let alternatives = [];
  if (SHOW_ALTERNATIVES) {
    const feats = (await loadAlternatives()).features;
    const project = Object.fromEntries(net.projects.flatMap((p) => p.stations.flatMap((s) => s.alternatives.map((a) => [a.id, p.id]))));
    alternatives = feats
      .filter((f) => f.properties.project && !f.properties.preferred)
      .map((f) => ({ ...f.properties, color: color[project[f.properties.id]] || '#9aa3ad' }));
  }
  return { projects, stations, alternatives, note: conn.metadata.note };
}

// The master switch for everything ST3.
export const st3 = store({ master: true });
