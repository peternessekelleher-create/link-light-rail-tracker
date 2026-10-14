// GET /api/shapes — every 1 Line and 2 Line track shape, by shape_id, so the
// browser can move trains along the exact shape their trip runs on.
import { getStatic } from '../lib/gtfs.js';

export default async function handler(req, res) {
  try {
    const { shapes } = await getStatic();
    const out = {};
    for (const [id, s] of shapes) out[id] = { line: s.line, coordinates: s.coordinates };
    res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=21600, stale-while-revalidate=86400');
    res.status(200).json(out);
  } catch (err) {
    console.error(err);
    res.setHeader('Cache-Control', 'no-store');
    res.status(502).json({ error: 'Could not load Sound Transit GTFS data' });
  }
}
