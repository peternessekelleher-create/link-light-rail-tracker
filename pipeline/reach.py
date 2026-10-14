"""Where buses take you from each station in 15 and 30 minutes.

For every station and time window (day type x period):

  1. Departures from the station are sampled every SAMPLE_EVERY_MIN.
  2. Each sample runs raptor.search: walk to a stop within ACCESS_RADIUS_M
     (with the platform-to-street penalty), wait, ride; optionally walk up to
     TRANSFER_RADIUS_M, wait and ride once more. A stop is reached when the
     whole trip fits in MAX_TRIP_MIN.
  3. Per stop, the median total time over all samples is kept, counting a
     sample that doesn't reach the stop in time as "too long". With an even
     number of samples the lower median is used, so the time is one a rider
     actually experiences and its path is that sample's path.
  4. A stop is in the 15 band if its median is at most 15 minutes, else 30.

Writes data/reach/<station id>.json; the format is in README.md.
"""
import datetime as dt
import gzip
import json
import math
import multiprocessing as mp
from collections import defaultdict

from .config import (
    ACCESS_RADIUS_M, BANDS_MIN, DAY_TYPES, MAX_RIDES, MAX_TRIP_MIN, PERIODS, REACH_DIR,
    REACH_WARN_GZ_BYTES, SAMPLE_EVERY_MIN, SHAPE_SIMPLIFY_M, STATION_EXIT_MIN, TRANSFER_RADIUS_M,
    WALK_DETOUR, WALK_SPEED_M_PER_MIN, WORKERS,
)
from .geo import dist_m, encode_polyline, m_per_deg_lon, M_PER_DEG_LAT, simplify
from .raptor import search
from .timetable import Day

SCHEMA_VERSION = 1


def walk_s(d_m):
    return round(d_m * WALK_DETOUR / WALK_SPEED_M_PER_MIN * 60)


def windows():
    """[(window id, day type, period id, start s, end s)] in display order."""
    return [(f"{d}-{p}", d, p, h0 * 3600, h1 * 3600) for d in DAY_TYPES for p, _, h0, h1 in PERIODS]


class StopGrid:
    """Stops bucketed by ~250 m cells for radius queries."""

    def __init__(self, stops, cell_m=TRANSFER_RADIUS_M):
        self.stops = stops
        self.lat0 = 47.6
        self.cy = cell_m / M_PER_DEG_LAT
        self.cx = cell_m / m_per_deg_lon(self.lat0)
        self.cells = defaultdict(list)
        for s in stops.values():
            self.cells[self._cell(s.lat, s.lon)].append(s)

    def _cell(self, lat, lon):
        return int(lat // self.cy), int(lon // self.cx)

    def near(self, lat, lon, r):
        cy, cx = self._cell(lat, lon)
        n = math.ceil(r / (self.cy * M_PER_DEG_LAT)) + 1
        for y in range(cy - n, cy + n + 1):
            for x in range(cx - n, cx + n + 1):
                for s in self.cells.get((y, x), ()):
                    d = dist_m((lat, lon), (s.lat, s.lon))
                    if d <= r:
                        yield s, d


def footpaths(net, grid):
    return {
        s.id: tuple((o.id, walk_s(d)) for o, d in grid.near(s.lat, s.lon, TRANSFER_RADIUS_M))
        for s in net.stops.values()
    }


# --- Worker state (set before forking, shared copy-on-write) ----------------
_S = {}


def prepare(net, dates):
    grid = StopGrid(net.stops)
    _S.update(net=net, grid=grid, foot=footpaths(net, grid), days={d: Day(net, date) for d, date in dates.items()}, dates=dates)


def build_all(net, stations, dates, workers=WORKERS):
    prepare(net, dates)
    REACH_DIR.mkdir(parents=True, exist_ok=True)
    keep = {f"{s['id']}.json" for s in stations}
    for old in REACH_DIR.glob("*.json"):
        if old.name not in keep:
            old.unlink()
    if workers > 1:
        with mp.get_context("fork").Pool(workers) as pool:
            return pool.map(build_station, stations, chunksize=1)
    return [build_station(s) for s in stations]


def build_station(station):
    net, days = _S["net"], _S["days"]
    here = (station["lat"], station["lon"])
    access_all = [(s.id, STATION_EXIT_MIN * 60 + walk_s(d)) for s, d in _S["grid"].near(*here, ACCESS_RADIUS_M)]

    tables = Tables()
    out_windows = {}
    for wid, day_type, period, start, end in windows():
        day = days[day_type]
        access = [(s, w) for s, w in access_all if s in day.stop_patterns]
        samples = list(range(start, end, SAMPLE_EVERY_MIN * 60))
        per_stop = defaultdict(list)  # stop -> [(total s, t0, label)]
        for t0 in samples:
            for stop, lab in search(day, _S["foot"], access, t0, t0 + MAX_TRIP_MIN * 60).items():
                per_stop[stop].append((lab.time - t0, t0, lab))
        out_windows[wid] = summarise(day, tables, per_stop, len(samples), access, start, end)
        out_windows[wid]["date"] = _S["dates"][day_type].isoformat()

    doc = {
        "v": SCHEMA_VERSION,
        "station": {k: station[k] for k in ("id", "name", "kind", "lat", "lon")},
        "access_stops": len(access_all),
        **tables.export(net, days),
        "windows": out_windows,
    }
    path = REACH_DIR / f"{station['id']}.json"
    text = json.dumps(doc, separators=(",", ":"), ensure_ascii=False)
    path.write_text(text + "\n")
    w = out_windows
    return {
        "id": station["id"], "name": station["name"], "bytes": len(text), "gz_bytes": len(gzip.compress(text.encode())),
        "stops30": {k: v["stops30"] for k, v in w.items()}, "routes": {k: v["routes"] for k, v in w.items()},
        "max_min": max((r[1] for v in w.values() for r in v["reached"]), default=0),
        "max_legs": max((len(r[4]) for v in w.values() for r in v["reached"]), default=0),
    }


def summarise(day, tables, per_stop, n_samples, access, start, end):
    mid = (n_samples - 1) // 2  # lower median
    limit_s = MAX_TRIP_MIN * 60
    band15 = BANDS_MIN[0] * 60
    reached, seg = [], {}
    routes = set()
    for stop, obs in per_stop.items():
        if len(obs) <= mid:
            continue  # unreachable in time for more than half the samples
        obs.sort(key=lambda o: o[0])
        total, t0, lab = obs[mid]
        if total > limit_s:
            continue
        legs = []
        for n, (p, k, i, j) in enumerate(lab.legs):
            pat = day.patterns[p]
            routes.add(pat.route_id)
            legs.append([tables.pattern(pat), tables.stop(pat.stops[i]), tables.stop(pat.stops[j])])
            for h in range(i, j):
                band = 15 if pat.arr[k][h + 1] - t0 <= band15 else 30
                key = tables.hop(pat, h)
                b, x = seg.get(key, (30, 1))
                seg[key] = (min(b, band), min(x, n))
        minutes = math.ceil(total / 60)
        reached.append([tables.stop(stop), minutes, 15 if total <= band15 else 30, len(legs) - 1, legs])
    reached.sort(key=lambda r: (r[1], r[0]))
    assert all(len(r[4]) <= MAX_RIDES for r in reached)
    return {
        "samples": n_samples,
        "departures": day.departures([s for s, _ in access], start, end),
        "routes": len(routes),
        "stops15": sum(r[2] == 15 for r in reached),
        "stops30": len(reached),
        "reached": reached,
        "segments": sorted([h, b, x] for h, (b, x) in seg.items()),
    }


class Tables:
    """Per-file lookup tables, so windows refer to stops, routes, patterns
    and hops by small integers."""

    def __init__(self):
        self.stops, self.routes, self.patterns, self.hops = {}, {}, {}, {}
        self._pat = {}

    def stop(self, sid):
        return self.stops.setdefault(sid, len(self.stops))

    def route(self, rid):
        return self.routes.setdefault(rid, len(self.routes))

    def pattern(self, pat):
        if pat.id not in self.patterns:
            self.patterns[pat.id] = len(self.patterns)
            self._pat[pat.id] = pat
            self.route(pat.route_id)
        return self.patterns[pat.id]

    def hop(self, pat, h):
        return self.hops.setdefault((self.pattern(pat), h), len(self.hops))

    def export(self, net, days):
        stops = [None] * len(self.stops)
        for sid, i in self.stops.items():
            s = net.stops[sid]
            stops[i] = [sid, s.name, round(s.lat, 5), round(s.lon, 5)]
        routes = [None] * len(self.routes)
        for rid, i in self.routes.items():
            r = net.routes[rid]
            routes[i] = [rid, r.number, r.agency, r.brt]
        patterns = [None] * len(self.patterns)
        by_index = {}
        for pid, i in self.patterns.items():
            pat = self._pat[pid]
            patterns[i] = [pid, self.routes[pat.route_id]]
            by_index[i] = pat
        hops = [None] * len(self.hops)
        cuts = {}
        for (pi, h), i in self.hops.items():
            pat = by_index[pi]
            if pi not in cuts:
                cuts[pi] = hop_geometry(net, pat)
            hops[i] = [pi, h, encode_polyline(cuts[pi][h])]
        return {"stops": stops, "routes": routes, "patterns": patterns, "hops": hops}


# --- Drawing ridden segments -------------------------------------------------

def hop_geometry(net, pat):
    """For each consecutive stop pair of a pattern, the piece of the route
    shape between them as [(lat, lon)], simplified. Straight lines if the
    pattern has no shape."""
    pts = [(net.stops[s].lat, net.stops[s].lon) for s in pat.stops]
    shape = net.shapes.get(pat.shape_id)
    if not shape or len(shape) < 2:
        return [[pts[h], pts[h + 1]] for h in range(len(pts) - 1)]
    cum = _cum_dist(shape)
    use_dist = all(d is not None for d in pat.dists) and all(p[2] is not None for p in shape)
    pos = _positions_by_dist(shape, pat.dists) if use_dist else _positions_by_nearest(shape, cum, pts)
    out = []
    for h in range(len(pts) - 1):
        a, b = pos[h], pos[h + 1]
        line = [_at(shape, a)] + [(p[0], p[1]) for p in shape[math.floor(a) + 1: math.ceil(b)]] + [_at(shape, b)]
        if b <= a:
            line = [pts[h], pts[h + 1]]
        xy = simplify([(lon, lat) for lat, lon in line], SHAPE_SIMPLIFY_M)
        out.append([(lat, lon) for lon, lat in xy])
    return out


def _cum_dist(shape):
    c = [0.0]
    for p, q in zip(shape, shape[1:]):
        c.append(c[-1] + dist_m(p[:2], q[:2]))
    return c


def _at(shape, pos):
    """Point at fractional vertex index `pos`."""
    i = min(int(pos), len(shape) - 2)
    f = pos - i
    (a, b), (c, d) = shape[i][:2], shape[i + 1][:2]
    return (a + (c - a) * f, b + (d - b) * f)


def _positions_by_dist(shape, dists):
    sd = [p[2] for p in shape]
    out, i = [], 0
    for d in dists:
        while i < len(sd) - 2 and sd[i + 1] < d:
            i += 1
        span = sd[i + 1] - sd[i]
        out.append(i + (min(max((d - sd[i]) / span, 0), 1) if span > 0 else 0))
    return out


def _positions_by_nearest(shape, cum, pts):
    """Each stop's nearest point on the shape, searching forward from the
    previous stop and no further along than a generous detour allows, so
    loops and out-and-back routes don't jump ahead."""
    out, start = [], 0
    for n, p in enumerate(pts):
        reach = cum[start] + (dist_m(pts[n - 1], p) * 3 + 500 if n else math.inf)
        best, best_pos = math.inf, float(start)
        i = start
        while i < len(shape) - 1 and cum[i] <= reach:
            pos, d = _project(shape, i, p)
            if d < best:
                best, best_pos = d, pos
            i += 1
        out.append(best_pos)
        start = int(best_pos)
    return out


def _project(shape, i, p):
    (ay, ax), (by, bx) = shape[i][:2], shape[i + 1][:2]
    k = m_per_deg_lon(ay) / M_PER_DEG_LAT
    dx, dy = (bx - ax) * k, by - ay
    L = dx * dx + dy * dy
    t = 0 if L == 0 else max(0, min(1, (((p[1] - ax) * k) * dx + (p[0] - ay) * dy) / L))
    q = (ay + (by - ay) * t, ax + (bx - ax) * t)
    return i + t, dist_m(p, q)


def dates_for(net):
    return {d: net.representative_date(wd) for d, (_, wd) in DAY_TYPES.items()}


if __name__ == "__main__":
    # Quick single-station run: python -m pipeline.reach link-C27
    import sys
    import time

    from .config import FEEDS
    from .feeds import Network
    from .gtfs import Feed
    from .stations import all_stations

    t = time.time()
    net = Network.load()
    print(f"loaded feeds in {time.time() - t:.0f}s")
    stations = [s for s in all_stations(Feed.download(FEEDS["st"], "feed_st.zip")) if s["id"] in sys.argv[1:]]
    dates = dates_for(net)
    t = time.time()
    prepare(net, dates)
    print(f"timetables in {time.time() - t:.0f}s; dates {dates}")
    REACH_DIR.mkdir(parents=True, exist_ok=True)
    for s in stations:
        t = time.time()
        print(build_station(s), f"{time.time() - t:.1f}s")
