# Link Light Rail Tracker

An interactive satellite map of Sound Transit's Link **1 Line** and **2 Line**, built live from Sound Transit's official GTFS feed. No transit data is stored in this repo.

**Step 1 (this version):** stations and track, in the official line colors, on a Mapbox satellite map. Later steps will add live trains, on-time history and ridership.

## How it works

```
Browser ──► /api/config   Mapbox token from the MAPBOX_TOKEN env var
        └─► /api/link     Vercel function: download GTFS zip → unzip → keep 1 & 2 Line → small JSON
                          (cached 6 h at Vercel's CDN plus in memory)
```

- **Data:** `https://www.soundtransit.org/GTFS-rail/40_gtfs.zip`, from the [Open Transit Data downloads page](https://www.soundtransit.org/help-contacts/business-information/open-transit-data-otd/otd-downloads). Lines are matched by `route_short_name` with `route_type` 0; colors come from `route_color`.
- **`/api/link` response** (about 10 KB gzipped):
  ```json
  {
    "stations": [{ "name": "Westlake", "lat": 47.61, "lon": -122.34, "lines": ["1 Line", "2 Line"] }],
    "routes":   [{ "line": "1 Line", "color": "#28813F", "coordinates": [[47.81, -122.29], ...] }]
  }
  ```
- **Front end:** `public/`, a static page with Mapbox GL JS. Each map layer is a module in `public/layers/` and is registered in `public/app.js`.

## Deploy

1. Import this repo in the Vercel dashboard. The defaults are fine: no framework, no build command (`vercel.json` sets the output directory to `public`).
2. Add the environment variable `MAPBOX_TOKEN` (your Mapbox public `pk.` token), then redeploy.
3. In your Mapbox account, restrict the token's URLs to your Vercel domain.

## Check the data pipeline locally

```sh
npm install
npm run check   # fetches the live feed and checks the acceptance criteria
```
