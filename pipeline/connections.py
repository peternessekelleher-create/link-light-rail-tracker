"""Bus routes that connect to each station, from every feed.

A route connects when any of its stops is within CONNECT_RADIUS_FT of the
station and it runs on at least one representative date. For each route the
panel shows its agency, number, name, BRT brand and weekday midday trips per
hour: trips calling at the route's stops near the station between the
Midday period's start and end, per direction, busiest direction.

Writes
  data/connections.json  stations (Link and ST3) with routes grouped by agency
  data/routes.geojson    each connecting route's shape: the most common
                         shape per direction on the representative weekday
"""
import json
from collections import Counter, defaultdict

from .config import CONNECT_RADIUS_FT, DATA, FREQ_DAY, FREQ_PERIOD, PERIODS, SHAPE_SIMPLIFY_FT
from .geo import simplify


def build(net, stations, grid, dates, extra_meta):
    services = {d: net.services_on(date) for d, date in dates.items()}
    running = set().union(*services.values())
    weekday = services[FREQ_DAY]
    _, _, h0, h1 = next(p for p in PERIODS if p[0] == FREQ_PERIOD)
    lo, hi = h0 * 3600, h1 * 3600

    near = {}  # station id -> {stop id: distance}
    for st in stations:
        near[st["id"]] = {s.id: d for s, d in grid.near(st["lat"], st["lon"], CONNECT_RADIUS_FT)}
    stop_stations = defaultdict(list)
    for sid, stops in near.items():
        for stop in stops:
            stop_stations[stop].append(sid)

    hits = {}  # (station, route) -> (distance, stop)
    tph = Counter()  # (station, route, direction) -> trips in the window
    shape_votes = defaultdict(Counter)  # (route, direction) -> shape counts
    for tid, st in net.stop_times.items():
        trip = net.trips[tid]
        if trip.service_id not in running:
            continue
        shape_votes[(trip.route_id, trip.direction)][trip.shape_id] += 1000 if trip.service_id in weekday else 1
        counted = set()
        for stop, dep in zip(st.stops, st.dep):
            for sid in stop_stations.get(stop, ()):
                key = (sid, trip.route_id)
                d = near[sid][stop]
                if key not in hits or d < hits[key][0]:
                    hits[key] = (d, stop)
                # One count per trip per station, at its first nearby call.
                if trip.service_id in weekday and sid not in counted:
                    counted.add(sid)
                    if lo <= dep < hi:
                        tph[(sid, trip.route_id, trip.direction)] += 1
    hours = h1 - h0

    out_stations = []
    connected = defaultdict(list)  # route -> stations
    for st in stations:
        rows = defaultdict(list)
        for (sid, rid), (d, stop) in hits.items():
            if sid != st["id"]:
                continue
            r = net.routes[rid]
            dirs = {k[2]: v for k, v in tph.items() if k[0] == sid and k[1] == rid}
            rows[r.agency].append({
                "route_id": rid,
                "number": r.number,
                "name": r.name,
                "brt": r.brt,
                "midday_tph": round(max(dirs.values(), default=0) / hours, 1),
                "stop_id": stop,
                "stop_name": net.stops[stop].name,
                "distance_ft": round(d),
            })
            connected[rid].append(st["id"])
        agencies = [
            {"agency": a, "routes": sorted(rs, key=lambda r: route_key(r["number"], r["brt"]))}
            for a, rs in sorted(rows.items(), key=lambda kv: (-len(kv[1]), kv[0]))
        ]
        out_stations.append({**st, "route_count": sum(len(a["routes"]) for a in agencies), "agencies": agencies})

    # Route shapes.
    features = []
    for rid in sorted(connected, key=lambda r: (net.routes[r].agency, route_key(net.routes[r].number, net.routes[r].brt))):
        r = net.routes[rid]
        dirs = sorted(d for (x, d) in shape_votes if x == rid)
        lines = []
        for d in dirs:
            shape = net.shapes.get(shape_votes[(rid, d)].most_common(1)[0][0])
            if shape:
                xy = simplify([(lon, lat) for lat, lon, _ in shape], SHAPE_SIMPLIFY_FT)
                lines.append([[round(x, 5), round(y, 5)] for x, y in xy])
        features.append({
            "type": "Feature",
            "geometry": {"type": "MultiLineString", "coordinates": lines},
            "properties": {
                "route_id": rid, "agency": r.agency, "number": r.number, "name": r.name, "brt": r.brt,
                "stations": sorted(connected[rid]),
            },
        })

    meta = {
        **extra_meta,
        "connect_radius_ft": CONNECT_RADIUS_FT,
        "frequency": {"day_type": FREQ_DAY, "period": FREQ_PERIOD, "start": h0, "end": h1,
                      "measure": "trips per hour at the route's stops near the station, busier direction"},
    }
    write_json(DATA / "connections.json", {"metadata": meta, "stations": out_stations})
    write_json(DATA / "routes.geojson", {"type": "FeatureCollection", "metadata": meta, "features": features})
    return out_stations, features


def route_key(number, brt):
    """BRT first, then numbers in numeric order, then anything else."""
    digits = "".join(c for c in number if c.isdigit())
    return (0 if brt else 1, int(digits) if digits and number[0].isdigit() else 0 if brt else 99999, number)


def write_json(path, obj):
    # Compact but one feature or station per line, so weekly diffs stay readable.
    key = "features" if "features" in obj else "stations"
    head = json.dumps({k: v for k, v in obj.items() if k != key}, separators=(",", ":"), ensure_ascii=False)[:-1]
    body = ",\n".join(json.dumps(f, separators=(",", ":"), ensure_ascii=False) for f in obj[key])
    path.write_text(f'{head},"{key}":[\n{body}\n]}}\n')
