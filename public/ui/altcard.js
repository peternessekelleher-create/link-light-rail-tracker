// Alternative card: everything known about one station option, or all of a
// station's options side by side ("Compare All") in the same format.
import { bindRouteHover, routeChip } from './st3panel.js';

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const titleCase = (s) => s.replace(/\b([a-z])/g, (c) => c.toUpperCase());

// "soundtransit.org · Further Study Results Chinatown International District…"
function sourceLabel(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '');
    const last = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || '')
      .replace(/\.(pdf|html?)$/i, '')
      .replace(/[-_]+/g, ' ')
      .replace(/\s+\d{6,}$/, '')
      .trim();
    const title = last.length > 64 ? `${last.slice(0, 62)}…` : last;
    return title ? `${host} · ${titleCase(title)}` : host;
  } catch {
    return url;
  }
}

export function createAltCard(model) {
  const el = document.getElementById('alt-card');
  const body = el.querySelector('[data-body]');
  const title = el.querySelector('#alt-card-title');
  let opener = null;

  const section = (a) => {
    const p = a.props;
    const routes = model.altRoutes(a.id);
    const structure = [titleCase(p.structure || 'Not Published'), p.depth_ft ? `${p.depth_ft} Ft Deep` : 'Depth Not Published'].join(' · ');
    return `
      <article class="alt-col ${a.role}">
        <header>
          <h3>${escapeHtml(a.station.multi ? a.label : a.station.name)}${a.roleLabel ? ` <span class="role-tag">${escapeHtml(a.roleLabel)}</span>` : ''}</h3>
          <p class="card-option">${escapeHtml(p.option)}</p>
        </header>
        <dl>
          <dt>Status</dt><dd>${escapeHtml(p.status)}</dd>
          <dt>Structure / Depth</dt><dd>${escapeHtml(structure)}</dd>
          <dt>Location (Sound Transit)</dt><dd><blockquote>${escapeHtml(p.location_text)}</blockquote></dd>
          <dt>Impacts</dt><dd>${p.impacts ? escapeHtml(p.impacts) : '<span class="muted">None Published</span>'}</dd>
          <dt>Connecting Routes (${routes.length})</dt>
          <dd>${
            routes.length
              ? `<ul class="card-routes">${routes
                  .map((r) => `<li data-route="${r.route_id}" tabindex="0" title="${escapeHtml(`${r.stop_name}, ${r.distance_m} m`)}">${routeChip(model.routeById.get(r.route_id))}</li>`)
                  .join('')}</ul><p class="muted small">Stops Within ${model.meta.connect_radius_m} m. Hover A Route To See It.</p>`
              : '<span class="muted">None Within Range</span>'
          }</dd>
          <dt>How The Point Was Derived</dt>
          <dd>${escapeHtml(p.derivation)}. Accuracy About ±${p.confidence_m} m.
            <span class="muted small">Street intersections © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a> (ODbL).</span></dd>
          <dt>Sources</dt>
          <dd><ul class="card-sources">${(p.sources || [])
            .map((u) => `<li><a href="${escapeHtml(u)}" target="_blank" rel="noopener">${escapeHtml(sourceLabel(u))}</a></li>`)
            .join('')}</ul></dd>
          <dt>Walk-Shed Population / Jobs</dt><dd class="placeholder">Coming With The Isochrone Map</dd>
        </dl>
      </article>`;
  };

  const show = (heading, alts, compare, from) => {
    opener = from || document.activeElement;
    title.textContent = heading;
    body.innerHTML = alts.map(section).join('');
    el.classList.toggle('compare', compare);
    el.style.setProperty('--cols', alts.length);
    el.hidden = false;
    body.scrollTop = 0;
    el.querySelector('[data-close-card]').focus();
  };

  const close = () => {
    if (el.hidden) return;
    el.hidden = true;
    if (opener?.isConnected) opener.focus();
  };

  el.querySelector('[data-close-card]').addEventListener('click', close);
  document.addEventListener('keydown', (e) => e.key === 'Escape' && close());
  bindRouteHover(body);

  return {
    open(altId, from) {
      const a = model.alts.get(altId);
      show(a.station.multi ? `${a.station.name}: ${a.short}` : a.station.name, [a], false, from);
    },
    compare(stationId, from) {
      const s = model.stations.get(stationId);
      show(`${s.name}: Compare All`, s.alts, true, from);
    },
    close,
  };
}
