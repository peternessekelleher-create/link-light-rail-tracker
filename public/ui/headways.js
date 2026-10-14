// Right panel: live vs scheduled average headway per line and direction.
// The numbers are computed server-side in /api/trains; this only renders them.
import { view, liveFeed } from '../lib/view.js';
import { formatClock, HEADWAY_WARN_S } from '../lib/delay.js';

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function renderHeadways(data) {
  const rowsEl = document.getElementById('headway-rows');
  const updatedEl = document.getElementById('headway-updated');
  const toggle = document.getElementById('headways-toggle');
  const body = document.getElementById('headway-body');

  toggle.addEventListener('click', () => {
    const open = toggle.getAttribute('aria-expanded') !== 'true';
    toggle.setAttribute('aria-expanded', String(open));
    body.hidden = !open;
  });

  function render() {
    const hw = liveFeed.body?.headways;
    if (!hw) {
      rowsEl.innerHTML = '<p class="hw-empty">Waiting For Live Data…</p>';
      return;
    }
    const rows = [];
    for (const { line, color } of data.routes) {
      for (const [dir, name] of Object.entries(data.directions?.[line] || {})) {
        if (!view.shown(line, dir)) continue;
        const h = hw[line]?.[dir];
        if (!h) continue;
        const actual = h.actual != null ? formatClock(h.actual) : 'Not Enough Trains';
        const scheduled = h.scheduled != null ? formatClock(h.scheduled) : '—';
        let diff = '';
        if (h.actual != null && h.scheduled != null) {
          const d = h.actual - h.scheduled;
          diff = `<span class="hw-diff${d > HEADWAY_WARN_S ? ' warn' : ''}">${d >= 0 ? '+' : '−'}${formatClock(d)}</span>`;
        }
        rows.push(`
          <div class="hw-row">
            <div class="hw-title"><span class="hw-dot" style="background:${color}"></span>${escapeHtml(line)} · Toward ${escapeHtml(name)}</div>
            <div class="hw-values">Actual ${actual} · Scheduled ${scheduled} ${diff}</div>
            <div class="hw-meta">Based On ${h.trains} Train${h.trains === 1 ? '' : 's'}</div>
          </div>`);
      }
    }
    rowsEl.innerHTML = rows.join('') || '<p class="hw-empty">All Lines And Directions Are Switched Off</p>';
  }

  function renderUpdated() {
    const ts = liveFeed.body?.feedTs;
    updatedEl.textContent = ts ? `Updated ${Math.max(0, Math.round(Date.now() / 1000 - ts))} Sec Ago` : '';
  }

  liveFeed.subscribe(() => { render(); renderUpdated(); });
  view.subscribe(render);
  setInterval(renderUpdated, 1000);
}
