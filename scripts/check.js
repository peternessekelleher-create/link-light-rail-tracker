// Runs the GTFS pipeline against the live feed and checks the Step 1
// acceptance criteria. Usage: npm run check
import { loadLinkData, LINES } from '../lib/gtfs.js';

const t0 = Date.now();
const data = await loadLinkData();
const json = JSON.stringify(data);
const fail = (msg) => { console.error(`FAIL: ${msg}`); process.exitCode = 1; };

if (data.routes.map((r) => r.line).join() !== LINES.join()) fail(`routes are ${data.routes.map((r) => r.line)}`);
for (const r of data.routes) {
  if (!/^#[0-9A-F]{6}$/.test(r.color)) fail(`${r.line} color ${r.color}`);
  if (r.coordinates.length < 100) fail(`${r.line} has only ${r.coordinates.length} track points`);
}
for (const s of data.stations) {
  if (!s.lines.length || s.lines.some((l) => !LINES.includes(l))) fail(`${s.name} lines ${s.lines}`);
  if (Math.abs(s.lat - 47.6) > 1 || Math.abs(s.lon + 122.3) > 1) fail(`${s.name} at ${s.lat},${s.lon}`);
}

console.log(`${data.stations.length} stations, ${data.routes.map((r) => `${r.line} ${r.color} ${r.coordinates.length} pts`).join('; ')}`);
console.log(`payload ${(json.length / 1024).toFixed(1)} KB, built in ${Date.now() - t0} ms`);
console.log(data.stations.map((s) => `${s.name} [${s.lines.join(', ')}]`).join('\n'));
