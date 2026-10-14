"""5- and 10-minute walk sheds around everywhere the bus takes you.

For each station and time window: the street network you can walk in 5 and
10 minutes (WALK_SHED_FT) from the station itself and from every stop its
reach file lists for that window (both bands, including after a transfer),
merged into one area per band.

  1. Per stop (cached for the run): walking distance along the OpenStreetMap
     pedestrian network (walknet.py), the street pieces within each limit,
     widened by WALK_SHED_BUFFER_FT and merged.
  2. Per station x window: the union of those areas, simplified to
     WALK_SHED_SIMPLIFY_FT and written as TopoJSON with quantized coordinates:
     data/walksheds/<station id>_<window>.topojson

Both steps run in parallel worker processes (one stop chunk or one station
per task). Needs shapely and pyosmium (requirements.txt).
"""
import gzip
import json
import multiprocessing as mp

from .config import (
    MAX_TRIP_MIN, REACH_DIR, WALK_SHED_BUFFER_FT, WALK_SHED_CLOSE_FT, WALK_SHED_FILL_HOLE_ACRES, WALK_SHED_FT, WALK_SHED_MIN, WALK_SHED_SIMPLIFY_FT, WALKSHED_DIR,
    WALKSHED_QUANTUM_DEG, WALKSHED_WARN_GZ_BYTES, WORKERS,
)
from .walknet import WalkNet, cell_of, to_lonlat, to_xy

_S = {}  # worker state, set before forking


def load_reach():
    """{station id: (station, {window: [stop ids]})}, {stop id: (lat, lon)} and
    {stop id: name} from the reach files. Every stop listed was reached in at
    most MAX_TRIP_MIN; that is asserted here, so no shed starts beyond it."""
    stations, stops, names = {}, {}, {}
    for f in sorted(REACH_DIR.glob("*.json")):
        doc = json.loads(f.read_text())
        table = doc["stops"]
        for sid, name, lat, lon in table:
            stops[sid] = (lat, lon)
            names[sid] = name
        windows = {}
        for w, v in doc["windows"].items():
            assert all(r[1] <= MAX_TRIP_MIN for r in v["reached"]), f"{f.name} {w}: stop over {MAX_TRIP_MIN} min"
            windows[w] = [table[r[0]][0] for r in v["reached"]]
        stations[doc["station"]["id"]] = (doc["station"], windows)
    return stations, stops, names


def build_all(workers=WORKERS):
    import shapely

    stations, stops, names = load_reach()
    _S["names"] = {f"stop:{k}": v for k, v in names.items()}
    points = {f"stop:{k}": v for k, v in stops.items()}
    points.update({f"station:{k}": (s["lat"], s["lon"]) for k, (s, _) in stations.items()})

    cells = set()
    for lat, lon in points.values():
        cx, cy = cell_of(*to_xy(lat, lon))
        cells.update((cx + dx, cy + dy) for dx in (-1, 0, 1) for dy in (-1, 0, 1))
    net = WalkNet.load(cells)
    print(f"Walk network: {net.n_edges:,} edges near {len(points):,} stops and stations")

    # 1. Per-stop sheds, in parallel chunks.
    _S["net"] = net
    keys = sorted(points)
    chunks = [[(k, points[k]) for k in keys[i::workers * 4]] for i in range(workers * 4)]
    with mp.get_context("fork").Pool(workers) as pool:
        parts = pool.map(_stop_sheds, chunks)
    sheds = {k: v for part in parts for k, v in part.items()}
    unsnapped = sorted(k for k in keys if k not in sheds)
    _S["sheds"] = {k: tuple(shapely.from_wkb(g) for g in v) for k, v in sheds.items()}
    _S["stations"] = stations

    # 2. Per station x window unions, one station per task.
    WALKSHED_DIR.mkdir(parents=True, exist_ok=True)
    keep = {f"{sid}_{w}.topojson" for sid, (_, ws) in stations.items() for w in ws}
    for old in WALKSHED_DIR.glob("*.topojson"):
        if old.name not in keep:
            old.unlink()
    with mp.get_context("fork").Pool(workers) as pool:
        results = [r for rs in pool.map(_station_files, sorted(stations)) for r in rs]
    return results, unsnapped, net, points


def _stop_sheds(chunk):
    import shapely

    net = _S["net"]
    out = {}
    for key, (lat, lon) in chunk:
        pieces = net.reach(lat, lon, [WALK_SHED_FT[m] for m in WALK_SHED_MIN])
        if pieces is None:
            continue
        geoms = []
        for m in WALK_SHED_MIN:
            # Buffering each piece and then merging is ~50x faster in GEOS
            # than buffering one MultiLineString, with the same result.
            lines = [shapely.LineString(x) for x in pieces[WALK_SHED_FT[m]]] or [shapely.Point(to_xy(lat, lon))]
            g = shapely.union_all(shapely.buffer(lines, WALK_SHED_BUFFER_FT, quad_segs=3))
            geoms.append(shapely.to_wkb(g.simplify(WALK_SHED_SIMPLIFY_FT / 3)))
        out[key] = tuple(geoms)
    return out


def _station_files(sid):
    import shapely

    sheds, (station, windows) = _S["sheds"], _S["stations"][sid]
    own = sheds.get(f"station:{sid}")
    out = []
    for wid, stop_ids in windows.items():
        layers = []
        for i, m in enumerate(WALK_SHED_MIN):
            parts = [sheds[f"stop:{s}"][i] for s in stop_ids if f"stop:{s}" in sheds]
            if own:
                parts.append(own[i])
            g = smooth(shapely.union_all(parts)).simplify(WALK_SHED_SIMPLIFY_FT) if parts else shapely.Polygon()
            layers.append((m, g))
        text = topojson(layers)
        (WALKSHED_DIR / f"{sid}_{wid}.topojson").write_text(text)
        out.append({
            "station": sid, "window": wid, "stops": len(stop_ids), "bytes": len(text),
            "gz_bytes": len(gzip.compress(text.encode())),
            "acres": {m: round(g.area / 43_560) for m, g in layers},
        })
    return out


def smooth(g):
    """Close slivers (grow and shrink by WALK_SHED_CLOSE_FT), then fill the
    enclosed holes up to WALK_SHED_FILL_HOLE_ACRES: the gaps between blocks
    that the 100 ft street buffers leave."""
    import shapely

    g = g.buffer(WALK_SHED_CLOSE_FT, quad_segs=2).buffer(-WALK_SHED_CLOSE_FT, quad_segs=2)
    max_hole = WALK_SHED_FILL_HOLE_ACRES * 43_560
    polys = []
    for p in getattr(g, "geoms", [g]):
        if isinstance(p, shapely.Polygon) and not p.is_empty:
            keep = [r for r in p.interiors if shapely.Polygon(r).area > max_hole]
            polys.append(shapely.Polygon(p.exterior, keep))
    return shapely.MultiPolygon(polys) if polys else shapely.Polygon()


# --- TopoJSON ----------------------------------------------------------------

def topojson(layers):
    """[(minutes, shapely geometry in feet)] -> TopoJSON text with one
    GeometryCollection "walk" of MultiPolygons, properties {minutes}.
    Coordinates are quantized and delta-encoded; each ring is its own arc."""
    import shapely

    q = WALKSHED_QUANTUM_DEG
    rings_lonlat = []
    for _, g in layers:
        polys = [p for p in getattr(g, "geoms", [g]) if not p.is_empty and isinstance(p, shapely.Polygon)]
        rings_lonlat.append([[_lonlat(r.coords) for r in [p.exterior, *p.interiors]] for p in polys])
    pts = [pt for layer in rings_lonlat for poly in layer for ring in poly for pt in ring]
    x0 = min((p[0] for p in pts), default=0.0)
    y0 = min((p[1] for p in pts), default=0.0)

    arcs, geometries = [], []
    for (m, _), polys in zip(layers, rings_lonlat):
        out_polys = []
        for poly in polys:
            out_rings = []
            for ring in poly:
                qs = []
                for lon, lat in ring:
                    p = (round((lon - x0) / q), round((lat - y0) / q))
                    if not qs or p != qs[-1]:
                        qs.append(p)
                if len(qs) < 4:
                    continue
                if qs[0] != qs[-1]:
                    qs.append(qs[0])
                delta = [list(qs[0])] + [[b[0] - a[0], b[1] - a[1]] for a, b in zip(qs, qs[1:])]
                out_rings.append([len(arcs)])
                arcs.append(delta)
            if out_rings:
                out_polys.append(out_rings)
        geometries.append({"type": "MultiPolygon", "properties": {"minutes": m}, "arcs": out_polys})
    topo = {
        "type": "Topology",
        "transform": {"scale": [q, q], "translate": [round(x0, 6), round(y0, 6)]},
        "objects": {"walk": {"type": "GeometryCollection", "geometries": geometries}},
        "arcs": arcs,
    }
    return json.dumps(topo, separators=(",", ":")) + "\n"


def _lonlat(coords):
    return [to_lonlat(x, y) for x, y in coords]


def sizes_report(results):
    big = [r for r in results if r["gz_bytes"] > WALKSHED_WARN_GZ_BYTES]
    gz = sorted(r["gz_bytes"] for r in results)
    print(f"\nWalk-shed files: {len(results)}; gzipped median {gz[len(gz) // 2] / 1024:.0f} KB, "
          f"largest {gz[-1] / 1024:.0f} KB, all {sum(gz) / 1024 / 1024:.1f} MB")
    for r in sorted(results, key=lambda r: -r["gz_bytes"])[:5]:
        print(f"  {r['station']}_{r['window']:16s} {r['bytes'] / 1024:7.0f} KB  {r['gz_bytes'] / 1024:5.0f} KB gz  {r['stops']} stops")
    return not big


# --- Barrier check -----------------------------------------------------------

def barrier_check(net, points):
    """Walk sheds must follow streets, not jump a freeway or a lake. For one
    stop beside I-5 and one on the Lake Union shore (picked automatically),
    count the street points within ACROSS_FT in a straight line that are more
    than the 10-minute walk away, and how many of them the 10-minute shed (as
    drawn: smoothed, holes filled) covers anyway. Returns True if the
    shed covers under 2% of them."""
    import math

    import shapely

    from .config import WALK_SHED_FT
    from .walknet import to_xy

    limit = WALK_SHED_FT[10]
    across_ft = 1_500

    def across(key):
        lat, lon = points[key]
        x, y = to_xy(lat, lon)
        res = net.distances(x, y, limit)
        if res is None:
            return None
        dist = res[0]
        far = [(net.vx[v], net.vy[v]) for v in range(len(net.vx))
               if abs(net.vx[v] - x) < across_ft and abs(net.vy[v] - y) < across_ft
               and math.hypot(net.vx[v] - x, net.vy[v] - y) < across_ft and v not in dist]
        return far

    def near_i5(key):
        x, y = to_xy(*points[key])
        best = math.inf
        for line in net.i5:
            for (ax, ay), (bx, by) in zip(line, line[1:]):
                dx, dy = bx - ax, by - ay
                L2 = dx * dx + dy * dy or 1
                t = max(0, min(1, ((x - ax) * dx + (y - ay) * dy) / L2))
                best = min(best, math.hypot(ax + dx * t - x, ay + dy * t - y))
        return best

    # Candidates: stops within 300 ft of I-5 in Seattle; stops on Westlake Ave N
    # or Eastlake Ave E along Lake Union.
    names = _S.get("names", {})
    stops = [k for k in points if k.startswith("stop:") and k in _S["sheds"]]
    seattle = [k for k in stops if 47.50 < points[k][0] < 47.73]
    i5 = sorted((k for k in seattle if near_i5(k) < 300), key=lambda k: near_i5(k))[:40]
    lake = [k for k in seattle if 47.625 < points[k][0] < 47.65 and any(s in names.get(k, "") for s in ("Westlake Ave N", "Eastlake Ave E", "Fairview Ave E"))]
    ok = True
    for label, cands in (("I-5", i5), ("Lake Union", lake)):
        scored = [(k, across(k)) for k in cands]
        scored = [(k, f) for k, f in scored if f]
        if not scored:
            print(f"  {label}: no candidate stop found")
            ok = False
            continue
        key, far = max(scored, key=lambda kf: len(kf[1]))
        inside = int(shapely.contains_xy(smooth(_S["sheds"][key][1]), [p[0] for p in far], [p[1] for p in far]).sum())
        share = inside / len(far)
        ok &= share < 0.02
        print(f"  {'PASS' if share < 0.02 else 'FAIL'}  {label}: {names.get(key, key)} -- {len(far)} street points within "
              f"{across_ft:,} ft straight-line are over {limit:,} ft on foot; the 10-min shed covers {inside} ({share:.1%})")
    return ok
