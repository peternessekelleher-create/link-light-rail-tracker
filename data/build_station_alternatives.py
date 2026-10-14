"""
Build station_alternatives.geojson / .csv for the Link tracker.

No official coordinates are published for planned ST3 station alternatives
(Sound Transit releases them only as PDF maps and engineering drawings).
Each point here is derived from street intersections named in Sound Transit's
own location descriptions, then offset as the description says. Every anchor,
offset, and source is stored on the feature so the derivation is auditable.

Anchor intersections: OpenStreetMap (© OpenStreetMap contributors, ODbL),
resolved by pipeline/osm_anchors.py and cached in data/anchors_osm.json.
Existing stations: Sound Transit GTFS stops.txt. See METHODS.md.

    python3 data/build_station_alternatives.py                    # cached anchors
    python3 data/build_station_alternatives.py --rebuild-anchors  # re-query OSM

Prints every station point that moves more than MOVE_WARN_M (15 m) from the
previous station_alternatives.geojson.
"""
import argparse
import csv
import json
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from pipeline import osm_anchors  # noqa: E402
from pipeline.config import DATA, MOVE_WARN_M, ST_RAIL_GTFS_URL  # noqa: E402
from pipeline.gtfs import Feed  # noqa: E402

# --- Preferred options -----------------------------------------------------
# The one option per station location the site shows (preferred = true). Set
# here by hand from the Board actions in the sources, not parsed from the
# status text. Avalon has none: the station was removed in 2025.
PREFERRED = {
    "CID-DEARBORN", "MIDTOWN-NORTH-OF-CID", "SODO-1C", "DEL-ANDOVER", "WSJ-5",
    "BLE-WESTLAKE", "BLE-DENNY", "BLE-SLU", "BLE-SEATTLE-CENTER",
    "BLE-SMITH-COVE", "BLE-INTERBAY", "BLE-BALLARD",
}

# --- Anchor intersections -----------------------------------------------------
# Names only. Coordinates come from OpenStreetMap via pipeline/osm_anchors.py
# and are cached in data/anchors_osm.json (rebuild with --rebuild-anchors).
ANCHOR_NAMES = [
    # Chinatown-International District / Pioneer Square
    "6th Ave S & Seattle Blvd S",
    "6th Ave S & S Dearborn St",
    "5th Ave S & S Jackson St",
    "6th Ave S & S Jackson St",
    "5th Ave S & S Weller St",
    "6th Ave S & S Weller St",
    "4th Ave S & S Jackson St",
    "4th Ave S & Weller St pedestrian bridge",
    "4th Ave & James St",
    "5th Ave & James St",
    "4th Ave & Jefferson St",
    "5th Ave & Jefferson St",
    # SODO
    "S Lander St & 5th Pl S",
    # Delridge
    "Delridge Way SW & SW Andover St",
    "26th Ave SW & SW Andover St",
    "Delridge Way SW & SW Dakota St",
    "Delridge Way SW & SW Genesee St",
    # Avalon
    "35th Ave SW & SW Genesee St",
    "Fauntleroy Way SW & SW Genesee St",
    # Alaska Junction
    "41st Ave SW & SW Alaska St",
    "42nd Ave SW & SW Alaska St",
    "41st Ave SW & SW Edmunds St",
    "42nd Ave SW & SW Edmunds St",
    "Fauntleroy Way SW & SW Alaska St",
    # Ballard Link north of downtown
    "5th Ave & Pine St",
    "Westlake Ave N & Denny Way",
    "7th Ave N & Harrison St",
    "1st Ave W & W Republican St",
    "15th Ave W & W Galer St",
    "17th Ave W & W Dravus St",
    "15th Ave NW & NW Market St",
]

# OSM street names that don't follow the abbreviation rules in osm_anchors.py.
ANCHOR_OVERRIDES = {
    # The Weller St pedestrian bridge is a footway named "South Weller Street"
    # that passes over 4th Ave S without a shared node.
    "4th Ave S & Weller St pedestrian bridge": {"streets": [
        {"names": ["4th Avenue South"]},
        {"names": ["South Weller Street"], "highway": "footway|steps"},
    ]},
    # 15th Ave W becomes Elliott Ave W just north of Galer, and Galer crosses
    # it on the "West Galer Street Flyover" bridge. The flyover's ramp also
    # touches Elliott ~120 m south; the street crossing is the northern one.
    "15th Ave W & W Galer St": {"pick": "north", "streets": [
        {"names": ["15th Avenue West", "Elliott Avenue West"]},
        {"names": ["West Galer Street", "West Galer Street Flyover"]},
    ]},
    # Westlake Ave is "Westlake Avenue" south of Denny and "... North" above it.
    "Westlake Ave N & Denny Way": {"streets": [
        {"names": ["Westlake Avenue North", "Westlake Avenue"]},
        {"names": ["Denny Way"]},
    ]},
}

# Existing stations: Sound Transit GTFS stops.txt parent stations.
EXISTING_GTFS = {
    "International District/Chinatown (existing)": "C09",
    "SODO (existing)": "C15",
}

M_PER_DEG_LAT = 111_132.0


def offset(lat, lon, north_m=0.0, east_m=0.0):
    m_per_deg_lon = 111_320.0 * math.cos(math.radians(lat))
    return lat + north_m / M_PER_DEG_LAT, lon + east_m / m_per_deg_lon


# Filled in main(): anchor name -> (lat, lon); existing station -> (lat, lon).
A = {}
EXISTING = {}


def centroid(names):
    pts = [A[n] for n in names]
    return sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts)


def dist_m(a, b):
    dlat = (a[0] - b[0]) * M_PER_DEG_LAT
    dlon = (a[1] - b[1]) * 111_320.0 * math.cos(math.radians(a[0]))
    return math.hypot(dlat, dlon)


# --- Source registry ---------------------------------------------------------
S = {
    "ST_CID_2024": "https://www.soundtransit.org/sites/default/files/documents/Further%20Study-Results-Chinatown-International%20District-Alternatives%20Construction-20241114.pdf",
    "ST_CID_BLOG_2024": "https://www.soundtransit.org/blog/platform/additional-studies-ballard-link-cid-station-alternatives-wrap",
    "ST_CID_SPPR_2022": "https://www.soundtransit.org/sites/default/files/documents/west-seattle-and-ballard-link-extensions-station-planning-progress-report-chinatown-international-district.pdf",
    "ST_CID_FURTHER": "https://ballardlink.participate.online/cid-further-studies.html",
    "URB_2026_04": "https://www.theurbanist.org/crucial-ballard-link-deadline-pushed-back-yet-again-by-feds/",
    "URB_2024_10": "https://www.theurbanist.org/why-ballard-link-is-still-trapped-in-planning-limbo/",
    "IEX_2025_09": "https://iexaminer.org/delays-uncertainty-and-opportunity-as-plans-for-cid-sound-transit-station-continue-to-be-in-flux/",
    "STB_2024_11": "https://seattletransitblog.com/2024/11/16/ballard-link-extension-4th-ave-shallow-is-dead-long-live-5th-ave-diagonal/",
    "WIKI_BLE": "https://en.wikipedia.org/wiki/Ballard_Link_Extension",
    "COUNCIL_2026_07": "https://council.seattle.gov/2026/07/31/sound-transit-announces-timeline-for-building-light-rail-to-ballard/",
    "WSLE_FEIS_CH6": "https://www.soundtransit.org/sites/default/files/documents/06-WSLE-FinalEIS-alternativesevaluation.pdf",
    "WSLE_SPPR_DELRIDGE": "https://www.soundtransit.org/sites/default/files/documents/west-seattle-and-ballard-link-extensions-station-planning-progress-report-delridge.pdf",
    "WSLE_SPPR_AVALON": "https://www.soundtransit.org/sites/default/files/documents/west-seattle-and-ballard-link-extensions-station-planning-progress-report-avalon.pdf",
    "WSLE_SPPR_AJ": "https://www.soundtransit.org/sites/default/files/documents/west-seattle-and-ballard-link-extensions-station-planning-progress-report-alaska-junction.pdf",
    "WSB_2024_10": "https://westseattleblog.com/2024/10/west-seattle-light-rail-heres-the-sound-transit-route-station-location-recommendations-for-first-of-two-major-votes/",
    "WSLE_FURTHER": "https://westseattlelink.infocommunity.org/wsle-further-studies.html",
    "WSLE_PAGE": "https://www.soundtransit.org/system-expansion/west-seattle-link-extension",
    "WSH_2025_11": "https://www.westsideseattle.com/robinson-papers/2025/11/24/sound-transit-details-multi-million-dollar-savings-plan-west-seattle",
    "URB_2026_08": "https://www.theurbanist.org/west-seattle-link-date-slips-to-2035-as-sound-transit-greproperty-acquisitions/",
}

# --- Station alternatives ----------------------------------------------------
# derive: ("intersection", name) | ("midpoint", [a, b]) | ("centroid", [a, b, c, d])
# offset_m: (north, east) applied after the base point.
ALTS = [
    # ===== CID: the three options carried into the Ballard Link Draft EIS =====
    dict(id="CID-DEARBORN", project="Ballard Link", station_area="Chinatown-International District",
         option="Dearborn Street (preferred, formerly 'South of CID')",
         status="Board preferred alternative (2023); in Draft EIS",
         structure="tunnel", depth_ft=None,
         location_text="Beneath 6th Avenue South, straddling Seattle Boulevard South (ST, Nov 2024).",
         derive=("intersection", "6th Ave S & Seattle Blvd S"), offset_m=(0, 0), confidence_m=75,
         impacts="6-7 yr construction; 6th Ave S fully closed during station build; Seattle Blvd S (~7,000 veh/day) kept open on decking; building demolition in Stage 1; longest walk to King St Station / existing ID/C transfers. Pairs with a Midtown station north of CID.",
         sources=["ST_CID_2024", "ST_CID_BLOG_2024", "URB_2026_04", "IEX_2025_09"]),
    dict(id="CID-5TH-DIAG", project="Ballard Link", station_area="Chinatown-International District",
         option="5th Avenue Shallow Diagonal",
         status="Studied in Draft EIS; cheapest/fastest; strong CID community opposition",
         structure="tunnel", depth_ft=115,
         location_text="Beneath the area between 5th Ave S and 6th Ave S, east of and connected by underground passage to the existing ID/C station; 5th Ave option sits between S Jackson St and S Weller St (ST 2022, 2024).",
         derive=("centroid", ["5th Ave S & S Jackson St", "6th Ave S & S Jackson St", "5th Ave S & S Weller St", "6th Ave S & S Weller St"]),
         offset_m=(0, 0), confidence_m=120,
         impacts="5-6 yr construction (shortest); half a block of S King St closed; few business displacements but demolition in the heart of the CID; ~4 escalator flights to transfer at ID/C.",
         sources=["ST_CID_2024", "ST_CID_SPPR_2022", "STB_2024_11", "IEX_2025_09", "URB_2026_04"]),
    dict(id="CID-4TH-SHALLOW", project="Ballard Link", station_area="Chinatown-International District",
         option="4th Avenue Shallow",
         status="Studied in Draft EIS; ST found it technically infeasible (late 2024)",
         structure="tunnel", depth_ft=80,
         location_text="Tunnel platform under 4th Ave S, west of the existing ID/C station, between S Jackson St and Seattle Blvd S; entrances at the Weller St pedestrian bridge and the south end of Union Station (ST 2022).",
         derive=("midpoint", ["4th Ave S & S Jackson St", "4th Ave S & Weller St pedestrian bridge"]),
         offset_m=(0, 0), confidence_m=120,
         impacts="10-12 yr construction; 4th Ave S fully closed Jackson-Main for ~4 yrs; First Hill Streetcar cut at 4th/Jackson ~2 yrs; ~$600-700M above Dearborn; BNSF rail risk. Best hub connection to King St Station and Union Station.",
         sources=["ST_CID_2024", "ST_CID_SPPR_2022", "ST_CID_FURTHER", "STB_2024_11", "URB_2026_04"]),
    dict(id="MIDTOWN-NORTH-OF-CID", project="Ballard Link", station_area="Midtown / Pioneer Square",
         option="Station north of CID (pairs with Dearborn)",
         status="Part of Board preferred alternative (2023); James St vs Madison St sub-options",
         structure="tunnel", depth_ft=None,
         location_text="Close to Pioneer Square Station, east of 4th Avenue, between James St and Yesler Way; reported at the King County Administration Building block (ST 2024; Urbanist 2024).",
         derive=("centroid", ["4th Ave & James St", "5th Ave & James St", "4th Ave & Jefferson St", "5th Ave & Jefferson St"]),
         offset_m=(0, 0), confidence_m=120,
         impacts="Requires demolishing the King County Administration Building; James St closed ~4 yrs. A Madison St variant would give easy transfers to RapidRide G.",
         sources=["ST_CID_BLOG_2024", "ST_CID_FURTHER", "URB_2024_10", "WIKI_BLE", "STB_2024_11"]),

    # ===== SODO =====
    dict(id="SODO-1C", project="West Seattle Link + Ballard Link", station_area="SODO",
         option="SODO-1c At-Grade Lander Access (selected)",
         status="Selected (Board M2024-59, Oct 2024); footprint reduced in 2025 savings",
         structure="at-grade", depth_ft=None,
         location_text="New at-grade station just west of the existing SODO Station, reached via the new S Lander St bridge (WSB 2024).",
         derive=("intersection_existing", "SODO (existing)"), offset_m=(-35, -45), confidence_m=80,
         impacts="33 businesses / 240 employees displaced for SODO segment; 14,600 daily boardings (2042, new + existing).",
         sources=["WSLE_FEIS_CH6", "WSB_2024_10", "WSH_2025_11"]),

    # ===== Delridge =====
    dict(id="DEL-ANDOVER", project="West Seattle Link", station_area="Delridge",
         option="Andover Street station (DEL-5, DEL-6a, DEL-6b) - DEL-6b selected",
         status="Selected (DEL-6b, Oct 2024); in final design",
         structure="elevated", depth_ft=None,
         location_text="Elevated station west of Delridge Way SW and north of SW Andover St, oriented NE-SW, just east of Nucor Steel (ST SPPR; WSB 2024).",
         derive=("midpoint", ["Delridge Way SW & SW Andover St", "26th Ave SW & SW Andover St"]), offset_m=(50, 0), confidence_m=100,
         impacts="DEL-6b: 34 residential, 19 business, 130 employees displaced; 5,400 daily boardings; $700-750M. DEL-5: 114 residential. DEL-6a: 48 residential. Bridge and steel mill limit the walkshed.",
         sources=["WSLE_SPPR_DELRIDGE", "WSLE_FEIS_CH6", "WSB_2024_10", "WSLE_FURTHER"]),
    dict(id="DEL-DAKOTA", project="West Seattle Link", station_area="Delridge",
         option="Dakota Street station (DEL-1a, 1b, 2a, 2b)",
         status="Not selected (was 2022 Board preferred, DEL-1a)",
         structure="elevated", depth_ft=None,
         location_text="Elevated station west of Delridge Way SW between SW Dakota St and SW Genesee St, next to Youngstown Cultural Arts Center and Delridge Community Center (ST SPPR).",
         derive=("midpoint", ["Delridge Way SW & SW Dakota St", "Delridge Way SW & SW Genesee St"]), offset_m=(0, -60), confidence_m=100,
         impacts="93-197 residential, 13-18 business displaced depending on variant; 5,400 daily boardings; $600M-1.05B. Closest to the Youngstown community hub; up to 1.0 mi of visual impact.",
         sources=["WSLE_SPPR_DELRIDGE", "WSLE_FEIS_CH6"]),
    dict(id="DEL-DELRIDGE-WAY", project="West Seattle Link", station_area="Delridge",
         option="Delridge Way station (DEL-3, DEL-4)",
         status="Not selected",
         structure="elevated", depth_ft=None,
         location_text="Elevated station on Delridge Way SW north of SW Dakota St, straddling the street, entrances on both sides (ST SPPR).",
         derive=("midpoint", ["Delridge Way SW & SW Dakota St", "Delridge Way SW & SW Andover St"]), offset_m=(0, 0), confidence_m=120,
         impacts="70-151 residential, 14-18 business displaced; 5,400 daily boardings; $600-850M. Fewest properties touched, least room for TOD.",
         sources=["WSLE_SPPR_DELRIDGE", "WSLE_FEIS_CH6"]),

    # ===== Avalon (station removed 2025) =====
    dict(id="AVA-ELEVATED", project="West Seattle Link", station_area="Avalon",
         option="Elevated Avalon (paired with WSJ-1, WSJ-2)",
         status="Not selected; Avalon station removed in 2025",
         structure="elevated", depth_ft=None,
         location_text="Elevated station south of SW Genesee St and east of Fauntleroy Way SW (ST SPPR).",
         derive=("midpoint", ["Fauntleroy Way SW & SW Genesee St", "35th Ave SW & SW Genesee St"]), offset_m=(-50, 0), confidence_m=80,
         impacts="Station area (10-min walkshed, 2040): ~5,400 residents, 3,200 jobs.",
         sources=["WSLE_SPPR_AVALON"]),
    dict(id="AVA-BELOW-GRADE", project="West Seattle Link", station_area="Avalon",
         option="Below-grade Avalon (retained cut under 35th Ave SW; FEIS preferred)",
         status="Selected Oct 2024, then REMOVED in 2025 cost savings",
         structure="retained cut", depth_ft=None,
         location_text="Lidded retained cut south of SW Genesee St, beneath 35th Ave SW (WSB 2024); 'south side of Fauntleroy Way SW under SW Genesee St and 35th Ave SW' (ST SPPR).",
         derive=("intersection", "35th Ave SW & SW Genesee St"), offset_m=(-60, 0), confidence_m=80,
         impacts="Removing it saved an estimated $375-470M and 48 residential displacements; ST expects riders to shift to Delridge/Alaska Junction. Cannot be added back later as an infill station.",
         sources=["WSLE_SPPR_AVALON", "WSB_2024_10", "WSH_2025_11", "URB_2026_08"]),

    # ===== Alaska Junction =====
    dict(id="WSJ-5", project="West Seattle Link", station_area="Alaska Junction",
         option="Medium Tunnel 41st Ave (WSJ-5a / WSJ-5b) - WSJ-5b selected",
         status="Selected (WSJ-5b, Oct 2024); 2025 refinement: mined tunnel instead of deep open cut",
         structure="tunnel", depth_ft=50,
         location_text="Tunnel station beneath 41st Ave SW and SW Alaska St; entrances on both sides of Alaska St, one shifted toward 42nd Ave SW (WSB 2024; ST further studies).",
         derive=("intersection", "41st Ave SW & SW Alaska St"), offset_m=(0, 0), confidence_m=80,
         impacts="WSJ-5b: 111 residential, 44 business, 240 employees displaced; 7,600 daily boardings; $1.75-1.90B. 42nd Ave entrance added ~90 TOD units. Some reports say the 2025 redesign shifts the station about a block east (unverified).",
         sources=["WSLE_FEIS_CH6", "WSB_2024_10", "WSLE_FURTHER", "WSH_2025_11"]),
    dict(id="WSJ-1", project="West Seattle Link", station_area="Alaska Junction",
         option="Elevated 41st/42nd Ave (WSJ-1)",
         status="Not selected",
         structure="elevated", depth_ft=None,
         location_text="Elevated station south of SW Alaska St between 41st Ave SW and 42nd Ave SW, entrances on Alaska and Edmunds (ST SPPR).",
         derive=("centroid", ["41st Ave SW & SW Alaska St", "42nd Ave SW & SW Alaska St", "41st Ave SW & SW Edmunds St", "42nd Ave SW & SW Edmunds St"]),
         offset_m=(0, 0), confidence_m=60,
         impacts="351-370 residential, 57 business displaced; 7,600 daily boardings; $1.70-1.85B.",
         sources=["WSLE_SPPR_AJ", "WSLE_FEIS_CH6"]),
    dict(id="WSJ-2", project="West Seattle Link", station_area="Alaska Junction",
         option="Elevated Fauntleroy Way (WSJ-2)",
         status="Not selected",
         structure="elevated", depth_ft=None,
         location_text="Elevated station south (east side) of Fauntleroy Way SW, straddling SW Alaska St (ST SPPR).",
         derive=("intersection", "Fauntleroy Way SW & SW Alaska St"), offset_m=(0, 40), confidence_m=80,
         impacts="474-493 residential displaced (most of any option), 15-18 business; 8,000 daily boardings (highest); $1.05-1.15B (cheapest). Farther from the Junction core.",
         sources=["WSLE_SPPR_AJ", "WSLE_FEIS_CH6"]),
    dict(id="WSJ-3B", project="West Seattle Link", station_area="Alaska Junction",
         option="Tunnel 42nd Ave (WSJ-3b)",
         status="Not selected",
         structure="tunnel", depth_ft=80,
         location_text="Tunnel station under 42nd Ave SW crossing beneath SW Alaska St (ST SPPR).",
         derive=("intersection", "42nd Ave SW & SW Alaska St"), offset_m=(0, 0), confidence_m=60,
         impacts="126-230 residential, 42-45 business displaced; displaces Junction Plaza Park; $2.20-2.40B (most expensive).",
         sources=["WSLE_SPPR_AJ", "WSLE_FEIS_CH6"]),
    dict(id="WSJ-3A", project="West Seattle Link", station_area="Alaska Junction",
         option="Tunnel 41st Ave (WSJ-3a)",
         status="Not selected",
         structure="tunnel", depth_ft=70,
         location_text="Tunnel station under 41st Ave SW crossing beneath SW Alaska St (ST SPPR).",
         derive=("intersection", "41st Ave SW & SW Alaska St"), offset_m=(0, 0), confidence_m=60,
         impacts="162-269 residential, 15-18 business displaced; $2.10-2.35B. Same station box as WSJ-5; differs in depth and tunnel length.",
         sources=["WSLE_SPPR_AJ", "WSLE_FEIS_CH6"]),
    dict(id="WSJ-4", project="West Seattle Link", station_area="Alaska Junction",
         option="Short Tunnel 41st Ave (WSJ-4)",
         status="Not selected",
         structure="tunnel", depth_ft=55,
         location_text="Tunnel station under 41st Ave SW south of SW Alaska St, third entrance at SW Edmunds St (ST SPPR).",
         derive=("midpoint", ["41st Ave SW & SW Alaska St", "41st Ave SW & SW Edmunds St"]), offset_m=(0, 0), confidence_m=60,
         impacts="253 residential, 17 business displaced; $1.65-1.80B.",
         sources=["WSLE_SPPR_AJ", "WSLE_FEIS_CH6"]),

    # ===== Rest of Ballard Link (preferred alternative cross streets) =====
    dict(id="BLE-WESTLAKE", project="Ballard Link", station_area="Westlake", option="Westlake new platforms",
         status="Preferred alternative; Phase 1 (target 2042)", structure="tunnel", depth_ft=None,
         location_text="5th Avenue and Pine Street (Wikipedia, citing ST).", derive=("intersection", "5th Ave & Pine St"),
         offset_m=(0, 0), confidence_m=150, impacts="", sources=["WIKI_BLE", "COUNCIL_2026_07"]),
    dict(id="BLE-DENNY", project="Ballard Link", station_area="Denny", option="Denny (Westlake Ave & Denny Way)",
         status="Preferred alternative; Phase 1. 2026: Board weighing merging Denny + South Lake Union into one station here",
         structure="tunnel", depth_ft=None, location_text="Westlake Avenue and Denny Way (Wikipedia, citing ST).",
         derive=("intersection", "Westlake Ave N & Denny Way"), offset_m=(0, 0), confidence_m=150, impacts="",
         sources=["WIKI_BLE", "URB_2026_04"]),
    dict(id="BLE-SLU", project="Ballard Link", station_area="South Lake Union", option="South Lake Union (Harrison St & 7th Ave N)",
         status="Preferred alternative; Phase 1. 2026: may be eliminated if merged with Denny",
         structure="tunnel", depth_ft=None, location_text="Harrison Street and 7th Avenue North (Wikipedia, citing ST).",
         derive=("intersection", "7th Ave N & Harrison St"), offset_m=(0, 0), confidence_m=150,
         impacts="Without this station, about two dozen blocks of Uptown/Belltown/SLU fall outside a 10-minute walk of Ballard Link (ST analysis via The Urbanist, 2023).",
         sources=["WIKI_BLE", "URB_2026_04"]),
    dict(id="BLE-SEATTLE-CENTER", project="Ballard Link", station_area="Seattle Center", option="Seattle Center (W Republican St & 1st Ave W)",
         status="Preferred alternative; Phase 1 terminus until Phase 2", structure="tunnel", depth_ft=None,
         location_text="West Republican Street and 1st Avenue West (Wikipedia, citing ST).",
         derive=("intersection", "1st Ave W & W Republican St"), offset_m=(0, 0), confidence_m=150, impacts="",
         sources=["WIKI_BLE", "COUNCIL_2026_07"]),
    dict(id="BLE-SMITH-COVE", project="Ballard Link", station_area="Smith Cove", option="Smith Cove (15th Ave W & W Galer St)",
         status="Preferred alternative; Phase 2 (unfunded)", structure="elevated", depth_ft=None,
         location_text="15th Avenue West and West Galer Street (Wikipedia, citing ST).",
         derive=("intersection", "15th Ave W & W Galer St"), offset_m=(0, 0), confidence_m=150, impacts="",
         sources=["WIKI_BLE", "COUNCIL_2026_07"]),
    dict(id="BLE-INTERBAY", project="Ballard Link", station_area="Interbay", option="Interbay (17th Ave W & W Dravus St)",
         status="Preferred alternative; Phase 2 (unfunded)", structure="elevated", depth_ft=None,
         location_text="17th Avenue West and West Dravus Street (Wikipedia, citing ST).",
         derive=("intersection", "17th Ave W & W Dravus St"), offset_m=(0, 0), confidence_m=150, impacts="",
         sources=["WIKI_BLE", "COUNCIL_2026_07"]),
    dict(id="BLE-BALLARD", project="Ballard Link", station_area="Ballard", option="Ballard (15th Ave NW & NW Market St)",
         status="Preferred alternative; Phase 2 (unfunded)", structure="tunnel or elevated (sources conflict)", depth_ft=None,
         location_text="Northwest 15th Avenue and Northwest Market Street (Wikipedia, citing ST).",
         derive=("intersection", "15th Ave NW & NW Market St"), offset_m=(0, 0), confidence_m=150, impacts="",
         sources=["WIKI_BLE", "COUNCIL_2026_07"]),
]


def derive_point(alt):
    kind, ref = alt["derive"]
    if kind == "intersection":
        base, anchors = A[ref], [ref]
        method = f"Intersection of {ref}"
    elif kind == "intersection_existing":
        base, anchors = EXISTING[ref], []
        method = f"Existing station point: {ref} (Sound Transit GTFS stops.txt)"
    elif kind == "midpoint":
        base, anchors = centroid(ref), ref
        method = f"Midpoint of {ref[0]} and {ref[1]}"
    elif kind == "centroid":
        base, anchors = centroid(ref), ref
        method = "Centroid of the block bounded by " + "; ".join(ref)
    else:
        raise ValueError(kind)
    n, e = alt["offset_m"]
    lat, lon = offset(*base, north_m=n, east_m=e)
    if n or e:
        parts = []
        if n:
            parts.append(f"{abs(n):.0f} m {'north' if n > 0 else 'south'}")
        if e:
            parts.append(f"{abs(e):.0f} m {'east' if e > 0 else 'west'}")
        method += ", then shifted " + " and ".join(parts) + " to match the written description"
    return round(lat, 6), round(lon, 6), method, anchors


def load_anchors(rebuild):
    path = DATA / "anchors_osm.json"
    if rebuild or not path.exists():
        print("Resolving anchor intersections from OpenStreetMap ...")
        resolved = osm_anchors.build(ANCHOR_NAMES, ANCHOR_OVERRIDES)
        path.write_text(json.dumps({
            "source": "OpenStreetMap via Overpass API",
            "license": "ODbL 1.0, (c) OpenStreetMap contributors, https://www.openstreetmap.org/copyright",
            "anchors": resolved,
        }, indent=2) + "\n")
    anchors = json.loads(path.read_text())["anchors"]
    missing = set(ANCHOR_NAMES) - anchors.keys()
    if missing:
        sys.exit(f"anchors_osm.json is missing {sorted(missing)}; run with --rebuild-anchors")
    return anchors


def load_existing():
    feed = Feed.download(ST_RAIL_GTFS_URL, "st_rail_gtfs.zip")
    stops = {r["stop_id"]: r for r in feed.rows("stops.txt")}
    out = {}
    for name, sid in EXISTING_GTFS.items():
        r = stops[sid]
        assert r["location_type"] == "1", f"{sid} is not a parent station"
        out[name] = (float(r["stop_lat"]), float(r["stop_lon"]))
    return out


def previous_points(path):
    try:
        old = json.loads(path.read_text())
    except (OSError, ValueError):
        return {}
    return {f["properties"]["id"]: tuple(reversed(f["geometry"]["coordinates"])) for f in old["features"]}


ap = argparse.ArgumentParser()
ap.add_argument("--rebuild-anchors", action="store_true", help="re-query OpenStreetMap")
args = ap.parse_args()

anchor_info = load_anchors(args.rebuild_anchors)
A.update({k: (v["lat"], v["lon"]) for k, v in anchor_info.items()})
EXISTING.update(load_existing())
out = DATA
before = previous_points(out / "station_alternatives.geojson")

features, rows = [], []
for alt in ALTS:
    lat, lon, method, anchors = derive_point(alt)
    props = {k: v for k, v in alt.items() if k not in ("derive", "offset_m", "sources")}
    props.update(
        preferred=alt["id"] in PREFERRED,
        lat=lat, lon=lon,
        coord_source="derived from OpenStreetMap intersections (no official coordinates published)",
        derivation=method,
        anchor_intersections=[{"name": a, **anchor_info[a]} for a in anchors],
        sources=[S[s] for s in alt["sources"]],
    )
    features.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": [lon, lat]}, "properties": props})
    rows.append({
        "id": alt["id"], "preferred": alt["id"] in PREFERRED, "project": alt["project"], "station_area": alt["station_area"], "option": alt["option"],
        "status": alt["status"], "structure": alt["structure"], "depth_ft": alt["depth_ft"] or "",
        "lat": lat, "lon": lon, "confidence_m": alt["confidence_m"], "derivation": method,
        "location_text": alt["location_text"], "impacts": alt["impacts"], "sources": " | ".join(S[s] for s in alt["sources"]),
    })

for name, (lat, lon) in EXISTING.items():
    features.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": [lon, lat]},
                     "properties": {"id": name, "preferred": False, "status": "existing station (reference only)",
                                    "coord_source": "Sound Transit GTFS stops.txt"}})

with open(out / "station_alternatives.geojson", "w") as f:
    json.dump({"type": "FeatureCollection",
               "metadata": {"crs": "EPSG:4326",
                            "attribution": "Anchor intersections (c) OpenStreetMap contributors, ODbL",
                            "note": "Planned-station points are derived approximations; see derivation and confidence_m on each feature."},
               "features": features}, f, indent=2)
    f.write("\n")
with open(out / "station_alternatives.csv", "w", newline="") as f:
    w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
    w.writeheader()
    w.writerows(rows)

# --- Sanity checks -----------------------------------------------------------
pts = {r["id"]: (r["lat"], r["lon"]) for r in rows}
ids = EXISTING["International District/Chinatown (existing)"]
print("Distances from existing ID/C station:")
for k in ["CID-4TH-SHALLOW", "CID-5TH-DIAG", "CID-DEARBORN", "MIDTOWN-NORTH-OF-CID"]:
    p = pts[k]
    side = ("east" if p[1] > ids[1] else "west") + "/" + ("north" if p[0] > ids[0] else "south")
    print(f"  {k:24s} {dist_m(p, ids):6.0f} m  ({side})")
print("Alaska Junction options vs 41st & Alaska:")
for k in ["WSJ-5", "WSJ-1", "WSJ-2", "WSJ-3A", "WSJ-3B", "WSJ-4"]:
    print(f"  {k:8s} {dist_m(pts[k], A['41st Ave SW & SW Alaska St']):6.0f} m")
print("Delridge options vs Delridge & Andover:")
for k in ["DEL-ANDOVER", "DEL-DELRIDGE-WAY", "DEL-DAKOTA"]:
    print(f"  {k:18s} {dist_m(pts[k], A['Delridge Way SW & SW Andover St']):6.0f} m")
print(f"SODO-1C vs existing SODO: {dist_m(pts['SODO-1C'], EXISTING['SODO (existing)']):.0f} m")
print(f"{len(rows)} alternatives written, {sum(r['preferred'] for r in rows)} preferred")
assert PREFERRED <= {r["id"] for r in rows}, PREFERRED - {r["id"] for r in rows}

# --- Movement since the previous build ---------------------------------------
after = {**pts, **EXISTING}
moved = [(k, dist_m(before[k], p)) for k, p in after.items() if k in before]
big = [(k, d) for k, d in moved if d > MOVE_WARN_M]
print(f"Moved more than {MOVE_WARN_M} m since the previous file: {len(big)} of {len(moved)}")
for k, d in sorted(big, key=lambda t: -t[1]):
    print(f"  MOVED {k:24s} {d:6.1f} m")
for k in sorted(after.keys() - before.keys()):
    print(f"  NEW   {k}")
