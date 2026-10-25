// Headless-проверка уровней (06 §7–§8): устойчивость без выстрелов, прогон серии выстрелов,
// бот-эксперт и предложение порогов звёзд. Работает в Node, поверх настоящего ядра.

export { checkStability, STABILITY_LIMITS } from './stability';
export type { BodyLoss, BodyMotion, BodyRef, StabilityOptions, StabilityReport } from './stability';
export { simulateShots } from './shots';
export type { Shot, ShotLog, SimOptions, SimResult, WaitPolicy } from './shots';
export { GRIDS, solveLevel, solveLevelAsync, TAPS } from './solver';
export type { Batch, BatchEvaluator, BatchResults, GridPreset, SolveOptions, SolveProgress, SolveResult, TapSpec } from './solver';
export { levelPoints, suggestStars } from './stars';
export type { LevelPoints, StarSuggestion } from './stars';
