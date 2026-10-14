// Decodes Google encoded polylines (written by pipeline/geo.py) to [lon, lat].
export function decodePolyline(str, precision = 5) {
  const factor = 10 ** precision;
  const out = [];
  let i = 0;
  let lat = 0;
  let lon = 0;
  const next = () => {
    let shift = 0;
    let result = 0;
    let b;
    do {
      b = str.charCodeAt(i++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (i < str.length) {
    lat += next();
    lon += next();
    out.push([lon / factor, lat / factor]);
  }
  return out;
}
