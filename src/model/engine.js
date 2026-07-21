/**
 * Spatial Affectability — core simulation engine.
 *
 * Every function in this file is pure: same inputs, same output, no side effects,
 * no access to the DOM, the canvas or any global state. This is what makes the
 * model testable independently of any user interface.
 */

/**
 * The three positions a household can hold towards the project.
 *
 * Modelled on the four-level social licence to operate (Thomson & Boutilier, 2011),
 * collapsed to three states for legibility on a grid.
 */
export const SUPPORTER = 'SUPPORTER';
export const OPPOSED = 'OPPOSED';
export const UNDECIDED = 'UNDECIDED';

export const STATES = [SUPPORTER, OPPOSED, UNDECIDED];

/**
 * Default model parameters.
 *
 * `solidarityReward` is deliberately higher than `supportReward`: opposition
 * groups cohere faster than support does. That asymmetry is the empirically
 * interesting part of the model, not an arbitrary tuning choice.
 */
export const DEFAULT_PARAMS = {
  supportReward: 1, // S — reward for agreeing with a supporting neighbour
  solidarityReward: 1.6, // R — reward for solidarity inside an opposition group
  conflictCost: 0.8, // C — social cost of disagreeing with a neighbour
  indecisionCost: 0.4, // U — cost of an unresolved position in the neighbourhood

  // Isolation of a lone supporter. See computeCellPayoff.
  isolationThreshold: 0.6, // share of opposed neighbours above which pressure amplifies
  isolationPenalty: 1.8, // multiplier applied to the conflict cost once isolated

  // How the project itself is being run. See computeProjectPayoff.
  compensationFairness: 0.5, // perceived fairness and timeliness of compensation
  engagementIntensity: 0.5, // frequency and quality of consultation and disclosure
  grievanceResolutionRate: 0.5, // share of grievances resolved within the committed time
  rumorPropagation: 0.3, // speed at which unverified information spreads
};

/**
 * One generation represents roughly one month of project time.
 *
 * The imitation rule assumes households can observe how their neighbours are
 * faring. That is not an abstraction in resettlement contexts: compensation
 * outcomes are physically visible as housing repairs, new clothing, children
 * returning to school. Those signals take weeks to months to appear, which
 * sets the timescale of one update step. Anything shorter would imply an
 * observability the field does not support.
 */
export const GENERATION_PERIOD = 'month';

/**
 * Payoff one household draws from its interaction with a single neighbour.
 *
 * The matrix is symmetric: swapping the two states never changes the result.
 *
 * Indecision is a cost, not a neutral state. An unresolved position delays the
 * project, and delay is the most expensive outcome of all: a resettlement plan
 * is built to identify opposition early enough to act on it, and a household
 * that has not declared itself can be neither convinced nor compensated. This
 * is why every pairing involving an undecided household carries `-U`.
 *
 *                | vs SUPPORTER | vs OPPOSED | vs UNDECIDED
 *   SUPPORTER    |      S       |     -C     |     -U
 *   OPPOSED      |     -C       |      R     |     -U
 *   UNDECIDED    |     -U       |     -U     |     -U
 *
 * Note that this function is pairwise and therefore blind to the composition of
 * the wider neighbourhood. The extra pressure borne by an isolated supporter
 * surrounded by opponents is a neighbourhood-level effect and is applied in
 * `computeCellPayoff`, not here.
 *
 * @param {string} stateA - state of the household computing its payoff
 * @param {string} stateB - state of the neighbour it interacts with
 * @param {{supportReward: number, solidarityReward: number, conflictCost: number}} params
 * @returns {number} the payoff, positive for agreement, negative for conflict
 */
/** Parameters used by the pairwise payoff matrix. */
export const PAIRWISE_PARAMS = [
  'supportReward',
  'solidarityReward',
  'conflictCost',
  'indecisionCost',
];

/** Additional parameters used once the whole neighbourhood is in view. */
export const ISOLATION_PARAMS = ['isolationThreshold', 'isolationPenalty'];

/** Parameters describing how the project itself is being run. */
export const PROJECT_PARAMS = [
  'compensationFairness',
  'engagementIntensity',
  'grievanceResolutionRate',
  'rumorPropagation',
];

export const REQUIRED_PARAMS = PAIRWISE_PARAMS;

/**
 * Rejects a parameter set that would silently poison the simulation.
 *
 * A missing key yields `undefined`, a malformed one yields `NaN`, and both
 * spread through every subsequent computation without ever throwing. The
 * simulation would keep running and display a grid that means nothing.
 * Failing loudly here is the cheapest possible place to catch that.
 *
 * Negative values are deliberately allowed: see the note in the README on
 * open modelling questions.
 *
 * @param {object} params
 * @throws {Error} if a required parameter is missing or not a finite number
 */
export function assertValidParams(params, keys = PAIRWISE_PARAMS) {
  if (params === null || typeof params !== 'object') {
    throw new Error(`Invalid params: expected an object, got ${params}`);
  }
  for (const key of keys) {
    if (!Number.isFinite(params[key])) {
      throw new Error(`Invalid params: ${key} must be a finite number, got ${params[key]}`);
    }
  }
}

export function computeNeighbourPayoff(stateA, stateB, params = DEFAULT_PARAMS) {
  if (!STATES.includes(stateA)) {
    throw new Error(`Unknown state: ${stateA}`);
  }
  if (!STATES.includes(stateB)) {
    throw new Error(`Unknown state: ${stateB}`);
  }
  assertValidParams(params);

  if (stateA === UNDECIDED || stateB === UNDECIDED) {
    return 0 - params.indecisionCost;
  }
  if (stateA === SUPPORTER && stateB === SUPPORTER) {
    return params.supportReward;
  }
  if (stateA === OPPOSED && stateB === OPPOSED) {
    return params.solidarityReward;
  }
  // Written as `0 - c` rather than `-c` on purpose: negating a zero cost would
  // produce -0, which is not strictly equal to 0 in JavaScript comparisons.
  return 0 - params.conflictCost;
}

/**
 * Rejects a grid that is not a usable rectangle, or a cell outside it.
 *
 * @param {string[][]} grid - rows of states, addressed as grid[y][x]
 * @param {number} x
 * @param {number} y
 * @throws {Error}
 */
export function assertValidCell(grid, x, y) {
  if (!Array.isArray(grid) || grid.length === 0 || !Array.isArray(grid[0])) {
    throw new Error('Invalid grid: expected a non-empty array of rows');
  }
  const width = grid[0].length;
  if (width === 0) {
    throw new Error('Invalid grid: rows must not be empty');
  }
  for (const row of grid) {
    if (!Array.isArray(row) || row.length !== width) {
      throw new Error('Invalid grid: all rows must have the same length');
    }
  }
  if (!Number.isInteger(x) || !Number.isInteger(y)) {
    throw new Error(`Invalid cell: coordinates must be integers, got (${x}, ${y})`);
  }
  if (y < 0 || y >= grid.length || x < 0 || x >= width) {
    throw new Error(`Cell (${x}, ${y}) is outside a ${width}x${grid.length} grid`);
  }
}

/**
 * States of the Moore neighbours of a cell, on a grid with FIXED EDGES.
 *
 * The grid does not wrap. A cell near the boundary genuinely has fewer
 * neighbours: 8 in the interior, 5 along an edge, 3 in a corner. This is the
 * single most important implementation detail in the whole model. A silent
 * wrap-around would still produce a plausible-looking simulation while quietly
 * erasing the edge effects along the project footprint, which are the result
 * the model exists to show.
 *
 * @param {string[][]} grid
 * @param {number} x
 * @param {number} y
 * @returns {string[]} neighbour states, between 3 and 8 of them
 */
export function getNeighbours(grid, x, y) {
  assertValidCell(grid, x, y);

  const neighbours = [];
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if (dx === 0 && dy === 0) {
        continue; // the cell is not its own neighbour
      }
      const ny = y + dy;
      const nx = x + dx;
      // No modulo here, on purpose. Out of bounds means "no neighbour", not
      // "look at the other side of the grid".
      if (ny >= 0 && ny < grid.length && nx >= 0 && nx < grid[0].length) {
        neighbours.push(grid[ny][nx]);
      }
    }
  }
  return neighbours;
}

/**
 * Total payoff a household draws from its neighbourhood.
 *
 * This is the sum of its pairwise payoffs, plus one neighbourhood-level effect
 * the pairwise matrix cannot express.
 *
 * **Isolation of a lone supporter.** A supporter surrounded by opponents bears
 * more social pressure than an opponent surrounded by supporters. This is a
 * field observation, and it is deliberately asymmetric: the payoff matrix stays
 * symmetric pair by pair, and the asymmetry enters only here, once the whole
 * neighbourhood is in view. Above `isolationThreshold`, the conflict cost the
 * supporter pays is multiplied by `isolationPenalty`.
 *
 * The threshold is a **proportion of actual neighbours**, never an absolute
 * count. With an absolute threshold, a corner cell holding only 3 neighbours
 * could never reach it, and the isolation effect would vanish exactly on the
 * boundary, which is where the model is supposed to be most interesting.
 *
 * @param {string[][]} grid
 * @param {number} x
 * @param {number} y
 * @param {object} params
 * @returns {number}
 */
export function computeCellPayoff(grid, x, y, params = DEFAULT_PARAMS) {
  assertValidParams(params, [...PAIRWISE_PARAMS, ...ISOLATION_PARAMS]);
  const neighbours = getNeighbours(grid, x, y);
  const self = grid[y][x];

  let total = 0;
  for (const neighbour of neighbours) {
    total += computeNeighbourPayoff(self, neighbour, params);
  }

  if (self !== SUPPORTER || neighbours.length === 0) {
    return total;
  }

  const opposedCount = neighbours.filter((state) => state === OPPOSED).length;
  const opposedShare = opposedCount / neighbours.length;
  if (opposedShare < params.isolationThreshold) {
    return total;
  }

  // Amplify only the conflict component, not the rewards the supporter draws
  // from whatever allies are left. The component is negative, so adding a
  // positive multiple of it makes the payoff worse.
  const conflictComponent = 0 - params.conflictCost * opposedCount;
  return total + (params.isolationPenalty - 1) * conflictComponent;
}

/**
 * Payoff a household draws from the project itself, independently of its
 * neighbours.
 *
 * This is where the four levers a project manager actually controls enter the
 * model. A supporter is rewarded by fair compensation and by being consulted,
 * and undermined by rumour. An opponent is sustained by unresolved grievances
 * and by rumour, and undermined by compensation that is seen to be fair.
 *
 *   supporter = compensationFairness + engagementIntensity - rumorPropagation
 *   opposed   = grievanceBacklog     + rumorPropagation    - compensationFairness
 *   undecided = -indecisionCost
 *
 * **Grievance backlog is derived, not accumulated.** `grievanceBacklog` is
 * taken as `1 - grievanceResolutionRate`: the share of grievances left
 * unresolved at the committed deadline. This keeps every generation a pure
 * function of the current state, which is what makes the simulation
 * reproducible and testable. Letting the backlog accumulate across generations
 * would create the self-reinforcing spiral described in the project brief, but
 * it would also give the model a memory, and reproducing a run would then
 * require replaying its whole history. That refinement is deliberately deferred
 * until the simulation runs end to end.
 *
 * The undecided household draws neither the benefits of compensation nor the
 * cohesion of an organised group: it is not compensated, not mobilised, and
 * simply bears the delay. This is the same `indecisionCost` used between
 * neighbours, applied here to its relationship with the project.
 *
 * @param {string} state
 * @param {object} params
 * @returns {number}
 */
export function computeProjectPayoff(state, params = DEFAULT_PARAMS) {
  if (!STATES.includes(state)) {
    throw new Error(`Unknown state: ${state}`);
  }
  assertValidParams(params, [...PROJECT_PARAMS, 'indecisionCost']);

  if (state === SUPPORTER) {
    return (
      params.compensationFairness + params.engagementIntensity - params.rumorPropagation
    );
  }
  if (state === OPPOSED) {
    const grievanceBacklog = 1 - params.grievanceResolutionRate;
    return grievanceBacklog + params.rumorPropagation - params.compensationFairness;
  }
  return 0 - params.indecisionCost;
}

/**
 * Everything a household weighs when deciding whether to hold its position:
 * its neighbourhood and the project together.
 *
 * This is the quantity the update rule compares between neighbours. It is kept
 * separate from its two components so that each can be tested on its own, and
 * so that a surprising result can be traced to the social term or the project
 * term rather than to their sum.
 *
 * @param {string[][]} grid
 * @param {number} x
 * @param {number} y
 * @param {object} params
 * @returns {number}
 */
export function computeTotalPayoff(grid, x, y, params = DEFAULT_PARAMS) {
  return computeCellPayoff(grid, x, y, params) + computeProjectPayoff(grid[y][x], params);
}
