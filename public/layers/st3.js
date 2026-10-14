// ST3 future network on the map: dashed approximate alignments through the
// selected options, a marker and accuracy circle per alternative, and the
// connecting King County Metro routes. All visibility is driven by the st3
// store through filters, so toggles are instant.
import { st3 } from '../lib/st3.js';

export const REMOVED_COLOR = '#9aa3ad';
export const BUS_COLORS = { rapid: '#ff6b81', local: '#ffe066' };
const SAME_SPOT_NOTE = 'Same Location, Different Depth';
const ICON_PX = 22;

const feature = (geometry, properties) => ({ type: 'Feature', geometry, properties });
const fc = (features) => ({ type: 'FeatureCollection', features });

// A circle of radius r metres as a polygon.
function circle(lon, lat, r, steps = 48) {
  const dLat = r / 111132;
  const dLon = r / (111320 * Math.cos((lat * Math.PI) / 180));
  const ring = [];
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * 2 * Math.PI;
    ring.push([lon + dLon * Math.cos(t), lat + dLat * Math.sin(t)]);
  }
  return { type: 'Polygon', coordinates: [ring] };
}

const colorOf = (alt) => (alt.role === 'removed' ? REMOVED_COLOR : alt.project.color);

export default function st3Layer(model, { onSelect }) {
  return {
    add(map) {
      addIcons(map, model);

      // Approximate alignments through each project's selected options. Ballard
      // Link's unfunded Phase 2 is drawn fainter.
      const lines = [];
      for (const p of model.projects) {
        const pts = p.alignment.map((sid) => {
          const s = model.stations.get(sid);
          const a = s.alts.find((x) => x.role === 'selected');
          return { phase: s.phase || 1, at: [a.props.lon, a.props.lat] };
        });
        for (let i = 1; i < pts.length; i++) {
          const phase = Math.max(pts[i - 1].phase, pts[i].phase);
          const last = lines.at(-1);
          if (last && last.properties.project === p.id && last.properties.phase === phase) last.geometry.coordinates.push(pts[i].at);
          else lines.push(feature({ type: 'LineString', coordinates: [pts[i - 1].at, pts[i].at] }, { project: p.id, color: p.color, phase }));
        }
      }

      const alts = [...model.alts.values()];
      map.addSource('st3-alignment', { type: 'geojson', data: fc(lines) });
      map.addSource('st3-circles', {
        type: 'geojson',
        data: fc(alts.map((a) => feature(circle(a.props.lon, a.props.lat, a.props.confidence_m), { id: a.id, color: colorOf(a) }))),
      });
      map.addSource('st3-alts', {
        type: 'geojson',
        data: fc(
          alts.map((a) =>
            feature(
              { type: 'Point', coordinates: [a.props.lon, a.props.lat] },
              {
                id: a.id,
                role: a.role,
                label: a.station.multi ? a.short : a.station.name,
                note: a.sameSpot ? `\n${SAME_SPOT_NOTE}` : '',
                ox: a.ox,
                icon: a.role === 'removed' ? 'st3-removed' : `st3-${a.role}:${a.project.id}`,
              },
            ),
          ),
        ),
      });
      map.addSource('st3-bus', { type: 'geojson', data: model.routes });

      // Lines and circles sit under the live Link tracks; markers go on top.
      const below = map.getLayer('link-routes-casing') ? 'link-routes-casing' : undefined;
      const busColor = ['case', ['get', 'rapidride'], BUS_COLORS.rapid, BUS_COLORS.local];
      map.addLayer({ id: 'st3-bus-casing', type: 'line', source: 'st3-bus', layout: { 'line-join': 'round' }, paint: { 'line-color': 'rgba(0,0,0,0.85)', 'line-width': 5 } }, below);
      map.addLayer({ id: 'st3-bus', type: 'line', source: 'st3-bus', layout: { 'line-join': 'round' }, paint: { 'line-color': busColor, 'line-width': 2.5 } }, below);
      map.addLayer({ id: 'st3-bus-hl-casing', type: 'line', source: 'st3-bus', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#ffffff', 'line-width': 9 } }, below);
      map.addLayer({ id: 'st3-bus-hl', type: 'line', source: 'st3-bus', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': busColor, 'line-width': 4.5 } }, below);
      map.addLayer(
        {
          id: 'st3-bus-labels',
          type: 'symbol',
          source: 'st3-bus',
          minzoom: 12,
          layout: {
            'symbol-placement': 'line',
            'symbol-spacing': 320,
            'text-field': ['get', 'number'],
            'text-font': ['DIN Pro Bold', 'Arial Unicode MS Bold'],
            'text-size': 12,
          },
          paint: { 'text-color': '#ffffff', 'text-halo-color': 'rgba(0,0,0,0.95)', 'text-halo-width': 2 },
        },
        below,
      );
      map.addLayer(
        {
          id: 'st3-alignment-casing',
          type: 'line',
          source: 'st3-alignment',
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: { 'line-color': 'rgba(0,0,0,0.85)', 'line-width': ['interpolate', ['linear'], ['zoom'], 9, 6, 15, 10] },
        },
        below,
      );
      map.addLayer(
        {
          id: 'st3-alignment',
          type: 'line',
          source: 'st3-alignment',
          layout: { 'line-join': 'round' },
          paint: {
            'line-color': ['get', 'color'],
            'line-width': ['interpolate', ['linear'], ['zoom'], 9, 3.5, 15, 6.5],
            'line-dasharray': [2, 1.4],
            'line-opacity': ['case', ['==', ['get', 'phase'], 2], 0.6, 1],
          },
        },
        below,
      );
      map.addLayer(
        {
          id: 'st3-circles',
          type: 'fill',
          source: 'st3-circles',
          paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.16, 'fill-outline-color': ['get', 'color'] },
        },
        below,
      );

      const offset = (px) => ['case', ['==', ['get', 'ox'], -1], ['literal', [-px, 0]], ['==', ['get', 'ox'], 1], ['literal', [px, 0]], ['literal', [0, 0]]];
      map.addLayer({
        id: 'st3-markers',
        type: 'symbol',
        source: 'st3-alts',
        layout: {
          'icon-image': ['get', 'icon'],
          'icon-size': ['interpolate', ['linear'], ['zoom'], 10, 0.75, 15, 1],
          'icon-offset': offset(9),
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
        },
      });
      const labelPaint = { 'text-color': '#ffffff', 'text-halo-color': 'rgba(0,0,0,0.95)', 'text-halo-width': 2.4 };
      const labelLayout = {
        'text-field': ['format', ['get', 'label'], {}, ['get', 'note'], { 'font-scale': 0.82 }],
        'text-font': ['DIN Pro Medium', 'Arial Unicode MS Regular'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 10, 12, 15, 14],
        'text-max-width': 12,
      };
      // Selected options are labelled from zoom 11; the rest from 13.
      map.addLayer({
        id: 'st3-labels-selected',
        type: 'symbol',
        source: 'st3-alts',
        minzoom: 11,
        layout: { ...labelLayout, 'text-variable-anchor': ['right', 'left', 'top', 'bottom'], 'text-radial-offset': 1.1 },
        paint: labelPaint,
      });
      map.addLayer({
        id: 'st3-labels-other',
        type: 'symbol',
        source: 'st3-alts',
        minzoom: 13,
        layout: { ...labelLayout, 'text-variable-anchor': ['right', 'left', 'top', 'bottom'], 'text-radial-offset': 1.1 },
        paint: labelPaint,
      });
      // Side-by-side twins: labels point away from each other.
      map.addLayer({
        id: 'st3-labels-twins',
        type: 'symbol',
        source: 'st3-alts',
        minzoom: 12,
        layout: {
          ...labelLayout,
          'text-anchor': ['case', ['==', ['get', 'ox'], -1], 'right', 'left'],
          'text-offset': ['case', ['==', ['get', 'ox'], -1], ['literal', [-1.6, 0]], ['literal', [1.6, 0]]],
          'text-justify': ['case', ['==', ['get', 'ox'], -1], 'right', 'left'],
        },
        paint: labelPaint,
      });
      // Removed options: a pre-drawn grey label with a strikethrough.
      map.addLayer({
        id: 'st3-labels-removed',
        type: 'symbol',
        source: 'st3-alts',
        minzoom: 12,
        layout: { 'icon-image': ['concat', 'st3-strike:', ['get', 'id']], 'icon-anchor': 'left', 'icon-offset': [14, 0], 'icon-allow-overlap': true },
      });

      map.on('click', 'st3-markers', (e) => onSelect(e.features[0].properties.id));
      map.on('mouseenter', 'st3-markers', () => (map.getCanvas().style.cursor = 'pointer'));
      map.on('mouseleave', 'st3-markers', () => (map.getCanvas().style.cursor = ''));

      st3.subscribe((state) => apply(map, model, state));
    },
  };
}

const ALL_IDS = [
  'st3-bus-casing', 'st3-bus', 'st3-bus-hl-casing', 'st3-bus-hl', 'st3-bus-labels',
  'st3-alignment-casing', 'st3-alignment', 'st3-circles', 'st3-markers',
  'st3-labels-selected', 'st3-labels-other', 'st3-labels-twins', 'st3-labels-removed',
];

function apply(map, model, state) {
  // Master off: hide every ST3 layer outright.
  for (const id of ALL_IDS) map.setLayoutProperty(id, 'visibility', state.master ? 'visible' : 'none');
  if (!state.master) return;

  const shown = [...model.alts.values()].filter((a) => state.altShown(a));
  const ids = (list) => ['in', ['get', 'id'], ['literal', list.map((a) => a.id)]];
  const twin = (a) => a.ox !== 0;
  map.setFilter('st3-circles', ids(shown));
  map.setFilter('st3-markers', ids(shown));
  map.setFilter('st3-labels-selected', ids(shown.filter((a) => a.role === 'selected' && !twin(a))));
  map.setFilter('st3-labels-other', ids(shown.filter((a) => a.role === 'alternative' && !twin(a))));
  map.setFilter('st3-labels-twins', ids(shown.filter((a) => a.role !== 'removed' && twin(a))));
  map.setFilter('st3-labels-removed', ids(shown.filter((a) => a.role === 'removed')));

  map.setFilter('st3-alignment', ['in', ['get', 'project'], ['literal', model.projects.filter((p) => state.projectOn(p)).map((p) => p.id)]]);
  map.setFilter('st3-alignment-casing', map.getFilter('st3-alignment'));

  // Buses: whole routes for every station with "Show Buses" on.
  const routes = new Set();
  for (const s of model.stations.values()) {
    if (state.buses[s.id] && state.projectOn(s.project)) for (const r of model.stationRoutes(s, state)) routes.add(r);
  }
  const busFilter = ['in', ['get', 'route_id'], ['literal', [...routes]]];
  for (const id of ['st3-bus-casing', 'st3-bus', 'st3-bus-labels']) map.setFilter(id, busFilter);
  const hl = ['==', ['get', 'route_id'], state.hoverRoute || ''];
  map.setFilter('st3-bus-hl-casing', hl);
  map.setFilter('st3-bus-hl', hl);
}

// Marker icons: selected = solid in the line color; alternative = hollow ring
// in the line color; removed = hollow grey ring. Each has a dark outer ring so
// it reads over bright imagery.
function addIcons(map, model) {
  const ratio = 2;
  const draw = (name, { fill, ring }) => {
    const c = document.createElement('canvas');
    c.width = c.height = ICON_PX * ratio;
    const ctx = c.getContext('2d');
    ctx.scale(ratio, ratio);
    const mid = ICON_PX / 2;
    const disk = (r) => (ctx.beginPath(), ctx.arc(mid, mid, r, 0, Math.PI * 2));
    disk(9.5);
    ctx.fillStyle = 'rgba(0,0,0,0.85)';
    ctx.fill();
    disk(7);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = ring;
    ctx.stroke();
    map.addImage(name, ctx.getImageData(0, 0, c.width, c.height), { pixelRatio: ratio });
  };
  for (const p of model.projects) {
    draw(`st3-selected:${p.id}`, { fill: p.color, ring: '#ffffff' });
    draw(`st3-alternative:${p.id}`, { fill: 'rgba(15,19,24,0.9)', ring: p.color });
  }
  draw('st3-removed', { fill: 'rgba(15,19,24,0.9)', ring: REMOVED_COLOR });

  // Struck-through grey labels for removed options (map text can't strike).
  for (const a of model.alts.values()) {
    if (a.role !== 'removed') continue;
    const text = a.short;
    const font = '600 13px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
    const m = document.createElement('canvas').getContext('2d');
    m.font = font;
    const w = Math.ceil(m.measureText(text).width) + 8;
    const h = 20;
    const c = document.createElement('canvas');
    c.width = w * ratio;
    c.height = h * ratio;
    const ctx = c.getContext('2d');
    ctx.scale(ratio, ratio);
    ctx.font = font;
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(0,0,0,0.95)';
    ctx.strokeText(text, 4, h / 2);
    ctx.fillStyle = '#c9d1d9';
    ctx.fillText(text, 4, h / 2);
    ctx.fillStyle = 'rgba(0,0,0,0.95)';
    ctx.fillRect(2, h / 2 - 2, w - 4, 4);
    ctx.fillStyle = '#c9d1d9';
    ctx.fillRect(3, h / 2 - 1, w - 6, 2);
    map.addImage(`st3-strike:${a.id}`, ctx.getImageData(0, 0, c.width, c.height), { pixelRatio: ratio });
  }
}
