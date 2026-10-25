import { createGame, addBlock, addPig, addBird, stepGame, makeSettle, settleTick, DT } from './game.mjs';
import { fmt, table } from './lib.mjs';
import { pigHp } from './final_cfg.mjs';
function buildLevel(g) {
  // Tower A: 3 floors wood at x=28
  let y = 0;
  for (let i = 0; i < 3; i++) { addBlock(g, 'wood', 26.25, y + 1, 0.5, 2); addBlock(g, 'wood', 29.75, y + 1, 0.5, 2); addBlock(g, 'wood', 28, y + 2.25, 4, 0.5); y += 2.5; }
  addPig(g, 28, 2.515 + 0.6075, 0.6075, pigHp(0.6075, 6)); addPig(g, 28, 5.03 + 0.405, 0.405, pigHp(0.405, 6));
  // TNT
  addBlock(g, 'tnt', 32.5, 0.5, 1, 1);
  // Tower B: ice columns + stone beams, 2 floors at x=37
  y = 0;
  for (let i = 0; i < 2; i++) { addBlock(g, 'ice', 35.25, y + 1, 0.5, 2); addBlock(g, 'ice', 38.75, y + 1, 0.5, 2); addBlock(g, 'stone', 37, y + 2.25, 4, 0.5); y += 2.5; }
  addPig(g, 37, 0.6075, 0.6075, pigHp(0.6075, 6));
  addPig(g, 37, 5.03 + 0.8325, 0.8325, pigHp(0.8325, 7));
  addPig(g, 43, 0.405, 0.405, pigHp(0.405, 6));
}
const rows = [];
const settleTimes = [], asleepTimes = [];
for (const v of [24, 18]) {
  for (let deg = 0; deg <= 48; deg += 4) {
    const g = createGame();
    buildLevel(g);
    // pre-settle 1.5 s with damage disabled (spawn grace)
    for (let i = 0; i < 90; i++) stepGame(g);
    const nBlocks0 = [...g.entities].filter(e => e.type === 'block').length;
    g.damageEnabled = true;
    const bird = addBird(g, 0, 2.5);
    const a = deg * Math.PI / 180;
    bird.body.setLinearVelocity({ x: v * Math.cos(a), y: v * Math.sin(a) });
    const s = makeSettle({ vLin: 0.1, vAng: 0.15, hold: 0.5, maxWait: 15 });
    let tSettle = null, tAsleep = null, maxV = 0;
    for (let i = 1; i <= 15 * 60; i++) {
      stepGame(g);
      for (const e of g.entities) maxV = Math.max(maxV, e.body.getLinearVelocity().length());
      if (tSettle === null && g.firstImpactStep !== null && settleTick(s, g)) tSettle = i * DT;
      if (tAsleep === null && [...g.entities].every(e => !e.body.isAwake() || e.body.getPosition().y < -5)) tAsleep = i * DT;
      if (tSettle !== null && tAsleep !== null) break;
      if (tSettle !== null && i * DT > tSettle + 3) break;
    }
    // forced sleep after settle: freeze everything, then verify nothing creeps for 3 s
    let creep = 0, wokeUp = 0;
    if (tSettle !== null) {
      for (const e of g.entities) e.body.setAwake(false);
      const p0 = new Map([...g.entities].map(e => [e, e.body.getPosition().clone()]));
      for (let i = 0; i < 180; i++) stepGame(g);
      for (const e of g.entities) { if (e.body.isAwake()) wokeUp++; const p = e.body.getPosition(); creep = Math.max(creep, Math.hypot(p.x - p0.get(e).x, p.y - p0.get(e).y)); }
    }
    const tImpact = g.firstImpactStep !== null ? (g.firstImpactStep - 90) * DT : null;
    const destroyed = g.events.filter(e => e.type === 'blockDestroyed');
    const byMat = {}; for (const d of destroyed) byMat[d.mat] = (byMat[d.mat] || 0) + 1;
    const pigs = g.events.filter(e => e.type === 'pigKilled').length;
    if (tSettle) settleTimes.push(tSettle - tImpact);
    if (tAsleep) asleepTimes.push(tAsleep - tImpact);
    rows.push({ v, deg, tImpact_s: tImpact ? fmt(tImpact, 2) : '-', 'settle(quiet 0.5s) after impact_s': tSettle ? fmt(tSettle - tImpact, 2) : '>15', 'allAsleep after impact_s': tAsleep ? fmt(tAsleep - tImpact, 2) : '>15', destroyed: `${destroyed.length}/${nBlocks0} ${JSON.stringify(byMat).replace(/"/g, '')}`, pigsKilled: `${pigs}/5`, maxSpeed: fmt(maxV, 1), 'forced-sleep: woke/creep_mm': `${wokeUp}/${fmt(creep * 1000, 1)}` });
  }
}
console.log('### G2: mini-level with FINAL config (Red 1.27 kg, pigs from 02, J0=m*V0, HP=k*m)');
console.log(table(rows));
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
console.log(`\nsettle(quiet) after impact: median=${fmt(pct(settleTimes, 0.5), 2)} p90=${fmt(pct(settleTimes, 0.9), 2)} max=${fmt(Math.max(...settleTimes), 2)}`);
console.log(`allAsleep after impact: median=${fmt(pct(asleepTimes, 0.5), 2)} p90=${fmt(pct(asleepTimes, 0.9), 2)} max=${fmt(Math.max(...asleepTimes), 2)}`);
