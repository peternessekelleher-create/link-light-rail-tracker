// GET /api/config — public client settings read from Vercel environment
// variables, so the Mapbox token never lives in the repo.
export default function handler(req, res) {
  const mapboxToken = process.env.MAPBOX_TOKEN;
  if (!mapboxToken) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(500).json({ error: 'MAPBOX_TOKEN is not set in the Vercel project settings' });
  }
  res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=3600');
  res.status(200).json({ mapboxToken });
}
