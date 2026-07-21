import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SUPPORTER,
  OPPOSED,
  UNDECIDED,
  computeNeighbourPayoff,
  getNeighbours,
  computeCellPayoff,
} from '../src/model/engine.js';

const params = {
  supportReward: 1,
  solidarityReward: 2,
  conflictCost: 0.5,
  indecisionCost: 0.3,
  isolationThreshold: 0.6,
  isolationPenalty: 2,
};

/** Builds a h x w grid filled with `fill`, then applies the given overrides. */
function makeGrid(w, h, fill = SUPPORTER, overrides = []) {
  const grid = Array.from({ length: h }, () => Array.from({ length: w }, () => fill));
  for (const [x, y, state] of overrides) {
    grid[y][x] = state;
  }
  return grid;
}

// --- getNeighbours: the fixed-edge contract -----------------------------

test('an interior cell has exactly 8 neighbours', () => {
  const grid = makeGrid(5, 5);
  assert.equal(getNeighbours(grid, 2, 2).length, 8);
});

test('an edge cell has exactly 5 neighbours', () => {
  const grid = makeGrid(5, 5);
  assert.equal(getNeighbours(grid, 0, 2).length, 5, 'left edge');
  assert.equal(getNeighbours(grid, 4, 2).length, 5, 'right edge');
  assert.equal(getNeighbours(grid, 2, 0).length, 5, 'top edge');
  assert.equal(getNeighbours(grid, 2, 4).length, 5, 'bottom edge');
});

test('a corner cell has exactly 3 neighbours', () => {
  const grid = makeGrid(5, 5);
  for (const [x, y] of [
    [0, 0],
    [4, 0],
    [0, 4],
    [4, 4],
  ]) {
    assert.equal(getNeighbours(grid, x, y).length, 3, `corner (${x}, ${y})`);
  }
});

test('the grid does not wrap around: a corner never sees the opposite side', () => {
  // Only the far corner is OPPOSED. A torus would make it a neighbour of (0, 0).
  const grid = makeGrid(4, 4, SUPPORTER, [[3, 3, OPPOSED]]);
  const neighbours = getNeighbours(grid, 0, 0);
  assert.equal(neighbours.length, 3);
  assert.ok(!neighbours.includes(OPPOSED), 'wrap-around detected');
});

test('a cell is never its own neighbour', () => {
  const grid = makeGrid(3, 3, SUPPORTER, [[1, 1, OPPOSED]]);
  const neighbours = getNeighbours(grid, 1, 1);
  assert.equal(neighbours.length, 8);
  assert.ok(!neighbours.includes(OPPOSED));
});

test('a one-cell grid has no neighbours at all', () => {
  assert.deepEqual(getNeighbours([[SUPPORTER]], 0, 0), []);
});

test('neighbours are read at the right coordinates, not transposed', () => {
  // grid[y][x]: this marks x=2, y=0, the cell to the right of (1, 0).
  const grid = makeGrid(3, 3, SUPPORTER, [[2, 0, OPPOSED]]);
  assert.ok(getNeighbours(grid, 1, 0).includes(OPPOSED), 'should see its right-hand neighbour');
  assert.ok(!getNeighbours(grid, 0, 2).includes(OPPOSED), 'must not see a transposed cell');
});

test('a cell outside the grid, or a malformed grid, is rejected', () => {
  const grid = makeGrid(3, 3);
  assert.throws(() => getNeighbours(grid, 3, 0), /outside/);
  assert.throws(() => getNeighbours(grid, -1, 0), /outside/);
  assert.throws(() => getNeighbours(grid, 0, 3), /outside/);
  assert.throws(() => getNeighbours(grid, 1.5, 0), /integers/);
  assert.throws(() => getNeighbours([], 0, 0), /non-empty/);
  assert.throws(() => getNeighbours([[SUPPORTER], [SUPPORTER, SUPPORTER]], 0, 0), /same length/);
});

// --- computeCellPayoff: summation --------------------------------------

test('a supporter among supporters collects one reward per neighbour', () => {
  const grid = makeGrid(3, 3);
  // Interior cell: 8 neighbours, all supporters, no opposition so no isolation.
  assert.equal(computeCellPayoff(grid, 1, 1, params), 8 * params.supportReward);
});

test('an opposed household among opponents collects the solidarity reward', () => {
  const grid = makeGrid(3, 3, OPPOSED);
  assert.equal(computeCellPayoff(grid, 1, 1, params), 8 * params.solidarityReward);
});

test('a corner cell scores over 3 neighbours, not 8', () => {
  const grid = makeGrid(3, 3);
  assert.equal(computeCellPayoff(grid, 0, 0, params), 3 * params.supportReward);
});

test('the total matches the sum of the pairwise payoffs, computed independently', () => {
  const grid = makeGrid(3, 3, UNDECIDED, [
    [1, 1, OPPOSED],
    [0, 0, OPPOSED],
    [2, 1, SUPPORTER],
  ]);
  const expected = getNeighbours(grid, 1, 1)
    .map((neighbour) => computeNeighbourPayoff(OPPOSED, neighbour, params))
    .reduce((a, b) => a + b, 0);
  assert.equal(computeCellPayoff(grid, 1, 1, params), expected);
});

// --- computeCellPayoff: isolation of a lone supporter -------------------

test('an isolated supporter is penalised beyond the plain sum of conflicts', () => {
  // Centre supporter, all 8 neighbours opposed: share = 1.0, above threshold.
  const grid = makeGrid(3, 3, OPPOSED, [[1, 1, SUPPORTER]]);
  const plainSum = 8 * -params.conflictCost;
  const payoff = computeCellPayoff(grid, 1, 1, params);
  assert.ok(payoff < plainSum, 'isolation must make things worse, not merely additive');
  assert.equal(payoff, plainSum * params.isolationPenalty);
});

test('a supporter below the threshold is not penalised', () => {
  // 3 opposed out of 8 = 0.375, below the 0.6 threshold.
  const grid = makeGrid(3, 3, SUPPORTER, [
    [0, 0, OPPOSED],
    [1, 0, OPPOSED],
    [2, 0, OPPOSED],
  ]);
  const expected = 3 * -params.conflictCost + 5 * params.supportReward;
  assert.equal(computeCellPayoff(grid, 1, 1, params), expected);
});

test('an isolated opponent is NOT penalised: the effect is asymmetric by design', () => {
  const grid = makeGrid(3, 3, SUPPORTER, [[1, 1, OPPOSED]]);
  assert.equal(computeCellPayoff(grid, 1, 1, params), 8 * -params.conflictCost);
});

test('the isolation threshold is proportional, so it still triggers in a corner', () => {
  // Corner supporter with all 3 of its neighbours opposed: share = 1.0.
  // An absolute threshold of 5 opposed neighbours could never fire here.
  const grid = makeGrid(4, 4, OPPOSED, [[0, 0, SUPPORTER]]);
  const plainSum = 3 * -params.conflictCost;
  assert.equal(computeCellPayoff(grid, 0, 0, params), plainSum * params.isolationPenalty);
});

test('isolation amplifies the conflict cost only, never the remaining rewards', () => {
  // 6 opposed, 2 supporters: share = 0.75, above threshold.
  const grid = makeGrid(3, 3, OPPOSED, [
    [1, 1, SUPPORTER],
    [0, 0, SUPPORTER],
    [2, 2, SUPPORTER],
  ]);
  const rewards = 2 * params.supportReward;
  const conflicts = 6 * -params.conflictCost;
  assert.equal(
    computeCellPayoff(grid, 1, 1, params),
    rewards + conflicts * params.isolationPenalty,
  );
});

test('undecided neighbours count towards the neighbourhood but not towards isolation', () => {
  // 5 opposed, 3 undecided: share = 0.625, above the 0.6 threshold.
  const grid = makeGrid(3, 3, OPPOSED, [
    [1, 1, SUPPORTER],
    [0, 0, UNDECIDED],
    [1, 0, UNDECIDED],
    [2, 0, UNDECIDED],
  ]);
  const undecided = 3 * -params.indecisionCost;
  const conflicts = 5 * -params.conflictCost;
  assert.equal(
    computeCellPayoff(grid, 1, 1, params),
    undecided + conflicts * params.isolationPenalty,
  );
});

test('an isolation penalty of 1 leaves the payoff untouched', () => {
  const grid = makeGrid(3, 3, OPPOSED, [[1, 1, SUPPORTER]]);
  const neutral = { ...params, isolationPenalty: 1 };
  assert.equal(computeCellPayoff(grid, 1, 1, neutral), 8 * -params.conflictCost);
});

test('computeCellPayoff rejects params that lack the isolation settings', () => {
  const grid = makeGrid(3, 3);
  const pairwiseOnly = {
    supportReward: 1,
    solidarityReward: 2,
    conflictCost: 0.5,
    indecisionCost: 0.3,
  };
  assert.throws(() => computeCellPayoff(grid, 1, 1, pairwiseOnly), /isolationThreshold/);
});
