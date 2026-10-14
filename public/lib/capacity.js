// Train size and capacity. Totals are always computed from these constants.

// Typical cars per train, used when the realtime feed gives no car count
// (as of Oct 2026 it never does for Link).
export const TYPICAL_CARS = { '1 Line': 4, '2 Line': 2 };

// Sound Transit's per-car planning standard: seats, plus standees at
// "target max load".
export const SEATS_PER_CAR = 74;
export const STANDING_PER_CAR = 120;
export const MAX_LOAD_PER_CAR = SEATS_PER_CAR + STANDING_PER_CAR;

// feedCars: the feed's car count for this train, or null.
export function trainCapacity(line, feedCars) {
  const measured = Number.isInteger(feedCars) && feedCars > 0;
  const cars = measured ? feedCars : TYPICAL_CARS[line];
  if (!cars) return null;
  return { cars, typical: !measured, seats: cars * SEATS_PER_CAR, maxLoad: cars * MAX_LOAD_PER_CAR };
}
