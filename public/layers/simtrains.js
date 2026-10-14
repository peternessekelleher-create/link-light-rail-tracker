// Simulated future trains on Ballard Link and West Seattle Link (full
// build-out), from data/simulated_trains.json:
//   - trains enter and leave at SODO and run to Ballard or Alaska Junction,
//     straight between stations along the approximate alignment;
//   - one leaves each end every 1 Line headway for the window picked in the
//     time picker; speed is the 1 Line's average scheduled speed between
//     stations, with a dwell at every station;
//   - each marker fills to its segment's estimated load (data/crowding.json);
//   - markers look like the live 1 Line trains (circle, white outline,
//     rotating arrow) in the project's color, with a small "SIM" tag;
//   - on Phase 2 (Seattle Center to Ballard, unfunded) trains are drawn at
//     50% and tagged "SIM · unfunded".
// Positions are a pure function of the clock, so every viewer sees the same
// trains. The ST3 switch hides all of it.
import { getJson } from '../lib/data.js';
import { reachView } from '../lib/reach.js';
import { st3 } from '../lib/st3.js';
import { addSimTrainIcons } from '../lib/trainicons.js';
import { fillLevel, levelOf, loadText } from '../lib/crowding.js';

const TICK_MS = 250;
const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const PHASE2_OPACITY = 0.5;
const OPACITY = 1;
const EMPTY = { type: 'FeatureCollection', features: [] };

export const loadSimulated = () => getJson('/data/simulated_trains.json');

// Timeline for one direction: [{ start, end, from, to, seg, dwell }]
function timeline(line, reverse, dwell) {
  const stations = reverse ? [...line.stations].reverse() : line.stations;
  const segs = reverse ? [...line.segments].reverse() : line.segments;
  const out = [];
  let t = 0;
  for (let i = 0; i < segs.length; i++) {
    const bearing = bearingOf(stations[i], stations[i + 1]);
    out.push({ start: t, end: t + segs[i].run_s, from: stations[i], to: stations[i + 1], seg: segs[i], bearing });
    t += segs[i].run_s;
    if (i < segs.length - 1) {
      out.push({ start: t, end: t + dwell, from: stations[i + 1], to: stations[i + 1], seg: segs[i], dwell: true, bearing });
      t += dwell;
    }
  }
  return { parts: out, total: t, stations };
}

// Degrees clockwise from north, from station a to station b.
function bearingOf(a, b) {
  const k = Math.cos((a.lat * Math.PI) / 180);
  return (Math.atan2((b.lon - a.lon) * k, b.lat - a.lat) * 180) / Math.PI;
}

// Every train on the line at time `now` (epoch seconds) for one direction.
function trainsAt(tl, headwayS, now, phaseOffset) {
  const out = [];
  if (!headwayS) return out;
  // Departures at k * headway + offset; a train is on the line for `total` s.
  const first = Math.ceil((now - tl.total - phaseOffset) / headwayS);
  for (let k = first; k * headwayS + phaseOffset <= now; k++) {
    const e = now - (k * headwayS + phaseOffset);
    const part = tl.parts.find((p) => e >= p.start && e < p.end);
    if (!part) continue;
    const f = part.dwell ? 0 : (e - part.start) / (part.end - part.start);
    out.push({ k, part, lon: part.from.lon + (part.to.lon - part.from.lon) * f, lat: part.from.lat + (part.to.lat - part.from.lat) * f, bearing: part.bearing });
  }
  return out;
}

export default function simTrainsLayer(sim, crowding, meta, currentWindow) {
  return {
    add(map) {
      addSimTrainIcons(map, sim.lines);
      map.addSource('sim-trains', { type: 'geojson', data: EMPTY });
      map.addLayer({
        id: 'sim-trains',
        type: 'symbol',
        source: 'sim-trains',
        layout: { 'icon-image': ['get', 'icon'], 'icon-allow-overlap': true, 'icon-ignore-placement': true, 'icon-size': ['interpolate', ['linear'], ['zoom'], 9, 0.75, 14, 1.1] },
        paint: { 'icon-opacity': ['get', 'opacity'] },
      });
      map.addLayer({
        id: 'sim-train-arrows',
        type: 'symbol',
        source: 'sim-trains',
        layout: {
          'icon-image': 'train-arrow',
          'icon-rotate': ['get', 'bearing'],
          'icon-rotation-alignment': 'map',
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
          'icon-size': ['interpolate', ['linear'], ['zoom'], 9, 0.75, 14, 1.1],
        },
        paint: { 'icon-opacity': ['get', 'opacity'] },
      });
      map.addLayer({
        id: 'sim-train-tags',
        type: 'symbol',
        source: 'sim-trains',
        minzoom: 10.5,
        layout: {
          'text-field': ['get', 'tag'],
          'text-font': ['DIN Pro Bold', 'Arial Unicode MS Bold'],
          'text-size': 10,
          'text-anchor': 'left',
          'text-offset': [1.1, 0],
          'text-allow-overlap': false,
        },
        paint: { 'text-color': '#ffffff', 'text-halo-color': 'rgba(0,0,0,0.95)', 'text-halo-width': 1.8, 'text-opacity': ['get', 'opacity'] },
      });

      const lines = sim.lines.map((l) => ({
        ...l,
        crowd: crowding?.lines[l.name]?.directions,
        dirs: [
          { key: '0', tl: timeline(l, false, sim.metadata.dwell_s) },
          { key: '1', tl: timeline(l, true, sim.metadata.dwell_s) },
        ],
      }));

      let timer = null;
      const tick = () => {
        const wid = reachView.window || currentWindow();
        const h = sim.headway_min[wid];
        const headwayS = h ? h * 60 : 0;
        const now = Date.now() / 1000;
        const features = [];
        for (const l of lines) {
          for (const [i, d] of l.dirs.entries()) {
            // The two directions are offset by half a headway.
            for (const tr of trainsAt(d.tl, headwayS, now, (i * headwayS) / 2)) {
              const seg = l.crowd?.[d.key]?.segments.find((s) => s.from === tr.part.from.id && s.to === tr.part.to.id)
                || l.crowd?.[d.key]?.segments.find((s) => s.to === tr.part.from.id);
              const pct = seg?.load_pct[wid];
              const load = pct == null ? null : { pct, label: levelOf(crowding, pct).label };
              const phase2 = tr.part.seg.phase === 2;
              features.push({
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [tr.lon, tr.lat] },
                properties: {
                  id: `${l.id}:${d.key}:${tr.k}`,
                  line: l.name,
                  toward: d.tl.stations.at(-1).name,
                  icon: `sim:${l.id}:${fillLevel(load)}`,
                  bearing: tr.bearing,
                  opacity: phase2 ? PHASE2_OPACITY : OPACITY,
                  tag: phase2 ? 'SIM · unfunded' : 'SIM',
                  load: load ? loadText(load) : '',
                },
              });
            }
          }
        }
        map.getSource('sim-trains').setData({ type: 'FeatureCollection', features });
      };

      const run = () => {
        const on = st3.master && !document.hidden;
        for (const id of ['sim-trains', 'sim-train-arrows', 'sim-train-tags']) map.setLayoutProperty(id, 'visibility', st3.master ? 'visible' : 'none');
        if (on && !timer) {
          tick();
          timer = setInterval(tick, TICK_MS);
        } else if (!on && timer) {
          clearInterval(timer);
          timer = null;
        }
      };
      st3.subscribe(run);
      reachView.subscribe(() => timer && tick());
      document.addEventListener('visibilitychange', run);

      // Hover: "Simulated Ballard Link train · Est. 45% full · Some standing".
      const tip = new mapboxgl.Popup({ closeButton: false, closeOnClick: false, offset: 12, className: 'tip' });
      map.on('mousemove', 'sim-trains', (e) => {
        const p = e.features[0].properties;
        map.getCanvas().style.cursor = 'pointer';
        tip.setLngLat(e.features[0].geometry.coordinates)
          .setHTML(`<strong>Simulated ${escapeHtml(p.line)} train</strong> · toward ${escapeHtml(p.toward)}${p.load ? `<br>${escapeHtml(p.load)}` : ''}<div class="note">${escapeHtml(meta.note)}</div>`)
          .addTo(map);
      });
      map.on('mouseleave', 'sim-trains', () => {
        map.getCanvas().style.cursor = '';
        tip.remove();
      });
    },
  };
}
