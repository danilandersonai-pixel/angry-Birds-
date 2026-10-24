import { describe, expect, it } from 'vitest';
import { World, Vec2, Circle, Box } from 'planck';

describe('каркас', () => {
  it('planck симулирует падение шара на землю', () => {
    const world = new World({ gravity: Vec2(0, -20) });
    world.createBody().createFixture({ shape: new Box(50, 0.5, Vec2(0, -0.5)) });
    const ball = world.createBody({ type: 'dynamic', position: Vec2(0, 5) });
    ball.createFixture({ shape: new Circle(0.45), density: 5 });
    for (let i = 0; i < 120; i++) world.step(1 / 60, 8, 3);
    expect(ball.getPosition().y).toBeCloseTo(0.45, 1);
  });
});
