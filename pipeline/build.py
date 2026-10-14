"""Run the whole data build.

    python -m pipeline.build                    # weekly: stations, buses, reach
    python -m pipeline.build --rebuild-anchors  # also re-query OpenStreetMap
    python -m pipeline.build --only link-C27    # reach for some stations only
    python -m pipeline.build --skip-walksheds   # skip the OpenStreetMap walk sheds

Walk sheds need shapely and pyosmium (pip install -r requirements.txt).

Exits non-zero if a check fails, so the scheduled Action doesn't commit a
broken build.
"""
import argparse
import subprocess
import sys
import time

from . import connections, crowding, reach, report
from .config import (
    BANDS_MIN, DAY_TYPES, DATA, MAX_RIDES, PERIODS, SAMPLE_EVERY_MIN, STATION_EXIT_MIN,
    TIMEZONE, TRANSFER_RADIUS_FT, ACCESS_RADIUS_FT, WALK_DETOUR, WALK_SPEED_FT_PER_MIN, WORKERS,
)
from .feeds import Network
from .stations import all_stations


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--rebuild-anchors", action="store_true")
    ap.add_argument("--only", nargs="*", help="station ids to rebuild reach for")
    ap.add_argument("--skip-walksheds", action="store_true")
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
            "access_radius_ft": ACCESS_RADIUS_FT,
            "transfer_radius_ft": TRANSFER_RADIUS_FT,
            "walk_detour": WALK_DETOUR,
            "walk_speed_ft_per_min": WALK_SPEED_FT_PER_MIN,
            "station_exit_min": STATION_EXIT_MIN,
            "sample_every_min": SAMPLE_EVERY_MIN,
            "bands_min": list(BANDS_MIN),
            "max_rides": MAX_RIDES,
            "statistic": "lower median over departures; a departure that misses 30 min counts as too long",
        },
    }
    grid = reach.StopGrid(net.stops)
    conn, _ = connections.build(net, stations, grid, dates, meta)

    todo = [s for s in stations if not args.only or s["id"] in args.only]
    t = time.time()
    results = reach.build_all(net, todo, dates) if not args.only else _only(net, todo, dates)
    print(f"Reach for {len(todo)} stations in {time.time() - t:.0f}s on {WORKERS} workers")

    ok = report.run(net, stations, conn, results, dates)

    t = time.time()
    crowd = crowding.build(net, dates, conn)
    print(f"\nCrowding model in {time.time() - t:.0f}s: trunk scaled x{crowd['trunk_k']:.2f}, "
          f"1 Line direction odds rebalanced x{crowd['balance_k']:.2f}")
    ok &= crowding.report(crowd)

    if not args.skip_walksheds:
        from . import walksheds

        t = time.time()
        shed_results, unsnapped, walk_net, points = walksheds.build_all()
        print(f"\nWalk sheds for {len(shed_results)} station-windows in {time.time() - t:.0f}s on {WORKERS} workers")
        if unsnapped:
            print(f"  No walkable way within reach of: {', '.join(unsnapped)}")
        ok &= walksheds.sizes_report(shed_results)
        print("\nCHECK walk sheds start only from stops reached within 30 min: PASS (asserted while reading reach files)")
        print("CHECK walk sheds follow streets, not across barriers:")
        ok &= walksheds.barrier_check(walk_net, points)

    if not ok:
        sys.exit("A check failed; outputs were written but should not be committed.")


def _only(net, todo, dates):
    reach.prepare(net, dates)
    return [reach.build_station(s) for s in todo]


if __name__ == "__main__":
    main()
