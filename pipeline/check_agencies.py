"""Does any agency outside config.FEEDS have bus stops near a station?

    python -m pipeline.check_agencies

Checks every feed in config.CANDIDATE_FEEDS and prints the stops it has
within CONNECT_RADIUS_FT of a station, and whether the feed runs any service
in the next four weeks. If one has both, move it into FEEDS.
"""
import datetime as dt

from .config import BUS_ROUTE_TYPES, CANDIDATE_FEEDS, CONNECT_RADIUS_FT, FEEDS
from .geo import dist_ft
from .gtfs import Feed
from .stations import all_stations


def main():
    stations = all_stations(Feed.download(FEEDS["st"], "feed_st.zip"))
    found = False
    for key, url in CANDIDATE_FEEDS.items():
        feed = Feed.download(url, f"feed_{key}.zip")
        agency = next(feed.rows("agency.txt"))["agency_name"]
        bus = {r["route_id"] for r in feed.rows("routes.txt") if r["route_type"] in BUS_ROUTE_TYPES}
        trips = {t["trip_id"] for t in feed.rows("trips.txt") if t["route_id"] in bus}
        served = {st["stop_id"] for st in feed.rows("stop_times.txt") if st["trip_id"] in trips}
        hits = []
        for s in feed.rows("stops.txt"):
            if s["stop_id"] not in served:
                continue
            p = (float(s["stop_lat"]), float(s["stop_lon"]))
            for st in stations:
                d = dist_ft(p, (st["lat"], st["lon"]))
                if d <= CONNECT_RADIUS_FT:
                    hits.append((st["name"], s["stop_name"], round(d)))
        today = dt.date.today()
        current = any(feed.services_on(today + dt.timedelta(days=i)) for i in range(28))
        found |= bool(hits) and current
        note = "" if current else " (feed has no service in the next 4 weeks: expired)"
        print(f"{key} ({agency}): {len(hits)} stops within {CONNECT_RADIUS_FT:,} ft of a station{note}")
        for h in hits:
            print(f"    {h[0]}: {h[1]} at {h[2]:,} ft")
    print("Add the current feeds with stops to FEEDS." if found else "No other agency currently serves a station.")


if __name__ == "__main__":
    main()
