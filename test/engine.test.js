import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SUPPORTER,
  OPPOSED,
  UNDECIDED,
  STATES,
  DEFAULT_PARAMS,
  computeNeighbourPayoff,
} from '../src/model/engine.js';

const params = {
  supportReward: 1,
  solidarityReward: 2,
  conflictCost: 0.5,
  indecisionCost: 0.3,
};

test('computeNeighbourPayoff returns each cell of the payoff matrix', () => {
  assert.equal(computeNeighbourPayoff(SUPPORTER, SUPPORTER, params), 1);
  assert.equal(computeNeighbourPayoff(OPPOSED, OPPOSED, params), 2);
  assert.equal(computeNeighbourPayoff(SUPPORTER, OPPOSED, params), -0.5);
  assert.equal(computeNeighbourPayoff(OPPOSED, SUPPORTER, params), -0.5);
});

test('indecision is a cost, never a neutral position', () => {
  for (const other of STATES) {
    assert.equal(computeNeighbourPayoff(UNDECIDED, other, params), -0.3);
    assert.equal(computeNeighbourPayoff(other, UNDECIDED, params), -0.3);
  }
});

test('an undeclared neighbour costs more than nothing but less than open conflict', () => {
  const indecision = computeNeighbourPayoff(SUPPORTER, UNDECIDED, params);
  const conflict = computeNeighbourPayoff(SUPPORTER, OPPOSED, params);
  assert.ok(indecision < 0, 'indecision must carry a cost');
  assert.ok(indecision > conflict, 'declared opposition must still cost more per neighbour');
});

test('the payoff matrix is symmetric for every pair of states', () => {
  for (const a of STATES) {
    for (const b of STATES) {
      assert.equal(
        computeNeighbourPayoff(a, b, params),
        computeNeighbourPayoff(b, a, params),
        `asymmetry between ${a} and ${b}`,
      );
    }
  }
});

test('opposition coheres faster than support under default parameters', () => {
  const solidarity = computeNeighbourPayoff(OPPOSED, OPPOSED, DEFAULT_PARAMS);
  const support = computeNeighbourPayoff(SUPPORTER, SUPPORTER, DEFAULT_PARAMS);
  assert.ok(solidarity > support, 'R must be greater than S');
});

test('only agreement between declared households is rewarded', () => {
  assert.ok(computeNeighbourPayoff(SUPPORTER, SUPPORTER, params) > 0);
  assert.ok(computeNeighbourPayoff(OPPOSED, OPPOSED, params) > 0);
  assert.ok(computeNeighbourPayoff(SUPPORTER, OPPOSED, params) < 0);
  assert.ok(computeNeighbourPayoff(UNDECIDED, UNDECIDED, params) < 0);
});

test('an unknown state is rejected rather than silently scored', () => {
  assert.throws(() => computeNeighbourPayoff('NEUTRAL', SUPPORTER, params), /Unknown state/);
  assert.throws(() => computeNeighbourPayoff(SUPPORTER, undefined, params), /Unknown state/);
});

// --- Edge cases on the parameters ---------------------------------------

test('omitting params falls back to the documented defaults', () => {
  assert.equal(
    computeNeighbourPayoff(SUPPORTER, SUPPORTER),
    DEFAULT_PARAMS.supportReward,
  );
});

test('a missing or malformed parameter is rejected, never returned as undefined or NaN', () => {
  assert.throws(() => computeNeighbourPayoff(SUPPORTER, SUPPORTER, {}), /finite number/);
  assert.throws(
    () => computeNeighbourPayoff(OPPOSED, SUPPORTER, { supportReward: 1 }),
    /finite number/,
  );
  assert.throws(
    () => computeNeighbourPayoff(SUPPORTER, SUPPORTER, { ...params, supportReward: NaN }),
    /finite number/,
  );
  assert.throws(
    () => computeNeighbourPayoff(SUPPORTER, SUPPORTER, { ...params, conflictCost: '0.5' }),
    /finite number/,
  );
  assert.throws(() => computeNeighbourPayoff(SUPPORTER, SUPPORTER, null), /expected an object/);
});

test('a zero cost or reward yields a clean zero, never a negative zero', () => {
  const noConflict = computeNeighbourPayoff(SUPPORTER, OPPOSED, { ...params, conflictCost: 0 });
  assert.ok(Object.is(noConflict, 0), 'conflict at zero cost must be +0, not -0');

  const noIndecision = computeNeighbourPayoff(SUPPORTER, UNDECIDED, {
    ...params,
    indecisionCost: 0,
  });
  assert.ok(Object.is(noIndecision, 0), 'indecision at zero cost must be +0, not -0');
});

test('sliders at their extremes do not break the matrix', () => {
  const allZero = {
    supportReward: 0,
    solidarityReward: 0,
    conflictCost: 0,
    indecisionCost: 0,
  };
  for (const a of STATES) {
    for (const b of STATES) {
      assert.equal(computeNeighbourPayoff(a, b, allZero), 0);
    }
  }
  const high = {
    supportReward: 10,
    solidarityReward: 10,
    conflictCost: 10,
    indecisionCost: 10,
  };
  assert.equal(computeNeighbourPayoff(SUPPORTER, OPPOSED, high), -10);
  assert.equal(computeNeighbourPayoff(UNDECIDED, SUPPORTER, high), -10);
});
