// Ładowanie modeli GLB i materiały "biologiczne" (poświata krawędzi, fala ogonka).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
// Modele są wbudowane w bundle (esbuild, loader "binary"), więc gra nie pobiera żadnych plików.
import spermGlb from '../public/models/sperm.glb';
import eggGlb from '../public/models/egg.glb';
import wbcGlb from '../public/models/WhiteBloodCell.glb';
import rbcGlb from '../public/models/RedBloodCell.glb';
import virusGlb from '../public/models/Virus.glb';

function firstMesh(root) {
  let found = null;
  root.updateMatrixWorld(true);
  root.traverse((o) => { if (!found && o.isMesh) found = o; });
  return found;
}

// Geometria ze światowym przekształceniem, wyśrodkowana i przeskalowana do promienia 1.
function normalized(mesh) {
  const g = mesh.geometry.clone();
  g.applyMatrix4(mesh.matrixWorld);
  // Część modeli z Poly Pizza nie ma normalnych; bez nich oświetlenie daje NaN.
  if (!g.attributes.normal) g.computeVertexNormals();
  g.computeBoundingSphere();
  const { center, radius } = g.boundingSphere;
  g.translate(-center.x, -center.y, -center.z);
  g.scale(1 / radius, 1 / radius, 1 / radius);
  g.computeBoundingSphere();
  return g;
}

export async function loadModels() {
  const loader = new GLTFLoader();
  const parse = (bytes) => loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  const [sperm, egg, wbc, rbc, virus] = await Promise.all([spermGlb, eggGlb, wbcGlb, rbcGlb, virusGlb].map(parse));
  const part = (name) => egg.scene.getObjectByName(name);
  const wbcMesh = firstMesh(wbc.scene), virusMesh = firstMesh(virus.scene), rbcMesh = firstMesh(rbc.scene);
  return {
    sperm: firstMesh(sperm.scene).geometry,
    corona: part('corona').geometry,
    zona: part('zona').geometry,
    cytoplasm: part('cytoplasm').geometry,
    wbc: normalized(wbcMesh), wbcMap: wbcMesh.material.map,
    rbc: normalized(rbcMesh),
    virus: normalized(virusMesh), virusMap: virusMesh.material.map,
  };
}

// Materiał z poświatą na krawędziach, która daje wrażenie półprzezroczystej komórki.
export function bioMaterial(params, { rim = 0x000000, rimPower = 2.4, rimStrength = 1, wave = false } = {}) {
  const mat = new THREE.MeshStandardMaterial(params);
  const rimColor = new THREE.Color(rim);
  const uniforms = {
    uRim: { value: rimColor },
    uRimPower: { value: rimPower },
    uRimStrength: { value: rimStrength },
    uWaveT: { value: 0 },
    uWaveAmp: { value: 0.06 },
  };
  mat.userData.uniforms = uniforms;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    if (wave) {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uWaveT;\nuniform float uWaveAmp;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          float tail = clamp(-position.z / 0.94, 0.0, 1.0);
          float bend = smoothstep(0.03, 0.5, tail) * (0.4 + 0.75 * tail);
          float phase = tail * 13.0 - uWaveT;
          transformed.x += uWaveAmp * bend * sin(phase);
          transformed.y += uWaveAmp * 0.45 * bend * cos(phase);
          transformed.x -= uWaveAmp * 0.1 * (1.0 - smoothstep(0.0, 0.1, tail)) * sin(uWaveT);`);
    }
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uRim;\nuniform float uRimPower;\nuniform float uRimStrength;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float rimF = pow(1.0 - clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0), uRimPower);
        totalEmissiveRadiance += uRim * rimF * uRimStrength;`);
  };
  mat.customProgramCacheKey = () => (wave ? 'bio-wave' : 'bio');
  return mat;
}

// Ściana: perystaltyka w wierzchołkach i delikatne przeświecanie tkanki.
export function wallMaterial(map, timeUniform) {
  const mat = new THREE.MeshStandardMaterial({
    map, bumpMap: map, bumpScale: 1.1, vertexColors: true, roughness: 0.42, metalness: 0,
  });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = timeUniform;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nattribute float aS;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        transformed += normal * (0.55 * sin(aS * 0.045 - uTime * 1.3) + 0.18 * sin(aS * 0.17 + uTime * 0.9));`);
    shader.fragmentShader = shader.fragmentShader
      // Bump przy zerowych pochodnych ekranowych potrafi dać NaN w normalnej.
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
       if (any(isnan(normal))) normal = nonPerturbedNormal;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
       totalEmissiveRadiance += diffuseColor.rgb * 0.07;`);
  };
  return mat;
}

export function radialSprite(color, size = 128) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const c = cv.getContext('2d');
  const g = c.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, color);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = g;
  c.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function nameTag(text, color) {
  const cv = document.createElement('canvas');
  cv.width = 512; cv.height = 96;
  const c = cv.getContext('2d');
  c.font = '600 44px Onest, system-ui, sans-serif';
  c.textAlign = 'center'; c.textBaseline = 'middle';
  c.shadowColor = 'rgba(20,0,10,.95)'; c.shadowBlur = 12;
  c.fillStyle = color;
  c.fillText(text, 256, 50);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false, fog: false, opacity: 0.92 }));
  s.scale.set(6.4, 1.2, 1);
  return s;
}
