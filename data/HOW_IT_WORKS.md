Everything on the map except the live trains comes from small files a weekly build writes (`pipeline/`, run by a GitHub Action). The page never loads raw GTFS or OpenStreetMap data. Distances are in feet.

## Stations

- **1 Line and 2 Line:** parent stations from Sound Transit's GTFS feed.
- **Sound Transit 3:** the 12 preferred station options for Ballard Link and West Seattle Link. Sound Transit publishes no coordinates for them, so each point comes from street intersections named in Sound Transit's own documents. Points are approximate (±200–500 ft); see the station methods below.

## Connecting bus routes

- **Connects:** a bus route connects to a station if any of its stops is within 1,320 ft (a quarter mile), straight line.
- **Sources:** King County Metro, Sound Transit, Community Transit and Pierce Transit GTFS. Every ID is prefixed by its feed (`kcm:`, `st:`, `ct:`, `pt:`), so IDs from different agencies can't collide.
- **Trips per hour:** weekday midday (9 am–3 pm) trips at the route's stops near the station, in the busier direction.
- **Buses only:** no Link, Sounder, streetcar, monorail, water taxi or ferries.
- **Future stations:** they show today's bus network. Metro and the other agencies will restructure routes when the stations open.

## Bus reach (15 and 30 minutes)

- **Total time:** walk from the station to a stop, wait, and ride, plus optionally one transfer (walk, wait, ride). A stop counts only if the whole trip fits.
- **Walking:** straight-line distance × 1.3 at 264 ft/min (3 mph). Leaving the station adds 2 minutes (platform to street). The first stop must be within 1,320 ft of the station, and a transfer walk within 800 ft.
- **Schedules:** waits and rides come from the published timetables (`stop_times`), not live data.
- **Departures:** for each time window, a trip starts every 5 minutes across the window, and each stop gets the median total time. That captures typical waits and slower rush-hour schedules. A departure that misses 30 minutes counts as too long.
- **Algorithm:** RAPTOR limited to two rides. Each reached stop keeps its path (route, pattern, boarding stop, alighting stop), so the ridden segments can be drawn.
- **Windows:** Weekday, Saturday and Sunday, each on a representative non-holiday date from the feed calendars. Periods are AM rush 6–9, Midday 9–3, PM rush 3–6, Evening 6–10 and Night 10–1.

## Walk sheds (5 and 10 minutes)

- **Where from:** the station itself, and every stop the bus reach shows in the chosen window (both bands, including stops reached after a transfer).
- **Distances:** 5 minutes is 1,320 ft and 10 minutes is 2,640 ft, walked along the street network at 264 ft/min (3 mph). A whole trip, door to door, can therefore take about 40 minutes.
- **Walking network:** OpenStreetMap's sidewalks, paths, stairs, crossings, pedestrian bridges and ordinary streets. Freeways and ways tagged as closed to people on foot are left out, so a freeway or a lake is a barrier unless a bridge or crossing exists.
- **Method:**
  - Each stop is snapped to the nearest walkable way (within 330 ft).
  - Every street piece within the walking distance is widened by 100 ft, and the pieces are merged.
  - Per station and window, all the stops' areas merge into one 5-minute area and one 10-minute area, simplified to about 30 ft.
- **Check:** each weekly build tests a stop beside I-5 and one on the shore of Lake Union. Fewer than 2% of the street points across the barrier may fall inside the shed, and in practice it's nearly none.

## Sources

- King County Metro GTFS: metro.kingcounty.gov/GTFS/google_transit.zip
- Sound Transit GTFS: gtfs.sound.obaweb.org/prod/40_gtfs.zip
- Community Transit GTFS: communitytransit.org (open data)
- Pierce Transit GTFS: gtfs.sound.obaweb.org/prod/3_gtfs.zip
- Street intersections for the ST3 stations and the walking network: © OpenStreetMap contributors, ODbL (Geofabrik Washington extract)
