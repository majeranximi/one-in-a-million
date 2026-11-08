// Player progression: DNA (the currency), upgrades, skins and achievements.
// Pure data and rules, with no DOM, so the logic can be tested in Node. Saved in this browser only.

export const UPGRADE_MAX = 5;
export const UPGRADES = [
  { id: 'mito', costs: [50, 100, 170, 260, 380] },
  { id: 'atp', costs: [50, 100, 170, 260, 380] },
  { id: 'tail', costs: [50, 100, 170, 260, 380] },
  { id: 'acro', costs: [50, 100, 170, 260, 380] },
  { id: 'immune', costs: [50, 100, 170, 260, 380] },
];

// pattern: 0 solid, 1 tail stripes, 2 head-to-tail gradient, 4 pulsing bands, 5 star field, 6 rainbow.
export const SKINS = [
  { id: 'classic', color: 0xffffff, color2: 0xffffff, rim: 0x8ff4ff, pattern: 0, free: true },
  { id: 'pearl', color: 0xffe2ec, color2: 0xffffff, rim: 0xffc2d8, pattern: 2, cost: 150 },
  { id: 'mint', color: 0xc4ffe6, color2: 0x45d6a0, rim: 0x9fffe0, pattern: 2, cost: 200 },
  { id: 'bubblegum', color: 0xff8fc8, color2: 0x8ff4ff, rim: 0xffb8e0, pattern: 1, cost: 300 },
  { id: 'zebra', color: 0xf2f2f2, color2: 0x1c1c1c, rim: 0xffffff, pattern: 1, cost: 400 },
  { id: 'lava', color: 0xffb347, color2: 0xd8261e, rim: 0xff6a2a, pattern: 2, glow: 0.35, cost: 500 },
  { id: 'ice', color: 0xe4f8ff, color2: 0x6fbfff, rim: 0xc8f0ff, pattern: 2, metal: 0.25, rough: 0.12, cost: 500 },
  { id: 'toxic', color: 0xa8ff40, color2: 0x235c0c, rim: 0xb8ff5a, pattern: 4, glow: 0.3, ach: 'viruses' },
  { id: 'neon', color: 0x10b8e0, color2: 0xe02ac0, rim: 0x6ff8ff, pattern: 4, glow: 0.28, rimStrength: 0.7, ach: 'hyper' },
  { id: 'shadow', color: 0x2a1219, color2: 0x0a0306, rim: 0xff3a4a, pattern: 0, rimStrength: 1.6, ach: 'untouchable' },
  { id: 'gold', color: 0xffd76a, color2: 0xb47c12, rim: 0xfff0b0, pattern: 2, metal: 0.9, rough: 0.28, ach: 'win_hard' },
  { id: 'galaxy', color: 0x7a46ff, color2: 0x0c1250, rim: 0xb08cff, pattern: 5, glow: 0.15, ach: 'veteran' },
  { id: 'rainbow', color: 0x404040, color2: 0x404040, rim: 0xffffff, pattern: 6, glow: 0.25, rimStrength: 0.5, ach: 'fashion' },
];

export const ACHIEVEMENTS = [
  { id: 'first_race', reward: 50 },
  { id: 'first_win', reward: 150 },
  { id: 'win_hard', reward: 300 },
  { id: 'win_crowd', reward: 250 },
  { id: 'clean', reward: 150 },
  { id: 'untouchable', reward: 150 },
  { id: 'flow', reward: 200 },
  { id: 'sprinter', reward: 300 },
  { id: 'comeback', reward: 250 },
  { id: 'escape', reward: 150 },
  { id: 'sugar', reward: 150 },
  { id: 'hyper', reward: 150 },
  { id: 'viruses', reward: 100 },
  { id: 'veteran', reward: 300 },
  { id: 'online', reward: 100 },
  { id: 'online_win', reward: 250 },
  { id: 'evolved', reward: 200 },
  { id: 'fashion', reward: 200 },
];

const DIFF_MUL = { easy: 0.8, normal: 1, hard: 1.4 };
const SPRINT_SECONDS = 65;
const FASHION_SKINS = 6;
const NO_MODS = Object.freeze({ speed: 1, drain: 1, regen: 1, agility: 1, resist: 1, immune: 1 });

export function newProgress() {
  const up = Object.fromEntries(UPGRADES.map((u) => [u.id, 0]));
  return { dna: 0, up, skins: [], skin: 'classic', ach: [], stats: { races: 0, wins: 0, fructose: 0, hypers: 0, escapes: 0, viruses: 0 } };
}

// Accepts whatever was saved, fixing anything missing or broken.
export function cleanProgress(raw) {
  const p = newProgress();
  if (!raw || typeof raw !== 'object') return p;
  p.dna = Math.max(0, Math.floor(Number(raw.dna) || 0));
  for (const u of UPGRADES) p.up[u.id] = Math.min(UPGRADE_MAX, Math.max(0, Math.floor(Number(raw.up?.[u.id]) || 0)));
  p.skins = Array.isArray(raw.skins) ? raw.skins.filter((id) => SKINS.some((s) => s.id === id)) : [];
  p.ach = Array.isArray(raw.ach) ? raw.ach.filter((id) => ACHIEVEMENTS.some((a) => a.id === id)) : [];
  for (const k of Object.keys(p.stats)) p.stats[k] = Math.max(0, Math.floor(Number(raw.stats?.[k]) || 0));
  p.skin = ownsSkin(p, raw.skin) ? raw.skin : 'classic';
  return p;
}

export function skinById(id) {
  return SKINS.find((s) => s.id === id) || SKINS[0];
}

export function ownsSkin(p, id) {
  const s = SKINS.find((x) => x.id === id);
  if (!s) return false;
  return !!(s.free || p.skins.includes(id) || (s.ach && p.ach.includes(s.ach)));
}

export function ownedSkinCount(p) {
  return SKINS.filter((s) => ownsSkin(p, s.id)).length;
}

export function upgradeCost(p, id) {
  const u = UPGRADES.find((x) => x.id === id);
  const level = p.up[id] || 0;
  return level >= UPGRADE_MAX ? null : u.costs[level];
}

// What the upgrades do to the player's swimmer.
export function mods(p) {
  if (!p) return NO_MODS;
  const l = (id) => p.up[id] || 0;
  return {
    speed: 1 + 0.015 * l('mito'),
    drain: 1 - 0.08 * l('atp'),
    regen: 1 + 0.12 * l('atp'),
    agility: 1 + 0.08 * l('tail'),
    resist: 1 - 0.12 * l('acro'),
    immune: 1 - 0.12 * l('immune'),
  };
}

export { NO_MODS };

function grant(p, id, unlocked) {
  if (p.ach.includes(id)) return;
  p.ach.push(id);
  const a = ACHIEVEMENTS.find((x) => x.id === id);
  p.dna += a.reward;
  unlocked.push(id);
}

// Achievements that depend on what the player owns rather than on a race.
export function checkCollection(p) {
  const unlocked = [];
  if (UPGRADES.some((u) => (p.up[u.id] || 0) >= UPGRADE_MAX)) grant(p, 'evolved', unlocked);
  if (SKINS.filter((s) => s.id !== 'rainbow' && ownsSkin(p, s.id)).length >= FASHION_SKINS) grant(p, 'fashion', unlocked);
  return unlocked;
}

export function buyUpgrade(p, id) {
  const cost = upgradeCost(p, id);
  if (cost === null || p.dna < cost) return null;
  p.dna -= cost;
  p.up[id] = (p.up[id] || 0) + 1;
  return checkCollection(p);
}

export function buySkin(p, id) {
  const s = SKINS.find((x) => x.id === id);
  if (!s || !s.cost || ownsSkin(p, id) || p.dna < s.cost) return null;
  p.dna -= s.cost;
  p.skins.push(id);
  p.skin = id;
  return checkCollection(p);
}

export function equipSkin(p, id) {
  if (!ownsSkin(p, id)) return false;
  p.skin = id;
  return true;
}

// Called once per finished race. Returns the DNA earned and anything newly unlocked.
export function finishRace(p, info) {
  const { won, place, total, diff, bots, online, humans, time, run } = info;
  const skinsBefore = SKINS.filter((s) => ownsSkin(p, s.id)).map((s) => s.id);
  const st = p.stats;
  st.races += 1;
  if (won) st.wins += 1;
  st.fructose += run.fructose;
  st.hypers += run.hypers;
  st.escapes += run.escapes;
  st.viruses += run.viruses;

  const earned = Math.round((20 + Math.max(0, total - place) * 4 + run.fructose * 2 + (won ? 60 + total * 3 : 0)) * (DIFF_MUL[diff] || 1));
  p.dna += earned;

  const unlocked = [];
  const give = (cond, id) => { if (cond) grant(p, id, unlocked); };
  give(true, 'first_race');
  give(won, 'first_win');
  give(won && diff === 'hard', 'win_hard');
  give(won && bots >= 19, 'win_crowd');
  give(run.wallPasses >= 7 && run.mucusHits === 0, 'clean');
  give(run.eaten === 0, 'untouchable');
  give(run.reachedAmpulla && run.currentTime < 3, 'flow');
  give(won && time < SPRINT_SECONDS, 'sprinter');
  give(won && run.wasLast, 'comeback');
  give(st.escapes >= 10, 'escape');
  give(st.fructose >= 50, 'sugar');
  give(st.hypers >= 5, 'hyper');
  give(st.viruses >= 10, 'viruses');
  give(st.races >= 25, 'veteran');
  give(online, 'online');
  give(online && won && humans >= 2, 'online_win');
  unlocked.push(...checkCollection(p));

  const newSkins = SKINS.filter((s) => ownsSkin(p, s.id) && !skinsBefore.includes(s.id)).map((s) => s.id);
  return { earned, unlocked, newSkins };
}
