// Station markers with name labels.

export default {
  add(map, data) {
    map.addSource('link-stations', {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: data.stations.map((s) => ({
          type: 'Feature',
          properties: {
            name: s.name,
            lines: s.lines.join('|'),
          },
          geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
        })),
      },
    });

    map.addLayer({
      id: 'link-stations',
      type: 'circle',
      source: 'link-stations',
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 4.5, 15, 8.5],
        'circle-color': '#ffffff',
        'circle-stroke-color': '#0b0e12',
        'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 9, 2, 15, 3],
      },
    });

    map.addLayer({
      id: 'link-station-labels',
      type: 'symbol',
      source: 'link-stations',
      layout: {
        'text-field': ['get', 'name'],
        'text-font': ['DIN Pro Medium', 'Arial Unicode MS Regular'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 9, 11, 15, 14],
        'text-variable-anchor': ['left', 'right', 'top', 'bottom'],
        'text-radial-offset': 0.9,
      },
      paint: {
        'text-color': '#ffffff',
        'text-halo-color': 'rgba(0,0,0,0.95)',
        'text-halo-width': 2.4,
      },
    });
    // Clicking a station opens its card (ui/stationcard.js via layers/reach.js).
  },
};
