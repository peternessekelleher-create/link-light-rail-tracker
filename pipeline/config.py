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
# All distances are in feet.
# A bus route "connects" to a station when any of its stops is within this
# straight-line distance (a quarter mile). Also the farthest stop you may
# walk to from a station to start a trip.
CONNECT_RADIUS_FT = 1_320
ACCESS_RADIUS_FT = CONNECT_RADIUS_FT
# Farthest walk between two stops when transferring.
TRANSFER_RADIUS_FT = 800
# Walking time = straight-line distance x WALK_DETOUR / WALK_SPEED_FT_PER_MIN.
WALK_DETOUR = 1.3
WALK_SPEED_FT_PER_MIN = 264  # 3 mph
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

# --- Walk sheds --------------------------------------------------------------
# From every stop reached within 30 min (and from the station itself), the
# streets you can walk along in 5 and 10 minutes at WALK_SPEED_FT_PER_MIN,
# buffered and merged into one area per band.
WALK_SHED_MIN = (5, 10)
WALK_SHED_FT = {m: m * WALK_SPEED_FT_PER_MIN for m in WALK_SHED_MIN}  # 1,320 and 2,640 ft
WALK_SHED_BUFFER_FT = 100  # each reachable street piece is widened this much each side
WALK_SHED_SIMPLIFY_FT = 30
# Smoothing of each merged shed: grow by WALK_SHED_CLOSE_FT and shrink back
# (closes slivers and notches without moving the outer edge), then fill any
# enclosed hole up to WALK_SHED_FILL_HOLE_ACRES. Block interiors are almost
# all under 5 acres; lakes and large parks (Green Lake is 259) stay open.
WALK_SHED_CLOSE_FT = 40
WALK_SHED_FILL_HOLE_ACRES = 20
# A stop farther than this from any walkable way gets no shed.
WALK_SNAP_MAX_FT = 330
WALKSHED_DIR = DATA / "walksheds"
# Coordinates in the TopoJSON files are quantized to this many degrees
# (about 2.4 ft east-west and 3.6 ft north-south).
WALKSHED_QUANTUM_DEG = 1e-5
# Warn if a walk-shed file is bigger than this (gzipped bytes).
WALKSHED_WARN_GZ_BYTES = 400_000

# OpenStreetMap: Geofabrik's Washington extract, read with pyosmium.
OSM_PBF_URL = "https://download.geofabrik.de/north-america/us/washington-latest.osm.pbf"
# highway=* values a pedestrian can use. Motorways are left out, as are ways
# tagged foot=no, foot=use_sidepath or access=no/private (unless foot=yes).
WALK_HIGHWAYS = {
    "footway", "path", "pedestrian", "steps", "corridor", "elevator", "living_street", "residential",
    "service", "unclassified", "road", "track", "cycleway", "bridleway",
    "tertiary", "tertiary_link", "secondary", "secondary_link", "primary", "primary_link", "trunk", "trunk_link",
}
WALK_OK_FOOT = {"yes", "designated", "permissive"}
WALK_EXCLUDE_ACCESS = {"no", "private"}

# --- Crowding (estimated typical, not live) ----------------------------------
# Inputs: data/ridership/*.csv (sources in data/ridership/SOURCES.md) and the
# Seattle Transit Blog's May 2025 1 Line counts by direction (downloaded).
RIDERSHIP_DIR = DATA / "ridership"
STB_1LINE_URL = "https://seattletransitblog.com/wp-content/uploads/2025/08/1LineMay2025Data.csv"
# The 13 Lynnwood-CID stations (2025 averages) are scaled together to this
# April 2026 total, after the 2 Line began crossing the lake (STB_2026_06).
TRUNK_2026_TOTAL = 98_300
# Per car, Sound Transit's loading standards (ST_CAPACITY). Load % is riders
# per train / (cars x CAR_TARGET_MAX_LOAD).
CAR_SEATS = 74
CAR_PLANNING_LOAD = 148  # 74 seated + 74 standing
CAR_TARGET_MAX_LOAD = 194  # 74 seated + 120 standing
# Cars per train: 1 Line four-car; 2 Line a mix of two- and three-car
# (URBANIST_2026_03); simulated ST3 lines assumed four-car.
CARS = {"1 Line": 4, "2 Line": 2.5, "sim": 4}
# Crowding levels: (id, label, upper bound in % of target max load). The
# bounds are the seats (74/194 = 38%), planning load (148/194 = 76%) and
# target max load (100%).
CROWDING_LEVELS = [
    ("seats", "Seats available", round(100 * CAR_SEATS / CAR_TARGET_MAX_LOAD)),
    ("some", "Some standing", round(100 * CAR_PLANNING_LOAD / CAR_TARGET_MAX_LOAD)),
    ("crowded", "Crowded", 100),
    ("very", "Very crowded", None),
]
# Assumed weekday ridership by period, as a share of the day (the hours
# outside the periods, 1-6 am, carry the remaining 3%).
WEEKDAY_PROFILE = {"am": 0.22, "midday": 0.30, "pm": 0.24, "evening": 0.15, "night": 0.06}
# Assumed weekend daily ridership relative to a weekday.
WEEKEND_FACTOR = {"weekday": 1.0, "saturday": 0.75, "sunday": 0.62}
# The STB direction counts are raw passenger-counter totals and come out
# about 2.6:1 northbound. Each station's north/south pattern is kept but
# rescaled so a whole day balances (most riders return the way they came).
BALANCE_DIRECTIONS = True
# Stations missing from the STB data borrow another station's direction split.
DIRECTION_PROXY = {"link-S05": "link-C35", "link-S03": "link-C35", "link-N13": "link-N11"}

# --- Simulated future trains (Ballard Link, West Seattle Link) ------------
# Headway: the 1 Line's scheduled headway in each window. Speed: the 1 Line's
# average scheduled speed between stations, plus a dwell at every station.
SIM_DWELL_S = 30
SIM_HEADWAY_STATION = "C03"  # Westlake, where 1 Line headways are measured

# --- Output ------------------------------------------------------------------
# Bus shapes are simplified to this tolerance to keep files small.
SHAPE_SIMPLIFY_FT = 13
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
MOVE_WARN_FT = 50
