// src/physics/constants.ts
export const PHYS = {
  GRAVITY: -15, DT: 1 / 60, VEL_ITERS: 10, POS_ITERS: 8, MAX_STEPS_PER_FRAME: 4,
  INSET: 0.0075, PRESETTLE_STEPS: 90, V_GATE: 0.5, KILL_Y: -10, BOUNDS_MARGIN: 15,
} as const;
export const LAUNCH = { V_MAX: 24, R_MAX: 2.0, R_CANCEL: 0.5 } as const;

export type MaterialId = 'wood' | 'ice' | 'stone' | 'tnt';
export interface MaterialDef { density: number; friction: number; restitution: number; v0: number; hpPerKg: number; blastMult: number }
export const MATERIALS: Record<MaterialId, MaterialDef> = {
  wood:  { density: 0.7, friction: 0.7,  restitution: 0.05, v0: 1.5, hpPerKg: 14, blastMult: 1.0 },
  ice:   { density: 0.9, friction: 0.25, restitution: 0.05, v0: 1.5, hpPerKg: 6,  blastMult: 1.25 },
  stone: { density: 2.2, friction: 0.9,  restitution: 0.02, v0: 2.5, hpPerKg: 27, blastMult: 1.4 },
  tnt:   { density: 0.8, friction: 0.6,  restitution: 0.05, v0: 1.5, hpPerKg: 4,  blastMult: 1.0 },
};
export const GROUND = { friction: 0.9, restitution: 0 } as const;
export const PIG_PHYS = { v0: 3.0, staticMult: 0.7, angularDamping: 3, linearDamping: 0.1, blastMult: 1.0 } as const;
export const PIG_HP_PER_KG = { pig_small: 6, pig_medium: 6, pig_large: 7, pig_king: 9 } as const;
export const BIRD_AFTER_IMPACT = { linearDamping: 1.5, angularDamping: 4 } as const;
export const BLAST = {
  bomb: { R: 3.5, J0: 30, dvMax: 20, D0: 100, spin: 0.15 },
  tnt:  { R: 3.0, J0: 25, dvMax: 18, D0: 80,  spin: 0.15, chainDelay: 0.12 },
  egg:  { R: 2.5, J0: 20, dvMax: 16, D0: 70,  spin: 0.15 },
} as const;
export const SETTLE = { V_LIN: 0.10, V_ANG: 0.15, HOLD_STEPS: 30, TIMEOUT_AFTER_IMPACT: 8, TIMEOUT_AFTER_LAUNCH: 10 } as const;
