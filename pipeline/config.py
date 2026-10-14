"""Tunable constants for the ST3 data pipeline."""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
# Downloads are cached here between steps of one run (gitignored).
CACHE = ROOT / ".cache"

# A bus route "connects" to a station alternative when any of its stops is
# within this distance (straight line, metres) of the alternative's point.
CONNECT_RADIUS_M = 400

KCM_GTFS_URL = "http://metro.kingcounty.gov/GTFS/google_transit.zip"
ST_RAIL_GTFS_URL = "https://www.soundtransit.org/GTFS-rail/40_gtfs.zip"

# The KCM feed also carries Seattle Streetcar (agency 23) and some ST Express
# routes (agency 40); only Metro buses are wanted here.
KCM_AGENCIES = {"1"}
BUS_ROUTE_TYPES = {"3"}

# "Weekday midday" frequency: trips per hour per direction, counted by each
# trip's first departure, on a representative weekday.
MIDDAY_START_H = 10
MIDDAY_END_H = 14
REP_WEEKDAY = 2  # Wednesday (Monday = 0)

# Bus shapes are simplified to this tolerance (metres) to keep the file small.
SHAPE_SIMPLIFY_M = 4

# Overpass API for OpenStreetMap street geometry, limited to Seattle.
# Tried in turn when one is busy.
OVERPASS_URLS = ["https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter"]
SEATTLE_BBOX = (47.48, -122.44, 47.74, -122.22)  # south, west, north, east
USER_AGENT = "link-light-rail-tracker/1.0 (+https://github.com/peternessekelleher-create/link-light-rail-tracker)"

# Print any station point that moves more than this when its anchors are rebuilt.
MOVE_WARN_M = 15
