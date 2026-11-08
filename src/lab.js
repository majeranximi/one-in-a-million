// The laboratory screen: spend DNA on upgrades and skins, and see achievements.
import { UPGRADES, UPGRADE_MAX, SKINS, ACHIEVEMENTS, upgradeCost, ownsSkin, buyUpgrade, buySkin, equipSkin } from './progress.js';
import { t } from './i18n.js';

const $ = (id) => document.getElementById(id);
const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;

function mixHex(a, b, f) {
  const ch = (n, s) => (n >> s) & 255;
  const m = (s) => Math.round(ch(a, s) + (ch(b, s) - ch(a, s)) * f);
  return `rgb(${m(16)},${m(8)},${m(0)})`;
}

// Colour of a skin at a point along the swimmer, 0 = head, 1 = tail tip (mirrors the shader).
function skinColorAt(s, u) {
  switch (s.pattern) {
    case 1: return u > 0.12 && Math.floor(u * 9) % 2 ? hex(s.color2) : hex(s.color);
    case 2: case 5: return mixHex(s.color, s.color2, Math.min(1, u * 1.15));
    case 4: return mixHex(s.color, s.color2, u > 0.12 ? 0.5 + 0.5 * Math.sin(u * 18) : 0);
    case 6: return `hsl(${Math.round(u * 430) % 360} 90% 62%)`;
    default: return hex(s.color);
  }
}

export function drawSkin(canvas, s) {
  const c = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  c.clearRect(0, 0, W, H);
  c.lineCap = 'round';
  c.shadowColor = hex(s.rim);
  c.shadowBlur = 6;
  const pts = [];
  for (let i = 0; i <= 64; i++) {
    const u = i / 64;
    pts.push([W * 0.26 + u * W * 0.68, H / 2 + Math.sin(u * 10) * H * 0.2 * Math.min(1, u * 1.6), u]);
  }
  for (let i = 0; i < 64; i++) {
    const [x, y, u] = pts[i], [x2, y2] = pts[i + 1];
    c.strokeStyle = skinColorAt(s, u);
    c.lineWidth = 1.4 + 4.6 * (1 - u) ** 1.5;
    c.beginPath(); c.moveTo(x, y); c.lineTo(x2, y2); c.stroke();
  }
  c.fillStyle = skinColorAt(s, 0);
  c.beginPath();
  c.ellipse(W * 0.19, H / 2, W * 0.095, H * 0.21, 0, 0, Math.PI * 2);
  c.fill();
  if (s.pattern === 5) {
    c.shadowBlur = 0;
    c.fillStyle = '#fff';
    for (const [x, y] of [[0.4, 0.42], [0.55, 0.62], [0.7, 0.4], [0.83, 0.58], [0.2, 0.44]]) c.fillRect(W * x, H * y, 1.6, 1.6);
  }
}

export class Lab {
  constructor(game) {
    this.game = game;
    this.tab = 'up';
    $('labBtn').onclick = () => this.open();
    $('labBack').onclick = () => { $('lab').hidden = true; $('menu').hidden = false; this.game.refreshMenu(); };
    $('labTabs').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (b) { this.tab = b.dataset.v; this.render(); }
    });
  }

  get p() { return this.game.progress; }

  open() {
    $('menu').hidden = true;
    $('lab').hidden = false;
    this.render();
  }

  // Saves, announces newly unlocked achievements and redraws.
  after(unlocked) {
    this.game.saveProgress();
    for (const id of unlocked || []) {
      const a = ACHIEVEMENTS.find((x) => x.id === id);
      this.game.toast(t(`ach.${id}`), t('lab.reward', { n: a.reward }), 3);
    }
    this.render();
  }

  render() {
    if ($('lab').hidden) return;
    $('labDna').textContent = t('lab.dna', { n: this.p.dna });
    $('labTabs').querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === this.tab)));
    const body = $('labBody');
    body.textContent = '';
    if (this.tab === 'up') this.renderUpgrades(body);
    else if (this.tab === 'skins') this.renderSkins(body);
    else this.renderAchievements(body);
  }

  renderUpgrades(body) {
    for (const u of UPGRADES) {
      const level = this.p.up[u.id] || 0;
      const cost = upgradeCost(this.p, u.id);
      const row = document.createElement('div');
      row.className = 'upRow';
      const text = document.createElement('div');
      text.className = 'upText';
      const name = document.createElement('b');
      name.textContent = t(`up.${u.id}`);
      const desc = document.createElement('span');
      desc.textContent = t(`up.${u.id}.d`);
      const pips = document.createElement('div');
      pips.className = 'pips';
      pips.setAttribute('aria-label', t('lab.level', { n: level, max: UPGRADE_MAX }));
      for (let i = 0; i < UPGRADE_MAX; i++) {
        const pip = document.createElement('i');
        if (i < level) pip.className = 'on';
        pips.append(pip);
      }
      text.append(name, desc, pips);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'quiet buy';
      btn.id = `up-${u.id}`;
      if (cost === null) {
        btn.textContent = t('lab.max');
        btn.disabled = true;
      } else {
        btn.textContent = t('lab.buy', { cost });
        btn.disabled = this.p.dna < cost;
        btn.onclick = () => this.after(buyUpgrade(this.p, u.id));
      }
      row.append(text, btn);
      body.append(row);
    }
  }

  renderSkins(body) {
    const grid = document.createElement('div');
    grid.className = 'skinGrid';
    for (const s of SKINS) {
      const card = document.createElement('div');
      card.className = 'skinCard';
      const owned = ownsSkin(this.p, s.id);
      const using = this.p.skin === s.id;
      if (using) card.classList.add('using');
      // Skins for sale show their colours; only achievement rewards are dimmed until earned.
      if (!owned && !s.cost) card.classList.add('locked');
      const cv = document.createElement('canvas');
      cv.width = 168; cv.height = 64;
      drawSkin(cv, s);
      const name = document.createElement('b');
      name.textContent = t(`skin.${s.id}`);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'quiet buy';
      btn.id = `skin-${s.id}`;
      if (using) {
        btn.textContent = t('lab.inUse');
        btn.disabled = true;
      } else if (owned) {
        btn.textContent = t('lab.use');
        btn.onclick = () => { equipSkin(this.p, s.id); this.after([]); };
      } else if (s.cost) {
        btn.textContent = t('lab.buySkin', { cost: s.cost });
        btn.disabled = this.p.dna < s.cost;
        btn.onclick = () => this.after(buySkin(this.p, s.id));
      } else {
        btn.textContent = t('lab.locked', { name: t(`ach.${s.ach}`) });
        btn.disabled = true;
      }
      card.append(cv, name, btn);
      grid.append(card);
    }
    body.append(grid);
  }

  renderAchievements(body) {
    const done = ACHIEVEMENTS.filter((a) => this.p.ach.includes(a.id)).length;
    const head = document.createElement('p');
    head.className = 'note';
    head.textContent = t('lab.count', { done, total: ACHIEVEMENTS.length });
    body.append(head);
    const list = document.createElement('ul');
    list.className = 'achList';
    for (const a of ACHIEVEMENTS) {
      const got = this.p.ach.includes(a.id);
      const li = document.createElement('li');
      if (got) li.className = 'got';
      const text = document.createElement('div');
      const name = document.createElement('b');
      name.textContent = t(`ach.${a.id}`);
      const desc = document.createElement('span');
      desc.textContent = t(`ach.${a.id}.d`);
      text.append(name, desc);
      const reward = document.createElement('small');
      reward.textContent = got ? t('lab.done') : t('lab.reward', { n: a.reward });
      li.append(text, reward);
      list.append(li);
    }
    body.append(list);
  }
}
