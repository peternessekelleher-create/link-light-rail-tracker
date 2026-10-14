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
  - Per station and window, all the stops' areas merge into one 5-minute area and one 10-minute area.
  - Smoothing: the merged area is grown by 40 ft and shrunk back, which closes slivers. Then every enclosed gap up to 20 acres is filled, which covers the insides of blocks the street buffers leave open. Lakes and large parks stay open. The result is simplified to about 30 ft.
- **Check:** each weekly build tests a stop beside I-5 and one on the shore of Lake Union. Fewer than 2% of the street points across the barrier may fall inside the shed, and in practice it's nearly none.

## Crowding (estimated, not live)

- **What the fill means:** each train marker fills from the bottom, empty to full. Full is Sound Transit's "target max load" of 194 riders per car (74 seated + 120 standing).
- **Levels:**
  - Seats available: up to 38%, which is all 74 seats taken.
  - Some standing: up to 76%, Sound Transit's planning load of 148 per car.
  - Crowded: up to 100%.
  - Very crowded: over 100%.
- **Daily boardings by station:** Sound Transit's System Performance Tracker (average weekday, 2025). Exceptions:
  - Stations that opened later use 2026 figures.
  - The Lynnwood–CID stations are scaled up to the April 2026 total (98,300), after the 2 Line began crossing the lake.
  - A station both lines serve is split between them by scheduled trains.
- **Direction:**
  - 1 Line: each station's split comes from Seattle Transit Blog's May 2025 counts by direction. Those raw counts lean 2.6 to 1 northbound, so they're rebalanced so that a whole day is even.
  - 2 Line: assumed 50/50.
- **Where riders get off:** spread over the stations further along the line, in proportion to those stations' boardings.
- **Time of day:** an assumed weekday profile (AM rush 22%, midday 30%, PM rush 24%, evening 15%, night 6%). Saturday is 75% of a weekday and Sunday 62% (assumptions). Each segment's riders in a window are divided by the trains scheduled then. The same profile applies to both directions, so the morning tide toward downtown isn't modeled.
- **Cars:** 1 Line trains have 4 cars. 2 Line trains mix 2 and 3 cars, so 2.5 is used.
- **Live trains:** use the segment they're on and the current time of day. They're not counted live.
- **Known differences:**
  - Spreading riders by boardings puts the 1 Line's busiest stretch at Pioneer Square ↔ International District.
  - Seattle Transit Blog's real alightings put it a little north, at Capitol Hill ↔ University of Washington.
  - Eastside 2 Line figures from 2025 predate the lake crossing and are probably low.

## Simulated future trains

- **Lines:** Ballard Link (SODO ↔ the new downtown tunnel ↔ Ballard) and West Seattle Link (SODO ↔ Alaska Junction), at full build-out. Trains enter and leave at SODO.
- **Phase 2:** Seattle Center ↔ Ballard trains are drawn at 50% and tagged "unfunded".
- **Frequency:** the current 1 Line's scheduled headway in the chosen time window, for example every 8 minutes at weekday PM rush and every 16 at night.
- **Speed:** the 1 Line's average scheduled speed between stations (about 33 mph), with 30-second station stops. Trains run straight between stations along the approximate alignment.
- **Crowding:** the same model, using Sound Transit's 2042 projected boardings:
  - West Seattle Link Final EIS: Delridge 5,400, Alaska Junction 7,600.
  - 2022 Draft EIS: the Ballard Link stations, the new SODO station (7,400, shared by the two lines) and the new CID station (10,000, the midpoint of 9,000–11,000).
- **Assumptions:** 4-car trains and 50/50 directions.
- **Purpose:** illustrative only. Sound Transit hasn't published service plans for these lines.

## Sources

- King County Metro GTFS: metro.kingcounty.gov/GTFS/google_transit.zip
- Sound Transit GTFS: gtfs.sound.obaweb.org/prod/40_gtfs.zip
- Community Transit GTFS: communitytransit.org (open data)
- Pierce Transit GTFS: gtfs.sound.obaweb.org/prod/3_gtfs.zip
- Street intersections for the ST3 stations and the walking network: © OpenStreetMap contributors, ODbL (Geofabrik Washington extract)
- Ridership: Sound Transit System Performance Tracker; Seattle Transit Blog (May 2025 1 Line counts; April 2026 station data); West Seattle Link Final EIS Ch. 6; West Seattle and Ballard Link Draft EIS Ch. 3. Full list with links: data/ridership/SOURCES.md
- Train capacity: Sound Transit loading standards (74 seats; 148 planning load; 194 target max load per car)
