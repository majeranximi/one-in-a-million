// Converts the downloaded models (3D-printing STL from Tactiles.eu, GLB from Poly Pizza) into light GLB files for the game.
//  - sperm: reduces the mesh, straightens the tail along -Z (the shader adds the waves), adds tail density
//  - egg: takes the outer surface of the bowl-shaped hemispheres, mirrors it and normalizes to radius 1
import fs from 'node:fs';
import path from 'node:path';
import { Document, NodeIO } from '@gltf-transform/core';
import { MeshoptSimplifier as Simplifier } from 'meshoptimizer';

const RAW = 'assets/raw';
const OUT = 'public/models';
fs.mkdirSync(OUT, { recursive: true });
await Simplifier.ready;

function readStl(file) {
  const b = fs.readFileSync(path.join(RAW, file));
  const n = b.readUInt32LE(80);
  const v = new Float32Array(n * 9);
  for (let i = 0; i < n; i++) for (let k = 0; k < 9; k++) v[i * 9 + k] = b.readFloatLE(84 + i * 50 + 12 + k * 4);
  return v;
}

function weld(soup, eps = 1e-6) {
  const map = new Map();
  const pos = [];
  const idx = new Uint32Array(soup.length / 3);
  for (let i = 0; i < soup.length; i += 3) {
    const key = `${Math.round(soup[i] / eps)},${Math.round(soup[i + 1] / eps)},${Math.round(soup[i + 2] / eps)}`;
    let id = map.get(key);
    if (id === undefined) {
      id = pos.length / 3;
      map.set(key, id);
      pos.push(soup[i], soup[i + 1], soup[i + 2]);
    }
    idx[i / 3] = id;
  }
  return { pos: new Float32Array(pos), idx };
}

// target = desired triangle count
function simplify({ pos, idx }, target, error = 0.02) {
  if (target * 3 >= idx.length) return compact(pos, idx);
  const [out] = Simplifier.simplify(idx, pos, 3, target * 3, error, []);
  return compact(pos, out);
}

function compact(pos, idx) {
  const remap = new Map();
  const p = [];
  const out = new Uint32Array(idx.length);
  idx.forEach((id, i) => {
    let n = remap.get(id);
    if (n === undefined) {
      n = p.length / 3;
      remap.set(id, n);
      p.push(pos[id * 3], pos[id * 3 + 1], pos[id * 3 + 2]);
    }
    out[i] = n;
  });
  return { pos: new Float32Array(p), idx: out };
}

function smoothNormals(pos, idx) {
  const n = new Float32Array(pos.length);
  for (let i = 0; i < idx.length; i += 3) {
    const [a, b, c] = [idx[i], idx[i + 1], idx[i + 2]];
    const ux = pos[b * 3] - pos[a * 3], uy = pos[b * 3 + 1] - pos[a * 3 + 1], uz = pos[b * 3 + 2] - pos[a * 3 + 2];
    const vx = pos[c * 3] - pos[a * 3], vy = pos[c * 3 + 1] - pos[a * 3 + 1], vz = pos[c * 3 + 2] - pos[a * 3 + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const t of [a, b, c]) { n[t * 3] += nx; n[t * 3 + 1] += ny; n[t * 3 + 2] += nz; }
  }
  for (let i = 0; i < n.length; i += 3) {
    const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1;
    n[i] /= l; n[i + 1] /= l; n[i + 2] /= l;
  }
  return n;
}

// Red-green subdivision of edges longer than the limit (leaves no cracks in the mesh).
function subdivide({ pos, idx }, limitFor) {
  const p = Array.from(pos);
  let tris = Array.from(idx);
  for (let pass = 0; pass < 12; pass++) {
    const mids = new Map();
    const mid = (a, b) => {
      const dx = p[a * 3] - p[b * 3], dy = p[a * 3 + 1] - p[b * 3 + 1], dz = p[a * 3 + 2] - p[b * 3 + 2];
      const mz = (p[a * 3 + 2] + p[b * 3 + 2]) / 2;
      if (Math.hypot(dx, dy, dz) <= limitFor(mz)) return -1;
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      let m = mids.get(key);
      if (m === undefined) {
        m = p.length / 3;
        mids.set(key, m);
        p.push((p[a * 3] + p[b * 3]) / 2, (p[a * 3 + 1] + p[b * 3 + 1]) / 2, mz);
      }
      return m;
    };
    const next = [];
    for (let i = 0; i < tris.length; i += 3) {
      const a = tris[i], b = tris[i + 1], c = tris[i + 2];
      const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
      const count = (ab >= 0) + (bc >= 0) + (ca >= 0);
      if (count === 0) next.push(a, b, c);
      else if (count === 3) next.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca);
      else if (count === 1) {
        if (ab >= 0) next.push(a, ab, c, ab, b, c);
        else if (bc >= 0) next.push(a, b, bc, a, bc, c);
        else next.push(a, b, ca, ca, b, c);
      } else if (ab < 0) next.push(a, b, bc, a, bc, ca, ca, bc, c);
      else if (bc < 0) next.push(a, ab, ca, ab, b, ca, b, c, ca);
      else next.push(a, ab, bc, ab, b, bc, a, bc, c);
    }
    tris = next;
    if (mids.size === 0) break;
  }
  return { pos: new Float32Array(p), idx: new Uint32Array(tris) };
}

async function writeGlb(name, parts) {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const scene = doc.createScene();
  for (const part of parts) {
    const prim = doc.createPrimitive()
      .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(part.pos).setBuffer(buffer))
      .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(part.normal).setBuffer(buffer));
    if (part.idx) prim.setIndices(doc.createAccessor().setType('SCALAR').setArray(part.idx).setBuffer(buffer));
    prim.setMaterial(doc.createMaterial(part.name));
    const mesh = doc.createMesh(part.name).addPrimitive(prim);
    scene.addChild(doc.createNode(part.name).setMesh(mesh));
  }
  const file = path.join(OUT, name);
  await new NodeIO().write(file, doc);
  const tris = parts.reduce((t, x) => t + (x.idx ? x.idx.length : x.pos.length / 3) / 3, 0);
  console.log(name, 'triangles:', tris, 'size:', (fs.statSync(file).size / 1024).toFixed(0), 'kB');
}

// ---------- SPERM ----------
async function sperm() {
  const welded = weld(readStl('SpermCell_Complete.stl'));
  const low = simplify(welded, 3500, 0.006);
  const P = low.pos;
  const count = P.length / 3;

  // The head sits at the end with the smallest x+y, the tail tip at the largest.
  let headTip = 0, tailTip = 0;
  for (let i = 0; i < count; i++) {
    const v = P[i * 3] + P[i * 3 + 1];
    if (v < P[headTip * 3] + P[headTip * 3 + 1]) headTip = i;
    if (v > P[tailTip * 3] + P[tailTip * 3 + 1]) tailTip = i;
  }
  const hx = P[headTip * 3], hy = P[headTip * 3 + 1];
  const ax0 = P[tailTip * 3] - hx, ay0 = P[tailTip * 3 + 1] - hy;
  const len = Math.hypot(ax0, ay0);
  const ax = ax0 / len, ay = ay0 / len;

  // w = distance along the head-to-tail axis (0..1), l = sideways offset, h = thickness
  const w = new Float32Array(count), l = new Float32Array(count), h = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const dx = P[i * 3] - hx, dy = P[i * 3 + 1] - hy;
    w[i] = (dx * ax + dy * ay) / len;
    l[i] = (-dx * ay + dy * ax) / len;
    h[i] = P[i * 3 + 2] / len;
  }

  // Centerline from the original dense vertices, used to remove the curves baked into the model.
  const BINS = 120;
  const sum = new Float64Array(BINS), cnt = new Float64Array(BINS);
  const W = welded.pos;
  for (let i = 0; i < W.length; i += 3) {
    const dx = W[i] - hx, dy = W[i + 1] - hy;
    const b = Math.min(BINS - 1, Math.max(0, Math.floor(((dx * ax + dy * ay) / len) * BINS)));
    sum[b] += (-dx * ay + dy * ax) / len;
    cnt[b]++;
  }
  const raw = Array.from(sum, (s, i) => (cnt[i] ? s / cnt[i] : NaN));
  for (let i = 0; i < BINS; i++) if (Number.isNaN(raw[i])) raw[i] = i ? raw[i - 1] : 0;
  const center = raw.map((_, i) => {
    let t = 0, c = 0;
    for (let k = -1; k <= 1; k++) if (raw[i + k] !== undefined) { t += raw[i + k]; c++; }
    return t / c;
  });
  const lineAt = (t) => {
    const f = Math.min(BINS - 1.001, Math.max(0, t * BINS - 0.5));
    const i = Math.floor(f);
    return center[i] + (center[i + 1] - center[i]) * (f - i);
  };

  // The head is the first ~12% of the length. Origin = center of the head, forward = +Z.
  const headCenterW = 0.055;
  const headLine = lineAt(headCenterW);
  const out = new Float32Array(P.length);
  for (let i = 0; i < count; i++) {
    const t = w[i];
    const offset = lineAt(t);
    // The head keeps a constant offset so it does not get sheared.
    const blend = Math.min(1, Math.max(0, (t - 0.1) / 0.06));
    const shift = headLine + (offset - headLine) * blend;
    // The tail is thickened so the camera can see it; the tip stays thin.
    const fat = 1 + 0.9 * Math.min(1, Math.max(0, (t - 0.14) / 0.1));
    out[i * 3] = (l[i] - shift) * fat;
    out[i * 3 + 1] = h[i] * fat;
    out[i * 3 + 2] = -(t - headCenterW);
  }

  // Denser tail, so the shader wave does not kink on long edges.
  const dense = subdivide({ pos: out, idx: low.idx }, (z) => (z < -0.07 ? 0.016 : 1));
  const normal = smoothNormals(dense.pos, dense.idx);
  await writeGlb('sperm.glb', [{ name: 'sperm', pos: dense.pos, idx: dense.idx, normal }]);
}

// ---------- EGG ----------
function shellOf(file, { flat = false, target = 0 } = {}) {
  const soup = readStl(file);
  const min = [1e9, 1e9, 1e9], max = [-1e9, -1e9, -1e9];
  for (let i = 0; i < soup.length; i += 3) for (let a = 0; a < 3; a++) {
    min[a] = Math.min(min[a], soup[i + a]);
    max[a] = Math.max(max[a], soup[i + a]);
  }
  const R = Math.min(max[0] - min[0], max[1] - min[1]) / 2;
  const cx = (min[0] + max[0]) / 2, cy = (min[1] + max[1]) / 2, cz = min[2] + R;

  // Keep only the outer side of the bowl, below the cut plane (no rim, tabs or braille).
  const kept = [];
  for (let i = 0; i < soup.length; i += 9) {
    const t = soup.subarray(i, i + 9);
    const gx = (t[0] + t[3] + t[6]) / 3 - cx, gy = (t[1] + t[4] + t[7]) / 3 - cy, gz = (t[2] + t[5] + t[8]) / 3 - cz;
    const d = Math.hypot(gx, gy, gz);
    if (gz > 0 || d < 0.82 * R) continue;
    const ux = t[3] - t[0], uy = t[4] - t[1], uz = t[5] - t[2], vx = t[6] - t[0], vy = t[7] - t[1], vz = t[8] - t[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const nl = Math.hypot(nx, ny, nz) || 1;
    if ((nx * gx + ny * gy + nz * gz) / (nl * d) < 0.3) continue;
    for (let v = 0; v < 3; v++) kept.push((t[v * 3] - cx) / R, (t[v * 3 + 1] - cy) / R, (t[v * 3 + 2] - cz) / R);
  }
  let half = new Float32Array(kept);

  if (target) {
    const low = simplify(weld(half), target, 0.01);
    const s = new Float32Array(low.idx.length * 3);
    low.idx.forEach((id, i) => {
      s[i * 3] = low.pos[id * 3]; s[i * 3 + 1] = low.pos[id * 3 + 1]; s[i * 3 + 2] = low.pos[id * 3 + 2];
    });
    half = s;
  }

  // Mirror across z=0 (with reversed vertex order).
  const n = half.length / 9;
  const pos = new Float32Array(n * 18);
  pos.set(half, 0);
  for (let i = 0; i < n; i++) {
    const o = i * 9, m = (n + i) * 9;
    pos[m] = half[o]; pos[m + 1] = half[o + 1]; pos[m + 2] = -half[o + 2];
    pos[m + 3] = half[o + 6]; pos[m + 4] = half[o + 7]; pos[m + 5] = -half[o + 8];
    pos[m + 6] = half[o + 3]; pos[m + 7] = half[o + 4]; pos[m + 8] = -half[o + 5];
  }
  if (flat) {
    const normal = new Float32Array(pos.length);
    for (let i = 0; i < pos.length; i += 9) {
      const ux = pos[i + 3] - pos[i], uy = pos[i + 4] - pos[i + 1], uz = pos[i + 5] - pos[i + 2];
      const vx = pos[i + 6] - pos[i], vy = pos[i + 7] - pos[i + 1], vz = pos[i + 8] - pos[i + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz) || 1;
      for (let v = 0; v < 3; v++) { normal[i + v * 3] = nx / l; normal[i + v * 3 + 1] = ny / l; normal[i + v * 3 + 2] = nz / l; }
    }
    return { pos, normal, R };
  }
  const w = weld(pos, 1e-5);
  return { pos: w.pos, idx: w.idx, normal: smoothNormals(w.pos, w.idx), R };
}

async function egg() {
  const corona = shellOf('HumanEggCell_IsolatedCoronaRadiata.stl', { flat: true });
  const zona = shellOf('HumanEggCell_IsolatedZonaPellucida.stl', { target: 2500 });
  const cyto = shellOf('HumanEggCell_IsolatedCytoplasm.stl', { target: 2500 });
  console.log('layer radii', corona.R, zona.R, cyto.R);
  const scale = (part) => {
    const k = part.R / corona.R;
    for (let i = 0; i < part.pos.length; i++) part.pos[i] *= k;
    return part;
  };
  await writeGlb('egg.glb', [
    { name: 'corona', ...corona },
    { name: 'zona', ...scale(zona) },
    { name: 'cytoplasm', ...scale(cyto) },
  ]);
}

await sperm();
await egg();
for (const f of ['WhiteBloodCell.glb', 'RedBloodCell.glb', 'Virus.glb']) fs.copyFileSync(path.join(RAW, f), path.join(OUT, f));
console.log('Done:', fs.readdirSync(OUT).join(', '));
