// K4: mass-proportional threshold J0 = m*V0 and HP = k*m  (pigs per 02 masses)
import { createGame, addBlock, addPig, addBird, stepGame, MATERIALS, PIG, BIRD, BIRD_MULT, STATIC_TO_PIG_MULT, MODE } from './game.mjs';
import { fmt, table } from './lib.mjs';
import './final_cfg.mjs';
import { PIGS, pigHp } from './final_cfg.mjs';
const targets = [
  ['wood col 0.5x2', (g) => addBlock(g, 'wood', 3, 1, 0.5, 2)],
  ['wood square 1x1', (g) => addBlock(g, 'wood', 3, 0.5, 1, 1)],
  ['wood plank 4x0.5 end-on', (g) => addBlock(g, 'wood', 3.0, 0.25, 4, 0.5)],
  ['ice col 0.5x2', (g) => addBlock(g, 'ice', 3, 1, 0.5, 2)],
  ['ice square 1x1', (g) => addBlock(g, 'ice', 3, 0.5, 1, 1)],
  ['stone col 0.5x2', (g) => addBlock(g, 'stone', 3, 1, 0.5, 2)],
  ['stone square 1x1', (g) => addBlock(g, 'stone', 3, 0.5, 1, 1)],
  ['TNT 1x1', (g) => addBlock(g, 'tnt', 3, 0.5, 1, 1)],
  ...PIGS.map(([n, r, k]) => [`${n} r${r} hp${fmt(pigHp(r, k), 1)}`, (g) => addPig(g, 3, r, r, pigHp(r, k))]),
];
const rows = [];
for (const [name, mk] of targets) {
  const row = { target: name };
  for (const v of [5, 8, 12, 16, 20, 24]) {
    const g = createGame(); const t = mk(g);
    for (let i = 0; i < 60; i++) stepGame(g);
    g.damageEnabled = true;
    if (v === 5) row.hp = fmt(t.maxHp, 1), row['J0=m*V0'] = fmt(t.body.getMass() * (MODE.V0[t.mat] ?? 2), 2);
    const half = t.r || t.w / 2;
    const yHit = name.includes('end-on') ? 0.4 : name.includes('col') ? 1.2 : Math.max(0.5, (t.r || 0.5)) + 0.02;
    const bird = addBird(g, 3 - half - 0.45 - 0.3, yHit);
    bird.body.setLinearVelocity({ x: v, y: 0 });
    for (let i = 0; i < 90; i++) stepGame(g);
    row[`v=${v}`] = t.dead ? 'X' : `${fmt(100 * (1 - Math.max(0, t.hp) / t.maxHp), 0)}%`;
  }
  rows.push(row);
}
console.log('### K4: one Red hit (1.27 kg), threshold J0 = m*V0, HP = k*m');
console.log(table(rows, ['target', 'hp', 'J0=m*V0', 'v=5', 'v=8', 'v=12', 'v=16', 'v=20', 'v=24']));
const rows2 = [];
for (const [name, r, k] of PIGS) {
  const hp = pigHp(r, k);
  const row = { pig: `${name} hp ${fmt(hp, 1)}` };
  for (const h of [1, 2, 3, 4, 6]) {
    const g = createGame(); g.damageEnabled = true;
    const p = addPig(g, 0, r + h, r, hp);
    for (let i = 0; i < 180; i++) stepGame(g);
    row[`fall ${h} m`] = p.dead ? 'X' : `${fmt(100 * (1 - Math.max(0, p.hp) / p.maxHp), 0)}%`;
  }
  for (const [mat, h] of [['wood', 1], ['wood', 2], ['wood', 4], ['stone', 1], ['stone', 2]]) {
    const g = createGame();
    const p = addPig(g, 0, r, r, hp);
    for (let i = 0; i < 60; i++) stepGame(g);
    g.damageEnabled = true;
    addBlock(g, mat, 0, 2 * r + h + 0.25, 2, 0.5);
    for (let i = 0; i < 120; i++) stepGame(g);
    row[`${mat} 2x0.5 ↓${h} m`] = p.dead ? 'X' : `${fmt(100 * (1 - Math.max(0, p.hp) / p.maxHp), 0)}%`;
  }
  rows2.push(row);
}
console.log('\n### K5: pig falls (ground->pig x0.7) and 2x0.5 planks dropped on pigs, J0 = m*V0 (V0 pig = 3 m/s)');
console.log(table(rows2));
// blocks falling flat onto ground
const rows3 = [];
for (const mat of ['wood', 'ice', 'stone']) {
  const row = { block: `${mat} 2x0.5 flat` };
  for (const h of [1, 2, 4, 6]) {
    const g = createGame(); g.damageEnabled = true;
    const b = addBlock(g, mat, 0, h + 0.25, 2, 0.5);
    for (let i = 0; i < 180; i++) stepGame(g);
    row[`fall ${h} m`] = b.dead ? 'X' : `${fmt(100 * (1 - Math.max(0, b.hp) / b.maxHp), 0)}%`;
  }
  rows3.push(row);
}
console.log('\n### K6: blocks dropped flat onto ground');
console.log(table(rows3));
