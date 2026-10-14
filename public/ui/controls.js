// Left panel: an on/off switch per line, with one per direction underneath.
// Direction names come from the GTFS feed (most common headsign).
import { view } from '../lib/view.js';

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function renderControls(data) {
  const root = document.getElementById('line-toggles');
  root.innerHTML = data.routes
    .map(({ line, color }) => {
      const dirs = Object.entries(data.directions?.[line] || {});
      return `
      <fieldset class="line-group" data-line="${escapeHtml(line)}" style="--line:${color}">
        <legend class="sr-only">${escapeHtml(line)}</legend>
        <label class="switch line-switch">
          <input type="checkbox" data-role="line" checked>
          <span class="track" aria-hidden="true"></span>
          <span class="line-name">${escapeHtml(line)}</span>
        </label>
        <div class="dir-switches">
          ${dirs
            .map(
              ([dir, name]) => `
          <label class="switch small">
            <input type="checkbox" data-role="dir" data-dir="${escapeHtml(dir)}" checked>
            <span class="track" aria-hidden="true"></span>
            <span>Toward ${escapeHtml(name)}</span>
          </label>`,
            )
            .join('')}
        </div>
      </fieldset>`;
    })
    .join('');

  root.addEventListener('change', (e) => {
    const input = e.target;
    const group = input.closest('.line-group');
    const line = group.dataset.line;
    view.update((v) => {
      if (input.dataset.role === 'line') v.lines[line] = input.checked;
      else v.dirs[line][input.dataset.dir] = input.checked;
    });
    if (input.dataset.role === 'line') {
      // Grey out, but keep, the direction settings while the line is off.
      group.classList.toggle('off', !input.checked);
      for (const d of group.querySelectorAll('[data-role="dir"]')) d.disabled = !input.checked;
    }
  });
}
