"""Small geodesy helpers. Distances use a local equirectangular projection,
which is accurate to well under a metre at city scale."""
import math

M_PER_DEG_LAT = 111_132.0


def m_per_deg_lon(lat):
    return 111_320.0 * math.cos(math.radians(lat))


def dist_m(a, b):
    """Distance in metres between (lat, lon) points."""
    dlat = (a[0] - b[0]) * M_PER_DEG_LAT
    dlon = (a[1] - b[1]) * m_per_deg_lon((a[0] + b[0]) / 2)
    return math.hypot(dlat, dlon)


def offset(lat, lon, north_m=0.0, east_m=0.0):
    return lat + north_m / M_PER_DEG_LAT, lon + east_m / m_per_deg_lon(lat)


def centroid(pts):
    return sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts)


def _xy(p, lat0):
    return p[1] * m_per_deg_lon(lat0), p[0] * M_PER_DEG_LAT


def closest_points(line_a, line_b):
    """Closest pair of points between two polylines of (lat, lon).
    Returns (distance_m, point_on_a, point_on_b)."""
    lat0 = line_a[0][0]
    best = (math.inf, None, None)

    def seg_closest(p, a, b):
        (px, py), (ax, ay), (bx, by) = _xy(p, lat0), _xy(a, lat0), _xy(b, lat0)
        dx, dy = bx - ax, by - ay
        L = dx * dx + dy * dy
        t = 0 if L == 0 else max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / L))
        return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)

    for line, other, flip in ((line_a, line_b, False), (line_b, line_a, True)):
        for p in line:
            for a, b in zip(other, other[1:]):
                q = seg_closest(p, a, b)
                d = dist_m(p, q)
                if d < best[0]:
                    best = (d, q, p) if flip else (d, p, q)
    return best


def simplify(coords, tol_m):
    """Douglas-Peucker on (lon, lat) pairs."""
    if len(coords) < 3:
        return coords
    lat0 = coords[0][1]
    pts = [(c[0] * m_per_deg_lon(lat0), c[1] * M_PER_DEG_LAT) for c in coords]
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        i, j = stack.pop()
        (ax, ay), (bx, by) = pts[i], pts[j]
        dx, dy = bx - ax, by - ay
        L = math.hypot(dx, dy)
        far, idx = 0.0, None
        for k in range(i + 1, j):
            px, py = pts[k]
            d = abs(dy * (px - ax) - dx * (py - ay)) / L if L else math.hypot(px - ax, py - ay)
            if d > far:
                far, idx = d, k
        if idx is not None and far > tol_m:
            keep[idx] = True
            stack += [(i, idx), (idx, j)]
    return [c for c, k in zip(coords, keep) if k]
