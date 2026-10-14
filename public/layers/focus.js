// Focus mode: while a station is hovered or pinned, everything unrelated
// fades (other stations and labels, lines, trains) and a black overlay
// darkens the basemap. The focused station keeps full strength, and so do
// its reach bands, walk sheds, stops and labels (they belong to it).
//
// Also sets the one layer order for the whole map, bottom to top:
//   basemap -> darkening overlay -> 10-min shed -> 5-min shed -> red bands
//   -> Link lines -> stations -> trains -> labels
import { DIM, focus } from '../lib/focus.js';

const WORLD = { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]]] } };

// Bottom to top. Layers that don't exist (a group failed to load, or
// SHOW_ALTERNATIVES is off) are skipped.
export const LAYER_ORDER = [
  'focus-dim',
  'walk-10', 'walk-5',
  'route-highlight-casing', 'route-highlight',
  'reach-casing-transfer', 'reach-line-transfer', 'reach-casing', 'reach-line',
  'st3-alt-circles',
  'st3-alignment-casing', 'st3-alignment',
  'link-routes-casing', 'link-routes',
  'reach-stops',
  'link-stations', 'st3-marker-halo', 'st3-markers', 'st3-alt-markers',
  'link-gaps', 'link-ghosts', 'sim-trains', 'link-trains', 'link-train-arrows',
  'link-station-labels', 'st3-labels', 'st3-alt-labels', 'reach-labels', 'sim-train-tags', 'link-train-tags',
  'station-hit',
];

// What fades, and how. `station` dims everything except features whose
// property `key` is the focused station's id; the others dim by a factor.
const FADES = [
  { id: 'link-stations', props: ['circle-opacity', 'circle-stroke-opacity'], station: 'sid', k: DIM.stations },
  { id: 'link-station-labels', props: ['text-opacity'], station: 'sid', k: DIM.stations },
  { id: 'st3-marker-halo', props: ['circle-opacity'], station: 'id', k: DIM.stations },
  { id: 'st3-markers', props: ['circle-opacity', 'circle-stroke-opacity'], station: 'id', k: DIM.stations },
  { id: 'st3-labels', props: ['text-opacity'], station: 'id', k: DIM.stations },
  { id: 'st3-alignment', props: ['line-opacity'], k: DIM.lines },
  { id: 'st3-alignment-casing', props: ['line-opacity'], k: DIM.lines },
  { id: 'link-gaps', props: ['line-opacity'], k: DIM.trains },
  { id: 'link-ghosts', props: ['icon-opacity'], k: DIM.trains },
  { id: 'link-trains', props: ['icon-opacity'], k: DIM.trains },
  { id: 'link-train-arrows', props: ['icon-opacity'], k: DIM.trains },
  { id: 'link-train-tags', props: ['text-opacity'], k: DIM.trains },
  { id: 'sim-trains', props: ['icon-opacity'], k: DIM.trains },
  { id: 'sim-train-tags', props: ['text-opacity'], k: DIM.trains },
];

export default function focusLayer(stations, linkStations) {
  return {
    add(map) {
      map.addSource('focus-dim', { type: 'geojson', data: WORLD });
      map.addLayer({
        id: 'focus-dim',
        type: 'fill',
        source: 'focus-dim',
        paint: { 'fill-color': '#000000', 'fill-opacity': 0, 'fill-opacity-transition': { duration: DIM.ms, delay: 0 } },
      });

      tagLinkStations(map, stations, linkStations);

      // Remember each layer's own opacity so dimming multiplies it.
      const base = new Map();
      for (const f of FADES) {
        if (!map.getLayer(f.id)) continue;
        for (const p of f.props) {
          base.set(`${f.id}|${p}`, map.getPaintProperty(f.id, p) ?? 1);
          map.setPaintProperty(f.id, `${p}-transition`, { duration: DIM.ms, delay: 0 });
        }
      }

      focus.subscribe(({ id }) => {
        map.setPaintProperty('focus-dim', 'fill-opacity', id ? DIM.overlay : 0);
        for (const f of FADES) {
          if (!map.getLayer(f.id)) continue;
          for (const p of f.props) {
            const b = base.get(`${f.id}|${p}`);
            const dimmed = ['*', b, f.k];
            const value = !id ? b : f.station ? ['case', ['==', ['get', f.station], id], b, dimmed] : dimmed;
            map.setPaintProperty(f.id, p, value);
          }
        }
      });
    },
  };
}

// Put every layer in LAYER_ORDER, above the basemap's own layers.
export function applyLayerOrder(map) {
  for (const id of LAYER_ORDER) if (map.getLayer(id)) map.moveLayer(id);
}

// The live Link station markers come from /api/link and carry only a name.
// Give each the matching station id from connections.json (nearest within
// 1,000 ft) so it can stay bright while focused.
function tagLinkStations(map, stations, linkStations) {
  const ids = stations.filter((s) => s.kind === 'link');
  const ft = (a, b) => Math.hypot((a.lat - b.lat) * 364605, (a.lon - b.lon) * 365223 * Math.cos((a.lat * Math.PI) / 180));
  const src = map.getSource('link-stations');
  if (!src) return;
  src.setData({
    type: 'FeatureCollection',
    features: linkStations.map((s) => {
      const near = ids.reduce((best, x) => (ft(s, x) < (best ? ft(s, best) : 1000) ? x : best), null);
      return {
        type: 'Feature',
        properties: { name: s.name, lines: s.lines.join('|'), sid: near?.id || '' },
        geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
      };
    }),
  });
}
