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
export const REQUIRED_PARAMS = [
  'supportReward',
  'solidarityReward',
  'conflictCost',
  'indecisionCost',
];

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
export function assertValidParams(params) {
  if (params === null || typeof params !== 'object') {
    throw new Error(`Invalid params: expected an object, got ${params}`);
  }
  for (const key of REQUIRED_PARAMS) {
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
