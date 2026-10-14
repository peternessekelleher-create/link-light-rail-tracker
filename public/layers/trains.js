// Live trains, each paired with a faded "ghost" at its scheduled position.
//
// Motion model: the server reports each train's delay at the moment of its
// last position report. Between reports the real train keeps moving along its
// own track as the schedule says, shifted by that delay, and the ghost moves
// on the unshifted schedule. Both are driven by the same clock, so the gap
// between them on the map is the delay shown in the popup.
import { measure, pointAt, sliceLine, scheduledDist } from '../lib/motion.js';
import { ON_TIME_S, DELAY_COLORS, formatDelay, delayClass } from '../lib/delay.js';
import { view, liveFeed } from '../lib/view.js';
import { trainCapacity } from '../lib/capacity.js';
import { addLiveTrainIcons } from '../lib/trainicons.js';
import { directionKey, fillLevel, loadText, trainLoad } from '../lib/crowding.js';
import { NOTES } from '../config.js';

const POLL_MS = 15 * 1000;
const MAX_BACKOFF_MS = 2 * 60 * 1000;
const GHOST_THRESHOLD_S = ON_TIME_S; // ghosts are hidden when within this of schedule
const STALE_AFTER_S = 3 * 60; // fade trains whose last report is older
const DROP_AFTER_S = 10 * 60; // and remove them after this
const MAX_EXTRAPOLATE_S = 90; // stop moving a train this long after its report
const EASE_MS = 1500; // glide time when a new report moves a train

const GHOSTS_KEY = 'link-tracker:show-ghosts';

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Estimated typical crowding, set by app.js once data/crowding.json loads:
// { doc, window: () => current window id }. Until then markers are empty.
export const liveCrowding = { doc: null, window: () => null };

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
      tags: document.getElementById('tag-toggle'),
    };

    addIcons(map, data.colors);
    addLiveTrainIcons(map, data.colors);
    addLayers(map);
    ui.toggle.checked = showGhosts;
    ui.toggle.addEventListener('change', () => {
      showGhosts = ui.toggle.checked;
      try { localStorage.setItem(GHOSTS_KEY, showGhosts ? '1' : '0'); } catch {}
    });
    // The tag layer's visibility also depends on the Live Link master switch,
    // so app.js sets it from the view store.
    ui.tags.addEventListener('change', () => view.update());

    // Line and direction switches act as map filters: instant, no re-fetch.
    view.subscribe(() => {
      const shown = ['in', ['get', 'key'], ['literal', view.visibleKeys()]];
      for (const id of ['link-trains', 'link-train-arrows', 'link-ghosts', 'link-gaps']) map.setFilter(id, shown);
      map.setFilter('link-train-tags', ['all', shown, ['!=', ['get', 'tag'], '']]);
    });

    const popup = new mapboxgl.Popup({ closeButton: true, offset: 14 });
    popup.on('close', () => (popupTrainId = null));
    map.on('click', 'link-trains', (e) => {
      popup.remove(); // before setting the id: removing fires 'close'
      popupTrainId = e.features[0].properties.id;
      renderPopup(Date.now() / 1000, true);
    });
    // Hover: "Est. 78% full · Crowded".
    const tip = new mapboxgl.Popup({ closeButton: false, closeOnClick: false, offset: 14, className: 'tip' });
    map.on('mousemove', 'link-trains', (e) => {
      map.getCanvas().style.cursor = 'pointer';
      const t = trains.get(e.features[0].properties.id);
      const load = t && crowdingOf(t);
      if (!load) return tip.remove();
      tip.setLngLat(t.at).setHTML(`<strong>${escapeHtml(t.line)}</strong> · ${loadText(load)}`).addTo(map);
    });
    map.on('mouseleave', 'link-trains', () => {
      map.getCanvas().style.cursor = '';
      tip.remove();
    });

    // The crowding model's direction for each train, matched by name.
    const dirKeys = new Map();
    function crowdingOf(t) {
      const doc = liveCrowding.doc;
      if (!doc) return null;
      const k = `${t.line}|${t.dir}`;
      if (!dirKeys.has(k)) dirKeys.set(k, directionKey(doc, t.line, t.dir, data.directions?.[t.line]?.[t.dir]));
      return t.at ? trainLoad(doc, t.line, dirKeys.get(k), t.at[0], t.at[1], liveCrowding.window()) : null;
    }

    // ---- Polling ----------------------------------------------------------

    async function poll() {
      pollTimer = null;
      try {
        if (!shapes.size) await loadShapes();
        const res = await fetch('/api/trains');
        if (!res.ok) throw new Error(`trains ${res.status}`);
        const body = await res.json();
        ingest(body);
        liveFeed.update((f) => (f.body = body));
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
          if (Math.abs(corr) < 9_800) Object.assign(next, { corr, corrAt: performance.now() });
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
        const key = `${t.line}|${t.dir}`;
        const stale = age > STALE_AFTER_S;
        live.push(point(t.at, {
          id,
          key,
          icon: `train:${t.line}:${fillLevel(crowdingOf(t))}`,
          bearing: p.bearing,
          opacity: stale ? 0.45 : 1,
          tag: stale ? '' : formatDelay(t.delay),
          tagColor: DELAY_COLORS[delayClass(t.delay)],
        }));

        if (showGhosts && Math.abs(t.delay) >= GHOST_THRESHOLD_S && age <= STALE_AFTER_S) {
          const gd = scheduledDist(t.stops, now);
          const g = pointAt(t.shape.coordinates, t.shape.cum, gd);
          ghosts.push(point([g.lon, g.lat], { key, icon: `ghost:${t.line}`, bearing: g.bearing }));
          gaps.push({
            type: 'Feature',
            properties: { key },
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
        ui.status.textContent = failures ? '' : 'Connecting To Live Data…';
        return;
      }
      const n = trains.size;
      const ago = feedTs ? Math.max(0, Math.round(now - feedTs)) : null;
      ui.status.textContent = n
        ? `Live · ${n} Train${n === 1 ? '' : 's'}${ago != null ? ` · Updated ${formatAgo(ago)}` : ''}`
        : 'No Trains Running Right Now';
    }

    let popupText = '';
    function renderPopup(now, open) {
      const t = trains.get(popupTrainId);
      if (!t || !view.shown(t.line, t.dir)) { popup.remove(); return; }
      const age = Math.max(0, Math.round(now - t.ts));
      const next = t.nextStop
        ? field('Next Stop', `${escapeHtml(t.nextStop)}${t.nextDelay != null ? ` <span class="muted">(Predicted ${formatDelay(t.nextDelay)})</span>` : ''}`)
        : '';
      const cap = trainCapacity(t.line, t.cars);
      const capacity = cap
        ? field('Cars', `${cap.cars}${cap.typical ? ' (Typical)' : ''}`) +
          field('Seats', cap.seats.toLocaleString()) +
          field('Max Capacity', `${cap.maxLoad.toLocaleString()} People`) +
          `<div class="popup-note">Capacity uses Sound Transit's planning standard.</div>`
        : '';
      const load = crowdingOf(t);
      const crowd = load ? field('Crowding', loadText(load)) + `<div class="note">${escapeHtml(NOTES.crowding)}</div>` : '';
      const html =
        `<div class="popup-name"><span class="chip" style="background:${data.colors[t.line]}">${escapeHtml(t.line)}</span> To ${escapeHtml(t.headsign)}</div>` +
        `<div class="train-status ${delayClass(t.delay)}">${delayText(t.delay)}</div>` +
        next +
        crowd +
        capacity +
        `<div class="muted popup-updated">${age > STALE_AFTER_S ? `Last Seen ${Math.round(age / 60)} Min Ago` : `Updated ${age} Sec Ago`}</div>`;
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

const field = (name, value) => `<div class="popup-field"><span class="field-name">${name}:</span> ${value}</div>`;

// "Late +3:20" / "Early −1:15" / "On Time": the same number as the map tag.
function delayText(s) {
  const tag = formatDelay(s);
  if (Math.abs(s) < GHOST_THRESHOLD_S) return tag;
  return `${s > 0 ? 'Late' : 'Early'} ${tag}`;
}

function formatAgo(s) {
  return s < 90 ? `${s} Sec Ago` : `${Math.round(s / 60)} Min Ago`;
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
    paint: { 'line-color': '#ffffff', 'line-width': 2.5, 'line-opacity': 0.9, 'line-dasharray': [1, 1.5] },
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
  // Live trains: the body (crowding fill level) stays upright so the fill
  // rises on screen; the direction arrow rotates on its own layer above it.
  const body = symbol('link-trains', { 'icon-opacity': ['get', 'opacity'] });
  delete body.layout['icon-rotate'];
  delete body.layout['icon-rotation-alignment'];
  map.addLayer(body);
  map.addLayer({ ...symbol('link-train-arrows', { 'icon-opacity': ['get', 'opacity'] }), source: 'link-trains', layout: { ...symbol('x').layout, 'icon-image': 'train-arrow' } });

  // Delay tags beside each train. Tags may hide each other where trains
  // crowd (downtown); the train icons above ignore placement, so they always show.
  map.addLayer({
    id: 'link-train-tags',
    type: 'symbol',
    source: 'link-trains',
    filter: ['!=', ['get', 'tag'], ''],
    layout: {
      'text-field': ['get', 'tag'],
      'text-font': ['DIN Pro Bold', 'Arial Unicode MS Bold'],
      'text-size': ['interpolate', ['linear'], ['zoom'], 9, 11, 14, 13],
      'text-variable-anchor': ['left', 'right'],
      'text-radial-offset': 1.4,
      'text-padding': 1,
    },
    paint: {
      'text-color': ['get', 'tagColor'],
      'text-halo-color': 'rgba(0,0,0,0.95)',
      'text-halo-width': 2.2,
    },
  });
}

// Train icons drawn once on a canvas: a circle in the line color with a thick
// white outline, a thin dark outer ring for contrast on bright imagery, and
// an arrow pointing in the direction of travel (up = north before rotation).
// Ghosts are the same at 35% fill with a bright dashed outline.
function addIcons(map, colors) {
  const ratio = 2;
  const size = 34;
  const r = 10;
  for (const [line, color] of Object.entries(colors)) {
    for (const ghost of [false, true]) {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size * ratio;
      const ctx = canvas.getContext('2d');
      ctx.scale(ratio, ratio);
      const c = size / 2;
      const circle = (radius) => {
        ctx.beginPath();
        ctx.arc(c, c, radius, 0, Math.PI * 2);
      };
      // Dark outer ring
      circle(r + 2.5);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = ghost ? 'rgba(0,0,0,0.7)' : 'rgba(0,0,0,0.85)';
      if (ghost) ctx.setLineDash([3.5, 2.5]);
      ctx.stroke();
      // Fill
      circle(r);
      ctx.globalAlpha = ghost ? 0.35 : 1;
      ctx.fillStyle = color;
      ctx.fill();
      // White outline
      ctx.globalAlpha = 1;
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
      ctx.setLineDash([]);
      // Arrow
      ctx.globalAlpha = ghost ? 0.7 : 1;
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
