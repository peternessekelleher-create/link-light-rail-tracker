// Delay thresholds and formatting, shared by train popups, delay tags and the
// headway panel. Adjust here to match Sound Transit's on-time definition.

export const ON_TIME_S = 60; // within this either way counts as on time (and hides the ghost)
export const VERY_LATE_S = 5 * 60; // late by more than this is shown in red
export const HEADWAY_WARN_S = 60; // actual headway this much over schedule is flagged

// Tag and popup colors: bright variants that read on a dark halo or panel.
export const DELAY_COLORS = { ontime: '#ffffff', late: '#ffd24d', 'very-late': '#ff8a7a', early: '#9ad8ff' };

// 200 -> "3:20"
export function formatClock(s) {
  const a = Math.abs(Math.round(s));
  return `${Math.floor(a / 60)}:${String(a % 60).padStart(2, '0')}`;
}

// 200 -> "+3:20", -75 -> "−1:15", 20 -> "On Time"
export function formatDelay(s) {
  if (Math.abs(s) < ON_TIME_S) return 'On Time';
  return `${s > 0 ? '+' : '−'}${formatClock(s)}`;
}

export function delayClass(s) {
  if (Math.abs(s) < ON_TIME_S) return 'ontime';
  if (s < 0) return 'early';
  return s > VERY_LATE_S ? 'very-late' : 'late';
}
