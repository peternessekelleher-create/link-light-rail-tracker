"""Printed checks after a build. run() returns False if a hard check fails.

  - every station has at least one connecting route
  - no reached stop over MAX_TRIP_MIN, no path with more than one transfer
  - known connections are present
  - preferred options match st3_network.json's selected options
  - rush vs midday reach for five stations (rush reaching more is flagged)
  - three trips traced by hand against the raw stop_times rows
  - reach file sizes
"""
import json

from .config import DATA, MAX_RIDES, MAX_TRIP_MIN, REACH_WARN_GZ_BYTES
from .gtfs import seconds
from .raptor import search
from . import reach

# (station id, route number) that must connect.
MUST_CONNECT = [
    ("st3-delridge", "H Line"),
    ("st3-alaska-junction", "C Line"),
    ("st3-ballard", "D Line"),
    ("st3-ballard", "44"),
    ("link-C27", "36"),  # Othello
    ("link-N23", "Swift Orange"),  # Lynnwood City Center
    ("link-S07", "A Line"),  # Federal Way Downtown
    ("link-E31", "B Line"),  # Downtown Redmond
]
RUSH_VS_MIDDAY = ["link-C03", "link-C27", "link-N23", "link-E15", "st3-ballard"]
SPOT_CHECKS = [("link-C03", "Westlake"), ("link-C27", "Othello"), ("link-N23", "Lynnwood City Center")]
SPOT_CHECK_T0 = 12 * 3600  # Weekday Midday, noon departure


def run(net, stations, conn, results, dates):
    ok = True
    by_id = {s["id"]: s for s in conn}

    print("\nStations and connecting routes (* = BRT)")
    for s in conn:
        parts = [f"{a['agency']}: " + ", ".join(r["number"] + ("*" if r["brt"] else "") for r in a["routes"]) for a in s["agencies"]]
        print(f"  {s['id']:22s} {s['name'][:24]:24s} {s['route_count']:3d}  {' | '.join(parts)[:150]}")
    none = [s for s in conn if s["route_count"] == 0]
    print(f"\nCHECK every station has a connecting route: {'PASS' if not none else 'FAIL'}")
    for s in none:
        print(f"  NO ROUTES: {s['id']} {s['name']}")
    ok &= not none

    print("\nCHECK known connections")
    for sid, num in MUST_CONNECT:
        hit = next((r for a in by_id[sid]["agencies"] for r in a["routes"] if r["number"] == num), None)
        ok &= hit is not None
        print(f"  {'PASS' if hit else 'FAIL'}  {sid} {by_id[sid]['name']} includes {num}" + (f" (stop {hit['stop_name']}, {hit['distance_ft']:,} ft)" if hit else ""))

    net_doc = json.loads((DATA / "st3_network.json").read_text())
    selected = {a["id"] for p in net_doc["projects"] for s in p["stations"] for a in s["alternatives"] if a["role"] == "selected"}
    preferred = {s["alternative_id"] for s in stations if s["kind"] == "st3"}
    same = selected == preferred and len(preferred) == 12
    ok &= same
    print(f"\nCHECK 12 preferred options, matching st3_network.json: {'PASS' if same else 'FAIL'} ({len(preferred)})")

    if results:
        worst = max(r["max_min"] for r in results)
        legs = max(r["max_legs"] for r in results)
        print(f"CHECK no reached stop over {MAX_TRIP_MIN} min: {'PASS' if worst <= MAX_TRIP_MIN else 'FAIL'} (max {worst})")
        print(f"CHECK no path with more than one transfer: {'PASS' if legs <= MAX_RIDES else 'FAIL'} (max rides {legs})")
        ok &= worst <= MAX_TRIP_MIN and legs <= MAX_RIDES

        res = {r["id"]: r for r in results}
        print("\nStops within 30 min, Weekday Midday vs Weekday AM / PM rush")
        for sid in RUSH_VS_MIDDAY:
            r = res.get(sid)
            if not r:
                continue
            m, am, pm = r["stops30"]["weekday-midday"], r["stops30"]["weekday-am"], r["stops30"]["weekday-pm"]
            flag = "  <- rush reaches more (see README: rush frequency)" if max(am, pm) > m else ""
            print(f"  {r['name'][:24]:24s} midday {m:4d}   AM {am:4d}   PM {pm:4d}{flag}")

        print("\nReach file sizes (raw / gzipped)")
        for r in sorted(results, key=lambda r: -r["gz_bytes"]):
            warn = "  <- over budget" if r["gz_bytes"] > REACH_WARN_GZ_BYTES else ""
            print(f"  {r['id']:22s} {r['bytes'] / 1024:7.1f} KB  {r['gz_bytes'] / 1024:6.1f} KB{warn}")
        total = sum(r["gz_bytes"] for r in results)
        print(f"  largest {max(r['gz_bytes'] for r in results) / 1024:.1f} KB gz, median {sorted(r['gz_bytes'] for r in results)[len(results) // 2] / 1024:.1f} KB gz, all {total / 1024:.0f} KB gz")

    spot_checks(net, stations)
    return ok


def spot_checks(net, stations):
    """Trace one trip per station by hand: a weekday noon departure to the
    stop farthest from the station (straight line) reached with a transfer,
    and recheck every time against the raw stop_times rows of the feed zip."""
    from .geo import dist_ft
    day = reach._S["days"]["weekday"]
    foot = reach._S["foot"]
    grid = reach._S["grid"]
    print(f"\nSpot checks: Weekday Midday ({day.date}), leaving the station at {hms(SPOT_CHECK_T0)}")
    for sid, _ in SPOT_CHECKS:
        st = next(s for s in stations if s["id"] == sid)
        access = [(s.id, reach.STATION_EXIT_MIN * 60 + reach.walk_s(d)) for s, d in grid.near(st["lat"], st["lon"], reach.ACCESS_RADIUS_FT)]
        access = [(s, w) for s, w in access if s in day.stop_patterns]
        labels = search(day, foot, access, SPOT_CHECK_T0, SPOT_CHECK_T0 + MAX_TRIP_MIN * 60)
        two = [(s, l) for s, l in labels.items() if len(l.legs) == 2] or list(labels.items())
        here = (st["lat"], st["lon"])
        stop, lab = max(two, key=lambda x: dist_ft(here, (net.stops[x[0]].lat, net.stops[x[0]].lon)))
        print(f"\n  From {st['name']} to {net.stops[stop].name}: {(lab.time - SPOT_CHECK_T0) / 60:.1f} min total")
        t = SPOT_CHECK_T0
        rows = []
        for n, (p, k, i, j) in enumerate(lab.legs):
            pat = day.patterns[p]
            tid, off = pat.trip_ids[k]
            if n == 0:
                walk, at = lab.access_s, lab.access_stop
                what = f"walk station -> {net.stops[at].name} (incl. {reach.STATION_EXIT_MIN} min exit)"
            else:
                walk, at = lab.transfer_s, pat.stops[i]
                what = f"transfer walk {net.stops[lab.transfer_from].name} -> {net.stops[at].name}"
            rows.append((what, walk))
            t += walk
            dep, arr = pat.dep[k][i], pat.arr[k][j]
            rows.append((f"wait for {net.routes[pat.route_id].number} (trip {tid})", dep - t))
            rows.append((f"ride {net.stops[pat.stops[i]].name} {hms(dep)} -> {net.stops[pat.stops[j]].name} {hms(arr)}", arr - dep))
            t = arr
            raw = raw_times(net, tid, pat.stops[i], pat.stops[j])
            match = raw == (dep - off, arr - off)
            print(f"    raw stop_times {tid}: departs {hms(raw[0])}, arrives {hms(raw[1])}  {'MATCH' if match else 'MISMATCH'}")
        for what, s in rows:
            print(f"    {s / 60:5.1f} min  {what}")
        print(f"    {sum(s for _, s in rows) / 60:5.1f} min  total")


def raw_times(net, trip_id, board, alight):
    """Departure at `board` and arrival at `alight`, read straight from the feed."""
    key, tid = trip_id.split(":", 1)
    b, a = board.split(":", 1)[1], alight.split(":", 1)[1]
    dep = arr = None
    for r in net.feeds[key].rows("stop_times.txt"):
        if r["trip_id"] == tid:
            if r["stop_id"] == b and dep is None:
                dep = seconds(r["departure_time"])
            elif r["stop_id"] == a and dep is not None:
                arr = seconds(r["arrival_time"])
    return dep, arr


def hms(s):
    s = int(s)
    return f"{s // 3600:02d}:{s % 3600 // 60:02d}:{s % 60:02d}"
