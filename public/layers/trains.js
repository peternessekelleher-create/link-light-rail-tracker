// Live trains, each paired with a faded "ghost" at its scheduled position.
//
// Motion model: the server reports each train's delay at the moment of its
// last position report. Between reports the real train keeps moving along its
// own track as the schedule says, shifted by that delay, and the ghost moves
// on the unshifted schedule. Both are driven by the same clock, so the gap
// between them on the map is the delay shown in the popup.
import { measure, pointAt, sliceLine, scheduledDist } from '../lib/motion.js';

const POLL_MS = 15 * 1000;
const MAX_BACKOFF_MS = 2 * 60 * 1000;
const GHOST_THRESHOLD_S = 60; // ghosts are hidden when within this of schedule
const STALE_AFTER_S = 3 * 60; // fade trains whose last report is older
const DROP_AFTER_S = 10 * 60; // and remove them after this
const MAX_EXTRAPOLATE_S = 90; // stop moving a train this long after its report
const EASE_MS = 1500; // glide time when a new report moves a train

const GHOSTS_KEY = 'link-tracker:show-ghosts';

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export default {
  add(map, data) {
    const shapes = new Map(); // shape_id => { coordinates, cum }
    const trains = new Map(); // vehicle id => state
    let feedTs = null;
    let lastOk = null;
    let failures = 0;
    let pollTimer = null;
    let frame = null;
    let showGhosts = readGhostPref();
    let popupTrainId = null;

    const ui = {
      status: document.getElementById('live-status'),
      banner: document.getElementById('live-banner'),
      toggle: document.getElementById('ghost-toggle'),
    };

    addIcons(map, data.colors);
    addLayers(map);
    ui.toggle.checked = showGhosts;
    ui.toggle.addEventListener('change', () => {
      showGhosts = ui.toggle.checked;
      try { localStorage.setItem(GHOSTS_KEY, showGhosts ? '1' : '0'); } catch {}
    });

    const popup = new mapboxgl.Popup({ closeButton: true, offset: 14 });
    popup.on('close', () => (popupTrainId = null));
    map.on('click', 'link-trains', (e) => {
      popup.remove(); // before setting the id: removing fires 'close'
      popupTrainId = e.features[0].properties.id;
      renderPopup(Date.now() / 1000, true);
    });
    map.on('mouseenter', 'link-trains', () => (map.getCanvas().style.cursor = 'pointer'));
    map.on('mouseleave', 'link-trains', () => (map.getCanvas().style.cursor = ''));

    // ---- Polling ----------------------------------------------------------

    async function poll() {
      pollTimer = null;
      try {
        if (!shapes.size) await loadShapes();
        const res = await fetch('/api/trains');
        if (!res.ok) throw new Error(`trains ${res.status}`);
        ingest(await res.json());
        failures = 0;
        lastOk = Date.now();
        ui.banner.hidden = true;
      } catch (err) {
        console.warn('Live data unavailable:', err.message);
        failures++;
        ui.banner.hidden = false;
      }
      renderStatus(Date.now() / 1000);
      if (!document.hidden) {
        const wait = failures ? Math.min(POLL_MS * 2 ** (failures - 1), MAX_BACKOFF_MS) : POLL_MS;
        pollTimer = setTimeout(poll, wait);
      }
    }

    async function loadShapes() {
      const res = await fetch('/api/shapes');
      if (!res.ok) throw new Error(`shapes ${res.status}`);
      for (const [id, s] of Object.entries(await res.json())) {
        shapes.set(id, { coordinates: s.coordinates, cum: measure(s.coordinates) });
      }
    }

    function ingest(body) {
      const now = Date.now() / 1000;
      feedTs = body.feedTs;
      const seen = new Set();
      for (const t of body.trains) {
        const shape = shapes.get(t.shapeId);
        if (!shape) continue;
        seen.add(t.id);
        const stops = t.stops.map(([d, a, p]) => ({ d, a: t.t0 + a, p: t.t0 + p }));
        const prev = trains.get(t.id);
        const next = { ...t, shape, stops, corr: 0, corrAt: 0 };
        // Glide from where the train is drawn now to its new position along
        // the track, instead of jumping.
        if (prev && prev.shapeId === t.shapeId && prev.drawn != null) {
          const corr = prev.drawn - targetDist(next, now);
          if (Math.abs(corr) < 3000) Object.assign(next, { corr, corrAt: performance.now() });
        }
        trains.set(t.id, next);
      }
      for (const id of trains.keys()) if (!seen.has(id)) trains.delete(id);
    }

    // ---- Animation --------------------------------------------------------

    function targetDist(t, now) {
      return scheduledDist(t.stops, Math.min(now, t.ts + MAX_EXTRAPOLATE_S) - t.delay);
    }

    function draw() {
      frame = requestAnimationFrame(draw);
      const now = Date.now() / 1000;
      const nowMs = performance.now();
      const live = [];
      const ghosts = [];
      const gaps = [];
      for (const [id, t] of trains) {
        const age = now - t.ts;
        if (age > DROP_AFTER_S) { trains.delete(id); continue; }
        const k = t.corrAt ? Math.min(1, (nowMs - t.corrAt) / EASE_MS) : 1;
        const eased = 1 - (1 - k) ** 3;
        t.drawn = targetDist(t, now) + t.corr * (1 - eased);
        const p = pointAt(t.shape.coordinates, t.shape.cum, t.drawn);
        t.at = [p.lon, p.lat];
        live.push(point(t.at, { id, icon: `train:${t.line}`, bearing: p.bearing, opacity: age > STALE_AFTER_S ? 0.45 : 1 }));

        if (showGhosts && Math.abs(t.delay) >= GHOST_THRESHOLD_S && age <= STALE_AFTER_S) {
          const gd = scheduledDist(t.stops, now);
          const g = pointAt(t.shape.coordinates, t.shape.cum, gd);
          ghosts.push(point([g.lon, g.lat], { icon: `ghost:${t.line}`, bearing: g.bearing }));
          gaps.push({
            type: 'Feature',
            properties: { color: data.colors[t.line] },
            geometry: { type: 'LineString', coordinates: sliceLine(t.shape.coordinates, t.shape.cum, t.drawn, gd) },
          });
        }
      }
      map.getSource('link-trains').setData(collection(live));
      map.getSource('link-ghosts').setData(collection(ghosts));
      map.getSource('link-gaps').setData(collection(gaps));
      if (popupTrainId != null) renderPopup(now, false);
    }

    // ---- Text -------------------------------------------------------------

    function renderStatus(now) {
      if (lastOk == null) {
        ui.status.textContent = failures ? '' : 'Connecting to live data…';
        return;
      }
      const n = trains.size;
      const ago = feedTs ? Math.max(0, Math.round(now - feedTs)) : null;
      ui.status.textContent = n
        ? `Live · ${n} train${n === 1 ? '' : 's'}${ago != null ? ` · updated ${formatAgo(ago)}` : ''}`
        : 'No trains running right now';
    }

    let popupText = '';
    function renderPopup(now, open) {
      const t = trains.get(popupTrainId);
      if (!t) { popup.remove(); return; }
      const age = Math.max(0, Math.round(now - t.ts));
      const status = delayText(t.delay);
      const next = t.nextStop
        ? `<div>Next stop: ${escapeHtml(t.nextStop)}${t.nextDelay != null ? ` <span class="muted">(predicted ${delayText(t.nextDelay).toLowerCase()})</span>` : ''}</div>`
        : '';
      const html =
        `<div class="popup-name"><span class="chip" style="background:${data.colors[t.line]}">${escapeHtml(t.line)}</span> ${escapeHtml(t.direction)}</div>` +
        `<div>To ${escapeHtml(t.headsign)}</div>` +
        `<div class="train-status ${t.delay >= GHOST_THRESHOLD_S ? 'late' : t.delay <= -GHOST_THRESHOLD_S ? 'early' : 'ontime'}">${status}</div>` +
        next +
        `<div class="muted">${age > STALE_AFTER_S ? `Last seen ${Math.round(age / 60)} min ago` : `Updated ${age} s ago`}</div>`;
      popup.setLngLat(t.at);
      if (html !== popupText || open) {
        popupText = html;
        popup.setHTML(html);
      }
      if (open) popup.addTo(map);
    }

    // ---- Lifecycle --------------------------------------------------------

    setInterval(() => renderStatus(Date.now() / 1000), 1000);
    function start() {
      if (!frame) frame = requestAnimationFrame(draw);
      if (!pollTimer) poll();
    }
    function stop() {
      clearTimeout(pollTimer);
      pollTimer = null;
      cancelAnimationFrame(frame);
      frame = null;
    }
    document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));
    if (!document.hidden) start();
  },
};

function delayText(s) {
  if (Math.abs(s) < GHOST_THRESHOLD_S) return 'On time';
  const min = Math.round(Math.abs(s) / 60);
  return `${min} min ${s > 0 ? 'late' : 'early'}`;
}

function formatAgo(s) {
  return s < 90 ? `${s} s ago` : `${Math.round(s / 60)} min ago`;
}

function readGhostPref() {
  try { return localStorage.getItem(GHOSTS_KEY) !== '0'; } catch { return true; }
}

const point = (coordinates, properties) => ({ type: 'Feature', properties, geometry: { type: 'Point', coordinates } });
const collection = (features) => ({ type: 'FeatureCollection', features });

function addLayers(map) {
  for (const id of ['link-gaps', 'link-ghosts', 'link-trains']) map.addSource(id, { type: 'geojson', data: collection([]) });

  map.addLayer({
    id: 'link-gaps',
    type: 'line',
    source: 'link-gaps',
    layout: { 'line-cap': 'round' },
    paint: { 'line-color': '#ffffff', 'line-width': 2, 'line-opacity': 0.75, 'line-dasharray': [1, 1.5] },
  });
  const symbol = (id, extra = {}) => ({
    id,
    type: 'symbol',
    source: id,
    layout: {
      'icon-image': ['get', 'icon'],
      'icon-rotate': ['get', 'bearing'],
      'icon-rotation-alignment': 'map',
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
      'icon-size': ['interpolate', ['linear'], ['zoom'], 9, 0.75, 14, 1.1],
    },
    paint: extra,
  });
  map.addLayer(symbol('link-ghosts'));
  map.addLayer(symbol('link-trains', { 'icon-opacity': ['get', 'opacity'] }));
}

// Train icons drawn once on a canvas: a circle in the line color with a white
// outline and an arrow pointing in the direction of travel (up = north before
// rotation). Ghosts are the same at 35% opacity with a dashed outline.
function addIcons(map, colors) {
  const ratio = 2;
  const size = 30;
  for (const [line, color] of Object.entries(colors)) {
    for (const ghost of [false, true]) {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size * ratio;
      const ctx = canvas.getContext('2d');
      ctx.scale(ratio, ratio);
      const c = size / 2;
      ctx.beginPath();
      ctx.arc(c, c, 10, 0, Math.PI * 2);
      ctx.globalAlpha = ghost ? 0.35 : 1;
      ctx.fillStyle = color;
      ctx.fill();
      ctx.globalAlpha = ghost ? 0.9 : 1;
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = '#ffffff';
      if (ghost) ctx.setLineDash([3, 2.5]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = ghost ? 0.5 : 1;
      ctx.beginPath();
      ctx.moveTo(c, c - 6);
      ctx.lineTo(c + 5, c + 4);
      ctx.lineTo(c, c + 1.5);
      ctx.lineTo(c - 5, c + 4);
      ctx.closePath();
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      map.addImage(`${ghost ? 'ghost' : 'train'}:${line}`, ctx.getImageData(0, 0, canvas.width, canvas.height), { pixelRatio: ratio });
    }
  }
}
