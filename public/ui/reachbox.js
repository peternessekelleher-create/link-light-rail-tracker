// Corner box for bus reach: the time picker (day type + period, defaulting
// to the current time in Seattle), the summary for the station shown, and
// the legend.
import { REACH_COLORS } from '../config.js';
import { reachView, currentWindow, windowLabel } from '../lib/reach.js';

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const hourLabel = (h) => {
  const x = h % 24;
  return `${x % 12 || 12} ${x < 12 ? 'am' : 'pm'}`;
};

export function createReachBox(root, meta, stationName) {
  const [day0, period0] = currentWindow(meta).split('-');
  root.innerHTML = `
    <p class="rb-title">Bus reach from a station</p>
    <div class="rb-picker">
      <label><span class="sr-only">Day</span>
        <select data-pick="day">${meta.day_types.map((d) => `<option value="${d.id}">${escapeHtml(d.label)}</option>`).join('')}</select>
      </label>
      <label><span class="sr-only">Time of day</span>
        <select data-pick="period">${meta.periods
          .map((p) => `<option value="${p.id}">${escapeHtml(p.label)} (${hourLabel(p.start)}–${hourLabel(p.end)})</option>`)
          .join('')}</select>
      </label>
    </div>
    <p class="rb-note">Schedule-based travel times (not live)</p>
    <p class="rb-summary" data-summary role="status" aria-live="polite"></p>
    <ul class="rb-legend">
      <li><span class="sw" style="background:${REACH_COLORS[15]}"></span>Within 15 min</li>
      <li><span class="sw" style="background:${REACH_COLORS[30]}"></span>15–30 min</li>
      <li><span class="sw dashed"></span>After 1 transfer</li>
    </ul>`;

  const day = root.querySelector('[data-pick="day"]');
  const period = root.querySelector('[data-pick="period"]');
  day.value = day0;
  period.value = period0;
  const pick = () => reachView.update((v) => (v.window = `${day.value}-${period.value}`));
  day.addEventListener('change', pick);
  period.addEventListener('change', pick);
  pick();

  const summary = root.querySelector('[data-summary]');
  const idle = `<span class="muted">${matchMedia('(hover: hover)').matches ? 'Hover' : 'Tap'} a station to see where buses go in 30 minutes.</span>`;
  summary.innerHTML = idle;

  return {
    // Called by the reach layer with { id, loading | error | summary } or null.
    status(s) {
      if (!s) return void (summary.innerHTML = idle);
      const from = `From ${escapeHtml(stationName(s.id))} · ${escapeHtml(windowLabel(meta, reachView.window))}`;
      if (s.loading) summary.innerHTML = `${from} · <span class="muted">Loading…</span>`;
      else if (s.error) summary.innerHTML = `${from} · <span class="error-text">Couldn't load travel times</span>`;
      else if (!s.summary.departures) summary.innerHTML = `${from}<br><strong>No bus service in this window.</strong>`;
      else if (!s.summary.stops30) summary.innerHTML = `${from}<br><strong>No stop reachable by bus within 30 min in this window.</strong>`;
      else {
        const r = s.summary;
        summary.innerHTML = `${from} · <strong>${r.routes} route${r.routes === 1 ? '' : 's'}</strong> · <strong>${r.stops30} stops</strong> within 30 min`;
      }
    },
  };
}
