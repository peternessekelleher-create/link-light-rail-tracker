# Station Alternatives — Sources and Coordinate Derivation

Companion to `station_alternatives.geojson` / `.csv` (23 planned-station options plus 2 existing-station reference points). Compiled 2026-10-13.

## 1. Are official coordinates published?

- **No.** Sound Transit publishes station alternatives only as PDF maps, renderings and engineering plan sheets (EIS Appendix J). No GIS layer or coordinate table for the Ballard Link or West Seattle Link alternatives was found.
- **Existing stations do have official coordinates.** They are in Sound Transit's GTFS `stops.txt`. The two existing-station reference points in this file (ID/C and SODO) now come from it.

## 2. How each coordinate was derived

1. **Read the location description.** Each option's wording comes from Sound Transit's own documents (station planning progress reports, the Final EIS, further-study memos), e.g. "elevated station west of Delridge Way SW and north of SW Andover St."
2. **Locate the named intersections.** Each street intersection in that description is found in OpenStreetMap (`pipeline/osm_anchors.py`, via the Overpass API): the node the two named streets share, the mean of several shared nodes at a divided-road junction, or, where one street bridges the other, the closest approach between them. Each anchor records its method and OSM node/way ids; the cache is `anchors_osm.json`. These are the `anchor_intersections` on each feature. (The first draft used Esri's free geocoder; its results can't be stored, so they were replaced. The OSM anchors agreed within 10 m except 6th Ave S & Seattle Blvd S, 24 m, and 15th Ave W & W Galer St, 21 m.)
3. **Build the point from the anchors.**
   - Station *at* a corner → that intersection.
   - Station *along a street between two cross streets* → midpoint of the two intersections.
   - Station *within a block* → centroid of the four corner intersections.
4. **Apply the stated direction.** When the text says "north of", "west of" or "south of", the point is shifted 35–60 m (about half a Seattle block) that way. The exact offset is written into the `derivation` field.
5. **Record uncertainty.** `confidence_m` is the radius the true station-box center most likely falls within:
   - 60–80 m when the text names the exact block.
   - 100–120 m when it only names a corridor.
   - 150 m for stations known only by a cross-street pair.
6. **Sanity-check the geometry.**
   - 4th Ave option: 85 m west of the existing ID/C station.
   - 5th Ave Diagonal: 68 m east.
   - Dearborn: 420 m southeast.
   - North-of-CID: 530 m north.
   - These match the sources' descriptions.

## 3. Known limits

- **Each point is the center of the station box.** It is not an entrance. Several options share a box and differ only in depth or tunnel length (WSJ-3a and WSJ-5 both sit at 41st & Alaska).
- **The 2025 West Seattle redesign** switched Alaska Junction to a mined tunnel. One report says the station shifts about a block east. Sound Transit hasn't published it, so it is not mapped.
- **Displacement counts are for whole segments.** In the Final EIS they cover the station *plus* its guideway, not the station alone.
- **Licensing.** Anchors are © OpenStreetMap contributors under the ODbL, credited on the map. Rebuild them with `python -m pipeline.build --rebuild-anchors` (or the Action's "rebuild anchors" option); the build prints any station that moves more than 15 m.
- **Upgrade path:** For the selected options, georeference the Final EIS Appendix J plan sheets in QGIS. That would get station boxes to within roughly 10 m.

## 4. Sourcing hierarchy

| Tier | Used for | Sources |
|---|---|---|
| 1. Sound Transit primary documents | Location wording, depth, displacements, ridership, cost, construction duration | WSLE Final EIS Ch. 6 (2024); station planning progress reports for CID, Delridge, Avalon, Alaska Junction (2022); CID further-study results (Nov 2024); WSLE further studies; Sound Transit project pages |
| 2. Government | Phasing and timeline | Seattle City Council blog (Jul 2026) |
| 3. Journalism | Status after the last official document, community reaction | The Urbanist (Oct 2024, Apr 2026, Aug 2026), International Examiner (Sep 2025), Seattle Transit Blog (Nov 2024), West Seattle Blog (Oct 2024), Westside Seattle (Nov 2025) |
| 4. Reference | Cross-street lists for the other Ballard Link stations | Wikipedia (cites Sound Transit) |

- **Reader comments were not used as fact.** Where one is mentioned (the Alaska Junction "block east" shift), it is labeled unverified.

## 5. Source URLs

- CID further-study results (Nov 2024): https://www.soundtransit.org/sites/default/files/documents/Further%20Study-Results-Chinatown-International%20District-Alternatives%20Construction-20241114.pdf
- CID studies blog post (Nov 2024): https://www.soundtransit.org/blog/platform/additional-studies-ballard-link-cid-station-alternatives-wrap
- CID station planning progress report (2022): https://www.soundtransit.org/sites/default/files/documents/west-seattle-and-ballard-link-extensions-station-planning-progress-report-chinatown-international-district.pdf
- Ballard Link further studies: https://ballardlink.participate.online/cid-further-studies.html
- WSLE Final EIS Chapter 6: https://www.soundtransit.org/sites/default/files/documents/06-WSLE-FinalEIS-alternativesevaluation.pdf
- Delridge progress report: https://www.soundtransit.org/sites/default/files/documents/west-seattle-and-ballard-link-extensions-station-planning-progress-report-delridge.pdf
- Avalon progress report: https://www.soundtransit.org/sites/default/files/documents/west-seattle-and-ballard-link-extensions-station-planning-progress-report-avalon.pdf
- Alaska Junction progress report: https://www.soundtransit.org/sites/default/files/documents/west-seattle-and-ballard-link-extensions-station-planning-progress-report-alaska-junction.pdf
- WSLE further studies: https://westseattlelink.infocommunity.org/wsle-further-studies.html
- WSLE project page: https://www.soundtransit.org/system-expansion/west-seattle-link-extension
- West Seattle Blog (Oct 2024): https://westseattleblog.com/2024/10/west-seattle-light-rail-heres-the-sound-transit-route-station-location-recommendations-for-first-of-two-major-votes/
- Westside Seattle (Nov 2025): https://www.westsideseattle.com/robinson-papers/2025/11/24/sound-transit-details-multi-million-dollar-savings-plan-west-seattle
- The Urbanist (Aug 2026): https://www.theurbanist.org/west-seattle-link-date-slips-to-2035-as-sound-transit-greproperty-acquisitions/
- The Urbanist (Apr 2026): https://www.theurbanist.org/crucial-ballard-link-deadline-pushed-back-yet-again-by-feds/
- The Urbanist (Oct 2024): https://www.theurbanist.org/why-ballard-link-is-still-trapped-in-planning-limbo/
- International Examiner (Sep 2025): https://iexaminer.org/delays-uncertainty-and-opportunity-as-plans-for-cid-sound-transit-station-continue-to-be-in-flux/
- Seattle Transit Blog (Nov 2024): https://seattletransitblog.com/2024/11/16/ballard-link-extension-4th-ave-shallow-is-dead-long-live-5th-ave-diagonal/
- Seattle City Council (Jul 2026): https://council.seattle.gov/2026/07/31/sound-transit-announces-timeline-for-building-light-rail-to-ballard/
- Wikipedia, Ballard Link Extension: https://en.wikipedia.org/wiki/Ballard_Link_Extension
