// K: calibration check of the final damage model: red bird direct hit at speed v
import { createGame, addBlock, addPig, addBird, stepGame } from './game.mjs';
import { fmt, table } from './lib.mjs';
const rows = [];
const targets = [
  ['wood col 0.5x2', (g) => addBlock(g, 'wood', 3, 1, 0.5, 2)],
  ['wood plank 4x0.5 (lying, hit on its end face)', (g) => addBlock(g, 'wood', 3.0, 0.25, 4, 0.5)],
  ['wood square 1x1', (g) => addBlock(g, 'wood', 3, 0.5, 1, 1)],
  ['ice col 0.5x2', (g) => addBlock(g, 'ice', 3, 1, 0.5, 2)],
  ['stone col 0.5x2', (g) => addBlock(g, 'stone', 3, 1, 0.5, 2)],
  ['stone square 1x1', (g) => addBlock(g, 'stone', 3, 0.5, 1, 1)],
  ['TNT 1x1', (g) => addBlock(g, 'tnt', 3, 0.5, 1, 1)],
  ['pig small r0.35 hp3', (g) => addPig(g, 3, 0.35, 0.35, 3)],
  ['pig medium r0.45 hp5', (g) => addPig(g, 3, 0.45, 0.45, 5)],
  ['pig large r0.6 hp9', (g) => addPig(g, 3, 0.6, 0.6, 9)],
];
for (const [name, mk] of targets) {
  const row = { target: name };
  for (const v of [5, 8, 12, 16, 20, 24]) {
    const g = createGame();
    const t = mk(g);
    for (let i = 0; i < 60; i++) stepGame(g);
    g.damageEnabled = true;
    const yHit = name.includes('lying') ? 0.4 : name.includes('col') ? 1.2 : Math.max(0.5, (t.r || 0.5)) + 0.02;
    const half = t.r || t.w / 2;
    const bird = addBird(g, 3 - half - 0.45 - 0.3, yHit);
    bird.body.setLinearVelocity({ x: v, y: 0 });
    for (let i = 0; i < 90; i++) stepGame(g);
    row[`v=${v}`] = t.dead ? 'X' : `${fmt(100 * (1 - Math.max(0, t.hp) / t.maxHp), 0)}%`;
  }
  rows.push(row);
}
console.log('### K1: damage dealt by one red-bird hit (X = destroyed); includes secondary impacts within 1.5 s');
console.log(table(rows));
