// Fetches the small files the weekly data build writes to data/. Each URL is
// fetched once per page load and shared by everything that asks for it.
const cache = new Map();

export function getJson(url) {
  if (!cache.has(url)) {
    const p = fetch(url).then((res) => {
      if (!res.ok) throw new Error(`${url} returned ${res.status}`);
      return res.json();
    });
    // A failed fetch can be retried on the next request.
    p.catch(() => cache.delete(url));
    cache.set(url, p);
  }
  return cache.get(url);
}

export const loadConnections = () => getJson('/data/connections.json');
export const loadRoutes = () => getJson('/data/routes.geojson');
export const loadNetwork = () => getJson('/data/st3_network.json');
export const loadAlternatives = () => getJson('/data/station_alternatives.geojson');
export const loadReachFile = (stationId) => getJson(`/data/reach/${encodeURIComponent(stationId)}.json`);
// "<station id>_<window>", e.g. "link-C27_weekday-pm"
export const loadWalkShedFile = (key) => getJson(`/data/walksheds/${encodeURIComponent(key)}.topojson`);
