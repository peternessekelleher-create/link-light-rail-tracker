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

## Sources

- King County Metro GTFS: metro.kingcounty.gov/GTFS/google_transit.zip
- Sound Transit GTFS: gtfs.sound.obaweb.org/prod/40_gtfs.zip
- Community Transit GTFS: communitytransit.org (open data)
- Pierce Transit GTFS: gtfs.sound.obaweb.org/prod/3_gtfs.zip
- Street intersections for the ST3 stations: © OpenStreetMap contributors, ODbL
