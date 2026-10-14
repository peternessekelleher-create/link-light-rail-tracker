# Link Light Rail Tracker

An interactive satellite map of Sound Transit's Link **1 Line** and **2 Line**, built live from Sound Transit's official GTFS feed. No transit data is stored in this repo.

- **Step 1:** stations and track, in the official line colors, on a Mapbox satellite map.
- **Step 2:** live trains, each paired with a faded "ghost" at its scheduled position so lateness shows at a glance.
- **Step 3:** switches for each line and direction, a delay tag beside each train ("+3:20"), and a headway panel comparing live and scheduled train spacing.
- **Step 4:** car count and passenger capacity in each train's popup, Title Case labels, and higher contrast (Lighthouse accessibility 100, no contrast failures).

- **Step 5:** a layer tree with a "Sound Transit 3 – Future Network" group: Ballard Link and West Seattle Link stations, every station alternative with its accuracy circle, dashed approximate alignments, and the King County Metro routes that connect to each alternative.

Later steps will add isochrones (travel-time maps), on-time history and ridership.

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
- **Headways** (`lib/headways.js`) are computed server-side in `/api/trains`. For each line and direction, trains are ordered along the direction's main track shape. Each gap is the follower's scheduled running time from where it is to where the leader is. The scheduled figure applies the same method to every trip the timetable has under way right now. Stale trains (over 3 min) and trains still at their first stop are left out.
- **Direction names** ("toward Federal Way Downtown") are the most common `trip_headsign` for each line and `direction_id`, served by `/api/link` as `directions`.
- **Capacity** (`public/lib/capacity.js`): 74 seats and 194 people at target max load per car (Sound Transit's planning standard), times the car count. Link's realtime feed has no per-train car count (`multi_carriage_details`), so the typical count per line is used and labeled "(Typical)"; a real count from the feed would take over automatically.
- **Contrast:** the satellite imagery is dimmed and desaturated (`public/layers/basemap.js`); text colors meet WCAG AA even with a panel over pure white imagery.
- **Thresholds** for on time, late, very late and the headway warning live in `public/lib/delay.js`.
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

## ST3 future network data

The site reads four small files from `data/` (copied to `public/data/` by the Vercel build, `scripts/copy-data.js`). They are rebuilt every Monday by a GitHub Action (`.github/workflows/st3-data.yml`), which commits them only when something changed:

| File | What |
|---|---|
| `st3_network.json` | Hand-maintained tree: projects, stations, panel labels, which option is selected, alignment order |
| `station_alternatives.geojson` | One point per alternative, built by `data/build_station_alternatives.py` from OpenStreetMap intersections ([METHODS.md](data/METHODS.md)) |
| `st3_bus_routes.geojson` | Each connecting Metro route: number, name, RapidRide, weekday midday trips/hour, whole-route shape (most common per direction), and the stations/alternatives it connects to |
| `st3_bus_connections.json` | `station_id → alternative_id → routes`, with each route's nearest stop and distance |

- **Connects:** any stop of the route within `CONNECT_RADIUS_M` (400 m) of the alternative, for every alternative, not just the selected one. All constants are in `pipeline/config.py`.
- **Run it by hand:** `python -m pipeline.build` (add `--rebuild-anchors` to re-query OpenStreetMap). It prints the station → alternative → routes table, the CID route differences and the sanity checks, and exits non-zero if a check fails. Standard-library Python only.
- **Modules:** `pipeline/gtfs.py` is a feed-agnostic GTFS reader, so a synthetic GTFS for the ST3 lines can reuse it before going to r5py or OpenTripPlanner.

## Deploy

1. Import this repo in the Vercel dashboard. The defaults are fine: `vercel.json` sets the build command (copy the ST3 data files) and the output directory (`public`).
2. Add the environment variables `MAPBOX_TOKEN` (your Mapbox public `pk.` token) and `ONEBUSAWAY_API_KEY` (`TEST` until your own key arrives), then redeploy. Changing the key later needs only a new value and a redeploy.
3. In your Mapbox account, restrict the token's URLs to your Vercel domain.

## Check the data pipeline locally

```sh
npm install
npm run check   # fetches the live feed and checks the acceptance criteria
npm run dev     # local preview at http://localhost:3000, keys from .env.local
```
