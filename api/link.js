// GET /api/link — 1 Line and 2 Line stations and track geometry as JSON.
import { getStatic } from '../lib/gtfs.js';

export default async function handler(req, res) {
  try {
    const { link } = await getStatic();
    // Vercel's CDN holds the response for 6 h and serves a stale copy for up
    // to a day while refreshing in the background, so most visitors never
    // reach this function at all.
    res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=21600, stale-while-revalidate=86400');
    res.status(200).json(link);
  } catch (err) {
    console.error(err);
    res.setHeader('Cache-Control', 'no-store');
    res.status(502).json({ error: 'Could not load Sound Transit GTFS data' });
  }
}
