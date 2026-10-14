// Front-end switches and constants.

// Draw every ST3 station option in data/station_alternatives.geojson, not
// only the preferred one (preferred = true). Off until an alternatives
// comparison view exists; the data is kept so this can be turned on later.
export const SHOW_ALTERNATIVES = false;

// Bus reach bands, by upper bound in minutes.
export const REACH_COLORS = { 15: '#C8102E', 30: '#FF8C7A' };
