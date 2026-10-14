// Dims and desaturates the satellite imagery so tracks, stations and trains
// stand out over both bright (downtown) and dark (Lake Washington) areas.

const BRIGHTNESS_MAX = 0.72; // 1 = unchanged
const SATURATION = -0.35; // -1 = grayscale, 0 = unchanged

export default {
  add(map) {
    for (const layer of map.getStyle().layers) {
      if (layer.type !== 'raster') continue;
      map.setPaintProperty(layer.id, 'raster-brightness-max', BRIGHTNESS_MAX);
      map.setPaintProperty(layer.id, 'raster-saturation', SATURATION);
    }
  },
};
