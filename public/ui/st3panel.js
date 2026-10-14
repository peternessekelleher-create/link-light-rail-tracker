// Body of the "Sound Transit 3 – Future Network" group in the layer panel:
// what each project's line and markers mean, and the bus-network caveat.
// The group has one switch (in index.html); nothing here toggles.
import { NOTES } from '../config.js';

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// "Ballard Link Phase 1 – 2042" -> "Phase 1 – 2042"; "West Seattle Link – 2035" -> "Opens 2035"
const phaseText = (p, label) => label.replace(p.name, '').trim().replace(/^–\s*/, 'Opens ');

export function renderSt3Panel(model, root) {
  root.innerHTML = `
    <ul class="legend-st3">
      ${model.projects
        .map(
          (p) => `
        <li style="--line:${p.color}">
          <span class="mk hollow" aria-hidden="true"></span><span class="swatch" aria-hidden="true"></span>
          <span><strong>${escapeHtml(p.name)}</strong><span class="sub">${Object.values(p.opening).map((o) => escapeHtml(phaseText(p, o))).join(' · ')}</span></span>
        </li>`,
        )
        .join('')}
    </ul>
    <p class="st3-note">${model.stations.length} planned stations (preferred options). Lines are approximate; Phase 2 is drawn fainter.</p>
    <ul class="legend-sim"><li><span class="mk sim" aria-hidden="true"></span>Simulated future trains</li></ul>
    <p class="note">${escapeHtml(NOTES.simulated)}</p>
    <p class="note">${escapeHtml(NOTES.futureLocation)}</p>
    <p class="note">${escapeHtml(NOTES.futureBuses)}</p>`;
}
