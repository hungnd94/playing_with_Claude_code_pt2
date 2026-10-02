/**
 * Approximately isotropic Gaussian blur of an equirectangular float raster:
 * three passes of running-sum box blur per axis. The horizontal radius of each
 * row is divided by cos(latitude) so the kernel has the same size on the
 * sphere everywhere; rows wrap around the antimeridian.
 */
export function blurEquirect(data: Float32Array, width: number, height: number, radiusY: number, passes = 3): void {
  const rowBuf = new Float64Array(width);
  const ry = Math.max(0, Math.round(radiusY));
  // Horizontal.
  for (let y = 0; y < height; y++) {
    const lat = Math.PI / 2 - ((y + 0.5) / height) * Math.PI;
    const c = Math.max(0.02, Math.cos(lat));
    const rx = Math.min(Math.floor((width - 1) / 2), Math.round(radiusY / c));
    if (rx < 1) continue;
    const off = y * width;
    for (let p = 0; p < passes; p++) {
      for (let x = 0; x < width; x++) rowBuf[x] = data[off + x];
      const norm = 1 / (2 * rx + 1);
      let s = 0;
      for (let k = -rx; k <= rx; k++) s += rowBuf[(k + width) % width];
      for (let x = 0; x < width; x++) {
        data[off + x] = s * norm;
        let addI = x + rx + 1;
        if (addI >= width) addI -= width;
        let subI = x - rx;
        if (subI < 0) subI += width;
        s += rowBuf[addI] - rowBuf[subI];
      }
    }
  }
  if (ry < 1) return;
  // Vertical (clamped at the poles), row-wise sliding window for cache locality.
  const norm = 1 / (2 * ry + 1);
  const src = new Float32Array(data.length);
  const sum = new Float64Array(width);
  for (let p = 0; p < passes; p++) {
    src.set(data);
    sum.fill(0);
    for (let k = -ry; k <= ry; k++) {
      const r = (k < 0 ? 0 : k >= height ? height - 1 : k) * width;
      for (let x = 0; x < width; x++) sum[x] += src[r + x];
    }
    for (let y = 0; y < height; y++) {
      const o = y * width;
      for (let x = 0; x < width; x++) data[o + x] = sum[x] * norm;
      const a = (y + ry + 1 >= height ? height - 1 : y + ry + 1) * width;
      const b = (y - ry < 0 ? 0 : y - ry) * width;
      for (let x = 0; x < width; x++) sum[x] += src[a + x] - src[b + x];
    }
  }
}
