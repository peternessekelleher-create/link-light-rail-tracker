"""Estimated typical crowding on every Link train, and the simulated ST3 lines.

Not live: a model of a typical day, from average boardings.

  1. Daily boardings per station (data/ridership/station_boardings.csv). The
     13 Lynnwood-CID stations are scaled together to the April 2026 total.
     A station both lines serve is split between them by scheduled trains.
  2. Direction: the 1 Line's share of boardings in each direction comes from
     the Seattle Transit Blog's May 2025 counts, rebalanced so a whole day is
     even (BALANCE_DIRECTIONS). The 2 Line is 50/50. A terminal sends
     everyone the one way it can.
  3. Alightings: each direction's riders get off at the stations further
     along, in proportion to those stations' boardings.
  4. Time of day: the daily load on each segment x the period's share of
     the day (WEEKDAY_PROFILE) x the weekend factor, divided by the trains
     scheduled in that period -> riders per train.
  5. Load % = riders per train / (cars x 194), Sound Transit's target max
     load per car.

The simulated Ballard and West Seattle lines use the same model with 2042
projected boardings (data/ridership/future_boardings.csv), 50/50 directions,
and the 1 Line's headway in each window.

Writes
  data/crowding.json         line -> direction -> segment -> window -> load %
  data/simulated_trains.json  stations, run times and headways for the
                              simulated trains
"""
import csv
import io
import json
import statistics
import urllib.request
from collections import Counter, defaultdict

from .config import (
    BALANCE_DIRECTIONS, CAR_PLANNING_LOAD, CAR_SEATS, CAR_TARGET_MAX_LOAD, CARS, CROWDING_LEVELS, DATA, DAY_TYPES,
    DIRECTION_PROXY, LINK_LINES, PERIODS, RIDERSHIP_DIR, SIM_DWELL_S, SIM_HEADWAY_STATION, STB_1LINE_URL,
    TRUNK_2026_TOTAL, USER_AGENT, WEEKDAY_PROFILE, WEEKEND_FACTOR,
)
from .geo import dist_ft
from .gtfs import seconds

DAY = 86400
# STB station names -> GTFS parent stop_id
STB_NAMES = {
    "Lynnwood City Center": "N23", "Mountlake Terrace": "N19", "Shoreline North/185th": "N17",
    "Shoreline South/148th": "N15", "Northgate": "N11", "Roosevelt": "N09", "U District": "N07",
    "University of Washington": "N05", "Capitol Hill": "N03", "Westlake/Seattle": "C03", "Symphony": "C05",
    "Pioneer Square": "C07", "International District/Chinatown": "C09", "Stadium": "C13", "SODO": "C15",
    "Beacon Hill": "C19", "Mount Baker": "C23", "Columbia City": "C25", "Othello": "C27", "Rainier Beach": "C29",
    "Tukwila International Blvd": "C35", "SeaTac/Airport": "C37", "Angle Lake": "S01",
}


# --- Link schedules ------------------------------------------------------------

class LinkSchedule:
    """1 Line and 2 Line trips from the Sound Transit feed, by parent station."""

    def __init__(self, st_feed):
        self.feed = st_feed
        routes = {r["route_id"]: r["route_short_name"] for r in st_feed.rows("routes.txt") if r["route_short_name"] in LINK_LINES}
        self.trips = {
            t["trip_id"]: (routes[t["route_id"]], t.get("direction_id") or "0", t["service_id"], t.get("shape_id", ""), t.get("trip_headsign", ""))
            for t in st_feed.rows("trips.txt") if t["route_id"] in routes
        }
        stops = {s["stop_id"]: s for s in st_feed.rows("stops.txt")}
        self.parent = {sid: (s.get("parent_station") or sid) for sid, s in stops.items()}
        self.pos = {sid: (float(s["stop_lat"]), float(s["stop_lon"])) for sid, s in stops.items()}
        self.name = {sid: s["stop_name"] for sid, s in stops.items()}
        calls = defaultdict(list)
        for st in st_feed.rows("stop_times.txt"):
            if st["trip_id"] in self.trips:
                calls[st["trip_id"]].append((int(st["stop_sequence"]), self.parent[st["stop_id"]], seconds(st["arrival_time"]), seconds(st["departure_time"])))
        self.calls = {t: sorted(c) for t, c in calls.items()}
        wanted = {v[3] for v in self.trips.values()}
        shapes = defaultdict(list)
        for r in st_feed.rows("shapes.txt"):
            if r["shape_id"] in wanted:
                shapes[r["shape_id"]].append((int(r["shape_pt_sequence"]), float(r["shape_pt_lat"]), float(r["shape_pt_lon"])))
        self.shapes = {k: [(la, lo) for _, la, lo in sorted(v)] for k, v in shapes.items()}

    def trips_on(self, date, offset=0):
        """(trip_id, time offset) for trips running on a service date."""
        services = self.feed.services_on(date)
        return [(t, offset) for t, v in self.trips.items() if v[2] in services and t in self.calls]

    def day_trips(self, date):
        """Trips that can run during the windows of `date`: that day's, plus the
        next day's early trips shifted by a day (the Night window runs to 1 am)."""
        import datetime as dt
        return self.trips_on(date) + self.trips_on(date + dt.timedelta(days=1), DAY)

    def order(self, line, direction, date):
        """Stations in travel order: the longest stop pattern for the line and
        direction on that date."""
        best = max((self.calls[t] for t, _ in self.trips_on(date) if self.trips[t][:2] == (line, direction)), key=len)
        return [c[1] for c in best]

    def departures(self, line, direction, station, date):
        """Departure times from a station, seconds after midnight of `date`."""
        out = []
        for t, off in self.day_trips(date):
            if self.trips[t][:2] != (line, direction):
                continue
            for _, s, _, dep in self.calls[t]:
                if s == station:
                    out.append(dep + off)
        return sorted(out)

    def headsign(self, line, direction, date):
        c = Counter(self.trips[t][4] for t, _ in self.trips_on(date) if self.trips[t][:2] == (line, direction))
        return c.most_common(1)[0][0]

    def speed_ft_per_s(self, line, date, period=("midday", 9, 15)):
        """Average scheduled speed between stations: track distance between
        consecutive stations (along the trip's shape) over the running time
        from departure to the next arrival, for every trip on that date that
        starts in the given period."""
        dist = run = 0.0
        for t, off in self.trips_on(date):
            if self.trips[t][0] != line or not period[1] * 3600 <= self.calls[t][0][3] < period[2] * 3600:
                continue
            shape = self.shapes.get(self.trips[t][3])
            if not shape:
                continue
            along = _along(shape, [self.pos[c[1]] for c in self.calls[t]])
            for a, b, ca, cb in zip(along, along[1:], self.calls[t], self.calls[t][1:]):
                if cb[2] > ca[3] and b > a:
                    dist += b - a
                    run += cb[2] - ca[3]
        return dist / run


def _along(shape, pts):
    """Distance along `shape` (feet) of each point, searching forward."""
    cum = [0.0]
    for p, q in zip(shape, shape[1:]):
        cum.append(cum[-1] + dist_ft(p, q))
    out, start = [], 0
    for p in pts:
        i = min(range(start, len(shape)), key=lambda k: dist_ft(shape[k], p))
        out.append(cum[i])
        start = i
    return out


# --- Load model ----------------------------------------------------------------

def segment_loads(order, boardings, share):
    """Daily riders on each segment of one direction.

    order: stations in travel order. boardings: station -> daily boardings on
    this line (both directions). share: station -> fraction of those boarding
    in this direction. Riders alight further along in proportion to the
    later stations' boardings."""
    n = len(order)
    w = [boardings.get(s, 0) for s in order]
    on = [boardings.get(s, 0) * share.get(s, 0) for s in order]
    on[-1] = 0.0
    loads = []
    for k in range(n - 1):
        load = 0.0
        for i in range(k + 1):
            beyond_i = sum(w[i + 1:])
            if beyond_i > 0:
                load += on[i] * sum(w[k + 1:]) / beyond_i
        loads.append(load)
    return loads


def balanced_shares(raw_north, boardings):
    """Rescale each station's northbound share (odds x k) so that northbound
    and southbound daily boardings are equal; keeps each station's pattern."""
    stations = [s for s in raw_north if boardings.get(s)]

    def north_total(k):
        tot = 0.0
        for s in stations:
            p = raw_north[s]
            tot += boardings[s] * (p * k / (p * k + (1 - p)) if 0 < p < 1 else p)
        return tot

    target = sum(boardings[s] for s in stations) / 2
    lo, hi = 1e-3, 1e3
    for _ in range(80):
        mid = (lo * hi) ** 0.5
        lo, hi = (mid, hi) if north_total(mid) < target else (lo, mid)
    k = (lo * hi) ** 0.5
    return {s: (p * k / (p * k + (1 - p)) if 0 < p < 1 else p) for s, p in raw_north.items()}, k


def load_stb():
    req = urllib.request.Request(STB_1LINE_URL, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=60) as r:
        rows = list(csv.DictReader(io.StringIO(r.read().decode("utf-8-sig"))))
    counts = defaultdict(lambda: {"North": [0, 0], "South": [0, 0]})
    for r in rows:
        sid = STB_NAMES.get(r["LongName"])
        if sid:
            c = counts[sid][r["Direction, Friendly"]]
            c[0] += int(r["BoardingCnt"])
            c[1] += int(r["AlightingCnt"])
    return counts


def read_csv(name):
    with open(RIDERSHIP_DIR / name, newline="") as f:
        return list(csv.DictReader(f))


def windows():
    return [(f"{d}-{p}", d, p, h0 * 3600, h1 * 3600) for d in DAY_TYPES for p, _, h0, h1 in PERIODS]


def level_of(pct):
    for lid, label, top in CROWDING_LEVELS:
        if top is None or pct <= top:
            return lid
    return CROWDING_LEVELS[-1][0]


def build(net, dates, stations):
    sched = LinkSchedule(net.feeds["st"])
    weekday = dates["weekday"]
    by_id = {s["id"]: s for s in stations}

    # Station boardings, with the Lynnwood-CID trunk scaled to April 2026.
    rows = read_csv("station_boardings.csv")
    daily = {r["station_id"].removeprefix("link-"): float(r["weekday_boardings"]) for r in rows}
    trunk = [r["station_id"].removeprefix("link-") for r in rows if "TRUNK_2026_TOTAL" in r["note"]]
    trunk_k = TRUNK_2026_TOTAL / sum(daily[s] for s in trunk)
    for s in trunk:
        daily[s] *= trunk_k

    # Lines, directions, station orders.
    lines = {}
    for line in LINK_LINES:
        dirs = sorted({v[1] for v in sched.trips.values() if v[0] == line})
        lines[line] = {d: sched.order(line, d, weekday) for d in dirs}

    # Split shared stations between lines by scheduled weekday trains.
    calls = Counter()
    for t, _ in sched.trips_on(weekday):
        for _, s, _, _ in sched.calls[t]:
            calls[(sched.trips[t][0], s)] += 1
    line_boardings = {}
    for line in LINK_LINES:
        line_boardings[line] = {}
        for s in set(lines[line][next(iter(lines[line]))]):
            total = sum(calls[(l, s)] for l in LINK_LINES)
            line_boardings[line][s] = daily.get(s, 0.0) * calls[(line, s)] / total if total else 0.0

    # Which GTFS direction is northbound, per line (ends further north).
    def north_dir(line):
        return max(lines[line], key=lambda d: sched.pos[lines[line][d][-1]][0])

    # 1 Line direction shares from STB, balanced.
    stb = load_stb()
    raw_north = {}
    for s, c in stb.items():
        n, so = c["North"][0], c["South"][0]
        if n + so:
            raw_north[s] = n / (n + so)
    one = lines["1 Line"]
    nd = north_dir("1 Line")
    order_n = one[nd]
    for s, proxy in DIRECTION_PROXY.items():
        s = s.removeprefix("link-")
        if s not in raw_north and proxy.removeprefix("link-") in raw_north:
            raw_north[s] = raw_north[proxy.removeprefix("link-")]
    raw_north[order_n[0]] = 1.0  # southern terminal: everyone goes north
    raw_north[order_n[-1]] = 0.0  # northern terminal
    if BALANCE_DIRECTIONS:
        north_share, balance_k = balanced_shares(raw_north, line_boardings["1 Line"])
    else:
        north_share, balance_k = raw_north, 1.0

    shares = {}
    for line in LINK_LINES:
        nd_l = north_dir(line)
        shares[line] = {}
        for d, order in lines[line].items():
            sh = {}
            for i, s in enumerate(order):
                if line == "1 Line":
                    p = north_share.get(s, 0.5)
                    sh[s] = p if d == nd_l else 1 - p
                else:
                    sh[s] = 1.0 if i == 0 else 0.5  # 2 Line: 50/50; a terminal sends everyone on
            sh[order[-1]] = 0.0
            shares[line][d] = sh

    # Trains per window, per line and direction, counted at Westlake.
    ref = SIM_HEADWAY_STATION
    trains = {}
    for line in LINK_LINES:
        for d in lines[line]:
            for wid, day, _, a, b in windows():
                deps = sched.departures(line, d, ref, dates[day])
                trains[(line, d, wid)] = sum(a <= t < b for t in deps)

    out_lines = {}
    for line in LINK_LINES:
        cap = CARS[line] * CAR_TARGET_MAX_LOAD
        dirs = {}
        for d, order in lines[line].items():
            loads = segment_loads(order, line_boardings[line], shares[line][d])
            segs = []
            for k, (a, b) in enumerate(zip(order, order[1:])):
                pct = {}
                for wid, day, period, _, _ in windows():
                    n = trains[(line, d, wid)]
                    riders = loads[k] * WEEKDAY_PROFILE[period] * WEEKEND_FACTOR[day]
                    pct[wid] = round(100 * riders / n / cap) if n else None
                segs.append(_segment(sched, a, b, pct, round(loads[k])))
            dirs[d] = {"name": f"Toward {sched.headsign(line, d, weekday)}", "segments": segs}
        out_lines[line] = {"kind": "live", "cars": CARS[line], "capacity_per_train": cap, "directions": dirs}

    # --- Simulated lines ---
    headway = {}
    for wid, day, _, a, b in windows():
        tph = []
        for d in lines["1 Line"]:
            deps = sched.departures("1 Line", d, ref, dates[day])
            n = sum(a <= t < b for t in deps)
            tph.append(n / ((b - a) / 3600))
        avg = statistics.mean(tph)
        headway[wid] = round(60 / avg, 1) if avg else None
    speed = sched.speed_ft_per_s("1 Line", weekday)

    future = {r["station_id"]: float(r["daily_boardings_2042"]) for r in read_csv("future_boardings.csv")}
    future_src = {r["station_id"]: r for r in read_csv("future_boardings.csv")}
    net_doc = json.loads((DATA / "st3_network.json").read_text())
    sim_lines, sim_meta = {}, []
    for p in net_doc["projects"]:
        order = [f"st3-{sid}" for sid in p["alignment"]]
        # Trains run between SODO and the far end; SODO is the first station.
        if order[-1] == "st3-sodo":
            order.reverse()
        order = [s for s in order if s in by_id]
        shared = sum(1 for q in net_doc["projects"] if "sodo" in q["alignment"])
        boards = {s: future.get(s, 0.0) / (shared if s == "st3-sodo" else 1) for s in order}
        cap = CARS["sim"] * CAR_TARGET_MAX_LOAD
        dirs = {}
        for d, seq in (("0", order), ("1", order[::-1])):
            sh = {s: (1.0 if i == 0 else 0.5) for i, s in enumerate(seq)}
            sh[seq[-1]] = 0.0
            loads = segment_loads(seq, boards, sh)
            segs = []
            for k, (a, b) in enumerate(zip(seq, seq[1:])):
                pct = {}
                for wid, day, period, s0, s1 in windows():
                    h = headway[wid]
                    n = (s1 - s0) / 60 / h if h else 0
                    riders = loads[k] * WEEKDAY_PROFILE[period] * WEEKEND_FACTOR[day]
                    pct[wid] = round(100 * riders / n / cap) if n else None
                segs.append({
                    "from": a, "to": b, "from_name": by_id[a]["name"], "to_name": by_id[b]["name"],
                    "coords": [[by_id[a]["lon"], by_id[a]["lat"]], [by_id[b]["lon"], by_id[b]["lat"]]],
                    "daily_riders": round(loads[k]), "load_pct": pct,
                })
            dirs[d] = {"name": f"Toward {by_id[seq[-1]]['name']}", "segments": segs}
        sim_lines[p["name"]] = {"kind": "simulated", "cars": CARS["sim"], "capacity_per_train": cap, "directions": dirs}

        stops = [{
            "id": s, "name": by_id[s]["name"], "lat": by_id[s]["lat"], "lon": by_id[s]["lon"], "phase": by_id[s]["phase"],
            "boardings_2042": round(boards[s]), "source": future_src.get(s, {}).get("source", "ASSUMPTION"),
        } for s in order]
        segments = []
        for a, b in zip(stops, stops[1:]):
            ft = dist_ft((a["lat"], a["lon"]), (b["lat"], b["lon"]))
            segments.append({"from": a["id"], "to": b["id"], "dist_ft": round(ft), "run_s": round(ft / speed), "phase": max(a["phase"], b["phase"])})
        sim_meta.append({"id": p["id"], "name": p["name"], "color": p["color"], "stations": stops, "segments": segments})

    levels = [{"id": i, "label": label, "max_pct": top} for i, label, top in CROWDING_LEVELS]
    meta = {
        "note": "Estimated typical crowding from average ridership, not live counts.",
        "load_pct": "riders per train / (cars x 194), Sound Transit's target max load per car",
        "capacity_per_car": {"seats": CAR_SEATS, "planning_load": CAR_PLANNING_LOAD, "target_max_load": CAR_TARGET_MAX_LOAD},
        "cars": CARS,
        "weekday_profile": WEEKDAY_PROFILE,
        "weekend_factor": WEEKEND_FACTOR,
        "trunk_scale": round(trunk_k, 3),
        "direction_balance_odds_factor": round(balance_k, 3),
        "dates": {k: v.isoformat() for k, v in dates.items()},
        "sources": "data/ridership/SOURCES.md",
    }
    _write(DATA / "crowding.json", {"metadata": meta, "levels": levels, "lines": {**out_lines, **sim_lines}})
    sim = {
        "metadata": {
            "note": "Simulated trains: illustrative frequency and crowding.",
            "headway_from": "1 Line scheduled headway at Westlake, mean of both directions",
            "speed_from": "1 Line average scheduled speed between stations, weekday midday",
            "speed_mph": round(speed * 3600 / 5280, 1),
            "dwell_s": SIM_DWELL_S,
        },
        "headway_min": headway,
        "lines": sim_meta,
    }
    _write(DATA / "simulated_trains.json", sim)
    return {"lines": out_lines, "sim_lines": sim_lines, "headway": headway, "sim_trains": sim, "speed_mph": sim["metadata"]["speed_mph"],
            "trains": trains, "trunk_k": trunk_k, "balance_k": balance_k, "stb": stb, "orders": lines, "north": north_dir,
            "sched": sched}


def _segment(sched, a, b, pct, daily):
    return {
        "from": f"link-{a}", "to": f"link-{b}", "from_name": sched.name[a], "to_name": sched.name[b],
        "coords": [[sched.pos[a][1], sched.pos[a][0]], [sched.pos[b][1], sched.pos[b][0]]],
        "daily_riders": daily, "load_pct": pct,
    }


def _write(path, obj):
    path.write_text(json.dumps(obj, separators=(",", ":"), ensure_ascii=False) + "\n")


# --- Checks --------------------------------------------------------------------

def report(r):
    """Print the 1 Line Weekday PM rush loads, check the busiest segment is in
    the central part of the line, compare with a profile built from the STB
    counts' real alightings, and count simulated trains at PM rush vs Night.
    Returns False if a check fails."""
    ok = True
    line = r["lines"]["1 Line"]
    print("\n1 Line estimated load, Weekday PM rush (% of target max load; daily riders)")
    for d, v in line["directions"].items():
        segs = v["segments"]
        print(f"  {v['name']}")
        for s in segs:
            print(f"    {s['from_name'][:22]:22s} -> {s['to_name'][:22]:22s} {s['load_pct']['weekday-pm']:4d}%  {s['daily_riders']:7,d}")
        i = max(range(len(segs)), key=lambda k: segs[k]["load_pct"]["weekday-pm"])
        central = len(segs) // 5 <= i < len(segs) - len(segs) // 5
        ok &= central
        print(f"  CHECK busiest segment central: {'PASS' if central else 'FLAG'} -- {segs[i]['from_name']} -> {segs[i]['to_name']} "
              f"(segment {i + 1} of {len(segs)})")

    # Cross-check: load from the raw STB boardings and alightings (May 2025,
    # Lynnwood to Angle Lake), by direction in travel order.
    stb, orders, north = r["stb"], r["orders"]["1 Line"], r["north"]("1 Line")
    for d, order in orders.items():
        key = "North" if d == north else "South"
        stations = [s for s in order if s in stb]
        load, best = 0, (0, None)
        for a, b in zip(stations, stations[1:]):
            load += stb[a][key][0] - stb[a][key][1]
            best = max(best, (load, (a, b)))
        names = r["sched"].name
        print(f"  Cross-check with STB real alightings, {key.lower()}bound: busiest {names[best[1][0]]} -> {names[best[1][1]]}")

    # Simulated trains on the line: trip time / headway, both directions.
    print("\nSimulated trains on the line at once (both directions, both lines)")
    counts = {}
    for wid in ("weekday-pm", "weekday-night"):
        h = r["headway"][wid]
        n = 0.0
        for l in r["sim_trains"]["lines"]:
            total = sum(s["run_s"] for s in l["segments"]) + r["sim_trains"]["metadata"]["dwell_s"] * (len(l["stations"]) - 2)
            n += 2 * total / (h * 60)
        counts[wid] = n
        print(f"  {wid:14s} headway {h:4.1f} min -> about {n:4.1f} trains")
    more = counts["weekday-pm"] > counts["weekday-night"]
    ok &= more
    print(f"  CHECK more simulated trains at PM rush than at Night: {'PASS' if more else 'FAIL'}")
    print(f"  1 Line average scheduled speed between stations: {r['speed_mph']} mph; dwell {r['sim_trains']['metadata']['dwell_s']} s")
    return ok
