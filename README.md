# Link Light Rail Tracker

An interactive satellite map of Sound Transit's Link **1 Line** and **2 Line**, built live from Sound Transit's official GTFS feed. No transit data is stored in this repo.

- **Step 1:** stations and track, in the official line colors, on a Mapbox satellite map.
- **Step 2:** live trains, each paired with a faded "ghost" at its scheduled position so lateness shows at a glance.
- **Step 3:** switches for each line and direction, a delay tag beside each train ("+3:20"), and a headway panel comparing live and scheduled train spacing.
- **Step 4:** car count and passenger capacity in each train's popup, Title Case labels, and higher contrast (Lighthouse accessibility 100, no contrast failures).

- **Step 5:** a "Sound Transit 3 – Future Network" layer for Ballard Link and West Seattle Link.
- **Step 6:** groundwork for isochrones.
  - **One ST3 switch:** it shows only the 12 preferred stations (hollow markers, labelled with their target opening) and a dashed approximate alignment.
  - **Station card:** click any 1 Line, 2 Line or ST3 station to see its connecting bus routes from every agency.
  - **Bus reach:** hover a station (tap on a phone) to see where buses take you within 15 and 30 minutes, from schedules, for any day type and time of day.

Later steps will add full isochrone polygons, riding Link inside the reach calculation, walk-shed population and jobs, on-time history and ridership.

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
- **Front end:** `public/`, a static page with Mapbox GL JS. Each map layer is a module in `public/layers/` and is registered in `public/app.js`. `public/config.js` holds `SHOW_ALTERNATIVES` (false: only preferred ST3 stations are drawn) and the reach colors.

## Transit data (stations, buses, reach)

A Python build (`pipeline/`, standard library only) downloads the GTFS feeds, computes everything, and writes small files to `data/`. The Vercel build copies them to `public/data/` (`scripts/copy-data.js`). A GitHub Action (`.github/workflows/st3-data.yml`) reruns it every Monday and commits the files only when something changed. Nothing runs on your computer, and the browser never loads raw GTFS.

```sh
python -m pipeline.build                    # everything (about 30 s)
python -m pipeline.build --rebuild-anchors  # also re-query OpenStreetMap for the ST3 anchors
python -m pipeline.build --only link-C27    # reach for some stations only
python -m pipeline.check_agencies           # any other agency with stops near a station?
```

It prints the station → route table and the checks, and it exits non-zero if a check fails. Every constant lives in `pipeline/config.py`: radii, walking speed, windows and feeds.

### Feeds and IDs

| Prefix | Feed | Carries |
|---|---|---|
| `kcm:` | King County Metro, `metro.kingcounty.gov/GTFS/google_transit.zip` | Metro, plus the ST Express routes Metro operates (522, 542, 545, 547, 556, 566) |
| `st:` | Sound Transit, `gtfs.sound.obaweb.org/prod/40_gtfs.zip` | Link and Sounder (used for the station list); its only buses are Link shuttle bus bridges, which are excluded |
| `ct:` | Community Transit, `communitytransit.org/.../current.zip` | CT, including Swift, plus the ST Express routes CT operates (510–535) |
| `pt:` | Pierce Transit, `gtfs.sound.obaweb.org/prod/3_gtfs.zip` | PT, including Stream, plus the ST Express routes PT operates (560–597) |

- **IDs:** every stop, trip, route, service and shape ID is written as `<prefix>:<original id>`. The prefix is the source feed, not the agency, because Sound Transit (agency 40) appears in all four feeds. The panel groups routes by the real agency name.
- **Station IDs:** `link-<parent stop_id>` for the 39 existing stations (e.g. `link-C27`, Othello) and `st3-<station id>` for the 12 preferred ST3 stations (e.g. `st3-ballard`). ST3 IDs follow the station, not the option, so they survive a change of preferred option.
- **Pattern IDs:** `<route_id>:<direction>:<8-hex hash of the stop sequence>`. They stay stable while the stops don't change.
- **Other agencies:** `pipeline.check_agencies` looks for other agencies with stops near a station. In October 2026, Everett Transit and Intercity Transit had none. Seattle Children's hospital shuttle has stops near Univ of Washington and U District, but its feed expired in July 2024, so it isn't included.
- **Buses only:** routes of `route_type` 3 or 11. Link, Sounder, streetcar, monorail, water taxi and ferries are excluded.

### Files

| File | What | Size (gzip) |
|---|---|---|
| `connections.json` | Every station (id, name, kind, lines or ST3 project, opening, coordinates) with its connecting routes grouped by agency: number, name, BRT brand, weekday midday trips/hr, nearest stop and distance. `metadata` holds the feed versions, representative dates, time windows and reach constants. | 13 KB |
| `routes.geojson` | Each connecting route's shape (most common per direction on the representative weekday). Loaded only when a card is open. | 130 KB |
| `reach/<station id>.json` | Bus reach for all 15 time windows (format below) | 9–70 KB each, median 21 KB |
| `station_alternatives.geojson` | All 23 ST3 options with `preferred`; see [METHODS.md](data/METHODS.md) | |
| `st3_network.json` | Hand-maintained: projects, colors, phases, opening labels, alignment order | |

### Connecting routes

- **Connects:** a route connects to a station if any of its stops is within `CONNECT_RADIUS_M` (400 m, straight line) and it runs on at least one of the three representative dates.
- **Trips per hour:** trips calling at the route's nearby stops on the representative weekday, from 9 am to 3 pm (the Midday window), counted once per trip, in the busier direction.
- **BRT:** detected from `route_short_name`. KCM `A Line`–`H Line` are RapidRide, CT `Swift …` are Swift, PT `STCL` is Stream, and `S1`–`S3` would be ST Stride.

### Bus reach (15 / 30 minutes)

- **Total time:** walk + wait + ride, optionally plus one transfer (walk + wait + ride). A stop counts only if the whole trip fits.
- **Walking:** straight-line distance × 1.3 at 80 m/min. Leaving the station adds 2 minutes (platform to street). Access stops must be within 400 m of the station and transfer walks within 250 m. All of these are constants.
- **Schedules:** wait and ride times come from the published `stop_times`, not live data. `pickup_type` and `drop_off_type` are respected.
- **Windows:** 3 day types × 5 periods, in Seattle time. Day types are Weekday, Saturday and Sunday. Periods are AM rush 6–9, Midday 9–15, PM rush 15–18, Evening 18–22 and Night 22–01. The Night window uses the next day's early trips.
- **Representative dates:** for each day type, the first date on or after the latest feed start date when every feed runs at least 90% of its usual bus trips for that weekday. That skips holidays, and an unchanged set of feeds gives the same dates every week. Currently those are Wed 2026-10-07, Sat 2026-10-03 and Sun 2026-10-04.
- **Algorithm:** RAPTOR limited to 2 rounds (`pipeline/raptor.py`), run for departures from the station every 5 minutes across the window.
- **Median:** each stop keeps the median total over the samples, and a sample that misses 30 minutes counts as too long. With an even number of samples it's the lower median, so the time is one a rider actually gets, and the stored path is that sample's path. Bands: at most 15 minutes, or at most 30.
- **Transfers:** a second ride on the same route but a different trip pattern is allowed. Short-turn and through-routed trips (e.g. a 50 that ends at Seward Park and one that starts there) are a real change of trip, and ruling them out cut Othello's reach by a fifth.
- **Why rush can reach more than midday:** at 4 of the 5 checked stations, rush hour reaches more stops. This comes from the schedules. Ballard's D Line runs every 8 minutes at rush and every 10 at midday, and its AM run to downtown is scheduled 2 minutes faster. Westlake also gains peak-only routes (510, 577, 590, 13).

### Reach file format

All arrays; windows refer to the tables by index.

```js
{
  "v": 1,
  "station": { "id": "link-C27", "name": "Othello", "kind": "link", "lat": 47.538, "lon": -122.281 },
  "access_stops": 11,
  "stops":    [["kcm:1234", "S Othello St & MLK Jr Way S", 47.5378, -122.2817], ...],
  "routes":   [["kcm:100210", "36", "King County Metro", null], ...],   // [id, number, agency, BRT brand]
  "patterns": [["kcm:100210:0:3f2a91c0", 1], ...],                      // [pattern id, route]
  "hops":     [[pattern, stop position, "encoded polyline"], ...],      // route shape between two consecutive stops
  "windows": {
    "weekday-pm": {
      "date": "2026-10-07", "samples": 36, "departures": 155,           // bus departures from the access stops
      "routes": 6, "stops15": 18, "stops30": 157,
      "reached":  [[stop, minutes, band 15|30, transfer 0|1, [[pattern, board stop, alight stop], ...]], ...],
      "segments": [[hop, band 15|30, transfer 0|1], ...]                 // ridden pieces to draw
    }, ...
  }
}
```

Polylines are Google's encoded format, precision 5 (`public/lib/polyline.js`). The page loads a station's file on first hover and caches it.

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
