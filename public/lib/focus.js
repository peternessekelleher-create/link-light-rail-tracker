// Which station the map is focused on (hovered or pinned), shared by every
// layer that dims when something else is in focus.
import { store } from './view.js';

export const focus = store({ id: null });

// How much unrelated things fade while a station is in focus.
export const DIM = {
  stations: 0.25, // other stations and their labels
  lines: 0.3, // Link lines and future alignments
  trains: 0.4, // live, ghost and simulated trains
  overlay: 0.35, // black over the basemap
  ms: 150, // fade duration
};
