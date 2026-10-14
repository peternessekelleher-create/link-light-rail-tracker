// GET /api/trains — live 1 Line and 2 Line trains with their schedules.
// The OneBusAway key is read here and never leaves the server.
import { getTrains, FeedError } from '../lib/realtime.js';

const FRESH_MS = 10 * 1000;

// One upstream fetch per 10 s per warm instance, on top of the CDN cache, to
// stay well inside the shared TEST key's rate limit.
let cached = null; // { body, at }
let inflight = null;

export default async function handler(req, res) {
  const key = process.env.ONEBUSAWAY_API_KEY;
  if (!key) return fail(res, 500, 'not_configured');

  try {
    if (!cached || Date.now() - cached.at > FRESH_MS) {
      inflight ??= getTrains(key)
        .then((body) => (cached = { body, at: Date.now() }))
        .finally(() => (inflight = null));
      await inflight;
    }
    res.setHeader('Cache-Control', 'public, s-maxage=10, stale-while-revalidate=20');
    res.status(200).json(cached.body);
  } catch (err) {
    // FeedError messages are written by us and never contain the key.
    console.error(err instanceof FeedError ? err.message : `trains: ${err.name}`);
    const code = err instanceof FeedError ? (err.status === 401 || err.status === 403 ? 'unauthorized' : err.status === 429 ? 'rate_limited' : 'upstream') : 'internal';
    fail(res, 502, code);
  }
}

function fail(res, status, code) {
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).json({ error: 'Live data temporarily unavailable', code });
}
