"""Every station the site analyses, existing and future, with one ID scheme.

    link-<parent stop_id>   1 Line / 2 Line stations, e.g. link-C03 (Westlake)
    st3-<station id>        preferred ST3 stations, e.g. st3-ballard

ST3 IDs come from the station (data/st3_network.json), not the option, so
they stay the same if Sound Transit picks a different option for a station.
"""
import json
from collections import defaultdict

from .config import DATA, LINK_LINES


def link_stations(st_feed):
    """Parent stations of the stops the 1 Line and 2 Line serve, south to north."""
    routes = {r["route_id"]: r["route_short_name"] for r in st_feed.rows("routes.txt") if r["route_short_name"] in LINK_LINES}
    trips = {t["trip_id"]: routes[t["route_id"]] for t in st_feed.rows("trips.txt") if t["route_id"] in routes}
    stops = {s["stop_id"]: s for s in st_feed.rows("stops.txt")}
    lines = defaultdict(set)
    for st in st_feed.rows("stop_times.txt"):
        line = trips.get(st["trip_id"])
        if line:
            s = stops[st["stop_id"]]
            lines[s.get("parent_station") or s["stop_id"]].add(line)
    out = []
    for pid, ls in lines.items():
        s = stops[pid]
        out.append({
            "id": f"link-{pid}",
            "name": s["stop_name"],
            "kind": "link",
            "lines": sorted(ls),
            "gtfs_stop_id": f"st:{pid}",
            "lat": round(float(s["stop_lat"]), 6),
            "lon": round(float(s["stop_lon"]), 6),
        })
    return sorted(out, key=lambda s: s["lat"])


def st3_stations():
    """Preferred options from station_alternatives.geojson, named and grouped
    by data/st3_network.json, in each project's alignment order."""
    net = json.loads((DATA / "st3_network.json").read_text())
    feats = json.loads((DATA / "station_alternatives.geojson").read_text())["features"]
    preferred = {f["properties"]["id"]: f["properties"] for f in feats if f["properties"].get("preferred")}
    out, seen = [], set()
    for p in net["projects"]:
        order = {sid: i for i, sid in enumerate(p["alignment"])}
        for s in sorted(p["stations"], key=lambda s: order.get(s["id"], 99)):
            alt = next((a for a in s["alternatives"] if a["id"] in preferred), None)
            if not alt:
                continue
            props = preferred[alt["id"]]
            phase = str(s.get("phase", 1))
            out.append({
                "id": f"st3-{s['id']}",
                "name": s["name"],
                "kind": "st3",
                "project": p["id"],
                "phase": int(phase),
                "opening": p["opening"][phase],
                "alternative_id": alt["id"],
                "confidence_m": props["confidence_m"],
                "lat": props["lat"],
                "lon": props["lon"],
            })
            seen.add(alt["id"])
    missing = preferred.keys() - seen
    if missing:
        raise ValueError(f"preferred options not in st3_network.json: {sorted(missing)}")
    return out


def all_stations(st_feed):
    return link_stations(st_feed) + st3_stations()
