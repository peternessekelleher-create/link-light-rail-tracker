"""Street-intersection anchors from OpenStreetMap (ODbL).

Each anchor is named like Sound Transit's text, e.g. "Delridge Way SW &
SW Andover St". Abbreviations expand to OSM's full Seattle names
("Delridge Way Southwest", "Southwest Andover Street"). The point is the
node the two streets share; dual carriageways give several nodes close
together, which are averaged. Streets that don't share a node (a footbridge
over a road) use the closest approach between them instead.

Data © OpenStreetMap contributors, available under the Open Database License.
"""
import json
import re
import time
import urllib.parse
import urllib.request

from .config import OVERPASS_URLS, SEATTLE_BBOX, USER_AGENT
from .geo import centroid, closest_points, dist_ft

WORDS = {
    "Ave": "Avenue", "St": "Street", "Blvd": "Boulevard", "Pl": "Place", "Dr": "Drive",
    "S": "South", "N": "North", "E": "East", "W": "West",
    "SW": "Southwest", "NW": "Northwest", "SE": "Southeast", "NE": "Northeast",
}
CLUSTER_FT = 260  # shared nodes this close together are one intersection
MAX_GAP_FT = 130  # closest-approach fallback must be at least this close


def osm_name(short):
    return " ".join(WORDS.get(w, w) for w in short.split())


def street_specs(anchor, override=None):
    """[(names, highway_regex or None), (names, highway_regex or None)]"""
    if override and "streets" in override:
        return [(s["names"], s.get("highway")) for s in override["streets"]]
    return [([osm_name(part.strip())], None) for part in anchor.split("&")]


def overpass(query, attempts=4):
    data = urllib.parse.urlencode({"data": query}).encode()
    for i in range(attempts):
        url = OVERPASS_URLS[i % len(OVERPASS_URLS)]
        try:
            req = urllib.request.Request(url, data=data, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=180) as r:
                return json.load(r)
        except Exception as e:  # rate limits and timeouts are common; back off
            if i == attempts - 1:
                raise
            print(f"  Overpass error from {url}: {e}; retrying")
            time.sleep(10 * (i + 1))


def fetch_ways(names):
    s, w, n, e = SEATTLE_BBOX
    # Exact-name matches use Overpass's tag index; a name regex times out.
    union = "".join(f'way["highway"]["name"="{nm}"]({s},{w},{n},{e});' for nm in sorted(names))
    q = f"[out:json][timeout:120];({union});out body geom;"
    by_name = {}
    for el in overpass(q)["elements"]:
        pts = [(g["lat"], g["lon"]) for g in el["geometry"]]
        by_name.setdefault(el["tags"]["name"], []).append(
            {"id": el["id"], "highway": el["tags"]["highway"], "nodes": dict(zip(el["nodes"], pts)), "line": pts}
        )
    return by_name


def _clusters(points):
    out = []
    for p in points:
        for c in out:
            if dist_ft(p[1], c[0][1]) <= CLUSTER_FT:
                c.append(p)
                break
        else:
            out.append([p])
    return out


PICK = {"north": lambda p: -p[0], "south": lambda p: p[0], "east": lambda p: -p[1], "west": lambda p: p[1]}


def resolve(anchor, specs, ways, near=None, pick=None):
    sides = []
    for names, hw in specs:
        side = [w for n in names for w in ways.get(n, []) if not hw or re.fullmatch(hw, w["highway"])]
        if not side:
            raise LookupError(f"{anchor}: no OSM ways named {names}")
        sides.append(side)
    a, b = sides
    shared = {}
    for wa in a:
        for wb in b:
            for nid in wa["nodes"].keys() & wb["nodes"].keys():
                shared[nid] = ((wa["id"], wb["id"]), wa["nodes"][nid])
    if shared:
        clusters = _clusters([(nid, pt, ids) for nid, (ids, pt) in shared.items()])
        if len(clusters) > 1 and pick:
            clusters.sort(key=lambda c: PICK[pick](centroid([p[1] for p in c])))
        elif len(clusters) > 1:
            if not near:
                where = ", ".join(f"{centroid([p[1] for p in c])}" for c in clusters)
                raise LookupError(f"{anchor}: streets meet at {len(clusters)} places ({where}); add a 'pick' or 'near' hint")
            clusters.sort(key=lambda c: dist_ft(centroid([p[1] for p in c]), near))
        c = clusters[0]
        lat, lon = centroid([p[1] for p in c])
        return {
            "lat": round(lat, 7), "lon": round(lon, 7),
            "method": "shared node" if len(c) == 1 else f"mean of {len(c)} shared nodes",
            "osm_nodes": sorted(p[0] for p in c),
            "osm_ways": sorted({i for p in c for i in p[2]}),
        }
    best = min(
        ((closest_points(wa["line"], wb["line"]), wa["id"], wb["id"]) for wa in a for wb in b),
        key=lambda t: t[0][0],
    )
    (gap, pa, pb), ia, ib = best
    if gap > MAX_GAP_FT:
        raise LookupError(f"{anchor}: streets never meet (closest {gap:.0f} ft)")
    lat, lon = centroid([pa, pb])
    return {
        "lat": round(lat, 7), "lon": round(lon, 7),
        "method": f"closest approach ({gap:.0f} ft apart; no shared node)",
        "osm_nodes": [], "osm_ways": sorted([ia, ib]),
    }


def build(anchors, overrides=None):
    """anchors: list of names. overrides: {name: {"streets": [...], "near": other_anchor,
    "pick": "north"|"south"|"east"|"west"}}; near/pick choose among several meeting points.
    Returns {name: {lat, lon, method, osm_nodes, osm_ways}}."""
    overrides = overrides or {}
    specs = {a: street_specs(a, overrides.get(a)) for a in anchors}
    names = {n for s in specs.values() for names, _ in s for n in names}
    ways = fetch_ways(names)
    out, errors = {}, []
    # Anchors with a 'near' hint go last so the hint is already resolved.
    for a in sorted(anchors, key=lambda a: "near" in overrides.get(a, {})):
        hint = overrides.get(a, {}).get("near")
        try:
            near = (out[hint]["lat"], out[hint]["lon"]) if hint else None
            out[a] = resolve(a, specs[a], ways, near, overrides.get(a, {}).get("pick"))
        except (LookupError, KeyError) as e:
            errors.append(str(e))
    if errors:
        raise LookupError("Could not resolve anchors:\n  " + "\n  ".join(errors))
    return {a: out[a] for a in anchors}
