"""Run the whole data build.

    python -m pipeline.build                    # weekly: stations, buses, reach
    python -m pipeline.build --rebuild-anchors  # also re-query OpenStreetMap
    python -m pipeline.build --only link-C27    # reach for some stations only

Exits non-zero if a check fails, so the scheduled Action doesn't commit a
broken build.
"""
import argparse
import subprocess
import sys
import time

from . import connections, reach, report
from .config import (
    BANDS_MIN, DAY_TYPES, DATA, MAX_RIDES, PERIODS, SAMPLE_EVERY_MIN, STATION_EXIT_MIN,
    TIMEZONE, TRANSFER_RADIUS_M, ACCESS_RADIUS_M, WALK_DETOUR, WALK_SPEED_M_PER_MIN, WORKERS,
)
from .feeds import Network
from .stations import all_stations


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--rebuild-anchors", action="store_true")
    ap.add_argument("--only", nargs="*", help="station ids to rebuild reach for")
    args = ap.parse_args()

    cmd = [sys.executable, str(DATA / "build_station_alternatives.py")]
    if args.rebuild_anchors:
        cmd.append("--rebuild-anchors")
    subprocess.run(cmd, check=True)

    t = time.time()
    net = Network.load()
    stations = all_stations(net.feeds["st"])
    dates = reach.dates_for(net)
    print(f"\nFeeds loaded in {time.time() - t:.0f}s: {len(net.routes)} bus routes, {len(net.trips)} trips, {len(net.stops)} stops")
    print(f"Stations: {sum(s['kind'] == 'link' for s in stations)} Link, {sum(s['kind'] == 'st3' for s in stations)} ST3")
    print("Representative dates: " + ", ".join(f"{k} {v} ({v:%a})" for k, v in dates.items()))

    meta = {
        "feeds": net.versions,
        "dates": {k: v.isoformat() for k, v in dates.items()},
        "timezone": TIMEZONE,
        "day_types": [{"id": k, "label": v[0]} for k, v in DAY_TYPES.items()],
        "periods": [{"id": p, "label": label, "start": h0, "end": h1} for p, label, h0, h1 in PERIODS],
        "reach": {
            "access_radius_m": ACCESS_RADIUS_M,
            "transfer_radius_m": TRANSFER_RADIUS_M,
            "walk_detour": WALK_DETOUR,
            "walk_speed_m_per_min": WALK_SPEED_M_PER_MIN,
            "station_exit_min": STATION_EXIT_MIN,
            "sample_every_min": SAMPLE_EVERY_MIN,
            "bands_min": list(BANDS_MIN),
            "max_rides": MAX_RIDES,
            "statistic": "lower median over departures; a departure that misses 30 min counts as too long",
        },
        "note": "Future stations show today's bus network. Metro will restructure routes when they open.",
    }
    grid = reach.StopGrid(net.stops)
    conn, _ = connections.build(net, stations, grid, dates, meta)

    todo = [s for s in stations if not args.only or s["id"] in args.only]
    t = time.time()
    results = reach.build_all(net, todo, dates) if not args.only else _only(net, todo, dates)
    print(f"Reach for {len(todo)} stations in {time.time() - t:.0f}s on {WORKERS} workers")

    if not report.run(net, stations, conn, results, dates):
        sys.exit("A check failed; outputs were written but should not be committed.")


def _only(net, todo, dates):
    reach.prepare(net, dates)
    return [reach.build_station(s) for s in todo]


if __name__ == "__main__":
    main()
