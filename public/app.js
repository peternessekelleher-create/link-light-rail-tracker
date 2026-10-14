import routesLayer from './layers/routes.js';
import stationsLayer from './layers/stations.js';
import trainsLayer from './layers/trains.js';
import { renderControls } from './ui/controls.js';
import { renderHeadways } from './ui/headways.js';
import { view } from './lib/view.js';

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

// Below 860 px the panels are drawers opened from buttons; one at a time.
const NARROW = window.matchMedia('(max-width: 859px)');

function setupDrawers() {
  const buttons = [...document.querySelectorAll('[data-drawer]')];
  const setOpen = (id) => {
    for (const b of buttons) {
      const open = b.dataset.drawer === id;
      b.setAttribute('aria-expanded', String(open));
      document.getElementById(b.dataset.drawer).classList.toggle('open', open);
    }
  };
  for (const b of buttons) {
    b.addEventListener('click', () => setOpen(b.getAttribute('aria-expanded') === 'true' ? null : b.dataset.drawer));
  }
  for (const c of document.querySelectorAll('[data-close]')) c.addEventListener('click', () => setOpen(null));
}

// Keep both lines clear of the side panels on wide screens.
const fitPadding = () =>
  NARROW.matches ? { top: 90, bottom: 40, left: 30, right: 30 } : { top: 40, bottom: 40, left: 290, right: 310 };

async function main() {
  const [config, data] = await Promise.all([getJson('/api/config'), getJson('/api/link')]);
  mapboxgl.accessToken = config.mapboxToken;
  // Exposed for line colors in popups and future layers.
  data.colors = Object.fromEntries(data.routes.map((r) => [r.line, r.color]));

  const map = new mapboxgl.Map({
    container: 'map',
    style: 'mapbox://styles/mapbox/satellite-streets-v12',
    bounds: boundsOf(data),
    fitBoundsOptions: { padding: fitPadding() },
  });
  map.addControl(new mapboxgl.NavigationControl(), 'bottom-right');
  map.addControl(new mapboxgl.ScaleControl({ unit: 'imperial' }), 'bottom-left');

  view.init(data.directions, data.routes.map((r) => r.line));
  renderControls(data);
  renderHeadways(data);
  map.on('load', () => {
    for (const layer of LAYERS) layer.add(map, data);
    setStatus('');
  });
}

// app.js is a module (deferred), but mapbox-gl.js is a classic deferred
// script listed first, so it is already loaded here.
setupDrawers();
main().catch((err) => {
  console.error(err);
  setStatus(err.message, true);
});
