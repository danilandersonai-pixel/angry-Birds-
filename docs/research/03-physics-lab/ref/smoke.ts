import { PhysicsWorld } from './PhysicsWorld';
import { BLAST } from './constants';
const mult = (k: string, m: string) => (m === 'stone' ? 0.7 : 1.0);
// 1) resting stone tower: no damage after presettle + 6 s
{
  const pw = new PhysicsWorld(mult);
  pw.addStaticBox(50, -1, 300, 2);
  let y = 0; const blocks = [];
  for (let i = 0; i < 6; i++) { blocks.push(pw.addBlock('stone', 28.25, y + 1, 0.5, 2), pw.addBlock('stone', 31.75, y + 1, 0.5, 2), pw.addBlock('stone', 30, y + 2.25, 4, 0.5)); y += 2.5; }
  pw.presettle();
  pw.damageEnabled = true;
  for (let i = 0; i < 360; i++) pw.fixedStep();
  console.log('resting tower6 stone: min hp fraction =', Math.min(...blocks.map(b => b.hp / b.maxHp)).toFixed(3), 'awake:', blocks.filter(b => b.body.isAwake()).length);
}
// 2) Red 24 m/s into wood column -> destroyed; bird damping switched
{
  const pw = new PhysicsWorld(mult);
  pw.addStaticBox(50, -1, 300, 2);
  const col = pw.addBlock('wood', 3, 1, 0.5, 2);
  let destroyed = 0; pw.onDestroyed = () => destroyed++;
  pw.presettle();
  const bird = pw.launchBird('red', 1.9, 1.2, 0.45, 2.0, 0.55, 0.32, 24, 0);
  for (let i = 0; i < 60; i++) pw.fixedStep();
  console.log('red 24 m/s -> wood col: destroyed =', destroyed, 'bird linDamp =', bird.body.getLinearDamping());
}
// 3) Bomb blast in a wood tower + settle
{
  const pw = new PhysicsWorld(mult);
  pw.addStaticBox(50, -1, 300, 2);
  let y = 0;
  for (let i = 0; i < 3; i++) { pw.addBlock('wood', 26.25, y + 1, 0.5, 2); pw.addBlock('wood', 29.75, y + 1, 0.5, 2); pw.addBlock('wood', 28, y + 2.25, 4, 0.5); y += 2.5; }
  pw.addPig(28, 0.6075, 0.6075, 0.8, 6);
  let destroyed = 0; pw.onDestroyed = () => destroyed++;
  pw.presettle(); pw.damageEnabled = true;
  pw.explode({ x: 28, y: 1 }, BLAST.bomb);
  let t = 0; while (!pw.settleTick() && t < 600) { pw.fixedStep(); t++; }
  console.log('bomb in wood tower: destroyed =', destroyed, 'of 10, settle after', (t / 60).toFixed(2), 's');
}
