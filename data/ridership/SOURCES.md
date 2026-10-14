# Ridership sources

Used by `pipeline/crowding.py` to estimate typical train crowding. Every
number in `station_boardings.csv` and `future_boardings.csv` names its source
here.

| Key | Source |
|---|---|
| ST_SPT_2025 | Sound Transit, System Performance Tracker: Link Ridership, average weekday boardings by station, 2025. https://www.soundtransit.org/ride-with-us/system-performance-tracker/ridership (a Power BI dashboard with no data export; values as tabulated in Wikipedia, "List of Link light rail stations", footnote "Weekday boardings as of 2025", retrieved 2026-02-20) |
| STB_2026_06 | Seattle Transit Blog, "Early look at Crosslake Connection's record-breaking ridership", 2026-06-18, citing Sound Transit's April 2026 per-station data. https://seattletransitblog.com/2026/06/18/early-look-at-crosslake-connections-record-breaking-ridership/ |
| STB_1LINE_2025 | Seattle Transit Blog, "Ridership patterns for Link 1 Line", 2025-08-25, and its data file https://seattletransitblog.com/wp-content/uploads/2025/08/1LineMay2025Data.csv: May 2025 automatic passenger counter boardings and alightings by station and direction, from a public records request. Downloaded by the build. |
| WSLE_FEIS_CH6 | Sound Transit, West Seattle Link Extension Final EIS, Chapter 6 (2024): 2042 daily boardings. https://www.soundtransit.org/sites/default/files/documents/06-WSLE-FinalEIS-alternativesevaluation.pdf |
| WSBLE_DEIS_CH3 | Sound Transit, West Seattle and Ballard Link Extensions Draft EIS, Chapter 3 Transportation (January 2022): Tables 3-4, 3-17, 3-18, 3-19, 2042 daily boardings. https://www.soundtransit.org/sites/default/files/documents/3-wsble-drafteis-chapter3-transportation-202201.pdf |
| ST_CAPACITY | Sound Transit light rail vehicle loading standards: 74 seats per car; planning load 74 standing (148 total); target max load 120 standing (194 total); crush 178 standing (252 total). As reported in Capitol Hill Seattle Blog, "Why Sound Transit is not rolling out more 3-car light rail trains", 2016-08. https://capitolhillseattle.com/2016/08/why-sound-transit-is-not-rolling-out-more-3-car-light-rail-trains |
| URBANIST_2026_03 | The Urbanist, March 2026: at the Crosslake opening the 1 Line runs four-car trains and the 2 Line a mix of two- and three-car trains. https://www.theurbanist.org/crosslake-light-rail-set-to-transform-puget-sound-region/ |
| ASSUMPTION | No published figure; the value and its reasoning are in the row's note. |
