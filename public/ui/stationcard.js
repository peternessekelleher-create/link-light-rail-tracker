// Station card: opens on click (tap) for any Link or ST3 station and lists
// the bus routes with a stop within the connect radius, grouped by agency.
import { NOTES } from '../config.js';
import { formatDistance } from '../lib/units.js';

const escapeHtml = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const hourLabel = (h) => `${h % 12 || 12} ${h % 24 < 12 ? 'am' : 'pm'}`;

export function createStationCard(conn, { lineColors, onClose, onRouteHover }) {
  const el = document.getElementById('station-card');
  const title = el.querySelector('#station-card-title');
  const body = el.querySelector('[data-body]');
  const byId = new Map(conn.stations.map((s) => [s.id, s]));
  const meta = conn.metadata;
  let opener = null;

  const header = (s) =>
    s.kind === 'link'
      ? `<p class="sc-lines">${s.lines.map((l) => `<span class="chip" style="background:${lineColors[l] || '#555'}">${escapeHtml(l)}</span>`).join('')}</p>`
      : `<p class="sc-st3"><span class="sc-future">Sound Transit 3 · planned</span> ${escapeHtml(s.opening)}</p>
         <p class="note">${escapeHtml(NOTES.futureLocation)}</p>`;

  const routeRow = (r) => `
    <tr data-route="${escapeHtml(r.route_id)}" tabindex="0">
      <td><span class="rt-num ${r.brt ? 'rapid' : ''}">${escapeHtml(r.number)}</span></td>
      <td class="sc-name">${escapeHtml(r.name)}<span class="sc-stop">${escapeHtml(r.stop_name)} · ${formatDistance(r.distance_ft)}</span></td>
      <td>${r.brt ? `<span class="brt-tag">${escapeHtml(r.brt)}</span>` : '<span class="muted">No</span>'}</td>
      <td class="num">${r.midday_tph ? r.midday_tph.toFixed(1) : '<span class="muted">–</span>'}</td>
    </tr>`;

  const render = (s) => {
    title.textContent = s.name;
    const n = s.route_count;
    body.innerHTML = `
      ${header(s)}
      <h3 class="sc-h">${n} connecting bus route${n === 1 ? '' : 's'} <span class="muted">· stop within ${formatDistance(meta.connect_radius_ft)}</span></h3>
      ${s.kind === 'st3' ? `<p class="note">${escapeHtml(NOTES.futureBuses)}</p>` : ''}
      ${s.agencies
        .map(
          (a) => `
        <table class="sc-table">
          <caption>${escapeHtml(a.agency)}</caption>
          <thead><tr><th scope="col">Route</th><th scope="col">Name</th><th scope="col">BRT</th><th scope="col" class="num">Trips/hr</th></tr></thead>
          <tbody>${a.routes.map(routeRow).join('')}</tbody>
        </table>`,
        )
        .join('')}
      <p class="sc-foot muted">Trips/hr: weekday midday (${hourLabel(meta.frequency.start)}–${hourLabel(meta.frequency.end)}) in the busier direction, from the agencies' published schedules. Hover a route to see it.</p>`;
  };

  const close = () => {
    if (el.hidden) return;
    el.hidden = true;
    onRouteHover(null);
    onClose();
    opener?.focus?.();
  };
  el.querySelector('[data-close-card]').addEventListener('click', close);
  document.addEventListener('keydown', (e) => e.key === 'Escape' && close());

  // Route hover and keyboard focus highlight the route on the map.
  body.addEventListener('mouseover', (e) => onRouteHover(e.target.closest('[data-route]')?.dataset.route || null));
  body.addEventListener('mouseleave', () => onRouteHover(null));
  body.addEventListener('focusin', (e) => onRouteHover(e.target.dataset?.route || null));

  return {
    open(id) {
      const s = byId.get(id);
      if (!s) return;
      opener = document.activeElement;
      render(s);
      el.hidden = false;
      body.scrollTop = 0;
    },
    close,
    isOpen: () => !el.hidden,
  };
}
