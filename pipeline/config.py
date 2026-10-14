"""Tunable constants for the data pipeline. Every number the outputs depend on
lives here, so a change is one edit and shows up in the files' metadata."""
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
REACH_DIR = DATA / "reach"
# Downloads are cached here between steps of one run (gitignored).
CACHE = ROOT / ".cache"

# --- Feeds -------------------------------------------------------------------
# The key is the ID prefix: every stop, trip, route, service and shape ID is
# written as "<key>:<original id>". The prefix is the source feed, not the
# agency, because Sound Transit (agency 40) appears in all four feeds: ST
# Express routes are published by the agency that operates them.
FEEDS = {
    "kcm": "http://metro.kingcounty.gov/GTFS/google_transit.zip",
    "st": "https://gtfs.sound.obaweb.org/prod/40_gtfs.zip",
    "ct": "https://www.communitytransit.org/docs/default-source/open-data/gtfs/current.zip",
    "pt": "https://gtfs.sound.obaweb.org/prod/3_gtfs.zip",
}
# Other regional feeds checked by `python -m pipeline.check_agencies` for
# current bus service near a station. In October 2026 Everett Transit and
# Intercity Transit had no stops near one. Seattle Children's shuttle has
# stops near Univ of Washington and U District, but its feed expired in July
# 2024 (no current service), so it is not in FEEDS.
CANDIDATE_FEEDS = {
    "et": "https://gtfs.sound.obaweb.org/prod/97_gtfs.zip",  # Everett Transit
    "it": "https://gtfs.sound.obaweb.org/prod/19_gtfs.zip",  # Intercity Transit
    "sch": "https://gtfs.sound.obaweb.org/prod/98_gtfs.zip",  # Seattle Children's shuttle
}
# Used only by data/build_station_alternatives.py for the two reference points.
ST_RAIL_GTFS_URL = "https://www.soundtransit.org/GTFS-rail/40_gtfs.zip"

# Display names for agency_name values that differ from common usage.
AGENCY_NAMES = {"Metro Transit": "King County Metro"}

# --- What counts as a bus ----------------------------------------------------
# 3 = bus, 11 = trolleybus. Link (0), Sounder (2), streetcar (0), monorail
# (12) and ferries (4) are excluded by type.
BUS_ROUTE_TYPES = {"3", "11"}
# Buses that replace Link during closures, not regular service.
EXCLUDE_ROUTES = {"st:1-SHUTTLE", "st:2-SHUTTLE"}
# Bus rapid transit brands: (feed, regex on route_short_name, brand).
BRT_PATTERNS = [
    ("kcm", r"^[A-Z] Line$", "RapidRide"),
    ("ct", r"^Swift\b", "Swift"),
    ("pt", r"^STCL$", "Stream"),
    (None, r"^S[1-3]$", "Stride"),  # ST Express Stride, whichever feed carries it
]

# --- Stations ----------------------------------------------------------------
# Existing stations: parent stations of the stops these Link routes serve, in
# the Sound Transit feed.
LINK_LINES = ("1 Line", "2 Line")
# ST3 stations: features in station_alternatives.geojson with preferred = true.

# --- Connections and walking -------------------------------------------------
# A bus route "connects" to a station when any of its stops is within this
# straight-line distance. Also the farthest stop you may walk to from a
# station to start a trip.
CONNECT_RADIUS_M = 400
ACCESS_RADIUS_M = CONNECT_RADIUS_M
# Farthest walk between two stops when transferring.
TRANSFER_RADIUS_M = 250
# Walking time = straight-line distance x WALK_DETOUR / WALK_SPEED_M_PER_MIN.
WALK_DETOUR = 1.3
WALK_SPEED_M_PER_MIN = 80
# Added once, when leaving the station: platform to street.
STATION_EXIT_MIN = 2

# --- Reach (travel time) -----------------------------------------------------
# A stop counts only if the median total time, including any transfer, is at
# most the larger band. Bands are inclusive upper bounds in minutes.
BANDS_MIN = (15, 30)
MAX_TRIP_MIN = BANDS_MIN[-1]
# RAPTOR rounds: 2 = first bus plus one transfer.
MAX_RIDES = 2
# Departures from the station are sampled every SAMPLE_EVERY_MIN across each
# window; the median over samples is reported.
SAMPLE_EVERY_MIN = 5

# Day types: id -> (label, weekday used for the representative date, Monday = 0).
DAY_TYPES = {
    "weekday": ("Weekday", 2),  # a Wednesday
    "saturday": ("Saturday", 5),
    "sunday": ("Sunday", 6),
}
# Periods: (id, label, start hour, end hour) in America/Los_Angeles service
# time. Night runs past midnight (25 = 1 am the next morning).
PERIODS = [
    ("am", "AM rush", 6, 9),
    ("midday", "Midday", 9, 15),
    ("pm", "PM rush", 15, 18),
    ("evening", "Evening", 18, 22),
    ("night", "Night", 22, 25),
]
TIMEZONE = "America/Los_Angeles"
# "Weekday midday trips per hour" in the station panel uses this window.
FREQ_DAY, FREQ_PERIOD = "weekday", "midday"

# A representative date is not a holiday: every feed must run at least this
# share of its usual service for that weekday.
REP_DAY_MIN_SHARE = 0.9

# Worker processes for the reach build (one station per task).
WORKERS = int(os.environ.get("REACH_WORKERS") or os.cpu_count() or 2)

# --- Output ------------------------------------------------------------------
# Bus shapes are simplified to this tolerance (metres) to keep files small.
SHAPE_SIMPLIFY_M = 4
# Warn if a reach file is bigger than this (gzipped bytes): about a second on
# a typical phone connection.
REACH_WARN_GZ_BYTES = 150_000

# --- ST3 station anchors (data/build_station_alternatives.py) ---------------
# Overpass API for OpenStreetMap street geometry, limited to Seattle.
# Tried in turn when one is busy.
OVERPASS_URLS = ["https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter"]
SEATTLE_BBOX = (47.48, -122.44, 47.74, -122.22)  # south, west, north, east
USER_AGENT = "link-light-rail-tracker/1.0 (+https://github.com/peternessekelleher-create/link-light-rail-tracker)"
# Print any station point that moves more than this when its anchors are rebuilt.
MOVE_WARN_M = 15
