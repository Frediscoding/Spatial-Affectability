import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SUPPORTER,
  OPPOSED,
  UNDECIDED,
  STATES,
  computeCellPayoff,
  computeProjectPayoff,
  computeTotalPayoff,
} from '../src/model/engine.js';

const params = {
  supportReward: 1,
  solidarityReward: 2,
  conflictCost: 0.5,
  indecisionCost: 0.3,
  isolationThreshold: 0.6,
  isolationPenalty: 2,
  compensationFairness: 0.6,
  engagementIntensity: 0.4,
  grievanceResolutionRate: 0.7,
  rumorPropagation: 0.2,
  projectWeight: 3,
};

/**
 * Compares two payoffs allowing for binary floating point error.
 *
 * The parameters are decimal fractions coming from sliders, and expressions
 * such as `1 - 0.7` evaluate to 0.30000000000000004 rather than 0.3. Asserting
 * exact equality on a hand-computed decimal would fail on a correct
 * implementation, so model values are compared within a tolerance.
 */
function closeTo(actual, expected, message) {
  assert.ok(
    Math.abs(actual - expected) < 1e-9,
    `${message ?? 'value'}: expected ${expected}, got ${actual}`,
  );
}

// --- computeProjectPayoff: the four levers ------------------------------

test('a supporter is rewarded by compensation and engagement, undermined by rumour', () => {
  // 0.6 + 0.4 - 0.2, computed by hand from the documented formula
  closeTo(computeProjectPayoff(SUPPORTER, params), 0.8, 'supporter');
});

test('an opponent is sustained by unresolved grievances and rumour', () => {
  // backlog = 1 - 0.7 = 0.3, then 0.3 + 0.2 - 0.6
  closeTo(computeProjectPayoff(OPPOSED, params), -0.1, 'opponent');
});

test('an undecided household draws nothing from the project and bears the delay', () => {
  closeTo(computeProjectPayoff(UNDECIDED, params), -0.3, 'undecided');
});

test('fair compensation helps supporters and hurts opponents, symmetrically', () => {
  const poor = { ...params, compensationFairness: 0.1 };
  const rich = { ...params, compensationFairness: 0.9 };

  assert.ok(
    computeProjectPayoff(SUPPORTER, rich) > computeProjectPayoff(SUPPORTER, poor),
    'compensation must strengthen support',
  );
  assert.ok(
    computeProjectPayoff(OPPOSED, rich) < computeProjectPayoff(OPPOSED, poor),
    'compensation must weaken opposition',
  );
});

test('rumour helps opponents and hurts supporters', () => {
  const quiet = { ...params, rumorPropagation: 0 };
  const loud = { ...params, rumorPropagation: 1 };

  assert.ok(computeProjectPayoff(SUPPORTER, loud) < computeProjectPayoff(SUPPORTER, quiet));
  assert.ok(computeProjectPayoff(OPPOSED, loud) > computeProjectPayoff(OPPOSED, quiet));
});

test('resolving grievances weakens opposition and leaves supporters untouched', () => {
  const slow = { ...params, grievanceResolutionRate: 0 };
  const fast = { ...params, grievanceResolutionRate: 1 };

  assert.ok(
    computeProjectPayoff(OPPOSED, fast) < computeProjectPayoff(OPPOSED, slow),
    'a resolved backlog must starve opposition',
  );
  assert.equal(
    computeProjectPayoff(SUPPORTER, fast),
    computeProjectPayoff(SUPPORTER, slow),
    'the grievance rate must not leak into the supporter payoff',
  );
});

test('engagement intensity moves supporters only', () => {
  const none = { ...params, engagementIntensity: 0 };
  const full = { ...params, engagementIntensity: 1 };

  assert.ok(computeProjectPayoff(SUPPORTER, full) > computeProjectPayoff(SUPPORTER, none));
  assert.equal(computeProjectPayoff(OPPOSED, full), computeProjectPayoff(OPPOSED, none));
});

test('a fully resolved backlog with no rumour and fair compensation leaves opposition negative', () => {
  const wellRun = {
    ...params,
    grievanceResolutionRate: 1,
    rumorPropagation: 0,
    compensationFairness: 1,
  };
  assert.equal(computeProjectPayoff(OPPOSED, wellRun), -1);
  assert.ok(computeProjectPayoff(SUPPORTER, wellRun) > 0);
});

test('the worst-run project makes opposition the only rewarding position', () => {
  const collapsed = {
    ...params,
    grievanceResolutionRate: 0,
    rumorPropagation: 1,
    compensationFairness: 0,
    engagementIntensity: 0,
  };
  assert.equal(computeProjectPayoff(OPPOSED, collapsed), 2);
  assert.equal(computeProjectPayoff(SUPPORTER, collapsed), -1);
});

test('an unknown state or a malformed parameter set is rejected', () => {
  assert.throws(() => computeProjectPayoff('NEUTRAL', params), /Unknown state/);
  assert.throws(
    () => computeProjectPayoff(SUPPORTER, { ...params, rumorPropagation: undefined }),
    /finite number/,
  );
});

// --- computeTotalPayoff: the sum ----------------------------------------

test('the total is the neighbourhood term plus the weighted project term', () => {
  const grid = [
    [SUPPORTER, OPPOSED, UNDECIDED],
    [OPPOSED, SUPPORTER, OPPOSED],
    [UNDECIDED, OPPOSED, SUPPORTER],
  ];
  for (let y = 0; y < 3; y += 1) {
    for (let x = 0; x < 3; x += 1) {
      assert.equal(
        computeTotalPayoff(grid, x, y, params),
        computeCellPayoff(grid, x, y, params) +
          params.projectWeight * computeProjectPayoff(grid[y][x], params),
        `cell (${x}, ${y})`,
      );
    }
  }
});

test('the project term applies to every state, including on a corner cell', () => {
  for (const state of STATES) {
    const grid = [[state]];
    // A one-cell grid has no neighbours, so the total is the project term alone.
    assert.equal(
      computeTotalPayoff(grid, 0, 0, params),
      params.projectWeight * computeProjectPayoff(state, params),
    );
  }
});

test('projectWeight scales how far management can outweigh neighbourhood pressure', () => {
  // A lone supporter in a cohesive opposition, with the project run well.
  const grid = [
    [OPPOSED, OPPOSED, OPPOSED],
    [OPPOSED, SUPPORTER, OPPOSED],
    [OPPOSED, OPPOSED, OPPOSED],
  ];
  const wellRun = { ...params, compensationFairness: 1, engagementIntensity: 1, rumorPropagation: 0 };
  const ignored = computeTotalPayoff(grid, 1, 1, { ...wellRun, projectWeight: 0 });
  const decisive = computeTotalPayoff(grid, 1, 1, { ...wellRun, projectWeight: 10 });
  assert.ok(ignored < 0, 'with no weight, the social term alone crushes the supporter');
  assert.ok(decisive > 0, 'with enough weight, good management can hold a lone supporter');
});
