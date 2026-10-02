/** Small WebGL2 helpers for the globe. */

export function compileProgram(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const v = compileShader(gl, gl.VERTEX_SHADER, vs);
  const f = compileShader(gl, gl.FRAGMENT_SHADER, fs);
  const p = gl.createProgram();
  if (!p) throw new Error("createProgram failed");
  gl.attachShader(p, v);
  gl.attachShader(p, f);
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(p);
    gl.deleteProgram(p);
    throw new Error("program link failed: " + log);
  }
  gl.deleteShader(v);
  gl.deleteShader(f);
  return p;
}

function compileShader(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const s = gl.createShader(type);
  if (!s) throw new Error("createShader failed");
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(s) ?? "";
    const lines = src.split("\n").map((l, i) => `${String(i + 1).padStart(4)}: ${l}`).join("\n");
    gl.deleteShader(s);
    throw new Error(`shader compile failed: ${log}\n${lines}`);
  }
  return s;
}

/** Cache of uniform locations for a program. */
export class Uniforms {
  private locs = new Map<string, WebGLUniformLocation | null>();
  constructor(private gl: WebGL2RenderingContext, private prog: WebGLProgram) {}
  loc(name: string): WebGLUniformLocation | null {
    let l = this.locs.get(name);
    if (l === undefined) {
      l = this.gl.getUniformLocation(this.prog, name);
      this.locs.set(name, l);
    }
    return l;
  }
  f(name: string, ...v: number[]): void {
    const l = this.loc(name);
    if (!l) return;
    const gl = this.gl;
    if (v.length === 1) gl.uniform1f(l, v[0]);
    else if (v.length === 2) gl.uniform2f(l, v[0], v[1]);
    else if (v.length === 3) gl.uniform3f(l, v[0], v[1], v[2]);
    else gl.uniform4f(l, v[0], v[1], v[2], v[3]);
  }
  i(name: string, ...v: number[]): void {
    const l = this.loc(name);
    if (!l) return;
    const gl = this.gl;
    if (v.length === 1) gl.uniform1i(l, v[0]);
    else if (v.length === 2) gl.uniform2i(l, v[0], v[1]);
    else gl.uniform3i(l, v[0], v[1], v[2]);
  }
}

/** Halve an RGBA8 image (box filter, or point sampling for id images). */
export function halveRGBA(src: Uint8Array, w: number, h: number, point: boolean): Uint8Array {
  const W = w >> 1, H = h >> 1;
  const out = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = 4 * (y * W + x);
      const a = 4 * (2 * y * w + 2 * x);
      if (point) {
        out[o] = src[a]; out[o + 1] = src[a + 1]; out[o + 2] = src[a + 2]; out[o + 3] = src[a + 3];
        continue;
      }
      const b = a + 4, c = a + 4 * w, d = c + 4;
      for (let k = 0; k < 4; k++) out[o + k] = (src[a + k] + src[b + k] + src[c + k] + src[d + k] + 2) >> 2;
    }
  }
  return out;
}

export interface TexOpts {
  internalFormat: number;
  format: number;
  type: number;
  minFilter: number;
  magFilter: number;
  wrapS?: number;
  wrapT?: number;
  mipmap?: boolean;
  anisotropy?: number;
}

export function createTexture(
  gl: WebGL2RenderingContext, w: number, h: number,
  data: ArrayBufferView | null, o: TexOpts, existing?: WebGLTexture | null,
): WebGLTexture {
  const tex = existing ?? gl.createTexture();
  if (!tex) throw new Error("createTexture failed");
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, o.internalFormat, w, h, 0, o.format, o.type, data);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, o.minFilter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, o.magFilter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, o.wrapS ?? gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, o.wrapT ?? gl.CLAMP_TO_EDGE);
  if (o.mipmap) gl.generateMipmap(gl.TEXTURE_2D);
  if (o.anisotropy && o.anisotropy > 1) {
    const ext = gl.getExtension("EXT_texture_filter_anisotropic");
    if (ext) {
      const max = gl.getParameter(ext.MAX_TEXTURE_MAX_ANISOTROPY_EXT) as number;
      gl.texParameterf(gl.TEXTURE_2D, ext.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(max, o.anisotropy));
    }
  }
  return tex;
}

/** Parse '#rgb', '#rrggbb', '#rrggbbaa' or [r,g,b(,a)] (r,g,b 0..255, a 0..1 like CSS rgba) → [r,g,b,a] in 0..1. */
export function parseColor(c: string | ArrayLike<number> | undefined, fallback: [number, number, number, number]): [number, number, number, number] {
  if (c === undefined) return fallback;
  if (typeof c === "string") {
    let s = c.trim().replace(/^#/, "");
    if (s.length === 3 || s.length === 4) s = s.split("").map((ch) => ch + ch).join("");
    const v = parseInt(s, 16);
    if (Number.isNaN(v)) return fallback;
    if (s.length === 8) return [((v >>> 24) & 255) / 255, ((v >>> 16) & 255) / 255, ((v >>> 8) & 255) / 255, (v & 255) / 255];
    return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255, 1];
  }
  const a = c.length > 3 ? c[3] : 1;
  return [c[0] / 255, c[1] / 255, c[2] / 255, Math.max(0, Math.min(1, a))];
}
