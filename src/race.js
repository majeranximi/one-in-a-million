// Race simulation: swimmers, bots, obstacles. It leaves rendering to the code behind the hooks.
// Roles: 'solo' runs everything; in multiplayer the 'host' runs bots, white blood cells and the
// finish, while each 'client' simulates only its own swimmer. Racers marked `remote` are driven
// from the network (their position is set from outside) and are never stepped here.
import { EGG_R } from './track.js';
import { NO_MODS } from './progress.js';

export const BASE_SPEED = 34;
const BOOST_SPEED = 20;
const HYPER_SPEED = 26;
const CURRENT_SPEED = 13;
const DRAFT_SPEED = 6;
const LATERAL_ACCEL = 62;
const LATERAL_DAMP = 3.4;
export const RACER_RADIUS = 0.95;

export const DIFFICULTY = {
  easy: { skill: [0.8, 0.88], error: 2.2, boostUse: 0.45, help: 1 },
  normal: { skill: [0.88, 0.95], error: 1.2, boostUse: 0.7, help: 0.5 },
  hard: { skill: [0.96, 1.02], error: 0.5, boostUse: 0.95, help: 0 },
};

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

function seeded(seed) {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

export class Racer {
  constructor(index, name, isPlayer) {
    this.index = index;
    this.name = name;
    this.isPlayer = isPlayer;
    this.reset(0, 0, 0, 1);
  }

  reset(s, x, y, skill) {
    this.s = s; this.x = x; this.y = y;
    this.vs = 0; this.vx = 0; this.vy = 0;
    this.skill = skill;
    this.energy = 100;
    this.input = { x: 0, y: 0, boost: false };
    this.boosting = false; this.drafting = false; this.inCurrent = false;
    this.slow = 0; this.infected = 0; this.hyper = 0; this.wbcCooldown = 0;
    this.eatenBy = null; this.eatenT = 0;
    this.finished = false; this.place = 0; this.finishTime = 0; this.blocked = 0;
    this.waveT = Math.random() * 6;
    this.pickups = 0;
    // Bot
    this.lane = Math.random() * Math.PI * 2;
    this.laneR = 0.2 + Math.random() * 0.55;
    this.think = Math.random() * 0.1;
    this.tx = 0; this.ty = 0;
    this.burst = 0; this.burstCheck = Math.random() * 2;
    this.aimError = [Math.random() - 0.5, Math.random() - 0.5];
  }
}

export class Race {
  constructor(track, hooks = {}) {
    this.track = track;
    this.hooks = hooks;
    this.racers = [];
    this.buildCourse();
    this.state = 'idle';
    this.time = 0;
    this.winner = null;
    this.difficulty = DIFFICULTY.normal;
  }

  buildCourse() {
    const { track } = this;
    const rnd = seeded(20261106);
    const z = track.zones;
    const spot = (s, frac = 0.85) => {
      const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * track.maxRadius(s) * frac;
      return [Math.cos(a) * r, Math.sin(a) * r];
    };

    // Cervical mucus: a membrane with one or two holes.
    this.walls = [];
    const wallCount = 7;
    for (let i = 0; i < wallCount; i++) {
      const s = 110 + ((z[0].to - 170) * i) / (wallCount - 1);
      const R = track.maxRadius(s);
      const holes = [];
      const n = i >= 4 ? 1 : 2;
      const first = rnd() * Math.PI * 2;
      for (let h = 0; h < n; h++) {
        // Two holes sit opposite each other and never overlap.
        const a = first + h * Math.PI;
        const r = R * (0.42 + rnd() * 0.16);
        holes.push({ x: Math.cos(a) * r, y: Math.sin(a) * r, r: 2.9 });
      }
      this.walls.push({ s, holes });
    }

    // Red blood cells: drifting obstacles, densest in the uterus.
    this.obstacles = [];
    const addRbc = (from, to, count) => {
      for (let i = 0; i < count; i++) {
        const s = from + rnd() * (to - from);
        const [x, y] = spot(s);
        const scale = 1.7 + rnd() * 1.4;
        this.obstacles.push({ kind: 'rbc', s, x, y, r: scale * 0.88, scale, x0: x, y0: y, phase: rnd() * 6.28, alive: true, cooldown: 0, spin: [rnd() - 0.5, rnd() - 0.5] });
      }
    };
    addRbc(z[1].from + 40, z[1].to - 30, 72);
    addRbc(z[0].from + 200, z[0].to, 8);
    addRbc(z[2].from, z[2].to, 10);
    addRbc(z[3].from, track.eggS - 60, 14);

    // Viruses: slow you down and block bursts. In the fallopian tube they lurk near the walls, on the fast line.
    const addVirus = (from, to, count, wall) => {
      for (let i = 0; i < count; i++) {
        const s = from + rnd() * (to - from);
        const R = track.maxRadius(s);
        const a = rnd() * Math.PI * 2;
        const r = wall ? R * (0.66 + rnd() * 0.3) : Math.sqrt(rnd()) * R * 0.85;
        const scale = 1.05 + rnd() * 0.5;
        this.obstacles.push({ kind: 'virus', s, x: Math.cos(a) * r, y: Math.sin(a) * r, r: scale, scale, x0: Math.cos(a) * r, y0: Math.sin(a) * r, phase: rnd() * 6.28, alive: true, cooldown: 0, spin: [rnd() - 0.5, rnd() - 0.5] });
      }
    };
    addVirus(z[2].from + 30, z[2].to, 44, true);
    addVirus(z[1].from + 50, z[1].to, 14, false);
    addVirus(z[3].from + 20, track.eggS - 70, 12, false);
    this.obstacles.sort((a, b) => a.s - b.s);

    // White blood cells hunt the swimmers.
    this.hunters = [];
    const addHunter = (s, wide) => {
      const R = track.maxRadius(s);
      const a = rnd() * 6.28, r = rnd() * R * 0.5;
      this.hunters.push({ s, x: Math.cos(a) * r, y: Math.sin(a) * r, home: s, wide, phase: rnd() * 6.28, r: 3.6, sated: 0, prey: null, hold: null });
    };
    for (let i = 0; i < 12; i++) addHunter(z[1].from + 55 + ((z[1].to - z[1].from - 110) * i) / 11, true);
    addHunter(z[0].to - 90, false);
    addHunter(z[2].from + 170, false);
    addHunter(z[2].from + 480, false);
    addHunter(z[3].from + 110, true);
    addHunter(z[3].from + 240, true);
    for (const h of this.hunters) { h.x0 = h.x; h.y0 = h.y; h.s0 = h.s; }

    // Fructose (fuel) and the rare hyperactivation.
    this.pickups = [];
    const addPickup = (s, x, y, kind) => this.pickups.push({ s, x, y, kind, timer: 0, phase: rnd() * 6.28 });
    for (let s = 70; s < track.eggS - 60; s += 26 + rnd() * 26) {
      const [x, y] = spot(s, 0.8);
      const zone = track.zoneIndex(s);
      // In the fallopian tube fuel sits near the wall, to reward the fast line.
      if (zone === 2) {
        const a = rnd() * 6.28, R = track.maxRadius(s) * 0.76;
        addPickup(s, Math.cos(a) * R, Math.sin(a) * R, 'fructose');
      } else addPickup(s, x, y, 'fructose');
    }
    for (const s of [z[0].to + 90, z[1].to - 120, z[2].from + 340, z[3].from + 40, track.eggS - 130]) {
      const [x, y] = spot(s, 0.55);
      addPickup(s, x, y, 'hyper');
    }
    this.pickups.sort((a, b) => a.s - b.s);

    // Stable ids, shared by every player in a multiplayer race.
    this.obstacles.forEach((o, i) => { o.id = i; });
    this.pickups.forEach((p, i) => { p.id = i; });
    this.hunters.forEach((h, i) => { h.id = i; });
  }

  setup({ racers, difficulty, role = 'solo', rubber = true }) {
    this.racers = racers;
    this.difficulty = difficulty;
    this.role = role;
    this.rubber = rubber;
    this.time = 0;
    this.winner = null;
    this.finalOrder = null;
    this.state = 'countdown';
    this.afterWin = 0;

    const n = racers.length;
    const order = racers.slice().sort((a, b) => (a.isPlayer ? 1 : 0) - (b.isPlayer ? 1 : 0));
    order.forEach((r, i) => {
      const row = Math.floor(i / 4), col = i % 4;
      const a = (col / 4) * Math.PI * 2 + row * 0.8 + 0.5;
      const rad = 3.3 + (row % 2) * 2.2;
      const skill = r.isPlayer ? 1 : difficulty.skill[0] + Math.random() * (difficulty.skill[1] - difficulty.skill[0]);
      r.reset(62 - row * 5, Math.cos(a) * rad, Math.sin(a) * rad, skill);
    });
    this.count = n;

    for (const o of this.obstacles) { o.alive = true; o.cooldown = 0; o.x = o.x0; o.y = o.y0; }
    for (const h of this.hunters) { h.s = h.s0; h.x = h.x0; h.y = h.y0; h.sated = 0; h.prey = null; h.hold = null; }
    for (const p of this.pickups) p.timer = 0;
  }

  go() { this.state = 'racing'; }

  ranking() {
    if (this.finalOrder) return this.finalOrder;
    return this.racers.slice().sort((a, b) => {
      if (a.finished !== b.finished) return a.finished ? -1 : 1;
      return b.s - a.s;
    });
  }

  update(dt) {
    if (this.state === 'countdown' || this.state === 'idle') return;
    this.time += dt;
    this.updateObstacles(dt);
    if (this.role !== 'client') this.updateHunters(dt);
    for (const r of this.racers) {
      if (r.remote) { this.proxyTick(r, dt); continue; }
      if (!r.isPlayer || r.autopilot) this.botThink(r, dt);
      this.step(r, dt);
    }
    this.collideRacers();
    if (this.state === 'won') {
      this.afterWin += dt;
    }
  }

  // A swimmer moved by the network: only its tail animation and, on the host, a safety release.
  proxyTick(r, dt) {
    r.waveT += dt * (5 + Math.abs(r.vs) * 0.44 + (r.boosting ? 8 : 0));
    if (this.role === 'host' && r.eatenBy) {
      r.eatenT -= dt;
      // The player's own release message normally arrives first; this covers a lost one.
      if (r.eatenT < -2) this.freeHunter(r);
    }
  }

  step(r, dt) {
    const { track } = this;
    r.wbcCooldown = Math.max(0, r.wbcCooldown - dt);
    r.slow = Math.max(0, r.slow - dt);
    r.infected = Math.max(0, r.infected - dt);
    r.hyper = Math.max(0, r.hyper - dt);
    r.blocked = Math.max(0, r.blocked - dt);

    if (r.finished) {
      // The winner slowly enters through the egg's layers while the tail beats slower and slower.
      const ds = track.eggS - r.s;
      if (Math.hypot(ds, r.x, r.y) > EGG_R * 0.62) {
        const k = 1 - dt * 0.22;
        r.s = track.eggS - ds * k;
        r.x *= k; r.y *= k;
      }
      r.vs *= Math.exp(-dt * 4);
      r.waveT += dt * Math.max(1.5, 18 - this.afterWin * 4);
      return;
    }

    if (r.eatenBy) {
      const h = r.eatenBy;
      r.eatenT -= dt;
      r.s = h.s; r.x = h.x + Math.sin(this.time * 7 + r.index) * 0.9; r.y = h.y + Math.cos(this.time * 6 + r.index) * 0.9;
      r.vs = 0; r.vx = 0; r.vy = 0;
      r.waveT += dt * 20;
      r.boosting = false;
      if (r.eatenT <= 0) this.release(r);
      return;
    }

    const prevS = r.s;
    const zone = track.zoneIndex(r.s);
    const R = track.maxRadius(r.s);
    const lat = Math.hypot(r.x, r.y);

    // Upgrades bought in the laboratory (only the local player has them).
    const m = r.mods || NO_MODS;
    r.boosting = r.input.boost && r.energy > 0 && r.infected <= 0;
    if (r.boosting) r.energy = Math.max(0, r.energy - 27 * m.drain * dt);
    else r.energy = Math.min(100, r.energy + 3.5 * m.regen * dt);

    let target = BASE_SPEED * r.skill * m.speed;
    if (r.boosting) target += BOOST_SPEED;
    if (r.hyper > 0) target += HYPER_SPEED;

    // Ciliary current: strong in the middle of the fallopian tube, almost none near the wall.
    r.inCurrent = false;
    if (zone === 2 && r.hyper <= 0) {
      const c = 1 - clamp(lat / R, 0, 1);
      const push = clamp((c - 0.14) / 0.3, 0, 1);
      target -= CURRENT_SPEED * push;
      r.inCurrent = push > 0.35;
    }

    // Slipstream behind another swimmer.
    r.drafting = false;
    for (const o of this.racers) {
      if (o === r || o.finished || o.eatenBy) continue;
      const gap = o.s - r.s;
      if (gap > 1.5 && gap < 11 && Math.hypot(o.x - r.x, o.y - r.y) < 2.6) { r.drafting = true; break; }
    }
    if (r.drafting) target += DRAFT_SPEED;

    if (r.slow > 0) target *= 0.42;
    if (r.infected > 0) target *= 0.68;

    if (!r.isPlayer) target *= this.rubberBand(r);

    r.vs += (target - r.vs) * Math.min(1, dt * (target > r.vs ? 1.7 : 2.6));
    r.s += r.vs * dt;

    r.vx += r.input.x * LATERAL_ACCEL * m.agility * dt;
    r.vy += r.input.y * LATERAL_ACCEL * m.agility * dt;
    const damp = Math.exp(-dt * LATERAL_DAMP);
    r.vx *= damp; r.vy *= damp;
    r.x += r.vx * dt; r.y += r.vy * dt;

    r.waveT += dt * (5 + Math.abs(r.vs) * 0.44 + (r.boosting ? 8 : 0));

    // Track wall.
    const rm = track.maxRadius(r.s);
    const l2 = Math.hypot(r.x, r.y);
    if (l2 > rm) {
      const nx = r.x / l2, ny = r.y / l2;
      r.x = nx * rm; r.y = ny * rm;
      const vn = r.vx * nx + r.vy * ny;
      if (vn > 0) {
        r.vx -= nx * vn * 1.4; r.vy -= ny * vn * 1.4;
        if (vn > 6) {
          r.vs *= 0.965;
          this.hooks.onWall?.(r);
        }
      }
    }

    this.crossWalls(r, prevS);
    this.touchObstacles(r);
    this.touchPickups(r);
    this.touchEgg(r);
    if (r.s < 3) r.s = 3;
  }

  // Gentle balancing: bots far behind the player catch up, bots far ahead ease off.
  rubberBand(r) {
    const player = this.racers.find((p) => p.isPlayer);
    if (!this.rubber || !player || !this.difficulty.help) return 1;
    const gap = r.s - player.s;
    const k = this.difficulty.help;
    if (gap > 60) return 1 - 0.1 * k * clamp((gap - 60) / 120, 0, 1);
    if (gap < -90) return 1 + 0.06 * k * clamp((-gap - 90) / 120, 0, 1);
    return 1;
  }

  crossWalls(r, prevS) {
    for (const w of this.walls) {
      if (prevS < w.s && r.s >= w.s) {
        const through = w.holes.some((h) => Math.hypot(r.x - h.x, r.y - h.y) < h.r);
        if (!through && r.hyper <= 0) {
          const resist = (r.mods || NO_MODS).resist;
          r.slow = 1.25 * resist;
          r.vs *= 1 - 0.5 * resist;
          this.hooks.onMucus?.(r, w);
        } else this.hooks.onHole?.(r, w);
      }
    }
  }

  windowStart(list, s) {
    let lo = 0, hi = list.length;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (list[m].s < s) lo = m + 1; else hi = m;
    }
    return lo;
  }

  touchObstacles(r) {
    const list = this.obstacles;
    for (let i = this.windowStart(list, r.s - 5); i < list.length && list[i].s < r.s + 5; i++) {
      const o = list[i];
      if (!o.alive || o.cooldown > 0) continue;
      const dx = r.x - o.x, dy = r.y - o.y, ds = r.s - o.s;
      const d = Math.hypot(dx, dy, ds);
      const hit = o.r + RACER_RADIUS * 0.7;
      if (d >= hit) continue;
      if (r.hyper > 0) { o.cooldown = 1.2; this.hooks.onSmash?.(r, o); continue; }
      if (o.kind === 'virus') {
        o.alive = false;
        o.cooldown = 16;
        r.infected = 3.2 * (r.mods || NO_MODS).immune;
        this.hooks.onVirus?.(r, o);
      } else {
        const lat = Math.hypot(dx, dy) || 1;
        r.vx += (dx / lat) * 11; r.vy += (dy / lat) * 11;
        r.vs *= 1 - 0.38 * (r.mods || NO_MODS).resist;
        o.cooldown = 1;
        this.hooks.onBump?.(r, o);
      }
    }
  }

  touchPickups(r) {
    const list = this.pickups;
    for (let i = this.windowStart(list, r.s - 3); i < list.length && list[i].s < r.s + 3; i++) {
      const p = list[i];
      if (p.timer > 0) continue;
      if (Math.hypot(r.x - p.x, r.y - p.y, r.s - p.s) < 2.2) {
        p.timer = p.kind === 'hyper' ? 16 : 7;
        r.pickups++;
        if (p.kind === 'hyper') { r.hyper = 3.6; r.energy = 100; r.infected = 0; } else r.energy = Math.min(100, r.energy + 26);
        this.hooks.onPickup?.(r, p);
      }
    }
  }

  touchEgg(r) {
    const { track } = this;
    const ds = track.eggS - r.s;
    const lat = Math.hypot(r.x, r.y);
    // Funnel in front of the egg: it cannot be passed on the side.
    if (ds < 50) {
      const lim = EGG_R * 0.85 + Math.max(0, ds) * 0.32;
      if (lat > lim) { r.x *= lim / lat; r.y *= lim / lat; }
    }
    const d = Math.hypot(ds, lat);
    if (d > EGG_R + 0.5) return;
    if (!this.winner) {
      // A client cannot decide who won: it asks the host and waits at the shell for the answer.
      if (this.role === 'client') {
        if (!r.claimed) { r.claimed = true; this.hooks.onClaim?.(r); }
      } else this.declareWinner(r);
    } else if (!r.finished && r.blocked <= 0) {
      // Cortical reaction: the shell is already hard, so latecomers bounce off.
      r.blocked = 0.5;
      r.vs = -22;
      this.hooks.onBounced?.(r);
    }
    if (!r.finished) {
      const k = (EGG_R + 0.6) / (d || 1);
      r.s = track.eggS - ds * k;
      r.x *= k; r.y *= k;
    }
  }

  declareWinner(r) {
    // Order and distances are frozen at the moment of victory; everyone reaches the shell later anyway.
    const order = this.racers.slice().sort((a, b) => (a === r ? -1 : b === r ? 1 : b.s - a.s));
    this.applyWin(r, order, this.racers.map((x) => x.s));
  }

  applyWin(r, order, finalS) {
    if (this.winner) return;
    this.winner = r;
    r.finished = true;
    r.place = 1;
    r.finishTime = this.time;
    this.state = 'won';
    this.afterWin = 0;
    this.finalOrder = order;
    this.racers.forEach((x, i) => { x.finalS = finalS[i]; });
    this.hooks.onWin?.(r);
  }

  collideRacers() {
    const rs = this.racers;
    for (let i = 0; i < rs.length; i++) {
      const a = rs[i];
      if (a.finished || a.eatenBy) continue;
      for (let j = i + 1; j < rs.length; j++) {
        const b = rs[j];
        if (b.finished || b.eatenBy || (a.remote && b.remote)) continue;
        const ds = a.s - b.s;
        if (Math.abs(ds) > RACER_RADIUS * 2) continue;
        const dx = a.x - b.x, dy = a.y - b.y;
        const d = Math.hypot(dx, dy, ds);
        if (d >= RACER_RADIUS * 2 || d < 1e-4) continue;
        const push = (RACER_RADIUS * 2 - d) / d;
        // A network-driven swimmer cannot be moved here, so the other one takes the whole push.
        const wa = a.remote ? 0 : b.remote ? 1 : 0.5, wb = b.remote ? 0 : a.remote ? 1 : 0.5;
        a.x += dx * push * wa; a.y += dy * push * wa;
        b.x -= dx * push * wb; b.y -= dy * push * wb;
        const lat = Math.hypot(dx, dy) || 1;
        const kick = 4.4;
        a.vx += (dx / lat) * kick * wa; a.vy += (dy / lat) * kick * wa;
        b.vx -= (dx / lat) * kick * wb; b.vy -= (dy / lat) * kick * wb;
        if (a.isPlayer || b.isPlayer) this.hooks.onNudge?.();
      }
    }
  }

  updateObstacles(dt) {
    const t = this.time;
    for (const o of this.obstacles) {
      if (o.cooldown > 0) {
        o.cooldown -= dt;
        if (o.cooldown <= 0) o.alive = true;
      }
      o.x = o.x0 + Math.sin(t * 0.5 + o.phase) * 1.3;
      o.y = o.y0 + Math.cos(t * 0.42 + o.phase) * 1.3;
    }
    for (const p of this.pickups) if (p.timer > 0) p.timer -= dt;
  }

  updateHunters(dt) {
    const { track } = this;
    for (const h of this.hunters) {
      h.sated = Math.max(0, h.sated - dt);
      if (h.hold) continue;

      let prey = null, best = 1e9;
      if (h.sated <= 0) {
        for (const r of this.racers) {
          if (r.finished || r.eatenBy || r.wbcCooldown > 0 || r.hyper > 0) continue;
          const ds = r.s - h.s;
          if (ds < -14 || ds > 46) continue;
          const d = Math.hypot(ds, r.x - h.x, r.y - h.y);
          if (d < best) { best = d; prey = r; }
        }
      }
      h.prey = prey;
      if (prey) {
        // Chase: fast sideways, but slower than a swimmer along the track, so escape is possible.
        const lateral = h.wide ? 15 : 11;
        const dx = prey.x - h.x, dy = prey.y - h.y, l = Math.hypot(dx, dy) || 1;
        const st = Math.min(lateral * dt, l);
        h.x += (dx / l) * st; h.y += (dy / l) * st;
        const ds = prey.s - h.s;
        h.s += clamp(ds, -18, 18) * dt * (h.wide ? 1 : 0.7);
        if (best < h.r + RACER_RADIUS * 0.7) {
          h.hold = prey;
          prey.eatenBy = h;
          prey.eatenT = 1.7 * (prey.mods || NO_MODS).immune;
          this.hooks.onEaten?.(prey, h);
        }
      } else {
        // Patrol around its post.
        const t = this.time * 0.35 + h.phase;
        const R = track.maxRadius(h.s) * (h.wide ? 0.55 : 0.3);
        const gx = Math.cos(t) * R, gy = Math.sin(t * 1.3) * R;
        h.x += (gx - h.x) * dt * 0.6; h.y += (gy - h.y) * dt * 0.6;
        h.s += (h.home - h.s) * dt * 0.35;
      }
      const R2 = Math.max(1, track.radius(h.s) - h.r * 0.8);
      const lh = Math.hypot(h.x, h.y);
      if (lh > R2) { h.x *= R2 / lh; h.y *= R2 / lh; }
    }
  }

  // Ends a hold without moving the swimmer (the host uses it for players on other devices).
  freeHunter(r) {
    const h = r.eatenBy;
    if (!h) return;
    if (h.hold !== undefined) { h.hold = null; h.sated = 7; }
    r.eatenBy = null;
    r.wbcCooldown = 7;
  }

  release(r) {
    const h = r.eatenBy;
    if (h) { h.hold = null; h.sated = 7; }
    r.eatenBy = null;
    r.wbcCooldown = 7;
    r.s = h.s + h.r + 1.2;
    r.vs = 16;
    this.hooks.onReleased?.(r);
  }

  // The player can escape a white blood cell faster by tapping burst.
  struggle(r) {
    if (r.eatenBy) r.eatenT -= 0.16;
  }

  // ---------- BOTS ----------
  botThink(r, dt) {
    if (r.finished || r.eatenBy) { r.input.x = 0; r.input.y = 0; r.input.boost = false; return; }
    const { difficulty } = this;
    r.think -= dt;
    if (r.think <= 0) {
      r.think = 0.09;
      this.planBot(r, difficulty);
    }
    const ax = (r.tx - r.x) * 0.55 - r.vx * 0.2;
    const ay = (r.ty - r.y) * 0.55 - r.vy * 0.2;
    const l = Math.hypot(ax, ay);
    const k = l > 1 ? 1 / l : 1;
    r.input.x = ax * k;
    r.input.y = ay * k;
  }

  planBot(r, difficulty) {
    const { track } = this;
    const look = 8 + Math.max(10, r.vs) * 1.4;
    const zone = track.zoneIndex(r.s + 10);
    const R = track.maxRadius(r.s + look * 0.6);
    const err = difficulty.error;

    // Lane: each bot keeps its own slowly shifting line.
    r.lane += 0.02 * Math.sin(r.index + this.time * 0.3);
    let lf = r.laneR;
    if (zone === 2) lf = 0.72 + 0.14 * Math.sin(r.index * 1.7 + this.time * 0.2) - err * 0.05;
    let tx = Math.cos(r.lane) * R * lf;
    let ty = Math.sin(r.lane) * R * lf;

    // In the ampulla, head for the egg.
    const toEgg = track.eggS - r.s;
    if (toEgg < 150) {
      const f = clamp(1 - toEgg / 150, 0, 1);
      tx *= 1 - f; ty *= 1 - f;
    }

    // Mucus: aim for the nearest hole.
    let targetLocked = false;
    for (const w of this.walls) {
      const ds = w.s - r.s;
      if (ds > 0 && ds < look + 28) {
        let best = null, bd = 1e9;
        for (const h of w.holes) {
          const d = Math.hypot(h.x - r.x, h.y - r.y);
          if (d < bd) { bd = d; best = h; }
        }
        tx = best.x + r.aimError[0] * err * 3.2;
        ty = best.y + r.aimError[1] * err * 3.2;
        targetLocked = true;
        break;
      }
    }

    // Fuel: turn towards it if it is close to the line.
    if (!targetLocked && r.energy < 80) {
      const list = this.pickups;
      let best = null, bs = 1e9;
      for (let i = this.windowStart(list, r.s + 4); i < list.length && list[i].s < r.s + look + 8; i++) {
        const p = list[i];
        if (p.timer > 0) continue;
        const d = Math.hypot(p.x - r.x, p.y - r.y);
        const reach = (p.s - r.s) * 0.34 + (p.kind === 'hyper' ? 6 : 1);
        if (d < reach && d < bs) { bs = d; best = p; }
      }
      if (best) { tx = best.x; ty = best.y; }
    }

    // Avoidance: push the target away from whatever is on course.
    let danger = 0;
    const avoid = (ox, oy, rad, ds) => {
      const t = clamp(ds / look, 0, 1);
      const px = r.x + (tx - r.x) * t, py = r.y + (ty - r.y) * t;
      const dx = px - ox, dy = py - oy;
      const d = Math.hypot(dx, dy) || 0.01;
      const safe = rad + 2.1 - err * 0.45;
      if (d < safe) {
        const force = (safe - d) * 2.2;
        tx += (dx / d) * force; ty += (dy / d) * force;
        danger = Math.max(danger, 1 - ds / look);
      }
    };
    const list = this.obstacles;
    for (let i = this.windowStart(list, r.s); i < list.length && list[i].s < r.s + look; i++) {
      const o = list[i];
      if (o.alive && o.cooldown <= 0) avoid(o.x, o.y, o.r, o.s - r.s);
    }
    let chased = false;
    for (const h of this.hunters) {
      const ds = h.s - r.s;
      if (h.hold || h.sated > 0) continue;
      if (ds > -10 && ds < look + 16) {
        avoid(h.x, h.y, h.r + 2.2, Math.max(0, ds));
        if (h.prey === r) chased = true;
      }
    }

    const rm = track.maxRadius(r.s + 6) * 0.95;
    const tl = Math.hypot(tx, ty);
    if (tl > rm) { tx *= rm / tl; ty *= rm / tl; }
    r.tx = tx; r.ty = ty;

    // Boosting: short bursts, an all-out finish, and escaping from white blood cells.
    r.burstCheck -= 0.09;
    if (r.burstCheck <= 0) {
      r.burstCheck = 1 + Math.random() * 2;
      const use = difficulty.boostUse;
      r.burst = r.energy > 45 && Math.random() < use * 0.65 ? 1.2 + Math.random() * 1.6 : 0;
    }
    r.burst = Math.max(0, r.burst - 0.09);
    const finalSprint = toEgg < 170 && r.energy > 3;
    r.input.boost = (r.burst > 0 || finalSprint || (chased && r.energy > 10)) && danger < 0.75;
  }
}
