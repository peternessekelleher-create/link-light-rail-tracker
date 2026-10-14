// Track polylines, one per line, colored with the GTFS route_color.
import { view } from '../lib/view.js';

const OFF_OPACITY = 0.25; // a line switched off fades instead of disappearing

// The 1 Line and 2 Line share track from Lynnwood to Int'l Dist/Chinatown.
// The API orients both lines north-to-south, so opposite pixel offsets show
// the shared section side by side instead of one color hiding the other.
// Each line shifts half its width to its own side, so the offset grows with
// the line width as you zoom in.
const SIDE = { '1 Line': -1, '2 Line': 1 };
const offsetByZoom = ['interpolate', ['linear'], ['zoom'], 9, ['*', ['get', 'side'], 2.3], 15, ['*', ['get', 'side'], 4.3]];

export default {
  add(map, data) {
    map.addSource('link-routes', {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: data.routes.map((r) => ({
          type: 'Feature',
          properties: { line: r.line, color: r.color, side: SIDE[r.line] ?? 0 },
          geometry: { type: 'LineString', coordinates: r.coordinates.map(([lat, lon]) => [lon, lat]) },
        })),
      },
    });

    // A dark casing keeps the official colors readable over any imagery.
    map.addLayer({
      id: 'link-routes-casing',
      type: 'line',
      source: 'link-routes',
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': 'rgba(0,0,0,0.9)',
        'line-width': ['interpolate', ['linear'], ['zoom'], 9, 7.5, 15, 13],
        'line-offset': offsetByZoom,
      },
    });
    map.addLayer({
      id: 'link-routes',
      type: 'line',
      source: 'link-routes',
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': ['get', 'color'],
        'line-width': ['interpolate', ['linear'], ['zoom'], 9, 4.5, 15, 8.5],
        'line-offset': offsetByZoom,
      },
    });

    // Direction switches don't affect track: both directions share it.
    view.subscribe(() => {
      const off = Object.keys(view.lines).filter((l) => !view.lines[l]);
      const opacity = off.length ? ['case', ['in', ['get', 'line'], ['literal', off]], OFF_OPACITY, 1] : 1;
      map.setPaintProperty('link-routes', 'line-opacity', opacity);
      map.setPaintProperty('link-routes-casing', 'line-opacity', opacity);
    });
  },
};
