// Vercel build step: copy the data files the site reads from data/ (written
// weekly by the ST3 data Action) into public/data/. Everything else in data/
// (build scripts, CSV, OSM anchor cache) stays out of the deployed site.
import { copyFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const PUBLIC_DATA = [
  'st3_network.json',
  'station_alternatives.geojson',
  'st3_bus_connections.json',
  'st3_bus_routes.geojson',
];

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = new URL('..', import.meta.url);
  mkdirSync(new URL('public/data/', root), { recursive: true });
  for (const f of PUBLIC_DATA) copyFileSync(new URL(`data/${f}`, root), new URL(`public/data/${f}`, root));
  console.log(`Copied ${PUBLIC_DATA.length} data files to public/data/`);
}
