"""One service day's bus timetable, arranged for RAPTOR.

Trips that make the same calls (same stops, same boarding/alighting rules)
on the same route form a pattern. Within a pattern, trips are kept in
first-in-first-out order (no trip overtakes another), so the earliest trip
you can board at any stop is a binary search on that stop's departures.
A pattern that has an overtaking trip is split until each part is FIFO.

Pattern IDs are stable across builds while the calls don't change:
"<route_id>:<direction>:<8 hex digits of the call sequence>", plus "~n" for
the n-th FIFO split.

Times are seconds after midnight of the service date. The previous day's
trips running past midnight and the next day's early trips are included,
shifted by a day, so a window can run past midnight (Night ends at 1 am).
"""
import datetime as dt
import hashlib
from array import array
from bisect import bisect_left
from collections import Counter, defaultdict

from .config import MAX_TRIP_MIN, PERIODS

DAY = 86400
# Earliest and latest clock times any window can use.
T_MIN = min(p[2] for p in PERIODS) * 3600
T_MAX = max(p[3] for p in PERIODS) * 3600 + MAX_TRIP_MIN * 60


class Pattern:
    __slots__ = ("id", "route_id", "stops", "pickup", "dropoff", "trip_ids", "arr", "dep", "dep_cols", "shape_id", "dists")

    def __init__(self, pid, route_id, stops, pickup, dropoff):
        self.id = pid
        self.route_id = route_id
        self.stops = stops
        self.pickup = pickup
        self.dropoff = dropoff
        self.trip_ids = []  # (trip_id, day offset in seconds)
        self.arr = []  # per trip: array of arrival seconds
        self.dep = []  # per trip: array of departure seconds
        self.dep_cols = None  # per stop: departures of every trip, ascending
        self.shape_id = ""
        self.dists = ()  # shape_dist_traveled per stop (first trip), for drawing

    def board(self, i, t):
        """Index of the earliest trip leaving stop i at or after t, or None."""
        col = self.dep_cols[i]
        k = bisect_left(col, t)
        return k if k < len(col) else None


class Day:
    def __init__(self, net, date):
        self.date = date
        self.patterns = []
        self.stop_patterns = defaultdict(list)  # stop -> [(pattern index, stop index)] where boarding is allowed

        runs = {
            -DAY: net.services_on(date - dt.timedelta(days=1)),
            0: net.services_on(date),
            DAY: net.services_on(date + dt.timedelta(days=1)),
        }
        groups = defaultdict(list)
        for tid, st in net.stop_times.items():
            trip = net.trips[tid]
            for off, services in runs.items():
                if trip.service_id not in services:
                    continue
                if st.arr[-1] + off < T_MIN or st.dep[0] + off > T_MAX:
                    continue
                key = (trip.route_id, st.stops, st.pickup, st.dropoff)
                groups[key].append((st.dep[0] + off, tid, off))

        for (route_id, stops, pickup, dropoff), trips in sorted(groups.items(), key=lambda kv: (kv[0][0], kv[0][1])):
            trips.sort()
            first = net.trips[trips[0][1]]
            digest = hashlib.sha1(repr((stops, pickup, dropoff)).encode()).hexdigest()[:8]
            base = f"{route_id}:{first.direction}:{digest}"
            parts = []  # FIFO sub-patterns
            for _, tid, off in trips:
                st = net.stop_times[tid]
                arr = array("i", (a + off for a in st.arr))
                dep = array("i", (d + off for d in st.dep))
                for part in parts:
                    if all(a >= pa for a, pa in zip(arr, part.arr[-1])) and all(d >= pd for d, pd in zip(dep, part.dep[-1])):
                        break
                else:
                    part = Pattern(base if not parts else f"{base}~{len(parts)}", route_id, stops, pickup, dropoff)
                    part.dists = st.dist
                    parts.append(part)
                part.trip_ids.append((tid, off))
                part.arr.append(arr)
                part.dep.append(dep)
            for part in parts:
                shapes = Counter(net.trips[t].shape_id for t, _ in part.trip_ids)
                part.shape_id = shapes.most_common(1)[0][0]
                # dists must match the drawn shape: take them from a trip on it.
                tid = next(t for t, _ in part.trip_ids if net.trips[t].shape_id == part.shape_id)
                part.dists = net.stop_times[tid].dist
                part.dep_cols = [array("i", (d[i] for d in part.dep)) for i in range(len(stops))]
                idx = len(self.patterns)
                self.patterns.append(part)
                for i, s in enumerate(stops[:-1]):
                    if pickup[i]:
                        self.stop_patterns[s].append((idx, i))

    def departures(self, stops, start, end):
        """Bus departures from any of these stops in [start, end)."""
        n = 0
        for s in stops:
            for p, i in self.stop_patterns.get(s, ()):
                col = self.patterns[p].dep_cols[i]
                n += bisect_left(col, end) - bisect_left(col, start)
        return n
