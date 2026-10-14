// ST3 future network on the map: a dashed approximate alignment through the
// preferred stations, hollow station markers, and labels with each station's
// target opening. One switch (st3.master) hides all of it.
// With SHOW_ALTERNATIVES on, the other options are drawn too, smaller, with
// their location-accuracy circles.
import { SHOW_ALTERNATIVES } from '../config.js';
import { st3 } from '../lib/st3.js';

const feature = (geometry, properties) => ({ type: 'Feature', geometry, properties });
const fc = (features) => ({ type: 'FeatureCollection', features });
const point = (s) => ({ type: 'Point', coordinates: [s.lon, s.lat] });

// A circle of radius r metres as a polygon.
function circle(lon, lat, r, steps = 48) {
  const dLat = r / 111132;
  const dLon = r / (111320 * Math.cos((lat * Math.PI) / 180));
  const ring = [];
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * 2 * Math.PI;
    ring.push([lon + dLon * Math.cos(t), lat + dLat * Math.sin(t)]);
  }
  return { type: 'Polygon', coordinates: [ring] };
}

// Every ST3 map layer, for the master switch.
export const ST3_LAYERS = [
  'st3-alignment-casing', 'st3-alignment', 'st3-marker-halo', 'st3-markers', 'st3-labels',
  'st3-alt-circles', 'st3-alt-markers', 'st3-alt-labels',
];

export default function st3Layer(model) {
  return {
    add(map) {
      // Alignment segments; a segment touching a Phase 2 station is Phase 2.
      const lines = [];
      for (const p of model.projects) {
        const pts = p.alignment;
        for (let i = 1; i < pts.length; i++) {
          const phase = Math.max(pts[i - 1].phase, pts[i].phase);
          const last = lines.at(-1);
          const at = [pts[i].lon, pts[i].lat];
          if (last && last.properties.project === p.id && last.properties.phase === phase) last.geometry.coordinates.push(at);
          else lines.push(feature({ type: 'LineString', coordinates: [[pts[i - 1].lon, pts[i - 1].lat], at] }, { project: p.id, color: p.color, phase }));
        }
      }
      map.addSource('st3-alignment', { type: 'geojson', data: fc(lines) });
      map.addSource('st3-stations', {
        type: 'geojson',
        data: fc(model.stations.map((s) => feature(point(s), { id: s.id, name: s.name, opening: s.opening, color: s.color, phase: s.phase }))),
      });

      // Alignment under the live Link tracks; markers on top of everything.
      const below = map.getLayer('link-routes-casing') ? 'link-routes-casing' : undefined;
      map.addLayer(
        {
          id: 'st3-alignment-casing',
          type: 'line',
          source: 'st3-alignment',
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: { 'line-color': 'rgba(0,0,0,0.85)', 'line-width': ['interpolate', ['linear'], ['zoom'], 9, 6, 15, 10] },
        },
        below,
      );
      map.addLayer(
        {
          id: 'st3-alignment',
          type: 'line',
          source: 'st3-alignment',
          layout: { 'line-join': 'round' },
          paint: {
            'line-color': ['get', 'color'],
            'line-width': ['interpolate', ['linear'], ['zoom'], 9, 3.5, 15, 6.5],
            'line-dasharray': [2, 1.4],
            'line-opacity': ['case', ['==', ['get', 'phase'], 2], 0.55, 1],
          },
        },
        below,
      );

      if (SHOW_ALTERNATIVES) addAlternatives(map, model);

      // Hollow markers: a dark disk ringed in the project color, with a black
      // halo so the ring reads over bright imagery.
      // (Mapbox only allows zoom at the top of an expression, so the halo has
      // its own stops: the marker radius plus stroke plus 1 px.)
      const radius = ['interpolate', ['linear'], ['zoom'], 9, 5, 15, 9];
      map.addLayer({
        id: 'st3-marker-halo',
        type: 'circle',
        source: 'st3-stations',
        paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 8.5, 15, 13.5], 'circle-color': 'rgba(0,0,0,0.85)' },
      });
      map.addLayer({
        id: 'st3-markers',
        type: 'circle',
        source: 'st3-stations',
        paint: {
          'circle-radius': radius,
          'circle-color': 'rgba(15,19,24,0.9)',
          'circle-stroke-color': ['get', 'color'],
          'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 9, 2.5, 15, 3.5],
        },
      });
      map.addLayer({
        id: 'st3-labels',
        type: 'symbol',
        source: 'st3-stations',
        minzoom: 11,
        layout: {
          'text-field': ['format', ['get', 'name'], {}, '\n', {}, ['get', 'opening'], { 'font-scale': 0.8 }],
          'text-font': ['DIN Pro Medium', 'Arial Unicode MS Regular'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 11, 12, 15, 14],
          'text-variable-anchor': ['right', 'left', 'top', 'bottom'],
          'text-radial-offset': 1.1,
          'text-justify': 'auto',
          'text-max-width': 14,
        },
        paint: { 'text-color': '#ffffff', 'text-halo-color': 'rgba(0,0,0,0.95)', 'text-halo-width': 2.4 },
      });

      st3.subscribe((s) => {
        for (const id of ST3_LAYERS) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', s.master ? 'visible' : 'none');
      });
    },
  };
}

function addAlternatives(map, model) {
  const alts = model.alternatives;
  map.addSource('st3-alts', { type: 'geojson', data: fc(alts.map((a) => feature(point(a), { id: a.id, label: a.option, color: a.color }))) });
  map.addSource('st3-alt-circles', { type: 'geojson', data: fc(alts.map((a) => feature(circle(a.lon, a.lat, a.confidence_m), { color: a.color }))) });
  map.addLayer({ id: 'st3-alt-circles', type: 'fill', source: 'st3-alt-circles', paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.14, 'fill-outline-color': ['get', 'color'] } });
  map.addLayer({
    id: 'st3-alt-markers',
    type: 'circle',
    source: 'st3-alts',
    paint: { 'circle-radius': 4, 'circle-color': 'rgba(15,19,24,0.9)', 'circle-stroke-color': ['get', 'color'], 'circle-stroke-width': 2, 'circle-opacity': 0.9 },
  });
  map.addLayer({
    id: 'st3-alt-labels',
    type: 'symbol',
    source: 'st3-alts',
    minzoom: 14,
    layout: { 'text-field': ['get', 'label'], 'text-font': ['DIN Pro Medium', 'Arial Unicode MS Regular'], 'text-size': 11, 'text-anchor': 'top', 'text-offset': [0, 0.8], 'text-max-width': 12 },
    paint: { 'text-color': '#c9d1d9', 'text-halo-color': 'rgba(0,0,0,0.95)', 'text-halo-width': 2 },
  });
}
