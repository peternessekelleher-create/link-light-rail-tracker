"""All feeds merged into one bus network with feed-prefixed IDs.

    net = Network.load()
    net.stops["kcm:1234"]      -> Stop(id, name, lat, lon)
    net.routes["ct:701"]       -> Route(...)
    net.trips["pt:98765"]      -> Trip(id, route_id, service_id, direction, shape_id)
    net.stop_times["kcm:..."]  -> StopTimes for that trip (bus trips only)
    net.services_on(date)      -> prefixed service_ids running that day

Every ID is "<feed>:<original id>" (see config.FEEDS) so nothing can collide.
Only bus routes are kept (config.BUS_ROUTE_TYPES, minus EXCLUDE_ROUTES); the
Sound Transit feed is also read raw by stations.py for the Link stations.
"""
import datetime as dt
import re
import sys
from array import array
from collections import Counter
from dataclasses import dataclass, field

from .config import (
    AGENCY_NAMES, BRT_PATTERNS, BUS_ROUTE_TYPES, EXCLUDE_ROUTES, FEEDS, REP_DAY_MIN_SHARE,
)
from .gtfs import Feed, seconds


@dataclass(frozen=True)
class Stop:
    id: str
    name: str
    lat: float
    lon: float


@dataclass
class Route:
    id: str
    feed: str
    agency: str
    number: str
    name: str
    brt: str | None  # brand ("RapidRide", "Swift", ...) or None
    color: str


@dataclass(frozen=True)
class Trip:
    id: str
    route_id: str
    service_id: str
    direction: str
    shape_id: str


@dataclass
class StopTimes:
    """One trip's calls in stop_sequence order. Times are seconds after the
    service day's noon-minus-12h (GTFS convention, may exceed 24 h)."""
    stops: tuple
    arr: array
    dep: array
    pickup: tuple  # False where pickup_type = 1 (no boarding)
    dropoff: tuple  # False where drop_off_type = 1 (no alighting)
    dist: tuple  # shape_dist_traveled or None


@dataclass
class Network:
    stops: dict = field(default_factory=dict)
    routes: dict = field(default_factory=dict)
    trips: dict = field(default_factory=dict)
    stop_times: dict = field(default_factory=dict)
    shapes: dict = field(default_factory=dict)  # shape_id -> [(lat, lon, dist or None)]
    feeds: dict = field(default_factory=dict)  # key -> Feed
    versions: dict = field(default_factory=dict)  # key -> feed_info summary

    @classmethod
    def load(cls, feeds=None, with_shapes=True):
        net = cls()
        for key, url in (feeds or FEEDS).items():
            feed = Feed.download(url, f"feed_{key}.zip")
            net.feeds[key] = feed
            net._add(key, feed, with_shapes)
        return net

    def _add(self, key, feed, with_shapes):
        p = f"{key}:".__add__
        info = feed.feed_info()
        self.versions[key] = {
            "url": FEEDS.get(key),
            "version": info.get("feed_version"),
            "start": info.get("feed_start_date"),
            "end": info.get("feed_end_date"),
        }
        agencies = {a.get("agency_id", ""): a["agency_name"] for a in feed.rows("agency.txt")}
        default_agency = next(iter(agencies.values()))
        for r in feed.rows("routes.txt"):
            rid = p(r["route_id"])
            if r["route_type"] not in BUS_ROUTE_TYPES or rid in EXCLUDE_ROUTES:
                continue
            agency = agencies.get(r.get("agency_id", ""), default_agency)
            number = r["route_short_name"] or r["route_long_name"]
            # King County Metro leaves route_long_name empty and puts the
            # terminals in route_desc.
            long = r["route_long_name"] if r["route_long_name"] != number else ""
            self.routes[rid] = Route(
                id=rid, feed=key,
                agency=AGENCY_NAMES.get(agency, agency),
                number=number,
                name=long or r.get("route_desc", ""),
                brt=brt_brand(key, number),
                color=("#" + r["route_color"]) if r.get("route_color") else "",
            )
        for t in feed.rows("trips.txt"):
            rid = p(t["route_id"])
            if rid in self.routes:
                self.trips[p(t["trip_id"])] = Trip(p(t["trip_id"]), rid, p(t["service_id"]), t.get("direction_id") or "0", p(t["shape_id"]) if t.get("shape_id") else "")

        calls = {}
        for st in feed.rows("stop_times.txt"):
            tid = p(st["trip_id"])
            if tid not in self.trips:
                continue
            a, d = st["arrival_time"] or st["departure_time"], st["departure_time"] or st["arrival_time"]
            if not a:
                continue  # untimed stop; skipped rather than interpolated
            dist = st.get("shape_dist_traveled")
            calls.setdefault(tid, []).append((
                int(st["stop_sequence"]), sys.intern(p(st["stop_id"])), seconds(a), seconds(d),
                st.get("pickup_type") != "1", st.get("drop_off_type") != "1",
                float(dist) if dist else None,
            ))
        used_stops = set()
        for tid, c in calls.items():
            c.sort()
            self.stop_times[tid] = StopTimes(
                stops=tuple(x[1] for x in c), arr=array("i", (x[2] for x in c)), dep=array("i", (x[3] for x in c)),
                pickup=tuple(x[4] for x in c), dropoff=tuple(x[5] for x in c), dist=tuple(x[6] for x in c),
            )
            used_stops.update(x[1] for x in c)
        for tid in [t for t in self.trips if t.startswith(p("")) and t not in self.stop_times]:
            del self.trips[tid]

        for s in feed.rows("stops.txt"):
            sid = p(s["stop_id"])
            if sid in used_stops:
                self.stops[sid] = Stop(sid, s["stop_name"], float(s["stop_lat"]), float(s["stop_lon"]))

        if with_shapes:
            wanted = {t.shape_id for t in self.trips.values() if t.shape_id.startswith(p(""))}
            pts = {}
            for r in feed.rows("shapes.txt"):
                sid = p(r["shape_id"])
                if sid in wanted:
                    d = r.get("shape_dist_traveled")
                    pts.setdefault(sid, []).append((int(r["shape_pt_sequence"]), float(r["shape_pt_lat"]), float(r["shape_pt_lon"]), float(d) if d else None))
            for sid, v in pts.items():
                v.sort()
                self.shapes[sid] = [(la, lo, d) for _, la, lo, d in v]

    def services_on(self, date):
        out = set()
        for key, feed in self.feeds.items():
            out |= {f"{key}:{s}" for s in feed.services_on(date)}
        return out

    def bus_trips_on(self, date):
        """Bus trips running on a date, per feed."""
        services = self.services_on(date)
        out = Counter()
        for t in self.trips.values():
            if t.service_id in services:
                out[t.route_id.split(":", 1)[0]] += 1
        return out

    def representative_date(self, weekday):
        """A date with this weekday that every feed covers with normal service.

        Starts from the latest feed_start_date (so all feeds are on their
        current schedule, and an unchanged set of feeds gives the same date
        every week), then takes the first date on which every feed with buses
        runs at least REP_DAY_MIN_SHARE of its busiest same-weekday bus trip
        count over the next eight weeks. That skips holidays."""
        starts = [v["start"] for v in self.versions.values() if v["start"]]
        start = max(dt.datetime.strptime(s, "%Y%m%d").date() for s in starts) if starts else dt.date.today()
        start += dt.timedelta(days=(weekday - start.weekday()) % 7)
        days = [start + dt.timedelta(weeks=i) for i in range(8)]
        counts = [self.bus_trips_on(d) for d in days]
        feeds = {k for c in counts for k in c}
        best = {k: max(c[k] for c in counts) for k in feeds}
        for d, c in zip(days, counts):
            if all(c[k] >= REP_DAY_MIN_SHARE * best[k] for k in feeds):
                return d
        raise RuntimeError(f"No date with normal service in all feeds for weekday {weekday} from {start}")


def brt_brand(feed, number):
    for f, pattern, brand in BRT_PATTERNS:
        if (f is None or f == feed) and re.search(pattern, number):
            return brand
    return None
