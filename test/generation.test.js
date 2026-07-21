import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SUPPORTER,
  OPPOSED,
  UNDECIDED,
  STATES,
  DEFAULT_PARAMS,
  PAYOFF_EPSILON,
  computeTotalPayoff,
  decideNextState,
  stepGeneration,
} from '../src/model/engine.js';

const params = { ...DEFAULT_PARAMS, noise: 0 };

/** A random source that never fires the noise branch. */
const noRandom = () => 1;

/** A random source replaying a fixed sequence, so a run is reproducible. */
function sequence(values) {
  let i = 0;
  return () => values[i++ % values.length];
}

function makeGrid(w, h, fill, overrides = []) {
  const grid = Array.from({ length: h }, () => Array.from({ length: w }, () => fill));
  for (const [x, y, state] of overrides) {
    grid[y][x] = state;
  }
  return grid;
}

function payoffGrid(grid) {
  return grid.map((row, y) => row.map((_, x) => computeTotalPayoff(grid, x, y, params)));
}

// --- Purity and shape ---------------------------------------------------

test('the input grid is never modified', () => {
  const grid = makeGrid(4, 4, SUPPORTER, [[1, 1, OPPOSED]]);
  const before = JSON.stringify(grid);
  stepGeneration(grid, params, noRandom);
  assert.equal(JSON.stringify(grid), before);
});

test('the new grid keeps the dimensions of the old one, including non-square grids', () => {
  const grid = makeGrid(5, 3, UNDECIDED, [[2, 1, OPPOSED]]);
  const next = stepGeneration(grid, params, noRandom);
  assert.equal(next.length, 3);
  for (const row of next) {
    assert.equal(row.length, 5);
  }
});

test('every cell of the new grid holds a valid state', () => {
  const grid = makeGrid(4, 4, UNDECIDED, [
    [0, 0, SUPPORTER],
    [3, 3, OPPOSED],
  ]);
  for (const row of stepGeneration(grid, params, sequence([0, 0.5]))) {
    for (const state of row) {
      assert.ok(STATES.includes(state), `unexpected state ${state}`);
    }
  }
});

test('the same grid, params and random source always give the same next generation', () => {
  const grid = makeGrid(6, 6, UNDECIDED, [
    [1, 1, OPPOSED],
    [4, 2, SUPPORTER],
    [2, 5, OPPOSED],
  ]);
  const noisy = { ...DEFAULT_PARAMS, noise: 0.3 };
  const a = stepGeneration(grid, noisy, sequence([0.1, 0.4, 0.9, 0.2]));
  const b = stepGeneration(grid, noisy, sequence([0.1, 0.4, 0.9, 0.2]));
  assert.deepEqual(a, b);
});

// --- The update rule ----------------------------------------------------

test('a uniform grid stays uniform when there is no noise', () => {
  for (const state of STATES) {
    const grid = makeGrid(5, 5, state);
    assert.deepEqual(stepGeneration(grid, params, noRandom), grid);
  }
});

test('the update is synchronous: no cell reacts to a neighbour that already moved', () => {
  // Two adjacent opponents in a sea of supporters. Under a synchronous update
  // both are evaluated against the same starting grid.
  const grid = makeGrid(5, 5, SUPPORTER, [
    [2, 2, OPPOSED],
    [3, 2, OPPOSED],
  ]);
  const payoffs = payoffGrid(grid);
  const expected = grid.map((row, y) => row.map((_, x) => decideNextState(grid, payoffs, x, y)));
  assert.deepEqual(stepGeneration(grid, params, noRandom), expected);
});

test('a household adopts the position of a visibly better-off neighbour', () => {
  // A lone supporter surrounded by a cohesive opposition: the opponents draw
  // the solidarity reward, the supporter pays an amplified conflict cost.
  const grid = makeGrid(3, 3, OPPOSED, [[1, 1, SUPPORTER]]);
  const payoffs = payoffGrid(grid);
  assert.ok(payoffs[1][1] < payoffs[0][0], 'the isolated supporter must be worse off');
  assert.equal(decideNextState(grid, payoffs, 1, 1), OPPOSED);
});

// --- Tie-breaking -------------------------------------------------------

test('a household already among the best holds its position', () => {
  const grid = makeGrid(3, 3, SUPPORTER);
  const payoffs = payoffGrid(grid);
  assert.equal(decideNextState(grid, payoffs, 1, 1), SUPPORTER);
});

test('a payoff better by less than epsilon does not move anyone', () => {
  const grid = makeGrid(3, 3, SUPPORTER, [[0, 0, OPPOSED]]);
  const payoffs = payoffGrid(grid).map((row) => row.map(() => 0));
  payoffs[1][1] = 1;
  payoffs[0][0] = 1 + PAYOFF_EPSILON / 10; // marginally better, within tolerance
  assert.equal(decideNextState(grid, payoffs, 1, 1), SUPPORTER, 'must hold position');
});

test('a payoff better by more than epsilon does move a household', () => {
  const grid = makeGrid(3, 3, SUPPORTER, [[0, 0, OPPOSED]]);
  const payoffs = payoffGrid(grid).map((row) => row.map(() => 0));
  payoffs[1][1] = 1;
  payoffs[0][0] = 1 + PAYOFF_EPSILON * 100;
  assert.equal(decideNextState(grid, payoffs, 1, 1), OPPOSED);
});

test('when tied best neighbours disagree, weight of numbers decides, not position', () => {
  const grid = makeGrid(3, 3, UNDECIDED, [
    [0, 0, OPPOSED], // top-left, would win a fixed scan order
    [2, 0, SUPPORTER],
    [2, 2, SUPPORTER],
  ]);
  const payoffs = grid.map((row) => row.map(() => 0));
  payoffs[1][1] = -1; // the centre is worse off than everyone
  payoffs[0][0] = 1;
  payoffs[0][2] = 1;
  payoffs[2][2] = 1;
  assert.equal(
    decideNextState(grid, payoffs, 1, 1),
    SUPPORTER,
    'two supporters must outweigh one opponent scanned first',
  );
});

test('an evenly split tie leaves the household where it was', () => {
  const grid = makeGrid(3, 3, UNDECIDED, [
    [0, 0, OPPOSED],
    [2, 2, SUPPORTER],
  ]);
  const payoffs = grid.map((row) => row.map(() => 0));
  payoffs[1][1] = -1;
  payoffs[0][0] = 1;
  payoffs[2][2] = 1;
  assert.equal(decideNextState(grid, payoffs, 1, 1), UNDECIDED);
});

test('tie-breaking is isotropic: rotating the grid rotates the outcome', () => {
  // The same configuration read from the opposite corner must give the same
  // answer. A fixed scan order would break this.
  const grid = makeGrid(3, 3, UNDECIDED, [
    [0, 0, SUPPORTER],
    [2, 2, OPPOSED],
  ]);
  const mirrored = makeGrid(3, 3, UNDECIDED, [
    [2, 2, SUPPORTER],
    [0, 0, OPPOSED],
  ]);
  const payoffs = grid.map((row) => row.map(() => 0));
  payoffs[1][1] = -1;
  payoffs[0][0] = 1;
  payoffs[2][2] = 1;

  assert.equal(decideNextState(grid, payoffs, 1, 1), UNDECIDED);
  assert.equal(decideNextState(mirrored, payoffs, 1, 1), UNDECIDED);
});

// --- Noise --------------------------------------------------------------

test('noise at zero never consults the random source', () => {
  let calls = 0;
  const counting = () => {
    calls += 1;
    return 0;
  };
  stepGeneration(makeGrid(4, 4, SUPPORTER), { ...DEFAULT_PARAMS, noise: 0 }, counting);
  assert.equal(calls, 0);
});

test('noise at one replaces every household with the drawn position', () => {
  const grid = makeGrid(3, 3, SUPPORTER);
  // Pairs: first draw fires the noise branch, second picks the state.
  const alwaysOpposed = sequence([0, 1 / 3]);
  const next = stepGeneration(grid, { ...DEFAULT_PARAMS, noise: 1 }, alwaysOpposed);
  for (const row of next) {
    for (const state of row) {
      assert.equal(state, OPPOSED);
    }
  }
});

test('the drawn position is never outside the three states', () => {
  const grid = makeGrid(4, 4, UNDECIDED);
  // 0.999... must still land inside STATES rather than one past the end.
  const next = stepGeneration(grid, { ...DEFAULT_PARAMS, noise: 1 }, sequence([0, 0.9999999]));
  for (const row of next) {
    for (const state of row) {
      assert.ok(STATES.includes(state));
    }
  }
});

// --- Guards -------------------------------------------------------------

test('a malformed grid, params or random source is rejected', () => {
  const grid = makeGrid(3, 3, SUPPORTER);
  assert.throws(() => stepGeneration([], params, noRandom), /non-empty/);
  assert.throws(() => stepGeneration([[SUPPORTER], [SUPPORTER, SUPPORTER]], params), /same length/);
  assert.throws(() => stepGeneration(grid, { ...params, noise: undefined }, noRandom), /noise/);
  assert.throws(() => stepGeneration(grid, params, 'not a function'), /random source/);
});
