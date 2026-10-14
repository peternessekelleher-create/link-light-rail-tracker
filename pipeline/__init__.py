"""Build-time data pipeline.

Runs in a scheduled GitHub Action (see .github/workflows/st3-data.yml) and
writes small files under data/ that the deployed site reads. Nothing here runs
in the browser or on Vercel, and the browser never loads raw GTFS.

  config.py          every tunable constant (radii, walking, windows, feeds)
  gtfs.py            generic GTFS reader: download, tables, active services
  feeds.py           all feeds merged into one bus network, feed-prefixed IDs
  stations.py        Link stations (Sound Transit GTFS) + preferred ST3 stations
  connections.py     bus routes near each station -> connections.json, routes.geojson
  timetable.py       one service day's patterns and trips, for RAPTOR
  raptor.py          two-ride RAPTOR search with paths
  reach.py           15/30-minute bus reach per station -> data/reach/<id>.json
  geo.py             distances, simplification, polyline encoding
  osm_anchors.py     street intersections from OpenStreetMap (Overpass API)
  check_agencies.py  looks for other agencies with stops near a station
  report.py          printed checks
  build.py           runs everything: python -m pipeline.build
"""
