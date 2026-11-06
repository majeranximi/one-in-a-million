// Tor: krzywa 3D z ramkami, profil promienia, strefy anatomiczne i siatka ścian.
// Fizyka działa w "przestrzeni toru": s (metry wzdłuż osi) oraz x, y (przekrój poprzeczny).
import * as THREE from 'three';

const CONTROL = [
  [0, 0, 0], [10, 6, -130], [-24, 26, -280], [-8, 8, -430], [6, 0, -600],
  [14, -4, -820], [0, 8, -1060], [-40, 34, -1290], [-190, 58, -1470], [-300, -10, -1680],
  [-430, -60, -1880], [-570, -6, -2080], [-660, 28, -2270], [-720, 34, -2470],
];

export const EGG_R = 19;

function smooth(t) {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

// Prosty szum wartości 2D (powtarzalny, bez zależności).
function noise2(x, y) {
  const hash = (a, b) => {
    const v = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
    return v - Math.floor(v);
  };
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = smooth(x - ix), fy = smooth(y - iy);
  const a = hash(ix, iy), b = hash(ix + 1, iy), c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

export class Track {
  constructor() {
    const curve = new THREE.CatmullRomCurve3(CONTROL.map((p) => new THREE.Vector3(...p)), false, 'centripetal');
    curve.arcLengthDivisions = 5000;
    this.length = curve.getLength();
    this.eggS = this.length - 34;
    this.count = Math.floor(this.length) + 1;

    const n = this.count;
    this.P = new Float32Array(n * 3);
    this.T = new Float32Array(n * 3);
    this.U = new Float32Array(n * 3);
    this.Rt = new Float32Array(n * 3);
    this.Rad = new Float32Array(n);

    const p = new THREE.Vector3(), t = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), right = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      const u = Math.min(1, i / this.length);
      curve.getPointAt(u, p);
      curve.getTangentAt(u, t).normalize();
      // Transport równoległy: "góra" nie obraca się bez potrzeby, więc sterowanie jest stałe na ekranie.
      up.addScaledVector(t, -up.dot(t)).normalize();
      right.crossVectors(t, up).normalize();
      p.toArray(this.P, i * 3); t.toArray(this.T, i * 3); up.toArray(this.U, i * 3); right.toArray(this.Rt, i * 3);
    }

    const L = this.length;
    this.zones = [
      { id: 'cervix', from: 0, to: 0.25 * L, tint: [0.98, 0.62, 0.62] },
      { id: 'uterus', from: 0.25 * L, to: 0.51 * L, tint: [0.72, 0.13, 0.2] },
      { id: 'tube', from: 0.51 * L, to: 0.82 * L, tint: [0.86, 0.32, 0.5] },
      { id: 'ampulla', from: 0.82 * L, to: L, tint: [0.98, 0.56, 0.36] },
    ];

    const keys = [
      [0, 1], [14, 14], [60, 12], [0.1 * L, 9.5], [0.235 * L, 9], [0.28 * L, 24], [0.34 * L, 38], [0.44 * L, 38],
      [0.5 * L, 15], [0.535 * L, 9.5], [0.8 * L, 10], [0.86 * L, 24], [0.93 * L, 31], [this.eggS - 22, EGG_R + 5],
      [this.eggS + 12, EGG_R * 0.9], [L, 1],
    ];
    let k = 0;
    for (let i = 0; i < n; i++) {
      while (k < keys.length - 2 && i > keys[k + 1][0]) k++;
      const [s0, r0] = keys[k], [s1, r1] = keys[k + 1];
      this.Rad[i] = r0 + (r1 - r0) * smooth((i - s0) / (s1 - s0));
    }
  }

  zoneIndex(s) {
    for (let i = this.zones.length - 1; i >= 0; i--) if (s >= this.zones[i].from) return i;
    return 0;
  }

  radius(s) {
    const f = Math.min(this.count - 1.001, Math.max(0, s));
    const i = Math.floor(f);
    return this.Rad[i] + (this.Rad[i + 1] - this.Rad[i]) * (f - i);
  }

  // Maksymalne wychylenie pływaka od osi w danym miejscu.
  maxRadius(s) {
    return Math.max(1, this.radius(s) - 1.3);
  }

  // Punkt świata dla współrzędnych toru.
  point(s, x, y, out) {
    const f = Math.min(this.count - 1.001, Math.max(0, s));
    const i = Math.floor(f), a = f - i, j = i * 3, q = j + 3;
    const { P, U, Rt } = this;
    const px = P[j] + (P[q] - P[j]) * a, py = P[j + 1] + (P[q + 1] - P[j + 1]) * a, pz = P[j + 2] + (P[q + 2] - P[j + 2]) * a;
    return out.set(
      px + Rt[j] * x + U[j] * y,
      py + Rt[j + 1] * x + U[j + 1] * y,
      pz + Rt[j + 2] * x + U[j + 2] * y,
    );
  }

  frame(s, t, u, r) {
    const f = Math.min(this.count - 1.001, Math.max(0, s));
    const i = Math.floor(f), a = f - i, j = i * 3;
    const mix = (arr, o, v) => v.set(
      arr[o] + (arr[o + 3] - arr[o]) * a,
      arr[o + 1] + (arr[o + 4] - arr[o + 1]) * a,
      arr[o + 2] + (arr[o + 5] - arr[o + 2]) * a,
    ).normalize();
    mix(this.T, j, t); mix(this.U, j, u); mix(this.Rt, j, r);
  }

  // Fałdy ściany: inne w każdej strefie, tak jak w anatomii.
  wallRelief(s, theta) {
    const w = (from, to, soft = 40) => smooth((s - from + soft) / (2 * soft)) * (1 - smooth((s - to + soft) / (2 * soft)));
    const [a, b, c, d] = this.zones;
    const big = noise2(s * 0.03 + 3, theta * 2.2);
    const fine = noise2(s * 0.14, theta * 5 + 9);
    const rings = Math.sin(s * 0.42 + Math.sin(theta * 3) * 1.1) * 0.9 + (fine - 0.5) * 0.9;
    const womb = (big - 0.5) * 6.5 + (fine - 0.5) * 2;
    const plicae = Math.abs(Math.sin(theta * 4 + s * 0.012)) * 3 - 1.5 + (fine - 0.5) * 0.7;
    const fronds = Math.abs(Math.sin(theta * 7 + s * 0.018 + big * 2)) * 5.5 - 2.75 + (big - 0.5) * 3;
    return rings * w(a.from, a.to) + womb * w(b.from, b.to) + plicae * w(c.from, c.to) + fronds * w(d.from, d.to);
  }

  zoneColor(s, out) {
    const zs = this.zones;
    let r = 0, g = 0, b = 0, total = 0;
    for (const z of zs) {
      const weight = smooth((s - z.from + 70) / 140) * (1 - smooth((s - z.to + 70) / 140));
      r += z.tint[0] * weight; g += z.tint[1] * weight; b += z.tint[2] * weight; total += weight;
    }
    return out.set(r / total, g / total, b / total);
  }

  buildMesh(material) {
    const STEP = 2, SEG = 72;
    const rings = Math.floor(this.length / STEP) + 1;
    const pos = new Float32Array(rings * (SEG + 1) * 3);
    const col = new Float32Array(rings * (SEG + 1) * 3);
    const uv = new Float32Array(rings * (SEG + 1) * 2);
    const sAttr = new Float32Array(rings * (SEG + 1));
    const c = new THREE.Vector3(), v = new THREE.Vector3();
    let o = 0;
    for (let i = 0; i < rings; i++) {
      const s = i * STEP;
      const R = this.radius(s);
      this.zoneColor(s, c);
      for (let j = 0; j <= SEG; j++) {
        const theta = (j / SEG) * Math.PI * 2;
        const relief = j === SEG ? this.wallRelief(s, 0) : this.wallRelief(s, theta);
        const fade = Math.min(1, R / 8);
        const r = R + 1.2 + relief * fade;
        this.point(s, Math.cos(theta) * r, Math.sin(theta) * r, v);
        v.toArray(pos, o * 3);
        const shade = 0.5 + 0.62 * smooth((relief + 2.2) / 4.4);
        col[o * 3] = c.x * shade; col[o * 3 + 1] = c.y * shade; col[o * 3 + 2] = c.z * shade;
        uv[o * 2] = s / 18; uv[o * 2 + 1] = (j / SEG) * Math.max(3, Math.round(R / 3));
        sAttr[o] = s;
        o++;
      }
    }
    const idx = new Uint32Array((rings - 1) * SEG * 6);
    let q = 0;
    for (let i = 0; i < rings - 1; i++) for (let j = 0; j < SEG; j++) {
      const a = i * (SEG + 1) + j, b = a + SEG + 1;
      idx[q++] = a; idx[q++] = a + 1; idx[q++] = b;
      idx[q++] = a + 1; idx[q++] = b + 1; idx[q++] = b;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setAttribute('aS', new THREE.BufferAttribute(sAttr, 1));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeVertexNormals();
    // Szew: pierwszy i ostatni wierzchołek pierścienia muszą mieć tę samą normalną, inaczej perystaltyka rozchyla ścianę.
    const nrm = g.attributes.normal;
    for (let i = 0; i < rings; i++) {
      const a = i * (SEG + 1), b = a + SEG;
      const nx = nrm.getX(a) + nrm.getX(b), ny = nrm.getY(a) + nrm.getY(b), nz = nrm.getZ(a) + nrm.getZ(b);
      const l = Math.hypot(nx, ny, nz) || 1;
      nrm.setXYZ(a, nx / l, ny / l, nz / l);
      nrm.setXYZ(b, nx / l, ny / l, nz / l);
    }
    const mesh = new THREE.Mesh(g, material);
    mesh.frustumCulled = false;
    return mesh;
  }
}

// Tekstura wilgotnej tkanki: plamki i naczynka, rysowane proceduralnie.
export function tissueTexture() {
  const size = 512;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#d8d8d8';
  ctx.fillRect(0, 0, size, size);
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 900; i++) {
    const x = rnd() * size, y = rnd() * size, r = 3 + rnd() * 16;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const l = rnd() > 0.5 ? 255 : 120;
    g.addColorStop(0, `rgba(${l},${l},${l},0.26)`);
    g.addColorStop(1, `rgba(${l},${l},${l},0)`);
    ctx.fillStyle = g;
    for (const dx of [-size, 0, size]) for (const dy of [-size, 0, size]) {
      ctx.setTransform(1, 0, 0, 1, dx, dy);
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.lineCap = 'round';
  for (let i = 0; i < 22; i++) {
    let x = rnd() * size, y = rnd() * size, a = rnd() * 6.28;
    ctx.strokeStyle = 'rgba(120,55,70,0.28)';
    ctx.lineWidth = 0.8 + rnd() * 2.2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let k = 0; k < 16; k++) {
      a += (rnd() - 0.5) * 1.1;
      x += Math.cos(a) * 16; y += Math.sin(a) * 16;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}
