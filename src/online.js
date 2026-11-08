// Multiplayer: rooms, the lobby screens and keeping every player's race in sync.
// The host runs bots, white blood cells and the finish. Each player simulates only their own
// swimmer, sends its state to the host, and the host relays everyone's state to everyone.
import { HostRoom, ClientRoom, MAX_PLAYERS, normalizeCode, isValidCode, cleanName } from './net.js';
import { t } from './i18n.js';

const SNAP_HZ = 15;
const STATE_HZ = 20;
const DELAY = 0.12; // seconds behind the newest data, so remote swimmers move smoothly
const BOT_CHOICES = [0, 5, 11];
const r2 = (v) => Math.round(v * 100) / 100;
const $ = (id) => document.getElementById(id);

// Events a player reports about their own swimmer; the host relays them as effects.
const PLAYER_EVENTS = new Set(['mucus', 'bump', 'virus', 'smash', 'pickup', 'claim', 'release', 'bounce']);

function flagsOf(r) {
  return (r.boosting ? 1 : 0) | (r.hyper > 0 ? 2 : 0) | (r.infected > 0 ? 4 : 0) | (r.eatenBy ? 8 : 0) | (r.finished ? 16 : 0);
}

function pack(r) {
  return [r2(r.s), r2(r.x), r2(r.y), r2(r.vs), r2(r.vx), r2(r.vy), flagsOf(r)];
}

function pushSample(ent, data) {
  const buf = (ent.buf ||= []);
  buf.push({ t: performance.now() / 1000, d: data });
  if (buf.length > 10) buf.shift();
}

// Positions DELAY seconds in the past, blended between the two samples around that moment.
function interpolate(ent, at, isRacer) {
  const buf = ent.buf;
  if (!buf?.length) return;
  let v;
  const last = buf[buf.length - 1];
  if (at >= last.t) {
    const ahead = Math.min(at - last.t, 0.25);
    v = last.d.slice();
    if (isRacer) v[0] += v[3] * ahead;
  } else if (at <= buf[0].t) {
    v = buf[0].d;
  } else {
    let k = buf.length - 2;
    while (k > 0 && buf[k].t > at) k--;
    const a = buf[k], b = buf[k + 1];
    const f = (at - a.t) / Math.max(1e-3, b.t - a.t);
    v = a.d.map((x, i) => (i < 6 ? x + (b.d[i] - x) * f : x));
  }
  ent.s = v[0]; ent.x = v[1]; ent.y = v[2];
  if (isRacer) { ent.vs = v[3]; ent.vx = v[4]; ent.vy = v[5]; }
}

export class Online {
  constructor(game, store) {
    this.game = game;
    this.store = store;
    this.role = null; // 'host' | 'client' | null
    this.room = null;
    this.players = [];
    this.myId = 0;
    this.code = '';
    this.settings = { diff: 'normal', bots: 5 };
    this.inRace = false;
    this.fx = [];
    this.sendTimer = 0;
    this.setupUi();
  }

  get active() { return !!this.role; }
  get isHost() { return this.role === 'host'; }

  // ---------- Screens ----------
  setupUi() {
    const name = $('mpName');
    name.value = this.store('jzm-name') || '';
    $('mpCreate').onclick = () => this.create();
    $('mpJoin').onclick = () => this.join();
    $('mpCode').addEventListener('input', (e) => { e.target.value = normalizeCode(e.target.value); });
    $('mpCode').addEventListener('keydown', (e) => { if (e.key === 'Enter') this.join(); });
    $('mpBack').onclick = () => { $('mp').hidden = true; $('menu').hidden = false; };
    $('roomCopy').onclick = () => this.copyLink();
    $('roomStart').onclick = () => this.startRace();
    $('roomLeave').onclick = () => this.leave();

    const seg = (id, key, parse) => {
      $(id).addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (!b || !this.isHost) return;
        this.settings[key] = parse(b.dataset.v);
        this.store(key === 'diff' ? 'jzm-mp-diff' : 'jzm-mp-bots', b.dataset.v);
        this.sendLobby();
        this.renderRoom();
      });
    };
    seg('roomDiff', 'diff', (v) => v);
    seg('roomBots', 'bots', (v) => parseInt(v, 10));
  }

  openScreen(code = '') {
    $('menu').hidden = true;
    $('mp').hidden = false;
    if (code) $('mpCode').value = normalizeCode(code);
    this.setStatus('');
    this.setBusy(false);
    (code ? $('mpJoin') : $('mpCreate')).focus({ preventScroll: true });
  }

  setStatus(text, isError = false) {
    $('mpStatus').textContent = text;
    $('mpStatus').classList.toggle('error', isError);
  }

  setBusy(busy) {
    for (const id of ['mpCreate', 'mpJoin', 'mpName', 'mpCode']) $(id).disabled = busy;
  }

  readName() {
    let name = cleanName($('mpName').value);
    if (!name) {
      name = t('mp.defaultName', { n: 100 + Math.floor(Math.random() * 900) });
      $('mpName').value = name;
    }
    this.store('jzm-name', name);
    return name;
  }

  showRoom() {
    this.setStatus('');
    this.setBusy(false);
    $('mp').hidden = true;
    $('results').hidden = true;
    $('room').hidden = false;
    this.renderRoom();
  }

  renderRoom() {
    if ($('room').hidden) return;
    const host = this.isHost;
    $('roomTitle').textContent = t('mp.room', { code: this.code });
    $('roomLink').textContent = this.inviteLink();
    $('roomCount').textContent = t('mp.players', { n: this.players.length, max: MAX_PLAYERS });
    const list = $('roomPlayers');
    list.textContent = '';
    for (const p of this.players) {
      const li = document.createElement('li');
      const name = document.createElement('span');
      name.textContent = p.name;
      li.append(name);
      const tags = [];
      if (p.id === 0) tags.push(t('mp.hostTag'));
      if (p.id === this.myId) tags.push(t('mp.youTag'));
      if (tags.length) {
        const small = document.createElement('small');
        small.textContent = tags.join(', ');
        li.append(small);
      }
      if (p.id === this.myId) li.className = 'me';
      list.append(li);
    }
    $('roomHostOpts').hidden = !host;
    $('roomStart').hidden = !host;
    $('roomWait').hidden = host;
    $('roomSettings').hidden = host;
    $('roomSettings').textContent = t('mp.settings', { level: t(`diff.${this.settings.diff}`), bots: this.settings.bots });
    const mark = (id, value) => $(id).querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === String(value))));
    mark('roomDiff', this.settings.diff);
    mark('roomBots', this.settings.bots);
  }

  inviteLink() {
    return `${location.origin}${location.pathname}?room=${this.code}`;
  }

  copyLink() {
    const link = this.inviteLink();
    const done = () => { $('roomCopy').textContent = t('mp.copied'); setTimeout(() => { $('roomCopy').textContent = t('mp.copy'); }, 1800); };
    const select = () => {
      const range = document.createRange();
      range.selectNodeContents($('roomLink'));
      getSelection().removeAllRanges();
      getSelection().addRange(range);
    };
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(link).then(done, select);
    else select();
  }

  // ---------- Joining ----------
  create() {
    const name = this.readName();
    this.game.sound.start();
    this.setBusy(true);
    this.setStatus(t('mp.connecting'));
    this.role = 'host';
    this.myId = 0;
    const diff = this.store('jzm-mp-diff');
    const bots = parseInt(this.store('jzm-mp-bots'), 10);
    this.settings = { diff: ['easy', 'normal', 'hard'].includes(diff) ? diff : 'normal', bots: BOT_CHOICES.includes(bots) ? bots : 5 };
    this.room = new HostRoom(name, this.game.progress.skin, {
      onReady: (code) => { this.code = code; this.syncPlayers(); this.showRoom(); },
      onError: (kind) => this.end(kind),
      onJoin: () => { this.syncPlayers(); this.sendLobby(); this.renderRoom(); },
      onLeave: (p) => this.playerLeft(p),
      onMessage: (p, msg) => this.hostMessage(p, msg),
    });
  }

  join() {
    const code = normalizeCode($('mpCode').value);
    if (!isValidCode(code)) { this.setStatus(t('mp.errCode'), true); return; }
    const name = this.readName();
    this.game.sound.start();
    this.setBusy(true);
    this.setStatus(t('mp.connecting'));
    this.role = 'client';
    this.code = code;
    this.room = new ClientRoom(code, name, this.game.progress.skin, {
      onMessage: (msg) => this.clientMessage(msg),
      onClosed: (kind) => this.end(kind),
    });
  }

  syncPlayers() {
    this.players = this.room.players.map((p) => ({ id: p.id, name: p.name, skin: p.skin }));
  }

  sendLobby() {
    if (!this.isHost) return;
    this.room.broadcast({ t: 'lobby', players: this.players, settings: this.settings });
  }

  leave() {
    this.room?.close();
    this.reset();
    this.game.exitOnline();
  }

  // The room closed or never opened: back to the online screen with the reason.
  end(kind) {
    if (!this.role) return;
    this.room?.close();
    this.reset();
    this.game.exitOnline();
    this.openScreen($('mpCode').value);
    const key = { notFound: 'mp.errNotFound', server: 'mp.errServer', connect: 'mp.errConnect', full: 'mp.errFull', started: 'mp.errStarted', version: 'mp.errVersion', hostLeft: 'mp.hostLeft' }[kind] || 'mp.errConnect';
    this.setStatus(t(key), true);
  }

  reset() {
    this.role = null;
    this.room = null;
    this.players = [];
    this.inRace = false;
    this.fx = [];
    this.byId = null;
    $('room').hidden = true;
  }

  // ---------- Racing ----------
  // Host: builds the starting list and tells everyone to go.
  startRace() {
    if (!this.isHost || !this.room?.ready) return;
    this.syncPlayers();
    const offset = Math.floor(Math.random() * 19);
    const roster = [
      ...this.players.map((p) => ({ k: 'h', id: p.id, name: p.name, skin: p.skin })),
      ...Array.from({ length: this.settings.bots }, (_, i) => ({ k: 'b', n: i + offset })),
    ];
    this.inRace = true;
    this.room.accepting = false;
    this.game.startOnlineRace({ roster, myId: 0, diff: this.settings.diff, role: 'host' });
    this.bindRacers();
    const pos = this.game.race.racers.map((r) => [r2(r.s), r2(r.x), r2(r.y)]);
    this.room.broadcast({ t: 'start', roster, diff: this.settings.diff, pos });
  }

  bindRacers() {
    this.byId = new Map();
    for (const r of this.game.race.racers) if (r.netId !== null && r.netId !== undefined) this.byId.set(r.netId, r);
    this.fx = [];
    this.sendTimer = 0;
  }

  // Called when the results appear: the room opens again for new players.
  raceOver() {
    if (!this.isHost) return;
    this.inRace = false;
    this.room.accepting = true;
  }

  backToRoom() {
    this.raceOver();
    this.game.exitRaceToLobby();
    this.showRoom();
  }

  // Every frame, before the simulation: place remote swimmers (and, for players, the white blood cells).
  beforeUpdate() {
    if (!this.inRace) return;
    const at = performance.now() / 1000 - DELAY;
    const race = this.game.race;
    for (const r of race.racers) if (r.remote) interpolate(r, at, true);
    if (!this.isHost) for (const h of race.hunters) interpolate(h, at, false);
  }

  // Every frame, after the simulation: send what changed.
  afterUpdate(dt) {
    if (!this.inRace) return;
    this.sendTimer -= dt;
    if (this.sendTimer > 0) return;
    const race = this.game.race;
    if (this.isHost) {
      this.sendTimer = 1 / SNAP_HZ;
      this.room.broadcast({
        t: 'snap',
        r: race.racers.map(pack),
        h: race.hunters.map((h) => [r2(h.s), r2(h.x), r2(h.y), h.prey ? h.prey.index : -1]),
        o: race.obstacles.filter((o) => !o.alive).map((o) => o.id),
        p: race.pickups.filter((p) => p.timer > 0).map((p) => p.id),
        f: this.fx,
      });
      this.fx = [];
    } else {
      this.sendTimer = 1 / STATE_HZ;
      this.room.send({ t: 'st', d: pack(this.game.player) });
    }
  }

  // Hooks from the simulation, for effects the other players should see.
  event(kind, r, id = -1) {
    if (!this.inRace) return;
    if (this.isHost) {
      this.fx.push([kind, r.index, id]);
      if (kind === 'eaten' && r.remote && r.isPlayer) {
        const p = this.room.players.find((x) => x.id === r.netId);
        if (p) this.room.send(p, { t: 'eaten', h: id });
      }
      if (kind === 'win') {
        const race = this.game.race;
        this.room.broadcast({ t: 'win', r: r.index, order: race.finalOrder.map((x) => x.index), fs: race.racers.map((x) => r2(x.finalS)) });
      }
    } else if (r === this.game.player && PLAYER_EVENTS.has(kind)) {
      this.room.send({ t: 'ev', k: kind, i: id });
    }
  }

  hostMessage(player, msg) {
    const r = this.byId?.get(player.id);
    if (!r || !this.inRace || !r.remote) return;
    const race = this.game.race;
    if (msg.t === 'st' && Array.isArray(msg.d)) {
      pushSample(r, msg.d);
      const f = msg.d[6] | 0;
      r.boosting = !!(f & 1); r.hyper = f & 2 ? 1 : 0; r.infected = f & 4 ? 1 : 0;
      return;
    }
    if (msg.t !== 'ev') return;
    switch (msg.k) {
      case 'virus': {
        const o = race.obstacles[msg.i];
        if (o?.alive) { o.alive = false; o.cooldown = 16; }
        break;
      }
      case 'pickup': {
        const p = race.pickups[msg.i];
        if (p) p.timer = p.kind === 'hyper' ? 16 : 7;
        break;
      }
      case 'claim':
        if (!race.winner) race.declareWinner(r);
        return;
      case 'release':
        race.freeHunter(r);
        break;
      default:
        if (!PLAYER_EVENTS.has(msg.k)) return;
    }
    this.game.remoteFx(msg.k, r, msg.i);
    this.fx.push([msg.k, r.index, msg.i]);
  }

  clientMessage(msg) {
    const game = this.game;
    switch (msg.t) {
      case 'welcome':
        this.myId = msg.id;
        this.code = msg.code;
        this.setBusy(false);
        this.showRoom();
        break;
      case 'lobby':
        this.players = msg.players;
        this.settings = msg.settings;
        this.renderRoom();
        break;
      case 'start':
        this.inRace = true;
        $('room').hidden = true;
        game.startOnlineRace({ roster: msg.roster, myId: this.myId, diff: msg.diff, role: 'client', pos: msg.pos });
        this.bindRacers();
        break;
      case 'snap':
        if (this.inRace) this.applySnap(msg);
        break;
      case 'eaten': {
        const me = game.player;
        const h = game.race.hunters[msg.h];
        if (this.inRace && me && h && !me.eatenBy && !me.finished) {
          me.eatenBy = h;
          me.eatenT = 1.7 * (me.mods?.immune ?? 1);
          game.race.hooks.onEaten?.(me, h);
        }
        break;
      }
      case 'win': {
        const race = game.race;
        if (this.inRace && race.racers[msg.r]) race.applyWin(race.racers[msg.r], msg.order.map((i) => race.racers[i]), msg.fs);
        break;
      }
      default:
    }
  }

  applySnap(msg) {
    const { race, player } = this.game;
    msg.r.forEach((d, i) => {
      const r = race.racers[i];
      if (!r || r === player) return;
      pushSample(r, d);
      const f = d[6];
      r.boosting = !!(f & 1); r.hyper = f & 2 ? 1 : 0; r.infected = f & 4 ? 1 : 0;
      r.eatenBy = f & 8 ? true : null;
      if (f & 16) r.finished = true;
    });
    msg.h.forEach((d, i) => {
      const h = race.hunters[i];
      if (!h) return;
      pushSample(h, d);
      h.prey = d[3] >= 0 ? race.racers[d[3]] : null;
    });
    for (const id of msg.o) {
      const o = race.obstacles[id];
      if (!o) continue;
      o.alive = false;
      o.cooldown = Math.max(o.cooldown, 0.4);
    }
    for (const id of msg.p) {
      const p = race.pickups[id];
      if (p) p.timer = Math.max(p.timer, 0.4);
    }
    for (const [kind, ri, id] of msg.f) {
      const r = race.racers[ri];
      if (r && r !== player) this.game.remoteFx(kind, r, id);
    }
  }

  // A player left the room. Mid-race, a bot takes over their swimmer.
  playerLeft(p) {
    this.syncPlayers();
    this.sendLobby();
    this.renderRoom();
    const r = this.byId?.get(p.id);
    if (!r || !this.inRace) return;
    this.byId.delete(p.id);
    const race = this.game.race;
    race.freeHunter(r);
    r.remote = false;
    r.isPlayer = false;
    r.buf = null;
    r.skill = (race.difficulty.skill[0] + race.difficulty.skill[1]) / 2;
    this.game.toast(t('mp.playerLeft', { name: r.name }), '', 3);
  }
}
