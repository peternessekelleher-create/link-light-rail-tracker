// Front-end switches and constants.

// Draw every ST3 station option in data/station_alternatives.geojson, not
// only the preferred one (preferred = true). Off until an alternatives
// comparison view exists; the data is kept so this can be turned on later.
export const SHOW_ALTERNATIVES = false;

// Disclaimers, shown in small muted text next to the thing they describe.
export const NOTES = {
  schedule: 'Schedule-based travel times, not live.',
  walk: 'Walk times assume 3 mph along streets.',
  futureBuses: "Future stations show today's bus network; routes will change.",
  futureLocation: 'Future station locations are approximate (±200–500 ft).',
  simulated: 'Simulated trains: illustrative frequency and crowding.',
  crowding: 'Crowding is estimated from average ridership, not live counts.',
};

// Bus reach bands, by upper bound in minutes.
export const REACH_COLORS = { 15: '#C8102E', 30: '#FF8C7A' };
