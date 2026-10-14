"""OpenStreetMap pedestrian network, and walking distance along it.

    net = WalkNet.load(cells)            # only the area near these grid cells
    pieces = net.reach(lat, lon, 2640)   # street pieces within 2,640 ft of walking

The network comes from Geofabrik's Washington extract (downloaded once per
run). Walkable ways are sidewalks, paths, stairs, crossings, pedestrian
bridges and ordinary streets; freeways and ways tagged foot=no or private
are left out, so a freeway or a lake is a barrier unless a way crosses it.

The graph's vertices are way endpoints and junctions; each edge keeps its
full geometry, so a walk can stop partway along a block. Coordinates are in
a local flat projection in feet (x east, y north), accurate to well under a
percent across the three counties.

© OpenStreetMap contributors, ODbL.
"""
import heapq
import math
import urllib.request
from array import array
from bisect import bisect_right
from collections import defaultdict

from .config import (
    CACHE, OSM_PBF_URL, USER_AGENT, WALK_EXCLUDE_ACCESS, WALK_HIGHWAYS, WALK_OK_FOOT, WALK_SNAP_MAX_FT,
)
from .geo import FT_PER_DEG_LAT, ft_per_deg_lon

LAT0 = 47.6  # projection origin latitude
KX = ft_per_deg_lon(LAT0)
KY = FT_PER_DEG_LAT
CELL_FT = 2_640  # grid cell for selecting the area and finding the nearest edge


def to_xy(lat, lon):
    return lon * KX, lat * KY


def to_lonlat(x, y):
    return x / KX, y / KY


def cell_of(x, y):
    return int(x // CELL_FT), int(y // CELL_FT)


def download_pbf():
    CACHE.mkdir(exist_ok=True)
    dest = CACHE / "washington-latest.osm.pbf"
    if not dest.exists():
        req = urllib.request.Request(OSM_PBF_URL, headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(req, timeout=600) as r, open(dest, "wb") as f:
            while chunk := r.read(1 << 22):
                f.write(chunk)
    return dest


def walkable(tags):
    hw = tags.get("highway")
    foot = tags.get("foot")
    if foot in WALK_OK_FOOT:
        return hw is not None
    if hw not in WALK_HIGHWAYS or foot in ("no", "private", "use_sidepath"):
        return False
    if tags.get("access") in WALK_EXCLUDE_ACCESS:
        return False
    return tags.get("area") != "yes" or hw == "pedestrian"


class WalkNet:
    def __init__(self):
        self.vx = array("d")  # vertex x
        self.vy = array("d")
        self.adj = []  # vertex -> [edge]
        self.eu = array("i")  # edge start vertex
        self.ev = array("i")  # edge end vertex
        self.elen = array("d")  # edge length, ft
        self.estart = array("i")  # edge geometry: offset into gx/gy
        self.gx = array("d")
        self.gy = array("d")
        self.grid = defaultdict(list)  # cell -> [edge] (by every vertex of its geometry)
        self.i5 = []  # Interstate 5 carriageways near the area, [(x, y)], for the barrier check

    @classmethod
    def load(cls, cells, pbf=None):
        """Walkable ways with any node inside `cells` (a set of grid cells)."""
        import osmium

        pbf = pbf or download_pbf()
        ways = []  # [(node ids, [(x, y)])]
        i5_lines = []
        uses = defaultdict(int)
        # Nodes are read only to fill the location cache; the filters then pass
        # just highway=* ways through to Python.
        fp = (
            osmium.FileProcessor(str(pbf), osmium.osm.NODE | osmium.osm.WAY)
            .with_locations()
            .with_filter(osmium.filter.EntityFilter(osmium.osm.WAY))
            .with_filter(osmium.filter.KeyFilter("highway"))
        )
        for w in fp:
            tags = dict(w.tags)
            i5 = tags.get("highway") == "motorway" and "I 5" in tags.get("ref", "").split(";")
            if not (i5 or walkable(tags)):
                continue
            ids, pts = [], []
            for n in w.nodes:
                if not n.location.valid():
                    continue
                ids.append(n.ref)
                pts.append(to_xy(n.location.lat, n.location.lon))
            if len(ids) < 2 or not any(cell_of(*p) in cells for p in pts):
                continue
            if i5 and not walkable(tags):
                i5_lines.append(pts)
                continue
            ways.append((ids, pts))
            for i, nid in enumerate(ids):
                uses[nid] += 2 if 0 < i < len(ids) - 1 else 1
        net = cls._build(ways, uses)
        net.i5 = i5_lines
        return net

    @classmethod
    def _build(cls, ways, uses):
        net = cls()
        vid = {}

        def vertex(nid, p):
            v = vid.get(nid)
            if v is None:
                v = vid[nid] = len(net.vx)
                net.vx.append(p[0])
                net.vy.append(p[1])
                net.adj.append([])
            return v

        for ids, pts in ways:
            start = 0
            for i in range(1, len(ids)):
                # Split at junctions (a node used more than once) and way ends.
                if i < len(ids) - 1 and uses[ids[i]] <= 2:
                    continue
                seg = pts[start: i + 1]
                length = sum(math.dist(a, b) for a, b in zip(seg, seg[1:]))
                if length > 0:
                    u, v = vertex(ids[start], pts[start]), vertex(ids[i], pts[i])
                    e = len(net.eu)
                    net.eu.append(u)
                    net.ev.append(v)
                    net.elen.append(length)
                    net.estart.append(len(net.gx))
                    for x, y in seg:
                        net.gx.append(x)
                        net.gy.append(y)
                    net.adj[u].append(e)
                    net.adj[v].append(e)
                    for c in {cell_of(x, y) for x, y in seg}:
                        net.grid[c].append(e)
                start = i
        net.estart.append(len(net.gx))
        return net

    @property
    def n_edges(self):
        return len(self.eu)

    def geometry(self, e):
        a, b = self.estart[e], self.estart[e + 1]
        return list(zip(self.gx[a:b], self.gy[a:b]))

    def snap(self, x, y):
        """Nearest point on any edge: (edge, distance along it, offset ft), or None
        if nothing is within WALK_SNAP_MAX_FT."""
        cx, cy = cell_of(x, y)
        best = (WALK_SNAP_MAX_FT, None, 0.0)
        for gx in (cx - 1, cx, cx + 1):
            for gy in (cy - 1, cy, cy + 1):
                for e in self.grid.get((gx, gy), ()):
                    g = self.geometry(e)
                    along = 0.0
                    for (ax, ay), (bx, by) in zip(g, g[1:]):
                        dx, dy = bx - ax, by - ay
                        L2 = dx * dx + dy * dy
                        t = 0.0 if L2 == 0 else max(0.0, min(1.0, ((x - ax) * dx + (y - ay) * dy) / L2))
                        d = math.hypot(ax + dx * t - x, ay + dy * t - y)
                        if d < best[0]:
                            best = (d, e, along + math.sqrt(L2) * t)
                        along += math.sqrt(L2)
        return None if best[1] is None else (best[1], best[2], best[0])

    def distances(self, x, y, limit):
        """Walking distance to every vertex within `limit`, from the nearest
        point on the network. Returns (dist by vertex, start edge info) or None."""
        hit = self.snap(x, y)
        if hit is None:
            return None
        e, along, off = hit
        dist = {}
        heap = [(off + along, self.eu[e]), (off + self.elen[e] - along, self.ev[e])]
        heapq.heapify(heap)
        while heap:
            d, v = heapq.heappop(heap)
            if d > limit or v in dist:
                continue
            dist[v] = d
            for f in self.adj[v]:
                w = self.ev[f] if self.eu[f] == v else self.eu[f]
                nd = d + self.elen[f]
                if nd <= limit and w not in dist:
                    heapq.heappush(heap, (nd, w))
        return dist, (e, along, off)

    def reach(self, lat, lon, limits):
        """For each limit, the pieces of street within that walking distance,
        as lists of (x, y). One search to the largest limit serves them all."""
        x, y = to_xy(lat, lon)
        res = self.distances(x, y, max(limits))
        if res is None:
            return None
        dist, (e0, along0, off0) = res
        out = {L: [] for L in limits}
        edges = {f for v in dist for f in self.adj[v]} | {e0}
        for e in edges:
            g = self.geometry(e)
            n = self.elen[e]
            du, dv = dist.get(self.eu[e], math.inf), dist.get(self.ev[e], math.inf)
            for L in limits:
                spans = []
                if du < L:
                    spans.append((0.0, min(n, L - du)))
                if dv < L:
                    spans.append((max(0.0, n - (L - dv)), n))
                if e == e0 and off0 < L:  # the stop's own edge, both ways from the snap point
                    r = L - off0
                    spans.append((max(0.0, along0 - r), min(n, along0 + r)))
                for a, b in _merge(spans):
                    piece = _slice(g, a, b)
                    if len(piece) >= 2:
                        out[L].append(piece)
        return out


def _merge(spans):
    spans = sorted(s for s in spans if s[1] > s[0])
    out = []
    for a, b in spans:
        if out and a <= out[-1][1]:
            out[-1] = (out[-1][0], max(out[-1][1], b))
        else:
            out.append((a, b))
    return out


def _slice(g, a, b):
    """The part of polyline g between distances a and b along it."""
    cum = [0.0]
    for p, q in zip(g, g[1:]):
        cum.append(cum[-1] + math.dist(p, q))

    def at(d):
        i = min(max(bisect_right(cum, d) - 1, 0), len(g) - 2)
        seg = cum[i + 1] - cum[i]
        t = 0.0 if seg == 0 else (d - cum[i]) / seg
        return (g[i][0] + (g[i + 1][0] - g[i][0]) * t, g[i][1] + (g[i + 1][1] - g[i][1]) * t)

    inner = [g[i] for i in range(1, len(g) - 1) if a < cum[i] < b]
    return [at(a)] + inner + [at(b)]
