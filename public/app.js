import routesLayer from './layers/routes.js';
import stationsLayer from './layers/stations.js';
import trainsLayer from './layers/trains.js';

// Map layers, drawn in this order. Future layers (history, ridership) are new
// modules with the same { add(map, data) } shape.
const LAYERS = [routesLayer, stationsLayer, trainsLayer];

const statusEl = document.getElementById('status');
const setStatus = (msg, isError = false) => {
  statusEl.textContent = msg;
  statusEl.classList.toggle('error', isError);
};

async function getJson(url) {
  const res = await fetch(url);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `${url} returned ${res.status}`);
  return body;
}

function boundsOf(data) {
  const b = new mapboxgl.LngLatBounds();
  for (const r of data.routes) for (const [lat, lon] of r.coordinates) b.extend([lon, lat]);
  for (const s of data.stations) b.extend([s.lon, s.lat]);
  return b;
}

function renderLegend(data) {
  document.getElementById('legend').innerHTML = data.routes
    .map((r) => `<li><span class="swatch" style="background:${r.color}"></span>${r.line}</li>`)
    .join('');
}

async function main() {
  const [config, data] = await Promise.all([getJson('/api/config'), getJson('/api/link')]);
  mapboxgl.accessToken = config.mapboxToken;
  // Exposed for line colors in popups and future layers.
  data.colors = Object.fromEntries(data.routes.map((r) => [r.line, r.color]));

  const map = new mapboxgl.Map({
    container: 'map',
    style: 'mapbox://styles/mapbox/satellite-streets-v12',
    bounds: boundsOf(data),
    fitBoundsOptions: { padding: { top: 90, bottom: 40, left: 40, right: 40 } },
  });
  map.addControl(new mapboxgl.NavigationControl(), 'top-right');
  map.addControl(new mapboxgl.ScaleControl({ unit: 'imperial' }), 'bottom-left');

  renderLegend(data);
  map.on('load', () => {
    for (const layer of LAYERS) layer.add(map, data);
    setStatus('');
  });
}

// app.js is a module (deferred), but mapbox-gl.js is a classic deferred
// script listed first, so it is already loaded here.
main().catch((err) => {
  console.error(err);
  setStatus(err.message, true);
});
