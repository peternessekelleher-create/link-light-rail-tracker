// Distances on screen are in feet, or miles above 5,280 ft. Never meters.
export const FT_PER_MILE = 5_280;

// 78 -> "78 ft", 1320 -> "1,320 ft", 7920 -> "1.5 mi"
export function formatDistance(ft) {
  if (ft > FT_PER_MILE) return `${(ft / FT_PER_MILE).toFixed(1)} mi`;
  return `${Math.round(ft).toLocaleString('en-US')} ft`;
}
