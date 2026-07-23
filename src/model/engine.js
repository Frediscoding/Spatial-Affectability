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
 * A cell that is not a household at all.
 *
 * The grid is always a rectangle, because that is what a raster is. The area
 * actually affected by a project is not: it is the footprint polygon, and the
 * cells of the rectangle that fall outside it are simply not part of the
 * community being modelled. They hold `OUTSIDE`.
 *
 * This is deliberately NOT a fourth state. An outside cell has no position, no
 * payoff, and no vote; it never updates and it is excluded from every share the
 * simulation reports. Putting it in `STATES` would make noise able to conjure a
 * household out of empty ground, and would put it in the denominator of every
 * percentage on screen.
 *
 * What it does is turn the boundary of the grid into the boundary of the
 * footprint. A household on the edge of the polygon has fewer neighbours, in
 * exactly the same way a household in a corner of the rectangle does, and the
 * edge effects the model exists to show follow the real perimeter of the
 * project instead of an arbitrary rectangle.
 */
export const OUTSIDE = 'OUTSIDE';

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

  projectWeight: 4, // how far project management can outweigh neighbourhood pressure
  decisionRate: 1 / 6, // probability an undecided household resolves in a given month
  noise: 0.02, // probability a household picks a position for reasons the model does not see
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
 * `OUTSIDE` cells are not neighbours either, for the same reason and by the
 * same mechanism: land outside the footprint is treated exactly like land off
 * the edge of the grid. This is what lets an imported footprint have a real
 * perimeter, and it means a household can hold anywhere from 0 to 8 neighbours,
 * not just the three rectangular cases.
 *
 * @param {string[][]} grid
 * @param {number} x
 * @param {number} y
 * @returns {{x: number, y: number}[]} coordinates of the neighbours, 0 to 8 of them
 */
export function getNeighbourCells(grid, x, y) {
  assertValidCell(grid, x, y);

  const cells = [];
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if (dx === 0 && dy === 0) {
        continue; // the cell is not its own neighbour
      }
      const ny = y + dy;
      const nx = x + dx;
      // No modulo here, on purpose. Out of bounds means "no neighbour", not
      // "look at the other side of the grid".
      if (ny < 0 || ny >= grid.length || nx < 0 || nx >= grid[0].length) {
        continue;
      }
      if (grid[ny][nx] === OUTSIDE) {
        continue; // outside the footprint: nobody lives there
      }
      cells.push({ x: nx, y: ny });
    }
  }
  return cells;
}

export function getNeighbours(grid, x, y) {
  return getNeighbourCells(grid, x, y).map((cell) => grid[cell.y][cell.x]);
}

/**
 * Average payoff a household draws from its neighbourhood.
 *
 * This is the **mean** of its pairwise payoffs, not their sum, plus one
 * neighbourhood-level effect the pairwise matrix cannot express.
 *
 * Averaging matters for two reasons. It keeps the social term on the same scale
 * as the project term, so that the levers a project manager controls can
 * actually compete with neighbourhood pressure; summing over eight neighbours
 * made the social term roughly ten times larger, and no slider setting could
 * ever overcome it. It also gives boundary cells the behaviour the model is
 * built to show: with a sum, a corner cell simply scores lower than an interior
 * one, which is an artefact. With a mean, it scores on the same scale but over
 * three neighbours instead of eight, so it is genuinely more volatile.
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

  if (self === OUTSIDE) {
    return 0; // empty ground draws nothing from anyone
  }
  if (neighbours.length === 0) {
    return 0;
  }

  let total = 0;
  for (const neighbour of neighbours) {
    total += computeNeighbourPayoff(self, neighbour, params);
  }

  if (self !== SUPPORTER) {
    return total / neighbours.length;
  }

  const opposedCount = neighbours.filter((state) => state === OPPOSED).length;
  const opposedShare = opposedCount / neighbours.length;
  if (opposedShare < params.isolationThreshold) {
    return total / neighbours.length;
  }

  // Amplify only the conflict component, not the rewards the supporter draws
  // from whatever allies are left. The component is negative, so adding a
  // positive multiple of it makes the payoff worse.
  const conflictComponent = 0 - params.conflictCost * opposedCount;
  return (total + (params.isolationPenalty - 1) * conflictComponent) / neighbours.length;
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
  if (grid[y]?.[x] === OUTSIDE) {
    return 0;
  }
  return (
    computeCellPayoff(grid, x, y, params) +
    params.projectWeight * computeProjectPayoff(grid[y][x], params)
  );
}

/**
 * Tolerance below which two payoffs are treated as equal.
 *
 * Payoffs are sums of decimal slider values in binary floating point, so two
 * values that are equal in the model can differ in the last bits depending on
 * the order the additions happened to be performed. Without this tolerance the
 * winner of a tie would be decided by rounding error: invisible, arbitrary, and
 * dependent on where a cell sits in the grid.
 */
export const PAYOFF_EPSILON = 1e-9;

/** Every parameter the simulation needs to run a generation. */
export const ALL_PARAMS = [
  ...PAIRWISE_PARAMS,
  ...ISOLATION_PARAMS,
  ...PROJECT_PARAMS,
  'projectWeight',
  'decisionRate',
  'noise',
];

/**
 * Decides the next state of one household, given every payoff on the board.
 *
 * The rule is Nowak & May imitation: adopt the position of whoever is doing
 * best in the neighbourhood, including yourself. Two refinements are needed to
 * make that deterministic.
 *
 * **Ties are resolved in favour of the status quo.** If the household is
 * already within `PAYOFF_EPSILON` of the best payoff around it, it does not
 * move. A household changes its declared position towards a project because it
 * sees someone doing visibly better, not because someone is doing marginally
 * better. Inertia is also the conservative assumption: it makes the model slower
 * to flip, so any tipping point it does produce is not an artefact of churn.
 *
 * **Ties between neighbours are resolved by weight of numbers, never by
 * position.** When several neighbours share the best payoff but hold different
 * positions, the most represented among them wins. Scanning them in a fixed
 * order would be simpler, but it would hand every tie to whichever neighbour
 * comes first, which on a grid means a systematic drift towards one corner. That
 * would be a visible artefact along the very edges the model exists to study.
 * If the tied neighbours are still evenly split, the household holds its
 * position.
 *
 * @param {string[][]} grid - the grid at the start of the generation
 * @param {number[][]} payoffs - total payoff of every cell, same dimensions
 * @param {number} x
 * @param {number} y
 * @returns {string} the state the household holds in the next generation
 */
export function decideNextState(grid, payoffs, x, y) {
  const own = grid[y][x];
  if (own === OUTSIDE) {
    return OUTSIDE; // empty ground never becomes a household
  }
  const ownPayoff = payoffs[y][x];
  const neighbours = getNeighbourCells(grid, x, y);

  let best = ownPayoff;
  for (const cell of neighbours) {
    if (payoffs[cell.y][cell.x] > best) {
      best = payoffs[cell.y][cell.x];
    }
  }

  if (ownPayoff >= best - PAYOFF_EPSILON) {
    return own; // already among the best: hold position
  }

  const votes = new Map();
  for (const cell of neighbours) {
    if (payoffs[cell.y][cell.x] >= best - PAYOFF_EPSILON) {
      const state = grid[cell.y][cell.x];
      votes.set(state, (votes.get(state) ?? 0) + 1);
    }
  }

  let winner = own;
  let winningVotes = 0;
  let contested = false;
  for (const [state, count] of votes) {
    if (count > winningVotes) {
      winner = state;
      winningVotes = count;
      contested = false;
    } else if (count === winningVotes) {
      contested = true;
    }
  }

  return contested ? own : winner;
}

/**
 * Advances the whole grid by one generation.
 *
 * The update is **synchronous**: every payoff is computed from the grid as it
 * stands at the start of the generation, and only then is the new grid built.
 * Updating cells one by one in place would let a cell react to a neighbour that
 * had already moved this turn, which silently turns the model into a different
 * one.
 *
 * The function is pure. It does not modify the grid it is given, and its only
 * source of randomness is injected, so a run can be replayed exactly.
 *
 * `noise` is the probability that a household ignores its neighbourhood
 * entirely and picks a position at random, standing in for the private reasons
 * no model captures. It also prevents the grid from freezing into a static
 * pattern. A household may draw the position it already held, so the effective
 * rate of visible change is lower than `noise` itself.
 *
 * @param {string[][]} grid
 * @param {object} params
 * @param {() => number} random - source of randomness in [0, 1), injected so
 *   that tests can make a run deterministic
 * @returns {string[][]} a new grid; the input is left untouched
 */
export function stepGeneration(grid, params = DEFAULT_PARAMS, random = Math.random) {
  assertValidParams(params, ALL_PARAMS);
  assertValidCell(grid, 0, 0); // rejects a ragged or empty grid
  if (typeof random !== 'function') {
    throw new Error('Invalid random source: expected a function returning [0, 1)');
  }

  const payoffs = grid.map((row, y) => row.map((_, x) => computeTotalPayoff(grid, x, y, params)));

  return grid.map((row, y) =>
    row.map((cell, x) => {
      // Checked before the noise draw: empty ground must not be reachable by
      // noise either, or the footprint would slowly fill itself in.
      if (cell === OUTSIDE) {
        return OUTSIDE;
      }
      if (params.noise > 0 && random() < params.noise) {
        return STATES[Math.floor(random() * STATES.length) % STATES.length];
      }
      // Making up one's mind takes time. An undecided household that has not
      // yet resolved this month stays undecided, whatever its neighbours are
      // doing. Without this, the imitation rule would resolve every undecided
      // household in a single generation, and the state would be decorative.
      if (grid[y][x] === UNDECIDED && random() >= params.decisionRate) {
        return UNDECIDED;
      }
      return decideNextState(grid, payoffs, x, y);
    }),
  );
}

/** The number of Moore neighbours a fully interior household has. */
export const FULL_NEIGHBOURHOOD = 8;

/**
 * Whether a household sits on the perimeter of the affected area.
 *
 * A household is on the perimeter when it has fewer than eight neighbours,
 * whatever the reason: it is on the edge of the grid, or it borders land outside
 * the footprint. Both mean the same thing on the ground — one side of this
 * household faces something other than more community.
 *
 * Defining exposure by neighbour count rather than by position is what makes the
 * statistic survive the switch from a rectangle to an imported polygon. A
 * household deep inside the bounding box but on the lip of a concavity in the
 * footprint is a boundary household, and any definition based on coordinates
 * would call it interior.
 *
 * @param {string[][]} grid
 * @param {number} x
 * @param {number} y
 * @returns {boolean} false for a cell that is not a household at all
 */
export function isBoundaryHousehold(grid, x, y) {
  if (grid[y][x] === OUTSIDE) {
    return false;
  }
  return getNeighbourCells(grid, x, y).length < FULL_NEIGHBOURHOOD;
}

/**
 * Counts households by position, excluding land outside the footprint.
 *
 * `OUTSIDE` cells are not in any count and not in the total. A percentage
 * computed against the size of the raster rather than against the number of
 * households would silently shrink every share as soon as a footprint is
 * imported, and the shape of the polygon would look like a change in opinion.
 *
 * @param {string[][]} grid
 * @returns {{SUPPORTER: number, OPPOSED: number, UNDECIDED: number, households: number}}
 */
export function countStates(grid) {
  const counts = { [SUPPORTER]: 0, [OPPOSED]: 0, [UNDECIDED]: 0, households: 0 };
  for (const row of grid) {
    for (const state of row) {
      if (state === OUTSIDE) {
        continue;
      }
      counts[state] += 1;
      counts.households += 1;
    }
  }
  return counts;
}

/**
 * The same counts, split between the perimeter of the affected area and its
 * interior.
 *
 * This is the measurement the model exists to produce. The claim from the
 * resettlement literature is that opposition concentrates along the boundary of
 * the project footprint, where households have fewer neighbours to reinforce a
 * position and are therefore more volatile. Splitting the counts is what turns
 * that claim into a number the user can watch move.
 *
 * @param {string[][]} grid
 * @returns {{boundary: object, interior: object}} each shaped like countStates
 */
export function countStatesByExposure(grid) {
  const empty = () => ({ [SUPPORTER]: 0, [OPPOSED]: 0, [UNDECIDED]: 0, households: 0 });
  const result = { boundary: empty(), interior: empty() };

  for (let y = 0; y < grid.length; y += 1) {
    for (let x = 0; x < grid[y].length; x += 1) {
      const state = grid[y][x];
      if (state === OUTSIDE) {
        continue;
      }
      const bucket = isBoundaryHousehold(grid, x, y) ? result.boundary : result.interior;
      bucket[state] += 1;
      bucket.households += 1;
    }
  }
  return result;
}
