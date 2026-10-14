// Decodes the walk-shed TopoJSON files written by pipeline/walksheds.py:
// quantized, delta-encoded arcs, each used whole and forward (no shared or
// reversed arcs), MultiPolygon geometries only.
export function topoFeatures(topo, object) {
  const [sx, sy] = topo.transform.scale;
  const [tx, ty] = topo.transform.translate;
  const arcs = topo.arcs.map((arc) => {
    let x = 0;
    let y = 0;
    return arc.map(([dx, dy]) => {
      x += dx;
      y += dy;
      return [x * sx + tx, y * sy + ty];
    });
  });
  return {
    type: 'FeatureCollection',
    features: topo.objects[object].geometries.map((g) => ({
      type: 'Feature',
      properties: g.properties || {},
      geometry: { type: 'MultiPolygon', coordinates: g.arcs.map((poly) => poly.map(([i]) => arcs[i])) },
    })),
  };
}
