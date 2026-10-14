// "Sound Transit 3 – Future Network" branch of the layer tree: a master
// switch, a switch per project, a checkbox per station alternative, and per
// station "Compare All", "Show Buses" and its connecting routes.
import { st3 } from '../lib/st3.js';

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// "Dearborn Only", "5th Ave, 4th Ave", "All 3 Options", "All Except WSJ-2"
export function servesText(station, served) {
  const n = station.alts.length;
  if (n < 2) return '';
  if (served.length === n) return `All ${n} Options`;
  if (served.length === 1) return `${served[0].short} Only`;
  if (n >= 4 && n - served.length <= 2) {
    return `All Except ${station.alts.filter((a) => !served.includes(a)).map((a) => a.short).join(', ')}`;
  }
  return served.map((a) => a.short).join(', ');
}

export function routeChip(route) {
  const p = route.properties;
  return `<span class="rt-num ${p.rapidride ? 'rapid' : ''}">${escapeHtml(p.number)}</span>`;
}

export function renderSt3Panel(model, root, { openCard, openCompare }) {
  const altRow = (a) => `
    <li class="alt ${a.role}">
      <label class="check">
        <input type="checkbox" data-role="alt" data-alt="${a.id}">
        <span class="alt-label">${escapeHtml(a.label)}</span>
        ${a.roleLabel ? `<span class="role-tag">${escapeHtml(a.roleLabel)}</span>` : ''}
      </label>
      <button type="button" class="link details" data-card="${a.id}" aria-label="Details: ${escapeHtml(a.label)}">Details</button>
    </li>`;

  const stationRow = (s) => `
    <li class="station ${s.removed ? 'removed' : ''}" data-station="${s.id}">
      ${
        s.multi
          ? `<div class="st-name">${escapeHtml(s.name)}${s.removed ? ` <span class="removed-tag">${escapeHtml(s.removed)}</span>` : ''}${s.note ? ` <span class="st-note">${escapeHtml(s.note)}</span>` : ''}</div>
             <ul class="alts">${s.alts.map(altRow).join('')}</ul>`
          : `<button type="button" class="st-name link" data-card="${s.alts[0].id}">${escapeHtml(s.name)}</button>${s.note ? ` <span class="st-note">${escapeHtml(s.note)}</span>` : ''}`
      }
      <div class="st-actions">
        ${s.multi ? `<button type="button" class="link" data-compare="${s.id}">Compare All</button><span class="sep" aria-hidden="true">·</span>` : ''}
        <button type="button" class="link" data-buses="${s.id}" aria-pressed="false">Show Buses</button>
      </div>
      <details class="routes">
        <summary>Connecting Routes (<span data-count></span>)</summary>
        <ul class="route-list" data-routes></ul>
      </details>
    </li>`;

  const projectBlock = (p) => {
    let phase = 1;
    const rows = p.stations
      .map((s) => {
        const head = (s.phase || 1) !== phase ? `<li class="phase-head">Phase ${s.phase} – Unfunded</li>` : '';
        phase = s.phase || 1;
        return head + stationRow(s);
      })
      .join('');
    return `
      <div class="proj" data-project="${p.id}" style="--line:${p.color}">
        <div class="group-head">
          <button type="button" class="collapse" aria-expanded="true" aria-controls="proj-${p.id}">
            <span class="chev" aria-hidden="true"></span>
            <span><span class="proj-name"><span class="swatch" aria-hidden="true"></span>${escapeHtml(p.name)}</span><span class="sub">${escapeHtml(p.subtitle)}</span></span>
          </button>
          <label class="switch"><input type="checkbox" data-role="project" data-project="${p.id}"><span class="track" aria-hidden="true"></span><span class="sr-only">Show ${escapeHtml(p.name)}</span></label>
        </div>
        <ul class="stations" id="proj-${p.id}">${rows}</ul>
      </div>`;
  };

  root.innerHTML = `
    ${model.projects.map(projectBlock).join('')}
    <ul class="legend-st3">
      <li><span class="mk selected"></span>Selected / Preferred</li>
      <li><span class="mk hollow"></span>Not Selected</li>
      <li><span class="mk removed"></span><s>Removed</s></li>
      <li><span class="mk ring"></span>Location Accuracy</li>
      <li><span class="ln rapid"></span>RapidRide</li>
      <li><span class="ln local"></span>Other Metro Bus</li>
    </ul>
    <p class="st3-note">Lines are approximate and drawn through the selected options. Bus routes shown are today's network. King County Metro will restructure service when these stations open.</p>
    <p class="st3-note">Buses connect if a stop is within ${model.meta.connect_radius_m} m. Midday frequency is for a weekday, 10 am to 2 pm.</p>`;

  const q = (sel) => root.querySelector(sel);

  root.addEventListener('change', (e) => {
    const t = e.target;
    st3.update((s) => {
      if (t.dataset.role === 'project') s.projects[t.dataset.project] = t.checked;
      if (t.dataset.role === 'alt') s.alts[t.dataset.alt] = t.checked;
    });
  });
  root.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.card) openCard(b.dataset.card, b);
    else if (b.dataset.compare) openCompare(b.dataset.compare, b);
    else if (b.dataset.buses) st3.update((s) => (s.buses[b.dataset.buses] = !s.buses[b.dataset.buses]));
    else if (b.classList.contains('collapse')) {
      const open = b.getAttribute('aria-expanded') !== 'true';
      b.setAttribute('aria-expanded', String(open));
      document.getElementById(b.getAttribute('aria-controls')).hidden = !open;
    }
  });
  bindRouteHover(root);

  // Keep inputs, buttons and route lists in step with the store.
  let lastAlts = '';
  st3.subscribe((s) => {
    for (const p of model.projects) {
      const input = q(`[data-role="project"][data-project="${p.id}"]`);
      input.checked = s.projects[p.id];
      input.disabled = !s.master;
      const block = q(`.proj[data-project="${p.id}"]`);
      block.classList.toggle('off', !s.projectOn(p));
      for (const el of block.querySelectorAll('.stations input, .stations button')) el.disabled = !s.projectOn(p);
    }
    for (const a of model.alts.values()) {
      const input = q(`[data-alt="${a.id}"]`);
      if (input) input.checked = s.alts[a.id];
    }
    for (const st of model.stations.values()) {
      const b = q(`[data-buses="${st.id}"]`);
      b.setAttribute('aria-pressed', String(s.buses[st.id]));
      b.textContent = s.buses[st.id] ? 'Hide Buses' : 'Show Buses';
    }
    const altsKey = JSON.stringify(s.alts);
    if (altsKey !== lastAlts) {
      lastAlts = altsKey;
      for (const st of model.stations.values()) renderRoutes(model, st, q(`[data-station="${st.id}"]`), s);
    }
  });
}

function renderRoutes(model, station, li, state) {
  const ids = model.stationRoutes(station, state);
  li.querySelector('[data-count]').textContent = ids.length;
  li.querySelector('[data-routes]').innerHTML = ids.length
    ? ids
        .map((id) => {
          const r = model.routeById.get(id);
          const serves = servesText(station, model.servedBy(station, id));
          const tph = r.properties.midday_tph;
          return `<li data-route="${id}" tabindex="0">
            ${routeChip(r)}
            <span class="rt-detail">${serves ? `<span class="rt-serves">${escapeHtml(serves)}</span>` : ''}<span class="rt-freq">${tph ? `${tph} / Hr Midday` : 'No Midday Service'}</span></span>
          </li>`;
        })
        .join('')
    : `<li class="muted">${station.multi ? 'Check An Option To See Its Buses' : 'No Routes Within Range'}</li>`;
}

// Hovering or focusing a route anywhere (panel or card) highlights it.
export function bindRouteHover(root) {
  const set = (id) => st3.hoverRoute !== id && st3.update((s) => (s.hoverRoute = id));
  root.addEventListener('mouseover', (e) => {
    const li = e.target.closest('[data-route]');
    if (li) set(li.dataset.route);
  });
  root.addEventListener('mouseout', (e) => {
    const li = e.target.closest('[data-route]');
    if (li && !li.contains(e.relatedTarget)) set(null);
  });
  root.addEventListener('focusin', (e) => e.target.dataset?.route && set(e.target.dataset.route));
  root.addEventListener('focusout', (e) => e.target.dataset?.route && set(null));
}
