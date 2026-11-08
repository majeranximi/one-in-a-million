// GLB model loading and "biological" materials (edge glow, tail wave).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
// The models are embedded in the bundle (esbuild, "binary" loader), so the game downloads no extra files.
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

// Geometry with its world transform applied, centered and scaled to radius 1.
function normalized(mesh) {
  const g = mesh.geometry.clone();
  g.applyMatrix4(mesh.matrixWorld);
  // Some Poly Pizza models have no normals; without them the lighting produces NaN.
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

// Material with an edge glow that makes cells look translucent.
// Swimmers (wave: true) also get skins: a second colour, a pattern along the tail and a glow.
export function bioMaterial(params, { rim = 0x000000, rimPower = 2.4, rimStrength = 1, wave = false, clock = null } = {}) {
  const mat = new THREE.MeshStandardMaterial(params);
  const rimColor = new THREE.Color(rim);
  const uniforms = {
    uRim: { value: rimColor },
    uRimPower: { value: rimPower },
    uRimStrength: { value: rimStrength },
    uWaveT: { value: 0 },
    uWaveAmp: { value: 0.06 },
    uColor2: { value: new THREE.Color(params.color ?? 0xffffff) },
    uPattern: { value: 0 },
    uSkinGlow: { value: 0 },
    uClock: clock || { value: 0 },
  };
  mat.userData.uniforms = uniforms;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    if (wave) {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uWaveT;\nuniform float uWaveAmp;\nvarying float vTail;\nvarying vec3 vObj;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          float tail = clamp(-position.z / 0.94, 0.0, 1.0);
          vTail = tail;
          vObj = position;
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
    if (wave) {
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
          uniform vec3 uColor2; uniform float uPattern; uniform float uSkinGlow; uniform float uClock;
          varying float vTail; varying vec3 vObj;
          vec3 skinHue(float h) { return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0); }`)
        .replace('#include <color_fragment>', `#include <color_fragment>
          float body = smoothstep(0.1, 0.16, vTail);
          if (uPattern > 0.5 && uPattern < 1.5) {
            diffuseColor.rgb = mix(diffuseColor.rgb, uColor2, step(0.5, fract(vTail * 9.0)) * body);
          } else if (uPattern > 1.5 && uPattern < 2.5) {
            diffuseColor.rgb = mix(diffuseColor.rgb, uColor2, smoothstep(0.02, 0.9, vTail));
          } else if (uPattern > 3.5 && uPattern < 4.5) {
            float wavePulse = 0.5 + 0.5 * sin(vTail * 18.0 - uClock * 6.0);
            diffuseColor.rgb = mix(diffuseColor.rgb, uColor2, wavePulse * body);
          } else if (uPattern > 4.5 && uPattern < 5.5) {
            diffuseColor.rgb = mix(diffuseColor.rgb, uColor2, smoothstep(0.0, 0.7, vTail));
            vec3 cell = floor(vObj * 90.0);
            float star = fract(sin(dot(cell, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
            diffuseColor.rgb += vec3(step(0.965, star)) * (0.6 + 0.4 * sin(uClock * 3.0 + star * 40.0));
          } else if (uPattern > 5.5) {
            diffuseColor.rgb = skinHue(fract(vTail * 1.2 - uClock * 0.15)) * 0.9 + 0.1;
          }`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          totalEmissiveRadiance += diffuseColor.rgb * uSkinGlow;`);
    }
  };
  mat.customProgramCacheKey = () => (wave ? 'bio-wave' : 'bio');
  return mat;
}

// Wall: peristalsis in the vertex shader and a subtle tissue glow.
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
      // Bump mapping can produce a NaN normal when screen-space derivatives are zero.
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
  const font = (size) => `600 ${size}px Onest, system-ui, sans-serif`;
  c.font = font(44);
  // Long names shrink to fit instead of being cut off at the canvas edge.
  const width = c.measureText(text).width;
  if (width > 490) c.font = font(Math.floor((44 * 490) / width));
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

// Dresses a swimmer's material in a look: { color, color2, rim, pattern, glow, metal, rough, rimStrength }.
export function paintSwimmer(mat, look) {
  const u = mat.userData.uniforms;
  mat.color.set(look.color);
  mat.emissive.set(look.color);
  mat.metalness = look.metal ?? 0;
  mat.roughness = look.rough ?? 0.32;
  u.uColor2.value.set(look.color2 ?? look.color);
  u.uPattern.value = look.pattern ?? 0;
  u.uSkinGlow.value = look.glow ?? 0;
  u.uRim.value.set(look.rim ?? look.color);
  u.uRimStrength.value = look.rimStrength ?? 0.95;
}
