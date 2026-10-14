"""Printed checks after a build: the station/alternative/route table, the
CID comparison, and known connections that must be present."""
import json

from .config import DATA

# (station_id, route number) that must connect through the selected option.
MUST_CONNECT = [
    ("delridge", "H Line"),
    ("alaska-junction", "C Line"),
    ("ballard", "D Line"),
    ("ballard", "44"),
]


def run():
    net = json.loads((DATA / "st3_network.json").read_text())
    conn = json.loads((DATA / "st3_bus_connections.json").read_text())["stations"]
    routes = {
        f["properties"]["route_id"]: f["properties"]
        for f in json.loads((DATA / "st3_bus_routes.geojson").read_text())["features"]
    }
    ok = True

    print("\nStation -> alternative -> connecting routes (* = RapidRide)")
    for p in net["projects"]:
        print(f"\n{p['name']}")
        for s in p["stations"]:
            print(f"  {s['name']}")
            for a in s["alternatives"]:
                rs = conn[s["id"]][a["id"]]
                nums = ", ".join(r["number"] + ("*" if routes[r["route_id"]]["rapidride"] else "") for r in rs)
                print(f"    {a['id']:22s} [{a['role']:11s}] {len(rs):3d}: {nums}")

    print("\nCID alternatives: route differences")
    cid = {a: {r["number"] for r in rs} for a, rs in conn["cid"].items()}
    names = list(cid)
    common = set.intersection(*cid.values())
    print(f"  Served by all three ({len(common)}): {', '.join(sorted(common, key=_num))}")
    for a in names:
        only = cid[a] - set.union(*(cid[b] for b in names if b != a))
        missing = set.union(*(cid[b] for b in names if b != a)) - cid[a]
        print(f"  {a:16s} only here: {', '.join(sorted(only, key=_num)) or '-'};  missing here: {', '.join(sorted(missing, key=_num)) or '-'}")
    if all(cid[a] == cid[names[0]] for a in names):
        print("  FLAG: all three CID alternatives connect to the same routes")

    print("\nSanity checks (selected option)")
    for sid, num in MUST_CONNECT:
        sel = next(a["id"] for p in net["projects"] for s in p["stations"] if s["id"] == sid
                   for a in s["alternatives"] if a["role"] == "selected")
        hit = next((r for r in conn[sid][sel] if r["number"] == num), None)
        ok &= hit is not None
        where = f"stop {hit['stop_name']} at {hit['distance_m']} m" if hit else "NOT FOUND"
        print(f"  {'PASS' if hit else 'FAIL'}  {sid} ({sel}) includes {num}: {where}")
    return ok


def _num(n):
    d = "".join(c for c in n if c.isdigit())
    return (0, n) if not d else (1, int(d))
