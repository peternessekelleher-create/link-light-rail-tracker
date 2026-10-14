// Vercel build step: copy the data files the site reads from data/ (written
// weekly by the data Action) into public/data/. Everything else in data/
// (build scripts, CSV, OSM anchor cache) stays out of the deployed site.
import { copyFileSync, cpSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const PUBLIC_DATA = [
  'st3_network.json',
  'station_alternatives.geojson',
  'connections.json',
  'routes.geojson',
  'crowding.json',
  'simulated_trains.json',
  'HOW_IT_WORKS.md',
  'METHODS.md',
];
// Directories copied whole: one reach file per station.
export const PUBLIC_DATA_DIRS = ['reach', 'walksheds'];

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = new URL('..', import.meta.url);
  mkdirSync(new URL('public/data/', root), { recursive: true });
  for (const f of PUBLIC_DATA) copyFileSync(new URL(`data/${f}`, root), new URL(`public/data/${f}`, root));
  for (const d of PUBLIC_DATA_DIRS) cpSync(new URL(`data/${d}/`, root), new URL(`public/data/${d}/`, root), { recursive: true });
  console.log(`Copied ${PUBLIC_DATA.length} data files and ${PUBLIC_DATA_DIRS.join(', ')}/ to public/data/`);
}
