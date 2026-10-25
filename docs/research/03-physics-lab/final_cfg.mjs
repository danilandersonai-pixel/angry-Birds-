// Final recommended configuration (applied on top of game.mjs defaults)
import { MATERIALS, PIG, BIRD, BIRD_MULT, STATIC_TO_PIG_MULT, MODE } from './game.mjs';
MODE.massThreshold = true;
MODE.V0 = { wood: 1.5, ice: 1.5, stone: 2.5, tnt: 1.5, pig: 3.0 };
BIRD.density = 2.0; BIRD.restitution = 0.32; BIRD.friction = 0.55;
PIG.density = 0.8; PIG.angularDamping = 3; PIG.linearDamping = 0.1;
STATIC_TO_PIG_MULT.value = 0.7;
BIRD_MULT.red = { wood: 1.0, ice: 1.0, stone: 0.7, tnt: 1.0, pig: 1.0 };
export const HPK = { wood: 14, ice: 6, stone: 27, tnt: 4 };
for (const [k, v] of Object.entries(HPK)) MATERIALS[k].hpPerM2 = v * MATERIALS[k].density;
export const pigHp = (r, k) => k * Math.PI * r * r * PIG.density;
export const PIGS = [['pig_small', 0.405, 6], ['pig_medium', 0.6075, 6], ['pig_large', 0.8325, 7], ['pig_king', 1.17, 9]];
