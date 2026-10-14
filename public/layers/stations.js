// Station markers with name labels; click a station for a popup.

const SHARED_COLOR = '#1C2630';

const escapeHtml = (s) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

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
            ring: s.lines.length === 1 ? data.colors[s.lines[0]] : SHARED_COLOR,
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
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 4, 15, 8],
        'circle-color': '#ffffff',
        'circle-stroke-color': ['get', 'ring'],
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
        'text-halo-color': 'rgba(0,0,0,0.85)',
        'text-halo-width': 1.6,
      },
    });

    const popup = new mapboxgl.Popup({ closeButton: true, offset: 10 });
    for (const id of ['link-stations', 'link-station-labels']) {
      map.on('click', id, (e) => {
        const f = e.features[0];
        const chips = f.properties.lines
          .split('|')
          .map((l) => `<span class="chip" style="background:${data.colors[l]}">${escapeHtml(l)}</span>`)
          .join('');
        popup
          .setLngLat(f.geometry.coordinates)
          .setHTML(`<div class="popup-name">${escapeHtml(f.properties.name)}</div><div class="popup-lines">${chips}</div>`)
          .addTo(map);
      });
      map.on('mouseenter', id, () => (map.getCanvas().style.cursor = 'pointer'));
      map.on('mouseleave', id, () => (map.getCanvas().style.cursor = ''));
    }
  },
};
