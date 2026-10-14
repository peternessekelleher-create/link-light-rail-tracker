"""Run the whole ST3 data build.

    python -m pipeline.build                    # weekly: stations + buses
    python -m pipeline.build --rebuild-anchors  # also re-query OpenStreetMap

Exits non-zero if a sanity check fails, so the scheduled Action doesn't
commit a broken build.
"""
import argparse
import subprocess
import sys

from . import bus_connections, report
from .config import DATA


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--rebuild-anchors", action="store_true")
    args = ap.parse_args()

    cmd = [sys.executable, str(DATA / "build_station_alternatives.py")]
    if args.rebuild_anchors:
        cmd.append("--rebuild-anchors")
    subprocess.run(cmd, check=True)

    meta, features, _ = bus_connections.build()
    print(f"\n{len(features)} connecting routes; KCM feed {meta['feed_version']}; "
          f"midday on {meta['representative_weekday']}")
    if not report.run():
        sys.exit("A sanity check failed; outputs were written but should not be committed.")


if __name__ == "__main__":
    main()
