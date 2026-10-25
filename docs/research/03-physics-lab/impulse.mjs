// Impulse tracker: records per-contact, per-step normal impulse (sum over manifold points),
// separated into regular solver and TOI solver contributions, plus approach speed from pre-solve.
export function attachTracker(world) {
  const T = {
    stepIndex: 0,
    inTOI: false,
    // key -> { a, b, steps: Map(step -> {reg, toi, maxPoint}), vApproach, firstStep }
    contacts: new Map(),
    events: [], // flat list of {step, key, J, toi}
  };
  const solver = world.m_solver;
  const origTOI = solver.solveWorldTOI.bind(solver);
  solver.solveWorldTOI = (step) => { T.inTOI = true; try { origTOI(step); } finally { T.inTOI = false; } };
  world.on('pre-step', () => { T.stepIndex++; });

  const keyOf = (c) => {
    const a = c.getFixtureA().getBody(), b = c.getFixtureB().getBody();
    const na = (a.getUserData() && a.getUserData().name) || '?';
    const nb = (b.getUserData() && b.getUserData().name) || '?';
    return na < nb ? `${na}|${nb}` : `${nb}|${na}`;
  };
  const rec = (k) => {
    let r = T.contacts.get(k);
    if (!r) { r = { steps: new Map(), vApproachMax: 0, firstStep: T.stepIndex }; T.contacts.set(k, r); }
    return r;
  };
  world.on('pre-solve', (c) => {
    // approach speed along normal at manifold points (before solver)
    const wm = c.getWorldManifold(null);
    if (!wm || !wm.pointCount) return;
    const a = c.getFixtureA().getBody(), b = c.getFixtureB().getBody();
    let vmax = 0;
    for (let i = 0; i < wm.pointCount; i++) {
      const p = wm.points[i];
      const va = a.getLinearVelocityFromWorldPoint(p), vb = b.getLinearVelocityFromWorldPoint(p);
      const vn = (vb.x - va.x) * wm.normal.x + (vb.y - va.y) * wm.normal.y; // <0 approaching
      vmax = Math.max(vmax, -vn);
    }
    const r = rec(keyOf(c));
    r.vApproachMax = Math.max(r.vApproachMax, vmax);
  });
  world.on('post-solve', (c, imp) => {
    const ni = imp.normalImpulses; // NOTE: reused array, copy if storing
    let s = 0, mp = 0;
    for (let i = 0; i < ni.length; i++) { s += ni[i]; mp = Math.max(mp, ni[i]); }
    const k = keyOf(c);
    const r = rec(k);
    let st = r.steps.get(T.stepIndex);
    if (!st) { st = { reg: 0, toi: 0, maxPoint: 0, calls: 0 }; r.steps.set(T.stepIndex, st); }
    if (T.inTOI) st.toi += s; else st.reg += s;
    st.maxPoint = Math.max(st.maxPoint, mp);
    st.calls++;
    T.events.push({ step: T.stepIndex, key: k, J: s, toi: T.inTOI });
  });
  return T;
}

// summary for one contact key
export function summarize(T, key, fromStep = 0, toStep = Infinity) {
  const r = T.contacts.get(key);
  if (!r) return { maxStepJ: 0, maxCallJ: 0, totalJ: 0, stepsWithJ: 0, maxToiJ: 0, vApproachMax: 0 };
  let maxStepJ = 0, totalJ = 0, n = 0, maxToiJ = 0;
  for (const [s, st] of r.steps) {
    if (s < fromStep || s > toStep) continue;
    const j = st.reg + st.toi;
    maxStepJ = Math.max(maxStepJ, j);
    maxToiJ = Math.max(maxToiJ, st.toi);
    totalJ += j;
    if (j > 1e-6) n++;
  }
  let maxCallJ = 0;
  for (const e of T.events) if (e.key === key && e.step >= fromStep && e.step <= toStep) maxCallJ = Math.max(maxCallJ, e.J);
  return { maxStepJ, maxCallJ, totalJ, stepsWithJ: n, maxToiJ, vApproachMax: r.vApproachMax };
}
