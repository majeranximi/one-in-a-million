// Scena, kamera, wejście, HUD i pętla gry.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { Track, EGG_R, tissueTexture } from './track.js';
import { Race, Racer, DIFFICULTY, BASE_SPEED, makeBotName } from './race.js';
import { loadModels, bioMaterial, wallMaterial, radialSprite, nameTag } from './assets.js';
import { Sound } from './audio.js';
import { LANGS, DEFAULT_LANG, FACT_COUNT, t, decimal, setLang, getLang, langName, savedLang } from './i18n.js';

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const REAL_CM = 18;

const RACER_COLORS = [0xffd9c2, 0xffc4e0, 0xd8c8ff, 0xc4ffd8, 0xfff3b0, 0xffb7a8, 0xb8e0ff, 0xf0d0ff, 0xd8ffb8, 0xffd0a0];
function store(key, value) {
  try {
    if (value !== undefined) localStorage.setItem(key, value);
    return localStorage.getItem(key);
  } catch { return null; }
}

class Game {
  async init() {
    const canvas = $('scene');
    try {
      this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    } catch {
      this.setStartState('noWebgl');
      showToast(t('toast.webgl'), t('toast.webglText'), 1e6);
      return;
    }
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, 1.6);
    this.renderer.setPixelRatio(this.pixelRatio);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x17030a);
    this.scene.fog = new THREE.Fog(0x2a0510, 50, 300);
    this.camera = new THREE.PerspectiveCamera(70, 1, 0.3, 900);

    this.timeU = { value: 0 };
    this.track = new Track();
    this.scene.add(this.track.buildMesh(wallMaterial(tissueTexture(), this.timeU)));

    this.scene.add(new THREE.HemisphereLight(0xffb8a8, 0x3a0614, 0.34));
    this.headlight = new THREE.PointLight(0xffe6d6, 95, 90, 1.5);
    this.scene.add(this.headlight);
    this.fill = new THREE.PointLight(0xff7e72, 120, 110, 1.45);
    this.scene.add(this.fill);

    this.models = await loadModels();

    this.tmp = {
      a: new THREE.Vector3(), b: new THREE.Vector3(), c: new THREE.Vector3(), d: new THREE.Vector3(),
      t: new THREE.Vector3(), u: new THREE.Vector3(), r: new THREE.Vector3(), m: new THREE.Matrix4(),
    };

    this.sound = new Sound();
    this.race = new Race(this.track, this.hooks());
    this.buildCourseMeshes();
    this.buildEgg();
    this.buildParticles();
    this.buildRacerPool();
    this.setupComposer();
    this.setupInput();
    this.setupUi();

    this.camS = 40; this.camX = 0; this.camY = 0;
    this.mode = 'menu';
    this.input = { x: 0, y: 0, boost: false };
    this.player = null;
    this.shake = 0;
    this.toastTimer = 0;
    this.hudTimer = 0;
    this.fpsSamples = [];
    this.qualityLevel = 0;
    this.lastZone = -1;
    this.startAttract();

    window.addEventListener('resize', () => this.resize());
    this.resize();
    this.last = performance.now();
    this.renderer.setAnimationLoop(() => this.frame());

    $('startBtn').disabled = false;
    this.setStartState('ready');
    window.__game = this; // używane przez testy i przy debugowaniu
    if (new URLSearchParams(location.search).has('autopilot')) {
      this.autopilot = true;
      this.startRace();
    }
  }

  hooks() {
    const near = (r) => this.player && Math.abs(r.s - this.player.s) < 45;
    return {
      onWall: (r) => { if (r === this.player) { this.sound.wall(); this.shake = Math.max(this.shake, 0.35); } },
      onMucus: (r, w) => {
        this.splash(r, 0xfff0c8, 26);
        w.mesh.userData.flash = 1;
        if (r === this.player) { this.sound.splat(); this.shake = 0.8; showToast(t('toast.mucus'), t('toast.mucusText'), 1.8); }
      },
      onHole: (r, w) => { if (r === this.player) { this.sound.tone(520, 0.18, 'triangle', 0.12, 1.5); w.mesh.userData.flash = 0.5; } },
      onBump: (r, o) => {
        if (r === this.player) { this.sound.hit(); this.shake = 0.9; } else if (near(r)) this.sound.tone(190, 0.1, 'sine', 0.08, 0.5);
        this.splash(r, 0xff4e4e, 12);
        void o;
      },
      onVirus: (r, o) => {
        this.splash(r, 0x9dff6a, 28);
        o.mesh.visible = false;
        if (r === this.player) { this.sound.virus(); this.shake = 0.6; showToast(t('toast.virus'), t('toast.virusText'), 1.8); }
      },
      onSmash: (r) => { this.splash(r, 0x9ff4ff, 14); },
      onPickup: (r, p) => {
        p.mesh.visible = false;
        if (r === this.player) {
          if (p.kind === 'hyper') { this.sound.hyper(); showToast(t('toast.hyper'), t('toast.hyperText'), 2); } else this.sound.pickup();
        }
      },
      onEaten: (r, h) => {
        h.mesh.userData.gulp = 1;
        if (r === this.player) { this.sound.eaten(); this.shake = 1.2; showToast(t('toast.eaten'), t('toast.eatenText'), 1.7); }
      },
      onReleased: (r) => { this.splash(r, 0xfff6e8, 20); if (r === this.player) this.sound.tone(300, 0.25, 'triangle', 0.14, 1.8); },
      onBounced: (r) => { this.splash(r, 0x9fe6ff, 18); if (r === this.player) { this.sound.tone(1200, 0.15, 'square', 0.06, 0.5); this.shake = 0.8; } },
      onNudge: () => { this.shake = Math.max(this.shake, 0.18); },
      onWin: (r) => this.onWin(r),
    };
  }

  // ---------- Świat ----------
  buildCourseMeshes() {
    const { models, race, scene } = this;

    // Śluz: błona z otworami; krawędzie otworów świecą, żeby dało się w nie celować.
    const wallMat = new THREE.MeshStandardMaterial({ color: 0xcfa35e, roughness: 0.7, transparent: true, opacity: 0.4, side: THREE.DoubleSide, depthWrite: false, emissive: 0x8a6226, emissiveIntensity: 0.16 });
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x8ff4ff, fog: false, toneMapped: false });
    for (const w of race.walls) {
      const R = this.track.radius(w.s) + 4;
      const shape = new THREE.Shape();
      shape.absarc(0, 0, R, 0, Math.PI * 2, false);
      const group = new THREE.Group();
      for (const h of w.holes) {
        const hole = new THREE.Path();
        hole.absarc(h.x, h.y, h.r, 0, Math.PI * 2, true);
        shape.holes.push(hole);
        const ring = new THREE.Mesh(new THREE.TorusGeometry(h.r, 0.075, 8, 48), ringMat);
        ring.position.set(h.x, h.y, 0);
        group.add(ring);
      }
      const membrane = new THREE.Mesh(new THREE.ShapeGeometry(shape, 40), wallMat.clone());
      group.add(membrane);
      this.placeMembrane(group, w.s);
      scene.add(group);
      w.mesh = group;
      w.membrane = membrane;
      group.userData.flash = 0;
    }

    // Krwinki, wirusy, leukocyty: osobne materiały na typ, wspólna geometria.
    const rbcMat = bioMaterial({ color: 0xd31b2a, roughness: 0.38, flatShading: false }, { rim: 0xff7a68, rimStrength: 0.75 });
    const virusMat = bioMaterial({ map: models.virusMap, color: 0xb7ff7a, roughness: 0.5 }, { rim: 0x7bff5c, rimStrength: 1.15 });
    const wbcMat = bioMaterial({ map: models.wbcMap, color: 0xcfcbe0, roughness: 0.55, transparent: true, opacity: 0.68 }, { rim: 0xc8d8ff, rimStrength: 0.55 });
    for (const o of race.obstacles) {
      o.mesh = new THREE.Mesh(o.kind === 'rbc' ? models.rbc : models.virus, o.kind === 'rbc' ? rbcMat : virusMat);
      o.mesh.scale.setScalar(o.scale);
      scene.add(o.mesh);
    }
    for (const h of race.hunters) {
      h.mesh = new THREE.Mesh(models.wbc, wbcMat);
      h.mesh.userData.gulp = 0;
      scene.add(h.mesh);
    }

    // Fruktoza i hiperaktywacja.
    const fructoseGeo = new THREE.IcosahedronGeometry(0.5, 3);
    const fructoseMat = bioMaterial({ color: 0xffc14a, emissive: 0xff9a20, emissiveIntensity: 0.9, roughness: 0.25 }, { rim: 0xfff0b0, rimStrength: 2.2 });
    const hyperGeo = new THREE.OctahedronGeometry(1.05, 0);
    const hyperMat = new THREE.MeshBasicMaterial({ color: 0x9ff8ff, toneMapped: false });
    for (const p of race.pickups) {
      p.mesh = new THREE.Mesh(p.kind === 'hyper' ? hyperGeo : fructoseGeo, p.kind === 'hyper' ? hyperMat : fructoseMat);
      scene.add(p.mesh);
    }
  }

  placeMembrane(group, s) {
    const { a, t, u, r, m } = this.tmp;
    this.track.point(s, 0, 0, a);
    this.track.frame(s, t, u, r);
    // Płaszczyzna (x,y) błony = (prawo, góra) toru; (prawo, góra, -T) jest układem prawoskrętnym.
    m.makeBasis(r, u, t.negate());
    group.matrixAutoUpdate = false;
    group.matrix.copy(m);
    group.matrix.setPosition(a);
    group.matrixWorldNeedsUpdate = true;
  }

  buildEgg() {
    const { models, track } = this;
    const egg = new THREE.Group();
    const R = EGG_R;
    egg.scale.setScalar(R);

    const cyto = new THREE.Mesh(models.cytoplasm, new THREE.MeshStandardMaterial({ color: 0xffa870, roughness: 0.55, emissive: 0xff7a3c, emissiveIntensity: 0.32, fog: false }));
    cyto.renderOrder = 1;
    egg.add(cyto);

    const nucleus = new THREE.Mesh(new THREE.SphereGeometry(0.2, 24, 16), new THREE.MeshStandardMaterial({ color: 0xffe8b0, emissive: 0xffc070, emissiveIntensity: 0.8, fog: false }));
    nucleus.position.set(0.2, 0.15, 0.3);
    egg.add(nucleus);

    this.zonaMat = bioMaterial({ color: 0xa8e8ff, roughness: 0.2, transparent: true, opacity: 0.32, depthWrite: false, fog: false }, { rim: 0x8fe0ff, rimStrength: 1.4 });
    const zona = new THREE.Mesh(models.zona, this.zonaMat);
    zona.renderOrder = 2;
    egg.add(zona);

    this.coronaMat = bioMaterial({ color: 0xffdca0, roughness: 0.48, transparent: true, opacity: 0.74, depthWrite: false, fog: false }, { rim: 0xffb060, rimStrength: 1.1 });
    const corona = new THREE.Mesh(models.corona, this.coronaMat);
    corona.renderOrder = 3;
    egg.add(corona);

    // Fala reakcji korowej rozchodząca się od punktu wniknięcia.
    this.waveMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
      uniforms: { uHit: { value: new THREE.Vector3(0, 0, 1) }, uP: { value: -1 }, uHard: { value: 0 } },
      vertexShader: 'varying vec3 vN; varying vec3 vV; varying vec3 vL; void main(){ vL=normalize(position); vec4 mv=modelViewMatrix*vec4(position,1.0); vN=normalize(normalMatrix*normal); vV=normalize(-mv.xyz); gl_Position=projectionMatrix*mv; }',
      fragmentShader: 'uniform vec3 uHit; uniform float uP; uniform float uHard; varying vec3 vN; varying vec3 vV; varying vec3 vL; void main(){ float a=acos(clamp(dot(vL,uHit),-1.0,1.0))/3.14159; float dw=(a-uP)/0.035; float front=uP<0.0?0.0:exp(-dw*dw); float fres=pow(1.0-max(dot(vN,vV),0.0),2.5); float hard=uHard*step(a,uP)*(0.09+fres*0.75); vec3 c=vec3(0.65,0.92,1.0)*(front*1.5+hard)+vec3(1.0,0.72,0.42)*fres*0.5*(1.0-uHard); gl_FragColor=vec4(c,1.0); }',
    });
    egg.add(new THREE.Mesh(new THREE.SphereGeometry(1.015, 64, 48), this.waveMat));

    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: radialSprite('rgba(255,180,100,0.5)'), blending: THREE.AdditiveBlending, depthWrite: false, fog: false, transparent: true }));
    halo.scale.setScalar(4.6);
    halo.renderOrder = -1;
    egg.add(halo);
    this.halo = halo;

    track.point(track.eggS, 0, 0, egg.position);
    // Szew półkul leży poziomo względem kierunku lotu, więc gracz patrzy na pełną kopułę.
    egg.rotation.set(Math.PI / 2, 0.4, 0.2);
    this.scene.add(egg);
    this.egg = egg;

    const glow = new THREE.PointLight(0xffb070, 360, 180, 1.4);
    track.point(track.eggS - R - 8, 0, 0, glow.position);
    this.scene.add(glow);
  }

  buildParticles() {
    // Drobiny w płynie: pozycje w przestrzeni toru, zawijane wokół kamery.
    const N = 1100;
    this.motes = { N, s: new Float32Array(N), a: new Float32Array(N), r: new Float32Array(N), pos: new Float32Array(N * 3) };
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.motes.pos, 3));
    this.moteMesh = new THREE.Points(g, new THREE.PointsMaterial({
      size: 0.2, map: radialSprite('rgba(255,225,210,0.8)', 32), transparent: true, opacity: 0.42, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true,
    }));
    this.moteMesh.frustumCulled = false;
    this.scene.add(this.moteMesh);
    for (let i = 0; i < N; i++) {
      this.motes.s[i] = Math.random() * 180 - 30;
      this.motes.a[i] = Math.random() * Math.PI * 2;
      this.motes.r[i] = Math.sqrt(Math.random()) * 0.95;
    }

    // Rozbryzgi po trafieniach.
    const B = 320;
    this.bursts = { B, next: 0, life: new Float32Array(B), vel: new Float32Array(B * 3), pos: new Float32Array(B * 3), col: new Float32Array(B * 3) };
    this.bursts.pos.fill(1e6);
    const bg = new THREE.BufferGeometry();
    bg.setAttribute('position', new THREE.BufferAttribute(this.bursts.pos, 3));
    bg.setAttribute('color', new THREE.BufferAttribute(this.bursts.col, 3));
    this.burstMesh = new THREE.Points(bg, new THREE.PointsMaterial({
      size: 0.75, map: radialSprite('rgba(255,255,255,1)', 32), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
    }));
    this.burstMesh.frustumCulled = false;
    this.scene.add(this.burstMesh);
  }

  buildRacerPool() {
    this.pool = [];
    for (let i = 0; i < 20; i++) {
      const color = i === 0 ? 0xffffff : RACER_COLORS[i % RACER_COLORS.length];
      const mat = bioMaterial({ color, roughness: 0.32, emissive: color, emissiveIntensity: 0.08 }, { rim: i === 0 ? 0x8ff4ff : color, rimStrength: i === 0 ? 0.95 : 0.4, wave: true });
      const mesh = new THREE.Mesh(this.models.sperm, mat);
      mesh.scale.setScalar(9);
      mesh.frustumCulled = false;
      mesh.visible = false;
      this.scene.add(mesh);
      this.pool.push({ mesh, mat });
    }
  }

  setupComposer() {
    const target = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(this.renderer, target);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    // Pojedynczy piksel NaN rozlałby się w bloomie na pół ekranu, więc czyścimy obraz przed poświatą.
    this.composer.addPass(new ShaderPass({
      uniforms: { tDiffuse: { value: null } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: 'uniform sampler2D tDiffuse; varying vec2 vUv; void main(){ vec4 c=texture2D(tDiffuse,vUv); if(any(isnan(c))||any(isinf(c))) c=vec4(0.0,0.0,0.0,1.0); gl_FragColor=vec4(min(c.rgb,vec3(20.0)),c.a); }',
    }));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.3, 0.5, 0.92);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.useComposer = true;
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(this.pixelRatio);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ---------- Stany ----------
  makeRacers(botCount, withPlayer) {
    for (const p of this.pool) {
      p.mesh.visible = false;
      if (p.tag) { this.scene.remove(p.tag); p.tag = null; }
    }
    const racers = [];
    if (withPlayer) {
      const r = new Racer(0, t('hud.you'), true);
      r.mesh = this.pool[0].mesh; r.mat = this.pool[0].mat;
      racers.push(r);
    }
    const offset = Math.floor(Math.random() * 19);
    for (let i = 0; i < botCount; i++) {
      const p = this.pool[i + 1];
      const r = new Racer(i + 1, makeBotName(i + offset), false);
      r.mesh = p.mesh; r.mat = p.mat;
      const css = `#${p.mat.color.getHexString()}`;
      p.tag = nameTag(r.name, css);
      p.tag.visible = false;
      this.scene.add(p.tag);
      r.tag = p.tag;
      racers.push(r);
    }
    racers.forEach((r) => { r.mesh.visible = true; });
    return racers;
  }

  resetWorld() {
    this.waveMat.uniforms.uP.value = -1;
    this.waveMat.uniforms.uHard.value = 0;
    this.coronaMat.opacity = 0.74;
    this.waveAnim = null;
    for (const o of this.race.obstacles) o.mesh.visible = true;
    for (const p of this.race.pickups) p.mesh.visible = true;
  }

  startAttract() {
    this.mode = 'menu';
    this.player = null;
    this.resetWorld();
    const racers = this.makeRacers(11, false);
    this.race.setup({ racers, difficulty: DIFFICULTY.hard });
    this.race.go();
    this.attractTarget = racers[0];
    this.camS = this.attractTarget.s - 10;
    $('hud').hidden = true;
    $('touch').hidden = true;
    $('vignette').className = '';
  }

  startRace() {
    this.sound.start();
    this.mouse.active = false; // kursor stoi na przycisku; sterowanie myszą zaczyna się od jej ruchu
    this.mode = 'countdown';
    this.resetWorld();
    const racers = this.makeRacers(this.botCount, true);
    this.player = racers[0];
    this.player.autopilot = !!this.autopilot;
    this.race.setup({ racers, difficulty: DIFFICULTY[this.diff] });
    this.camS = this.player.s - 40; this.camX = 0; this.camY = 0;
    $('menu').hidden = true; $('results').hidden = true; $('pause').hidden = true;
    $('hud').hidden = false;
    $('touch').hidden = !this.coarse;
    this.buildHud();
    this.lastZone = -1;
    this.countdown = 3.4;
    this.lastCount = 4;
    $('count').hidden = false;
    this.resultsShown = false;
  }

  onWin(winner) {
    const { egg, track } = this;
    // Kierunek uderzenia w układzie lokalnym jaja.
    const { a } = this.tmp;
    track.point(winner.s, winner.x, winner.y, a);
    egg.worldToLocal(a).normalize();
    this.waveMat.uniforms.uHit.value.copy(a);
    this.waveAnim = 0;
    this.sound.harden();
    this.splash(winner, 0xfff0c0, 60);
    if (!this.player) return;
    if (winner === this.player) {
      this.sound.win();
      showToast(t('toast.winYou'), t('toast.winYouText'), 3.5);
    } else {
      this.sound.lose();
      showToast(t('toast.winOther', { name: winner.name }), t('toast.winOtherText'), 3.5);
    }
    this.mode = 'finish';
    this.finishT = 0;
    if (this.player.eatenBy) this.race.release(this.player);
  }

  showResults() {
    this.resultsShown = true;
    const { race, track, player } = this;
    const ranking = race.ranking();
    const place = ranking.indexOf(player) + 1;
    const won = race.winner === player;
    const timeStr = fmtTime(race.time - (race.afterWin || 0));
    const total = ranking.length;
    $('resultTitle').textContent = won ? t('result.win') : place <= 3 ? t('result.close', { place }) : t('result.place', { place, total });
    const leftCm = cm(track.eggS - player.finalS - EGG_R, track);
    $('resultLead').textContent = won
      ? t('result.leadWin', { time: timeStr, count: player.pickups })
      : t('result.leadLose', { cm: leftCm, name: race.winner.name, time: timeStr });

    const list = $('table');
    list.textContent = '';
    ranking.forEach((r, i) => {
      const li = document.createElement('li');
      if (r === player) li.className = 'me';
      const a = document.createElement('span');
      a.textContent = `${i + 1}. ${r.name}`;
      const b = document.createElement('span');
      b.className = 'num';
      b.textContent = r === race.winner ? timeStr : t('hud.short', { v: cm(track.eggS - r.finalS - EGG_R, track) });
      li.append(a, b);
      list.append(li);
    });
    $('fact').textContent = t(`fact.${Math.floor(Math.random() * FACT_COUNT)}`);
    if (won && !player.autopilot) {
      const key = `jzm-best-${this.diff}`;
      const prev = parseFloat(store(key));
      const elapsed = race.time - (race.afterWin || 0);
      if (!prev || elapsed < prev) store(key, String(elapsed));
    }
    this.updateBest();
    $('results').hidden = false;
    $('touch').hidden = true;
  }

  togglePause(force) {
    if (this.mode !== 'race' && this.mode !== 'paused') return;
    const pause = force ?? this.mode === 'race';
    this.mode = pause ? 'paused' : 'race';
    $('pause').hidden = !pause;
  }

  // ---------- Wejście ----------
  setupInput() {
    this.keys = new Set();
    this.mouse = { x: 0, y: 0, active: false, down: false };
    this.touch = { x: 0, y: 0, boost: false };
    this.coarse = window.matchMedia?.('(pointer: coarse)').matches;
    this.reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    const steer = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'ShiftRight']);
    window.addEventListener('keydown', (e) => {
      if (steer.has(e.code) && this.mode !== 'menu' && $('results').hidden) e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === 'KeyP' || e.code === 'Escape') this.togglePause();
      if (e.code === 'KeyM') this.sound.setMuted(!this.sound.muted);
      if (e.code === 'Space' && this.player) this.race.struggle(this.player);
      if (e.code === 'Enter' && this.mode === 'menu' && !$('startBtn').disabled && !$('menu').hidden && $('credits').hidden && document.activeElement?.tagName !== 'BUTTON') this.startRace();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => { this.keys.clear(); this.togglePause(true); });

    const canvas = $('scene');
    window.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse') return;
      this.mouse.x = (e.clientX / window.innerWidth - 0.5) * 2;
      this.mouse.y = -(e.clientY / window.innerHeight - 0.5) * 2;
      this.mouse.active = true;
    });
    canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button === 0) {
        this.mouse.down = true;
        if (this.player) this.race.struggle(this.player);
      }
    });
    window.addEventListener('pointerup', () => { this.mouse.down = false; });

    // Dotyk: gałka i przycisk zrywu.
    const stick = $('stick'), knob = $('knob');
    let stickId = null;
    const moveStick = (e) => {
      const b = stick.getBoundingClientRect();
      const dx = (e.clientX - b.left - b.width / 2) / (b.width / 2);
      const dy = (e.clientY - b.top - b.height / 2) / (b.height / 2);
      const l = Math.max(1, Math.hypot(dx, dy));
      this.touch.x = dx / l; this.touch.y = -dy / l;
      knob.style.transform = `translate(${(dx / l) * 37}px, ${(dy / l) * 37}px)`;
    };
    stick.addEventListener('pointerdown', (e) => { stickId = e.pointerId; stick.setPointerCapture(stickId); moveStick(e); });
    stick.addEventListener('pointermove', (e) => { if (e.pointerId === stickId) moveStick(e); });
    const endStick = () => { stickId = null; this.touch.x = 0; this.touch.y = 0; knob.style.transform = ''; };
    stick.addEventListener('pointerup', endStick);
    stick.addEventListener('pointercancel', endStick);
    const bb = $('boostbtn');
    bb.addEventListener('pointerdown', (e) => { e.preventDefault(); this.touch.boost = true; if (this.player) this.race.struggle(this.player); });
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) bb.addEventListener(ev, () => { this.touch.boost = false; });
  }

  readInput() {
    const k = this.keys;
    let x = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    let y = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    if (x || y) { this.mouse.active = false; } else if (this.touch.x || this.touch.y) { x = this.touch.x; y = this.touch.y; } else if (this.mouse.active) {
      // Mysz: ze strefą martwą i pełnym wychyleniem w połowie drogi do krawędzi.
      const mx = this.mouse.x * 1.9, my = this.mouse.y * 1.9;
      const l = Math.hypot(mx, my);
      if (l > 0.14) {
        const m = Math.min(1, (l - 0.14) / 0.86) / l;
        x = mx * m; y = my * m;
      }
    }
    const l = Math.hypot(x, y);
    if (l > 1) { x /= l; y /= l; }
    const boost = k.has('Space') || k.has('ShiftLeft') || k.has('ShiftRight') || this.mouse.down || this.touch.boost;
    return { x, y, boost };
  }

  // ---------- UI ----------
  setupUi() {
    this.diff = store('jzm-diff') || 'normal';
    if (!DIFFICULTY[this.diff]) this.diff = 'normal';
    this.botCount = parseInt(store('jzm-bots'), 10) || 11;
    if (![5, 11, 19].includes(this.botCount)) this.botCount = 11;
    const seg = (id, get, set) => {
      const root = $(id);
      const render = () => root.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === String(get()))));
      root.addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (b) { set(b.dataset.v); render(); this.updateBest(); }
      });
      render();
    };
    seg('diffSeg', () => this.diff, (v) => { this.diff = v; store('jzm-diff', v); });
    seg('botSeg', () => this.botCount, (v) => { this.botCount = parseInt(v, 10); store('jzm-bots', v); });
    this.updateBest();
    $('startBtn').onclick = () => this.startRace();
    $('againBtn').onclick = () => this.startRace();
    $('menuBtn').onclick = () => { $('results').hidden = true; $('menu').hidden = false; this.startAttract(); };
    $('resumeBtn').onclick = () => this.togglePause(false);
    $('quitBtn').onclick = () => { $('pause').hidden = true; $('menu').hidden = false; this.startAttract(); };
    $('creditsBtn').onclick = () => { $('credits').hidden = false; };
    $('closeCredits').onclick = () => { $('credits').hidden = true; };
  }

  setStartState(state) {
    this.startState = state;
    $('startBtn').textContent = t(`start.${state}`);
  }

  // Napisy budowane w kodzie, które trzeba odświeżyć po zmianie języka.
  refreshLanguage() {
    this.setStartState(this.startState || 'loading');
    $('langCur').textContent = langName();
    if (this.diff) this.updateBest();
  }

  updateBest() {
    const b = parseFloat(store(`jzm-best-${this.diff}`));
    $('best').textContent = b ? t('best', { level: t(`diff.${this.diff}`).toLocaleLowerCase(getLang()), time: fmtTime(b) }) : '';
  }

  buildHud() {
    const { track } = this;
    const zones = $('zones');
    zones.textContent = '';
    this.zoneEls = track.zones.map((z) => {
      const el = document.createElement('div');
      el.className = 'zone';
      el.style.flex = `${Math.min(z.to, track.eggS) - z.from} 0 0`;
      const b = document.createElement('b');
      b.textContent = t(`zone.${z.id}`);
      el.append(b);
      zones.append(el);
      return el;
    });
    const ticks = $('ticks');
    ticks.textContent = '';
    for (const r of this.race.racers) {
      const tick = document.createElement('div');
      tick.className = r === this.player ? 'tick me' : 'tick';
      ticks.append(tick);
      r.tickEl = tick;
    }
  }

  updateHud(dt) {
    this.hudTimer -= dt;
    const { player, race, track } = this;
    if (!player) return;
    // Pasek paliwa co klatkę, reszta 8 razy na sekundę.
    $('atpfill').style.transform = `scaleX(${player.energy / 100})`;
    if (this.hudTimer > 0) return;
    this.hudTimer = 0.12;
    const rank = race.ranking();
    const place = rank.indexOf(player) + 1;
    $('place').innerHTML = `${place}<small> / ${rank.length}</small>`;
    $('atpval').textContent = `${Math.round(player.energy)}%`;
    const mm = Math.max(0, (player.vs / BASE_SPEED) * 3.2);
    $('speed').textContent = t('hud.speed', { v: decimal(mm) });
    $('left').textContent = t('hud.left', { v: cm(track.eggS - player.s - EGG_R, track) });
    for (const r of race.racers) r.tickEl.style.left = `${clamp(r.s / track.eggS, 0, 1) * 100}%`;

    const board = $('board');
    const top = rank.slice(0, 5);
    if (!top.includes(player)) top[4] = player;
    board.textContent = '';
    for (const r of top) {
      const li = document.createElement('li');
      if (r === player) li.className = 'me';
      const i = document.createElement('i');
      i.className = 'num';
      i.textContent = rank.indexOf(r) + 1;
      li.append(i, document.createTextNode(r.name));
      board.append(li);
    }

    const zi = track.zoneIndex(player.s);
    if (zi !== this.lastZone) {
      this.lastZone = zi;
      this.zoneEls.forEach((el, i) => el.classList.toggle('on', i === zi));
      if (this.mode === 'race') showToast(t(`zone.${track.zones[zi].id}`), t(`hint.${track.zones[zi].id}`), 3.4);
    }

    const chips = [];
    if (player.hyper > 0) chips.push(['good', t('chip.hyper')]);
    if (player.infected > 0) chips.push(['bad', t('chip.infected')]);
    if (player.inCurrent) chips.push(['bad', t('chip.current')]);
    if (player.drafting) chips.push(['good', t('chip.draft')]);
    if (player.chased) chips.push(['bad', t('chip.chased')]);
    const key = chips.map((c) => c[1]).join('|');
    if (key !== this.chipKey) {
      this.chipKey = key;
      const st = $('status');
      st.textContent = '';
      for (const [cls, text] of chips) {
        const d = document.createElement('div');
        d.className = `chip ${cls}`;
        d.textContent = text;
        st.append(d);
      }
    }
    const v = $('vignette');
    const cls = player.eatenBy ? 'eaten' : player.hyper > 0 ? 'hyper' : player.infected > 0 ? 'sick' : player.chased ? 'chased' : '';
    if (v.className !== cls) v.className = cls;
  }

  // ---------- Efekty ----------
  splash(r, color, count) {
    const { a } = this.tmp;
    this.track.point(r.s, r.x, r.y, a);
    const c = new THREE.Color(color);
    const b = this.bursts;
    for (let i = 0; i < count; i++) {
      const j = b.next;
      b.next = (j + 1) % b.B;
      b.life[j] = 0.5 + Math.random() * 0.6;
      b.pos[j * 3] = a.x; b.pos[j * 3 + 1] = a.y; b.pos[j * 3 + 2] = a.z;
      const v = 6 + Math.random() * 14;
      const th = Math.random() * 6.283, ph = Math.acos(2 * Math.random() - 1);
      b.vel[j * 3] = Math.sin(ph) * Math.cos(th) * v;
      b.vel[j * 3 + 1] = Math.sin(ph) * Math.sin(th) * v;
      b.vel[j * 3 + 2] = Math.cos(ph) * v;
      b.col[j * 3] = c.r; b.col[j * 3 + 1] = c.g; b.col[j * 3 + 2] = c.b;
    }
  }

  updateParticles(dt, viewS) {
    const { track } = this;
    const m = this.motes;
    const { a } = this.tmp;
    const zone = track.zoneIndex(viewS);
    const flow = zone === 2 ? -22 : zone === 0 ? -5 : -2.5;
    for (let i = 0; i < m.N; i++) {
      m.s[i] += flow * dt;
      if (m.s[i] < viewS - 30) m.s[i] += 190;
      if (m.s[i] > viewS + 160) m.s[i] -= 190;
      m.a[i] += dt * 0.12;
      const s = m.s[i];
      const R = track.radius(Math.max(0, s));
      track.point(s, Math.cos(m.a[i]) * m.r[i] * R, Math.sin(m.a[i]) * m.r[i] * R, a);
      m.pos[i * 3] = a.x; m.pos[i * 3 + 1] = a.y; m.pos[i * 3 + 2] = a.z;
    }
    this.moteMesh.geometry.attributes.position.needsUpdate = true;

    const b = this.bursts;
    let any = false;
    for (let i = 0; i < b.B; i++) {
      if (b.life[i] <= 0) continue;
      any = true;
      b.life[i] -= dt;
      if (b.life[i] <= 0) { b.pos[i * 3] = 1e6; continue; }
      const d = Math.exp(-dt * 2.6);
      b.vel[i * 3] *= d; b.vel[i * 3 + 1] *= d; b.vel[i * 3 + 2] *= d;
      b.pos[i * 3] += b.vel[i * 3] * dt; b.pos[i * 3 + 1] += b.vel[i * 3 + 1] * dt; b.pos[i * 3 + 2] += b.vel[i * 3 + 2] * dt;
    }
    if (any) {
      this.burstMesh.geometry.attributes.position.needsUpdate = true;
      this.burstMesh.geometry.attributes.color.needsUpdate = true;
    }
  }

  // ---------- Synchronizacja obiektów ze stanem ----------
  syncRacers() {
    const { track, player, camera } = this;
    const { a, b, c, t, u, r: rv, m } = this.tmp;
    for (const r of this.race.racers) {
      const { mesh, mat } = r;
      const uniforms = mat.userData.uniforms;
      uniforms.uWaveT.value = r.waveT;
      uniforms.uWaveAmp.value = r.boosting || r.hyper > 0 ? 0.075 : 0.05;
      mat.emissiveIntensity = (r === player ? 0.16 : 0.07) + (r.boosting ? 0.45 : 0) + (r.hyper > 0 ? 0.9 : 0);

      track.point(r.s, r.x, r.y, mesh.position);
      track.frame(r.s, t, u, rv);
      // Kierunek płynięcia = oś toru + prędkość boczna; główka prowadzi, ogonek ciągnie się za nią.
      const speed = Math.max(10, Math.abs(r.vs));
      a.copy(t).multiplyScalar(speed).addScaledVector(rv, r.vx).addScaledVector(u, r.vy).normalize();
      b.crossVectors(u, a).normalize();
      c.crossVectors(a, b).normalize();
      m.makeBasis(b, c, a);
      mesh.quaternion.setFromRotationMatrix(m);

      if (r.tag) {
        const dist = camera.position.distanceTo(mesh.position);
        const show = !!player && dist < 48 && dist > 9 && !r.eatenBy && this.mode !== 'finish';
        r.tag.visible = show;
        if (show) {
          r.tag.position.copy(mesh.position).addScaledVector(u, 1.6);
          const k = 0.32 + dist * 0.014;
          r.tag.scale.set(6.4 * k, 1.2 * k, 1);
        }
      }
    }
  }

  syncCourse(dt, viewS) {
    const { race } = this;
    const near = (s) => s > viewS - 40 && s < viewS + 320;
    const t = this.timeU.value;
    for (const o of race.obstacles) {
      const on = near(o.s) && o.alive;
      o.mesh.visible = on;
      if (!on) continue;
      this.track.point(o.s, o.x, o.y, o.mesh.position);
      o.mesh.rotation.x = t * o.spin[0] * 0.7 + o.phase;
      o.mesh.rotation.y = t * o.spin[1] * 0.7;
    }
    for (const h of race.hunters) {
      const on = near(h.s);
      h.mesh.visible = on;
      if (!on) continue;
      this.track.point(h.s, h.x, h.y, h.mesh.position);
      h.mesh.rotation.y += dt * 0.4;
      h.mesh.rotation.z += dt * 0.27;
      h.mesh.userData.gulp = Math.max(0, h.mesh.userData.gulp - dt * 1.6);
      const hunt = h.prey ? 1.08 : 1;
      const breathe = 1 + Math.sin(t * 2 + h.phase) * 0.05 + h.mesh.userData.gulp * 0.3;
      h.mesh.scale.setScalar(h.r * hunt * breathe);
    }
    for (const p of race.pickups) {
      const on = near(p.s) && p.timer <= 0;
      p.mesh.visible = on;
      if (!on) continue;
      this.track.point(p.s, p.x, p.y, p.mesh.position);
      p.mesh.rotation.y = t * 1.6 + p.phase;
      p.mesh.rotation.x = t * 1.1;
      p.mesh.scale.setScalar(1 + Math.sin(t * 4 + p.phase) * 0.14);
    }
    for (const w of race.walls) {
      const on = near(w.s);
      w.mesh.visible = on;
      if (!on) continue;
      w.mesh.userData.flash = Math.max(0, w.mesh.userData.flash - dt * 1.8);
      w.membrane.material.emissiveIntensity = 0.16 + w.mesh.userData.flash * 1.1;
      // Błona blisko kamery rzednie, żeby nie zasłaniać widoku.
      w.membrane.material.opacity = 0.08 + 0.34 * clamp((w.s - this.camS - 5) / 40, 0, 1);
    }
  }

  updateCamera(dt) {
    const { track, camera } = this;
    const { a, b, t, u, r } = this.tmp;
    const target = this.player || this.attractTarget;
    if (!target) return;

    // Kamera wolno okrąża jajo po zakończeniu wyścigu.
    if (this.mode === 'finish' || this.mode === 'results') {
      this.finishT = (this.finishT || 0) + dt;
      const winner = this.race.winner;
      const camS = track.eggS - EGG_R - 24;
      track.frame(camS, t, u, r);
      // Powolny łuk przed jajem, cały czas wewnątrz tunelu.
      const ang = this.finishT * 0.22 + 2.2;
      const orbit = Math.min(track.radius(camS) - 3, 13);
      const wp = this.tmp.d;
      track.point(winner.s, winner.x, winner.y, wp);
      track.point(camS, Math.cos(ang) * orbit, Math.sin(ang) * orbit, a);
      camera.position.lerp(a, 1 - Math.exp(-dt * 1.6));
      camera.up.copy(u);
      b.copy(this.egg.position).lerp(wp, 0.45);
      camera.lookAt(b);
      camera.fov += (58 - camera.fov) * Math.min(1, dt * 2);
      camera.updateProjectionMatrix();
      return;
    }

    const back = this.mode === 'menu' ? 14 : 10.5 + clamp(target.vs / 60, 0, 1.2) * 2.4;
    const wantS = target.s - back;
    // Kamera w przedbiegu podjeżdża z tyłu.
    this.camS += (wantS - this.camS) * (1 - Math.exp(-dt * (this.mode === 'countdown' ? 1.2 : 9)));
    const lim = Math.max(1, track.radius(this.camS) - 2.2);
    let wx = target.x * 0.78, wy = target.y * 0.78 + 3;
    const wl = Math.hypot(wx, wy);
    if (wl > lim) { wx *= lim / wl; wy *= lim / wl; }
    const k = 1 - Math.exp(-dt * 6.5);
    this.camX += (wx - this.camX) * k;
    this.camY += (wy - this.camY) * k;

    if (this.mode === 'menu') {
      this.camX += Math.sin(this.timeU.value * 0.3) * 0.05;
      this.camY += Math.cos(this.timeU.value * 0.23) * 0.05;
    }

    track.point(this.camS, this.camX, this.camY, camera.position);
    track.frame(this.camS, t, u, r);
    camera.up.copy(u);
    track.point(target.s + 16, target.x * 0.92, target.y * 0.92 + 0.5, b);
    camera.lookAt(b);

    if (this.shake > 0.001 && !this.reducedMotion) {
      const s = this.shake * 0.34;
      camera.position.x += (Math.random() - 0.5) * s;
      camera.position.y += (Math.random() - 0.5) * s;
      camera.position.z += (Math.random() - 0.5) * s;
      this.shake *= Math.exp(-dt * 7);
    }

    const fov = 68 + clamp((target.vs - BASE_SPEED) / 40, -0.5, 1) * 16;
    camera.fov += (fov - camera.fov) * Math.min(1, dt * 4);
    camera.updateProjectionMatrix();
  }

  // ---------- Pętla ----------
  frame() {
    const now = performance.now();
    const raw = (now - this.last) / 1000;
    const dt = Math.min(0.05, raw);
    this.last = now;
    this.timeU.value += dt;
    const time = this.timeU.value;

    this.watchPerformance(raw);

    const { race, player, track } = this;

    if (this.mode === 'countdown') {
      this.countdown -= dt;
      const n = Math.ceil(this.countdown - 0.4);
      if (n !== this.lastCount && n >= 0) {
        this.lastCount = n;
        $('count').textContent = n > 0 ? String(n) : t('hud.go');
        this.sound.beep(n === 0);
      }
      if (n <= 0) {
        race.go();
        this.mode = 'race';
        window.setTimeout(() => { $('count').hidden = true; }, 500);
      }
    }

    if (this.mode === 'race' || this.mode === 'finish' || this.mode === 'results') {
      if (player && !player.autopilot && !player.finished) {
        const i = this.readInput();
        player.input.x = i.x; player.input.y = i.y; player.input.boost = i.boost;
      }
      race.update(dt);
      if (player) {
        player.chased = race.hunters.some((h) => h.prey === player && !h.hold);
        this.sound.update(clamp(player.vs / 60, 0, 1), player.boosting, player.chased || track.eggS - player.s < 200);
      }
    } else if (this.mode === 'menu') {
      race.update(dt);
      // Pokaz w menu: kamera trzyma się aktualnego lidera, a po dopłynięciu zaczyna od nowa.
      const leader = race.ranking()[0];
      if (leader && leader !== this.attractTarget && leader.s - this.attractTarget.s > 10) this.attractTarget = leader;
      if (race.winner && race.afterWin > 7) this.startAttract();
    }

    if (this.mode === 'finish') {
      if (this.finishT > 4.6 && !this.resultsShown) {
        this.mode = 'results';
        this.showResults();
      }
    }

    if (this.waveAnim !== null && this.waveAnim !== undefined) {
      this.waveAnim += dt;
      const p = Math.min(1.05, this.waveAnim / 2.2);
      this.waveMat.uniforms.uP.value = p;
      this.waveMat.uniforms.uHard.value = Math.min(1, this.waveAnim / 2.2);
      this.coronaMat.opacity = 0.74 - Math.min(1, this.waveAnim / 2.2) * 0.26;
    }

    const viewS = (player || this.attractTarget || { s: 0 }).s;
    this.syncRacers();
    this.syncCourse(dt, viewS);
    this.updateCamera(dt);
    this.updateParticles(dt, viewS);

    this.headlight.position.copy(this.camera.position);
    track.point(viewS + 26, 0, 0, this.fill.position);
    this.egg.rotation.y += dt * 0.025;
    this.halo.material.opacity = 0.75 + Math.sin(time * 1.1) * 0.08;

    if (player && this.mode !== 'results') this.updateHud(dt);
    tickToast(dt);

    if (this.useComposer) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
  }

  // Gdy klatki są zbyt wolne, gra sama obniża jakość: najpierw rozdzielczość, potem poświatę.
  watchPerformance(raw) {
    if (raw > 0.5) return;
    this.fpsSamples.push(raw);
    if (this.fpsSamples.length < 45) return;
    const avg = this.fpsSamples.reduce((a, b) => a + b, 0) / this.fpsSamples.length;
    this.fpsSamples.length = 0;
    if (avg > 1 / 38 && this.qualityLevel < 3) {
      this.qualityLevel++;
      if (this.qualityLevel === 1) this.pixelRatio = Math.min(this.pixelRatio, 1);
      if (this.qualityLevel === 2) this.pixelRatio = 0.75;
      if (this.qualityLevel === 3) this.useComposer = false;
      this.resize();
    }
  }
}

function cm(units, track) {
  return decimal((Math.max(0, units) / track.eggS) * REAL_CM);
}

function fmtTime(sec) {
  // Zaokrąglenie przed podziałem, żeby 9,96 s nie dało "0:010,0".
  const tenths = Math.round(sec * 10);
  const m = Math.floor(tenths / 600), s = (tenths - m * 600) / 10;
  return `${m}:${s < 10 ? '0' : ''}${decimal(s)}`;
}

let toastLeft = 0;
function showToast(title, text, seconds) {
  $('toastTitle').textContent = title;
  $('toastText').textContent = text;
  $('toast').style.opacity = '1';
  toastLeft = seconds;
}
function tickToast(dt) {
  if (toastLeft > 0) {
    toastLeft -= dt;
    if (toastLeft <= 0) $('toast').style.opacity = '0';
  }
}

// Wybór języka: pierwszy ekran przy pierwszej wizycie, później dostępny z menu.
function setupLanguage(game) {
  const saved = savedLang();
  setLang(saved || DEFAULT_LANG, { remember: false });
  const list = $('langList');
  for (const { code, name } of LANGS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.id = `lang-${code}`;
    b.lang = code;
    const label = document.createElement('span');
    label.textContent = name;
    const tag = document.createElement('small');
    tag.textContent = code.toUpperCase();
    b.append(label, tag);
    b.onclick = () => {
      setLang(code);
      game.refreshLanguage();
      $('lang').hidden = true;
      $('menu').hidden = false;
    };
    list.append(b);
  }
  const open = () => {
    list.querySelectorAll('button').forEach((b) => b.setAttribute('aria-current', String(b.id === `lang-${getLang()}`)));
    $('menu').hidden = true;
    $('lang').hidden = false;
    $(`lang-${getLang()}`).focus({ preventScroll: true });
  };
  $('langBtn').onclick = open;
  game.refreshLanguage();
  if (!saved) open();
}

const game = new Game();
setupLanguage(game);
game.init().catch((err) => {
  console.error(err);
  game.setStartState('failed');
  showToast(t('toast.failed'), t('toast.failedText'), 1e6);
});
