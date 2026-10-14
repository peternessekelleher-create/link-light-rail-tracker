// GET /api/link — 1 Line and 2 Line stations and track geometry as JSON.
import { loadLinkData } from '../lib/gtfs.js';

const CACHE_MS = 6 * 60 * 60 * 1000; // 6 hours

// Kept in module scope so a warm function instance answers from memory.
let cached = null; // { data, at }
let inflight = null;

async function getData() {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.data;
  inflight ??= loadLinkData()
    .then((data) => (cached = { data, at: Date.now() }).data)
    .finally(() => (inflight = null));
  try {
    return await inflight;
  } catch (err) {
    // If Sound Transit is unreachable, a stale copy beats an empty map.
    if (cached) return cached.data;
    throw err;
  }
}

export default async function handler(req, res) {
  try {
    const data = await getData();
    // Vercel's CDN holds the response for 6 h and serves a stale copy for up
    // to a day while refreshing in the background, so most visitors never
    // reach this function at all.
    res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=21600, stale-while-revalidate=86400');
    res.status(200).json(data);
  } catch (err) {
    console.error(err);
    res.setHeader('Cache-Control', 'no-store');
    res.status(502).json({ error: 'Could not load Sound Transit GTFS data' });
  }
}
