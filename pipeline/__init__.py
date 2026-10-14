"""Build-time data pipeline for the ST3 layers.

Runs in a scheduled GitHub Action (see .github/workflows/st3-data.yml) and
writes small files under data/ that the deployed site reads. Nothing here runs
in the browser or on Vercel.

  config.py       every tunable constant (radius, feed URLs, midday window)
  geo.py          distances, offsets, line simplification
  gtfs.py         generic GTFS reader: download, tables, active services
  osm_anchors.py  street intersections from OpenStreetMap (Overpass API)
  bus_connections.py  King County Metro routes near each ST3 alternative
  report.py       printed sanity checks
  build.py        runs everything: python -m pipeline.build

gtfs.py is deliberately feed-agnostic so the next step can write a synthetic
GTFS for the ST3 lines and feed the same tables to r5py or OpenTripPlanner.
"""
