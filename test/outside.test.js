import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SUPPORTER,
  OPPOSED,
  UNDECIDED,
  OUTSIDE,
  DEFAULT_PARAMS,
  getNeighbours,
  computeCellPayoff,
  computeTotalPayoff,
  stepGeneration,
  isBoundaryHousehold,
  countStates,
  countStatesByExposure,
} from '../src/model/engine.js';

const params = {
  supportReward: 1,
  solidarityReward: 2,
  conflictCost: 0.5,
  indecisionCost: 0.3,
  isolationThreshold: 0.6,
  isolationPenalty: 2,
};

const _ = OUTSIDE;

/**
 * A 5x5 raster whose footprint is the 3x3 block in the middle.
 *
 * Stands in for the general case: the affected area is smaller than the raster
 * that contains it, and its perimeter runs through the interior of the grid.
 */
function blockGrid(fill = SUPPORTER) {
  return [
    [_, _, _, _, _],
    [_, fill, fill, fill, _],
    [_, fill, fill, fill, _],
    [_, fill, fill, fill, _],
    [_, _, _, _, _],
  ];
}

// --- Neighbourhoods -----------------------------------------------------

test('land outside the footprint is not a neighbour', () => {
  const grid = blockGrid();
  // (1, 1) is the north-west corner of the footprint: 3 neighbours, like the
  // corner of a rectangular grid, even though it sits inside the raster.
  assert.equal(getNeighbours(grid, 1, 1).length, 3);
  assert.equal(getNeighbours(grid, 2, 1).length, 5, 'north edge of the footprint');
  assert.equal(getNeighbours(grid, 2, 2).length, 8, 'centre of the footprint');
});

test('a household cut off from the footprint has no neighbours at all', () => {
  const grid = [
    [_, _, _],
    [_, SUPPORTER, _],
    [_, _, _],
  ];
  assert.deepEqual(getNeighbours(grid, 1, 1), []);
  assert.equal(computeCellPayoff(grid, 1, 1, params), 0);
});

test('a hole in the footprint removes neighbours from the households around it', () => {
  const grid = blockGrid();
  grid[2][2] = OUTSIDE; // an excluded parcel in the middle of the affected area
  assert.equal(getNeighbours(grid, 2, 1).length, 4, 'lost the neighbour below it');
  assert.equal(getNeighbours(grid, 1, 1).length, 2, 'lost its diagonal neighbour too');
});

test('outside land carries no payoff of its own', () => {
  const grid = blockGrid();
  assert.equal(computeCellPayoff(grid, 0, 0, params), 0);
  assert.equal(computeTotalPayoff(grid, 0, 0, DEFAULT_PARAMS), 0);
});

test('the isolation threshold is proportional, so it still fires on a footprint edge', () => {
  // A supporter at the corner of the footprint with all 3 of its neighbours
  // opposed. Nothing about this is special-cased for the rectangle.
  const grid = blockGrid(OPPOSED);
  grid[1][1] = SUPPORTER;
  assert.equal(computeCellPayoff(grid, 1, 1, params), -params.conflictCost * params.isolationPenalty);
});

// --- Generations --------------------------------------------------------

test('a generation never turns outside land into a household', () => {
  const grid = blockGrid(OPPOSED);
  // noise = 1 forces every household to redraw its position at random. Outside
  // land must not be reachable by that draw.
  const next = stepGeneration(grid, { ...DEFAULT_PARAMS, noise: 1 }, () => 0);
  for (let y = 0; y < grid.length; y += 1) {
    for (let x = 0; x < grid[y].length; x += 1) {
      if (grid[y][x] === OUTSIDE) {
        assert.equal(next[y][x], OUTSIDE, `(${x}, ${y}) should still be outside`);
      } else {
        assert.notEqual(next[y][x], OUTSIDE, `(${x}, ${y}) should still be a household`);
      }
    }
  }
});

test('a generation leaves the input grid untouched', () => {
  const grid = blockGrid(UNDECIDED);
  const before = JSON.stringify(grid);
  stepGeneration(grid, DEFAULT_PARAMS, () => 0.5);
  assert.equal(JSON.stringify(grid), before);
});

test('a footprint of one household is stable: it has nobody to imitate', () => {
  const grid = [
    [_, _, _],
    [_, OPPOSED, _],
    [_, _, _],
  ];
  const next = stepGeneration(grid, { ...DEFAULT_PARAMS, noise: 0 }, () => 0.5);
  assert.equal(next[1][1], OPPOSED);
});

// --- Counting -----------------------------------------------------------

test('outside land is excluded from the counts and from the total', () => {
  const grid = blockGrid();
  grid[1][1] = OPPOSED;
  grid[3][3] = UNDECIDED;
  const counts = countStates(grid);
  assert.equal(counts.households, 9, 'the raster holds 25 cells but only 9 households');
  assert.equal(counts[SUPPORTER], 7);
  assert.equal(counts[OPPOSED], 1);
  assert.equal(counts[UNDECIDED], 1);
});

test('a household is on the perimeter when it borders anything that is not a household', () => {
  const grid = blockGrid();
  assert.equal(isBoundaryHousehold(grid, 2, 2), false, 'the centre has all 8 neighbours');
  assert.equal(isBoundaryHousehold(grid, 1, 2), true, 'borders outside land to the west');
  assert.equal(isBoundaryHousehold(grid, 0, 0), false, 'outside land is not a household at all');
});

test('the exposure split separates the perimeter from the interior', () => {
  const grid = blockGrid();
  grid[2][2] = OPPOSED; // the only interior household
  const { boundary, interior } = countStatesByExposure(grid);

  assert.equal(interior.households, 1);
  assert.equal(interior[OPPOSED], 1);
  assert.equal(boundary.households, 8);
  assert.equal(boundary[SUPPORTER], 8);
  assert.equal(boundary.households + interior.households, countStates(grid).households);
});

test('on a rectangular grid the split still works, with no footprint involved', () => {
  const grid = Array.from({ length: 4 }, () => Array.from({ length: 4 }, () => SUPPORTER));
  const { boundary, interior } = countStatesByExposure(grid);
  assert.equal(interior.households, 4, 'a 4x4 grid has a 2x2 interior');
  assert.equal(boundary.households, 12);
});
