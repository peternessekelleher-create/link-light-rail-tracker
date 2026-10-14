// Track polylines, one per line, colored with the GTFS route_color.
import { view } from '../lib/view.js';

const OFF_OPACITY = 0.25; // a line switched off fades instead of disappearing

// The 1 Line and 2 Line share track from Lynnwood to Int'l Dist/Chinatown.
// The API orients both lines north-to-south, so opposite pixel offsets show
// the shared section side by side instead of one color hiding the other.
const OFFSET = { '1 Line': -2.5, '2 Line': 2.5 };

export default {
  add(map, data) {
    map.addSource('link-routes', {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: data.routes.map((r) => ({
          type: 'Feature',
          properties: { line: r.line, color: r.color, offset: OFFSET[r.line] ?? 0 },
          geometry: { type: 'LineString', coordinates: r.coordinates.map(([lat, lon]) => [lon, lat]) },
        })),
      },
    });

    // A dark casing keeps the colors readable over bright satellite imagery.
    map.addLayer({
      id: 'link-routes-casing',
      type: 'line',
      source: 'link-routes',
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': 'rgba(0,0,0,0.55)',
        'line-width': ['interpolate', ['linear'], ['zoom'], 9, 5, 15, 9],
        'line-offset': ['get', 'offset'],
      },
    });
    map.addLayer({
      id: 'link-routes',
      type: 'line',
      source: 'link-routes',
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': ['get', 'color'],
        'line-width': ['interpolate', ['linear'], ['zoom'], 9, 3, 15, 6],
        'line-offset': ['get', 'offset'],
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
