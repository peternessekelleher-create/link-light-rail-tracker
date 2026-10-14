// Bus reach on the map: hover a station (tap on touch screens) to draw the
// bus segments you can ride within 15 and 30 minutes, dots on the stops you
// can reach, and the farthest stop on each route in each band.
//
// Also owns the invisible hit areas over every station (Link and ST3) and the
// highlight for a route hovered in the station card.
import { REACH_COLORS } from '../config.js';
import { reachView, loadReach, windowFeatures } from '../lib/reach.js';
import { st3 } from '../lib/st3.js';
import { view } from '../lib/view.js';
import { loadRoutes } from '../lib/data.js';

const EMPTY = { type: 'FeatureCollection', features: [] };
const LINE_W = 3;
const CASING_W = LINE_W + 2; // 1 px white outline each side
const DASH = [2, 1.5]; // in line widths
// Mapbox measures dashes in line widths, so the casing's pattern is scaled to
// line up with the colored line's.
const CASING_DASH = DASH.map((d) => (d * LINE_W) / CASING_W);
const bandColor = ['match', ['get', 'band'], 15, REACH_COLORS[15], REACH_COLORS[30]];

export default function reachLayer(stations, { onSelect, onStatus }) {
  return {
    add(map) {
      // Drawn over the Link tracks, under the station markers.
      const below = map.getLayer('link-stations') ? 'link-stations' : undefined;
      for (const id of ['reach-segments', 'reach-stops', 'reach-labels', 'route-highlight']) map.addSource(id, { type: 'geojson', data: EMPTY });

      map.addLayer({ id: 'route-highlight-casing', type: 'line', source: 'route-highlight', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#ffffff', 'line-width': 7 } }, below);
      map.addLayer({ id: 'route-highlight', type: 'line', source: 'route-highlight', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#0f1318', 'line-width': 3 } }, below);

      // 30-minute band first so the 15-minute band draws on top.
      const sortKey = ['-', 0, ['get', 'band']];
      const solid = ['==', ['get', 'transfer'], 0];
      const dashed = ['==', ['get', 'transfer'], 1];
      map.addLayer({ id: 'reach-casing', type: 'line', source: 'reach-segments', filter: solid, layout: { 'line-join': 'round', 'line-cap': 'round', 'line-sort-key': sortKey }, paint: { 'line-color': '#ffffff', 'line-width': CASING_W } }, below);
      map.addLayer({ id: 'reach-line', type: 'line', source: 'reach-segments', filter: solid, layout: { 'line-join': 'round', 'line-cap': 'round', 'line-sort-key': sortKey }, paint: { 'line-color': bandColor, 'line-width': LINE_W } }, below);
      map.addLayer({ id: 'reach-casing-transfer', type: 'line', source: 'reach-segments', filter: dashed, layout: { 'line-join': 'round', 'line-sort-key': sortKey }, paint: { 'line-color': '#ffffff', 'line-width': CASING_W, 'line-dasharray': CASING_DASH } }, 'reach-casing');
      map.addLayer({ id: 'reach-line-transfer', type: 'line', source: 'reach-segments', filter: dashed, layout: { 'line-join': 'round', 'line-sort-key': sortKey }, paint: { 'line-color': bandColor, 'line-width': LINE_W, 'line-dasharray': DASH } }, 'reach-casing');
      map.addLayer({
        id: 'reach-stops',
        type: 'circle',
        source: 'reach-stops',
        paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 2, 15, 3.5], 'circle-color': bandColor, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1 },
      }, below);
      map.addLayer({
        id: 'reach-labels',
        type: 'symbol',
        source: 'reach-labels',
        layout: {
          'text-field': ['get', 'label'],
          'text-font': ['DIN Pro Medium', 'Arial Unicode MS Regular'],
          'text-size': 12,
          'text-anchor': 'left',
          'text-offset': [0.7, 0],
          'text-max-width': 18,
          // Farther stops win label collisions.
          'symbol-sort-key': ['-', 0, ['get', 'minutes']],
        },
        paint: { 'text-color': '#ffffff', 'text-halo-color': 'rgba(0,0,0,0.95)', 'text-halo-width': 2 },
      });

      // Hit areas: generous invisible circles over every station.
      map.addSource('station-hit', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: stations.map((s) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [s.lon, s.lat] }, properties: { id: s.id, kind: s.kind } })) },
      });
      map.addLayer({ id: 'station-hit', type: 'circle', source: 'station-hit', paint: { 'circle-radius': 14, 'circle-color': '#000000', 'circle-opacity': 0 } });

      const shown = () => [...(view.live ? ['link'] : []), ...(st3.master ? ['st3'] : [])];
      const visible = (id) => shown().includes(stations.find((s) => s.id === id)?.kind);
      const refreshHit = () => map.setFilter('station-hit', ['in', ['get', 'kind'], ['literal', shown()]]);
      // A group switched off takes its stations' reach and card with it.
      const prune = () => {
        if (reachView.hover && !visible(reachView.hover)) reachView.update((v) => (v.hover = null));
        if (reachView.selected && !visible(reachView.selected)) onSelect(null);
      };
      view.subscribe(() => (refreshHit(), prune()));
      st3.subscribe(() => (refreshHit(), prune()));

      // Hover (mouse only: touch screens get a click, which selects).
      let hovered = null;
      map.on('mousemove', 'station-hit', (e) => {
        map.getCanvas().style.cursor = 'pointer';
        const id = e.features[0].properties.id;
        if (id !== hovered) reachView.update((v) => (v.hover = hovered = id));
      });
      map.on('mouseleave', 'station-hit', () => {
        map.getCanvas().style.cursor = '';
        hovered = null;
        reachView.update((v) => (v.hover = null));
      });
      map.on('click', 'station-hit', (e) => onSelect(e.features[0].properties.id));

      // Draw whatever is active in the picked window. A newer request
      // supersedes an older one still loading.
      let drawn = '';
      let token = 0;
      reachView.subscribe(async (v) => {
        const id = v.active();
        const key = `${id}|${v.window}`;
        if (key === drawn) return;
        drawn = key;
        const mine = ++token;
        if (!id || !v.window) return draw(map, null), onStatus(null);
        onStatus({ id, loading: true });
        try {
          const doc = await loadReach(id);
          if (mine !== token) return;
          const f = windowFeatures(doc, v.window);
          draw(map, f);
          onStatus({ id, summary: f.summary });
        } catch (err) {
          if (mine !== token) return;
          console.error(err);
          draw(map, null);
          onStatus({ id, error: true });
        }
      });
    },

    // Outline one whole route (hovered in the station card), or none.
    async highlightRoute(map, routeId) {
      if (!routeId) return map.getSource('route-highlight').setData(EMPTY);
      const routes = await loadRoutes();
      const f = routes.features.find((x) => x.properties.route_id === routeId);
      map.getSource('route-highlight').setData(f ? { type: 'FeatureCollection', features: [f] } : EMPTY);
    },
  };
}

function draw(map, f) {
  map.getSource('reach-segments').setData(f ? f.segments : EMPTY);
  map.getSource('reach-stops').setData(f ? f.stops : EMPTY);
  map.getSource('reach-labels').setData(f ? f.labels : EMPTY);
}
