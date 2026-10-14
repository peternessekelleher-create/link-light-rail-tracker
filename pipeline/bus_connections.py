"""King County Metro bus routes that connect to each ST3 station alternative.

A route connects to an alternative when any stop it serves is within
CONNECT_RADIUS_M of the alternative's point. Every alternative is checked,
not only the selected one, so the panel can show what each choice gains or
loses.

Writes
  data/st3_bus_routes.geojson    one feature per route, whole route geometry
  data/st3_bus_connections.json  station_id -> alternative_id -> [routes]
"""
import datetime as dt
import json
import re
from collections import Counter, defaultdict

from .config import (
    BUS_ROUTE_TYPES, CONNECT_RADIUS_M, DATA, KCM_AGENCIES, KCM_GTFS_URL,
    MIDDAY_END_H, MIDDAY_START_H, REP_WEEKDAY, SHAPE_SIMPLIFY_M,
)
from .geo import dist_m, simplify
from .gtfs import Feed, seconds

RAPIDRIDE = re.compile(r"^[A-Z] Line$")


def load_alternatives():
    """[(station_id, alt_id, (lat, lon))] for every alternative in the network."""
    net = json.loads((DATA / "st3_network.json").read_text())
    feats = json.loads((DATA / "station_alternatives.geojson").read_text())["features"]
    pos = {f["properties"]["id"]: tuple(reversed(f["geometry"]["coordinates"])) for f in feats}
    out = []
    for p in net["projects"]:
        for s in p["stations"]:
            for a in s["alternatives"]:
                if a["id"] not in pos:
                    raise KeyError(f"{a['id']} is in st3_network.json but not station_alternatives.geojson")
                out.append((s["id"], a["id"], pos[a["id"]]))
    return out


def build(feed=None):
    feed = feed or Feed.download(KCM_GTFS_URL, "kcm_gtfs.zip")
    alts = load_alternatives()

    routes = {
        r["route_id"]: r for r in feed.rows("routes.txt")
        if r["agency_id"] in KCM_AGENCIES and r["route_type"] in BUS_ROUTE_TYPES
    }
    trips = {
        t["trip_id"]: t for t in feed.rows("trips.txt") if t["route_id"] in routes
    }

    # Stops within the radius of any alternative.
    near = defaultdict(list)  # stop_id -> [(alt index, distance)]
    stop_names = {}
    for s in feed.rows("stops.txt"):
        if s.get("location_type", "0") not in ("", "0"):
            continue
        p = (float(s["stop_lat"]), float(s["stop_lon"]))
        for i, (_, _, a) in enumerate(alts):
            d = dist_m(p, a)
            if d <= CONNECT_RADIUS_M:
                near[s["stop_id"]].append((i, d))
                stop_names[s["stop_id"]] = s["stop_name"]

    # One pass over stop_times: nearest stop per (route, alternative), and each
    # trip's first departure for the frequency count.
    hits = {}  # (route_id, alt index) -> (distance, stop_id)
    first = {}  # trip_id -> (stop_sequence, departure seconds)
    for st in feed.rows("stop_times.txt"):
        trip = trips.get(st["trip_id"])
        if not trip:
            continue
        seq = int(st["stop_sequence"])
        if st["departure_time"] and (st["trip_id"] not in first or seq < first[st["trip_id"]][0]):
            first[st["trip_id"]] = (seq, seconds(st["departure_time"]))
        for i, d in near.get(st["stop_id"], ()):
            key = (trip["route_id"], i)
            if key not in hits or d < hits[key][0]:
                hits[key] = (d, st["stop_id"])

    connected = sorted({r for r, _ in hits}, key=route_sort_key(routes))

    # Weekday midday frequency, per direction, by first departure. The day is
    # picked from the feed's start date, not today, so an unchanged feed gives
    # identical output and the weekly Action has nothing to commit.
    start = feed.feed_info().get("feed_start_date")
    day = feed.representative_day(REP_WEEKDAY, dt.datetime.strptime(start, "%Y%m%d").date() if start else None)
    running = feed.services_on(day)
    lo, hi = MIDDAY_START_H * 3600, MIDDAY_END_H * 3600
    tph = Counter()
    shape_votes = defaultdict(Counter)  # (route, direction) -> shape counts
    for tid, t in trips.items():
        if t["route_id"] not in connected:
            continue
        on_day = t["service_id"] in running
        # Prefer the shapes run on the representative weekday; fall back to all.
        shape_votes[(t["route_id"], t["direction_id"])][t["shape_id"]] += 1000 if on_day else 1
        if on_day and tid in first and lo <= first[tid][1] < hi:
            tph[(t["route_id"], t["direction_id"])] += 1
    hours = MIDDAY_END_H - MIDDAY_START_H

    shape_ids = {
        key: votes.most_common(1)[0][0] for key, votes in shape_votes.items()
    }
    wanted = set(shape_ids.values())
    pts = defaultdict(list)
    for r in feed.rows("shapes.txt"):
        if r["shape_id"] in wanted:
            pts[r["shape_id"]].append((int(r["shape_pt_sequence"]), float(r["shape_pt_lon"]), float(r["shape_pt_lat"])))
    shapes = {
        sid: [[round(x, 5), round(y, 5)] for x, y in simplify([(x, y) for _, x, y in sorted(p)], SHAPE_SIMPLIFY_M)]
        for sid, p in pts.items()
    }

    # Route features.
    connects = defaultdict(list)
    for (rid, i), (d, stop) in hits.items():
        connects[rid].append(i)
    features = []
    for rid in connected:
        r = routes[rid]
        dirs = sorted(d for (x, d) in shape_ids if x == rid)
        by_dir = {d: round(tph[(rid, d)] / hours, 1) for d in dirs}
        features.append({
            "type": "Feature",
            "geometry": {"type": "MultiLineString", "coordinates": [shapes[shape_ids[(rid, d)]] for d in dirs]},
            "properties": {
                "route_id": rid,
                "number": r["route_short_name"],
                "name": r["route_desc"] or r["route_long_name"],
                "rapidride": bool(RAPIDRIDE.match(r["route_short_name"])),
                "midday_tph": max(by_dir.values(), default=0),
                "midday_tph_by_direction": by_dir,
                "shape_ids": {d: shape_ids[(rid, d)] for d in dirs},
                "connects": [
                    {"station_id": alts[i][0], "alternative_id": alts[i][1]}
                    for i in sorted(connects[rid])
                ],
            },
        })

    # Station -> alternative -> routes (nearest stop first within each route).
    conn = defaultdict(dict)
    for i, (sid, aid, _) in enumerate(alts):
        rows = [
            {
                "route_id": rid,
                "number": routes[rid]["route_short_name"],
                "stop_id": hits[(rid, i)][1],
                "stop_name": stop_names[hits[(rid, i)][1]],
                "distance_m": round(hits[(rid, i)][0]),
            }
            for rid in connected if (rid, i) in hits
        ]
        conn[sid][aid] = rows

    info = feed.feed_info()
    meta = {
        "source": "King County Metro GTFS, " + KCM_GTFS_URL,
        "feed_version": info.get("feed_version"),
        "feed_start_date": info.get("feed_start_date"),
        "feed_end_date": info.get("feed_end_date"),
        "connect_radius_m": CONNECT_RADIUS_M,
        "midday_window": f"{MIDDAY_START_H:02d}:00-{MIDDAY_END_H:02d}:00",
        "representative_weekday": day.isoformat(),
        "note": "Bus routes shown are today's network. King County Metro will restructure service when these stations open.",
    }
    write_json(DATA / "st3_bus_routes.geojson", {"type": "FeatureCollection", "metadata": meta, "features": features})
    write_json(DATA / "st3_bus_connections.json", {"metadata": meta, "stations": conn})
    return meta, features, conn


def route_sort_key(routes):
    """RapidRide letters first, then numbers in numeric order."""
    def key(rid):
        n = routes[rid]["route_short_name"]
        m = re.match(r"(\d+)", n)
        return (0, n, 0) if RAPIDRIDE.match(n) else (1, "", int(m.group(1)) if m else 9999, n)
    return key


def write_json(path, obj):
    # Compact but line-per-feature, so weekly diffs stay readable.
    if "features" in obj:
        head = json.dumps({k: v for k, v in obj.items() if k != "features"}, separators=(",", ":"))[:-1]
        body = ",\n".join(json.dumps(f, separators=(",", ":")) for f in obj["features"])
        path.write_text(f'{head},"features":[\n{body}\n]}}\n')
    else:
        path.write_text(json.dumps(obj, indent=1) + "\n")
