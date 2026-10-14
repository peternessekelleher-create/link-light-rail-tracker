import routesLayer from './layers/routes.js';
import stationsLayer from './layers/stations.js';
import trainsLayer from './layers/trains.js';
import st3Layer from './layers/st3.js';
import reachLayer from './layers/reach.js';
import { renderControls } from './ui/controls.js';
import { renderHeadways } from './ui/headways.js';
import { renderSt3Panel } from './ui/st3panel.js';
import { createReachBox } from './ui/reachbox.js';
import { createStationCard } from './ui/stationcard.js';
import { setupMethods } from './ui/methods.js';
import { view } from './lib/view.js';
import { loadSt3, st3 } from './lib/st3.js';
import { reachView } from './lib/reach.js';
import { loadConnections } from './lib/data.js';

// Map layers, drawn in this order. Future layers (history, ridership) are new
// modules with the same { add(map, data) } shape. The ST3 and reach layers
// are appended once their data has loaded.
const LAYERS = [routesLayer, stationsLayer, trainsLayer];

// Every map layer that belongs to the live Link group, for its master switch.
const LIVE_LAYERS = ['link-routes-casing', 'link-routes', 'link-stations', 'link-station-labels', 'link-gaps', 'link-ghosts', 'link-trains', 'link-train-tags'];

const ATTRIBUTION = [
  '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">ST3 Station Anchors © OpenStreetMap Contributors (ODbL)</a>',
  'Bus Schedules: King County Metro, Sound Transit, Community Transit, Pierce Transit (GTFS)',
];

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

// Below 960 px the panels are drawers opened from buttons; one at a time.
const NARROW = window.matchMedia('(max-width: 959px)');

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
  NARROW.matches ? { top: 100, bottom: 40, left: 30, right: 30 } : { top: 40, bottom: 40, left: 380, right: 350 };

async function main() {
  // Bus and ST3 data are optional: if they fail, the live map still works.
  const connP = loadConnections().catch((err) => {
    console.error(err);
    return null;
  });
  const st3Model = connP.then((conn) => conn && loadSt3(conn)).catch((err) => {
    console.error(err);
    return null;
  });
  const [config, data] = await Promise.all([getJson('/api/config'), getJson('/api/link')]);
  mapboxgl.accessToken = config.mapboxToken;
  // Exposed for line colors in popups and future layers.
  data.colors = Object.fromEntries(data.routes.map((r) => [r.line, r.color]));

  const map = new mapboxgl.Map({
    container: 'map',
    style: 'mapbox://styles/mapbox/dark-v11', // dark streets, no imagery
    bounds: boundsOf(data),
    fitBoundsOptions: { padding: fitPadding() },
    customAttribution: ATTRIBUTION,
  });
  let mapLoaded = false;
  map.on('load', () => (mapLoaded = true));
  map.addControl(new mapboxgl.NavigationControl(), 'bottom-right');
  map.addControl(new mapboxgl.ScaleControl({ unit: 'imperial' }), 'bottom-left');

  view.init(data.directions, data.routes.map((r) => r.line));
  renderControls(data);
  renderHeadways(data);
  setupGroups();

  const [conn, model] = await Promise.all([connP, st3Model]);
  const st3Body = document.getElementById('st3-body');
  if (model) {
    renderSt3Panel(model, st3Body);
    LAYERS.push(st3Layer(model));
  } else {
    st3Body.innerHTML = '<p class="error-text">Future Network Data Unavailable</p>';
    document.getElementById('st3-toggle').disabled = true;
  }
  if (conn) LAYERS.push(setupReach(map, conn, data, !!model));
  else document.getElementById('reach-box').hidden = true;

  const ready = () => {
    for (const layer of LAYERS) layer.add(map, data);
    view.subscribe(() => {
      const tags = document.getElementById('tag-toggle').checked;
      for (const id of LIVE_LAYERS) {
        const on = view.live && (id !== 'link-train-tags' || tags);
        map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
      }
    });
    setStatus('');
  };
  if (mapLoaded) ready();
  else map.on('load', ready);
}

// Station card (click / tap) and bus reach (hover / tap) for every Link and
// ST3 station in connections.json.
function setupReach(map, conn, data, withSt3) {
  const stations = conn.stations.filter((s) => withSt3 || s.kind === 'link');
  const nameOf = (id) => stations.find((s) => s.id === id)?.name || id;
  let layer;
  const card = createStationCard(conn, {
    lineColors: data.colors,
    onClose: () => reachView.update((v) => (v.selected = null)),
    onRouteHover: (id) => layer.highlightRoute(map, id),
  });
  const box = createReachBox(document.getElementById('reach-box'), conn.metadata, nameOf);
  layer = reachLayer(stations, {
    onSelect: (id) => {
      if (!id) return card.close();
      reachView.update((v) => (v.selected = id));
      card.open(id);
    },
    onStatus: box.status,
  });
  return layer;
}

// The two master switches. Children keep their own state while a group is
// off, so switching it back on restores them.
function setupGroups() {
  const live = document.getElementById('live-toggle');
  live.addEventListener('change', () => view.update((v) => (v.live = live.checked)));
  view.subscribe((v) => {
    for (const el of document.querySelectorAll('#live-body input')) el.disabled = !v.live || (el.dataset.role === 'dir' && !v.lines[el.closest('.line-group').dataset.line]);
    document.getElementById('live-body').classList.toggle('off', !v.live);
  });

  const master = document.getElementById('st3-toggle');
  master.addEventListener('change', () => st3.update((s) => (s.master = master.checked)));
  st3.subscribe((s) => document.getElementById('st3-body').classList.toggle('off', !s.master));

  for (const b of document.querySelectorAll('.group-head > .collapse')) {
    b.addEventListener('click', () => {
      const open = b.getAttribute('aria-expanded') !== 'true';
      b.setAttribute('aria-expanded', String(open));
      document.getElementById(b.getAttribute('aria-controls')).hidden = !open;
    });
  }
}

// app.js is a module (deferred), but mapbox-gl.js is a classic deferred
// script listed first, so it is already loaded here.
setupDrawers();
setupMethods();
main().catch((err) => {
  console.error(err);
  setStatus(err.message, true);
});
