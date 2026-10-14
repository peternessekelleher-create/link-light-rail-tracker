# Link Light Rail Tracker

An interactive satellite map of Sound Transit's Link **1 Line** and **2 Line**, built live from Sound Transit's official GTFS feed. No transit data is stored in this repo.

- **Step 1:** stations and track, in the official line colors, on a Mapbox satellite map.
- **Step 2:** live trains, each paired with a faded "ghost" at its scheduled position so lateness shows at a glance.

Later steps will add on-time history and ridership.

## How it works

```
Browser ──► /api/config   Mapbox token from the MAPBOX_TOKEN env var
        ├─► /api/link     stations + one track line per Link line        (cached 6 h)
        ├─► /api/shapes   every 1/2 Line trip shape, by shape_id          (cached 6 h)
        └─► /api/trains   live trains + their schedules, every 15 s       (cached 10 s)
                          OneBusAway GTFS-realtime → keep 1 & 2 Line → match to the timetable
```

`/api/link` and `/api/shapes` come from Sound Transit's static GTFS feed, parsed once per server instance and cached in memory (`lib/gtfs.js`). `/api/trains` (`lib/realtime.js`) adds the live data.

### Live trains and ghosts

- **Delay** is measured from the train's reported position: how far behind or ahead of the timetable it was when it reported. The popup shows this number, and the map draws the train and its ghost exactly that far apart. The trip update's own prediction for the next stop appears beside the next stop's name.
- **Motion:** reports are usually 10–60 s old. Between reports, each train keeps moving along its own track on the timetable shifted by its delay, for up to 90 s after its report. The ghost moves on the timetable itself. A new report makes the train glide to its corrected spot along the track.
- **Ghosts** are hidden when a train is within 60 s of schedule (`GHOST_THRESHOLD_S` in `public/layers/trains.js`).
- **Service day:** Link's realtime feed has no `start_date`, so each trip's service day is the one (today or yesterday in Seattle) whose timetable covers the report time.
- **API key:** OneBusAway's realtime feeds accept any key, so `/api/trains` also checks the key against OneBusAway's REST API (at most once per 10 min) so that a bad key shows the "Live data temporarily unavailable" banner.

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
2. Add the environment variables `MAPBOX_TOKEN` (your Mapbox public `pk.` token) and `ONEBUSAWAY_API_KEY` (`TEST` until your own key arrives), then redeploy. Changing the key later needs only a new value and a redeploy.
3. In your Mapbox account, restrict the token's URLs to your Vercel domain.

## Check the data pipeline locally

```sh
npm install
npm run check   # fetches the live feed and checks the acceptance criteria
npm run dev     # local preview at http://localhost:3000, keys from .env.local
```
