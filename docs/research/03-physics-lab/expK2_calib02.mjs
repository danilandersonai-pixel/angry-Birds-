// K2: calibration with masses/HP from 02-characters (Red 2.0 density; pigs density 0.8) and our materials
import { createGame, addBlock, addPig, addBird, stepGame, MATERIALS, PIG, BIRD, BIRD_MULT, STATIC_TO_PIG_MULT } from './game.mjs';
import { fmt, table } from './lib.mjs';
BIRD.density = 2.0; BIRD.restitution = 0.32; BIRD.friction = 0.55;
PIG.density = 0.8; PIG.jMin = 0.3; PIG.angularDamping = 3;
STATIC_TO_PIG_MULT.value = 0.7;
const STONE_HP = Number(process.argv[2] || 60);
MATERIALS.stone.hpPerM2 = STONE_HP;
BIRD_MULT.red = { wood: 1.0, ice: 1.0, stone: 0.7, tnt: 1.0, pig: 1.0 };
const targets = [
  ['wood col 0.5x2 (hp 10)', (g) => addBlock(g, 'wood', 3, 1, 0.5, 2)],
  ['wood square 1x1 (hp 10)', (g) => addBlock(g, 'wood', 3, 0.5, 1, 1)],
  ['wood plank 4x0.5 end-on (hp 20)', (g) => addBlock(g, 'wood', 3.0, 0.25, 4, 0.5)],
  ['ice col 0.5x2 (hp 4)', (g) => addBlock(g, 'ice', 3, 1, 0.5, 2)],
  ['ice square 1x1 (hp 4)', (g) => addBlock(g, 'ice', 3, 0.5, 1, 1)],
  [`stone col 0.5x2 (hp ${STONE_HP})`, (g) => addBlock(g, 'stone', 3, 1, 0.5, 2)],
  [`stone square 1x1 (hp ${STONE_HP})`, (g) => addBlock(g, 'stone', 3, 0.5, 1, 1)],
  ['TNT 1x1 (hp 3)', (g) => addBlock(g, 'tnt', 3, 0.5, 1, 1)],
  ['pig_small r0.405 0.41kg hp2', (g) => addPig(g, 3, 0.405, 0.405, 2)],
  ['pig_medium r0.6075 0.93kg hp4.5', (g) => addPig(g, 3, 0.6075, 0.6075, 4.5)],
  ['pig_large r0.8325 1.74kg hp8', (g) => addPig(g, 3, 0.8325, 0.8325, 8)],
  ['pig_king r1.17 3.44kg hp40', (g) => addPig(g, 3, 1.17, 1.17, 40)],
];
const rows = [];
for (const [name, mk] of targets) {
  const row = { target: name };
  for (const v of [5, 8, 12, 16, 20, 24]) {
    const g = createGame(); const t = mk(g);
    for (let i = 0; i < 60; i++) stepGame(g);
    g.damageEnabled = true;
    const half = t.r || t.w / 2;
    const yHit = name.includes('end-on') ? 0.4 : name.includes('col') ? 1.2 : Math.max(0.5, (t.r || 0.5)) + 0.02;
    const bird = addBird(g, 3 - half - 0.45 - 0.3, yHit);
    bird.body.setLinearVelocity({ x: v, y: 0 });
    for (let i = 0; i < 90; i++) stepGame(g);
    row[`v=${v}`] = t.dead ? 'X' : `${fmt(100 * (1 - Math.max(0, t.hp) / t.maxHp), 0)}%`;
  }
  rows.push(row);
}
console.log(`### K2: one Red hit (1.27 kg, e=0.32), masses/HP of pigs from 02, stone ${STONE_HP} hp/m2, red x stone 0.7, ground->pig 0.7`);
console.log(table(rows));
// falls for pigs from 02
const rows2 = [];
for (const [name, r, hp] of [['pig_small', 0.405, 2], ['pig_medium', 0.6075, 4.5], ['pig_large', 0.8325, 8]]) {
  const row = { pig: name };
  for (const h of [1, 2, 3, 5, 8]) {
    const g = createGame(); g.damageEnabled = true;
    const p = addPig(g, 0, r + h, r, hp);
    for (let i = 0; i < 180; i++) stepGame(g);
    row[`fall ${h} m`] = p.dead ? 'X' : `${fmt(100 * (1 - Math.max(0, p.hp) / p.maxHp), 0)}%`;
  }
  // wood plank 2x0.5 dropped on pig from 1/2/4 m, stone plank 2x0.5 from 1 m
  for (const [mat, h] of [['wood', 1], ['wood', 2], ['wood', 4], ['stone', 1]]) {
    const g = createGame();
    const p = addPig(g, 0, r, r, hp);
    for (let i = 0; i < 60; i++) stepGame(g);
    g.damageEnabled = true;
    addBlock(g, mat, 0, 2 * r + h + 0.25, 2, 0.5);
    for (let i = 0; i < 120; i++) stepGame(g);
    row[`${mat} 2x0.5 from ${h} m`] = p.dead ? 'X' : `${fmt(100 * (1 - Math.max(0, p.hp) / p.maxHp), 0)}%`;
  }
  rows2.push(row);
}
console.log('\n### K3: pig falls (ground->pig mult 0.7) and planks falling on pigs');
console.log(table(rows2));
