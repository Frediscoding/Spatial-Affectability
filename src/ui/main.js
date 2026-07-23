/**
 * Spatial Affectability — browser front end.
 *
 * The engine knows nothing about this file: it is pure, and everything here is
 * display and input. All the model logic lives in ../model/engine.js, and the
 * geography in ../model/footprint.js and ../model/kmz.js.
 */

import {
  SUPPORTER,
  OPPOSED,
  UNDECIDED,
  OUTSIDE,
  STATES,
  DEFAULT_PARAMS,
  stepGeneration,
  countStates,
  countStatesByExposure,
  isBoundaryHousehold,
} from '../model/engine.js';
import { parseFootprint, rasterizeFootprint, gridFromMask } from '../model/footprint.js';
import { readKmz } from '../model/kmz.js';

/** Side of the plain rectangle used until a footprint is imported. */
const RECTANGLE_SIDE = 60;
const MS_PER_GENERATION = 140;
/** Cell size used when the control has no usable value. Matches the marked-up default. */
const DEFAULT_CELL_METRES = 50;
/** Longest side of the canvas in device pixels; the grid is scaled to fit it. */
const CANVAS_TARGET = 600;

/** Diverging palette: two poles and a neutral midpoint. Validated for CVD. */
const STATE_STYLE = {
  [SUPPORTER]: { label: 'Supporter', varName: '--supporter' },
  [UNDECIDED]: { label: 'Undecided', varName: '--undecided' },
  [OPPOSED]: { label: 'Opposed', varName: '--opposed' },
};

/** Stacking order: support at the bottom, opposition at the top, neutral between. */
const STACK_ORDER = [SUPPORTER, UNDECIDED, OPPOSED];

const SLIDERS = [
  {
    key: 'compensationFairness',
    label: 'Compensation fairness',
    hint: 'How fair and timely the compensation is perceived to be',
    min: 0,
    max: 1,
    step: 0.01,
  },
  {
    key: 'engagementIntensity',
    label: 'Engagement intensity',
    hint: 'Frequency and quality of consultation and disclosure',
    min: 0,
    max: 1,
    step: 0.01,
  },
  {
    key: 'grievanceResolutionRate',
    label: 'Grievance resolution rate',
    hint: 'Share of grievances resolved within the committed time',
    min: 0,
    max: 1,
    step: 0.01,
  },
  {
    key: 'rumorPropagation',
    label: 'Rumour propagation',
    hint: 'Speed at which unverified information spreads',
    min: 0,
    max: 1,
    step: 0.01,
  },
  {
    key: 'projectWeight',
    label: 'Weight of project management',
    hint: 'How far the levers above can outweigh neighbourhood pressure',
    min: 0,
    max: 10,
    step: 0.1,
  },
  {
    key: 'conflictCost',
    label: 'Cost of social conflict',
    hint: 'What disagreeing with a neighbour costs a household',
    min: 0,
    max: 2,
    step: 0.01,
  },
  {
    key: 'decisionRate',
    label: 'Decision rate',
    hint: 'Chance an undecided household makes up its mind this month',
    min: 0.01,
    max: 1,
    step: 0.01,
  },
  {
    key: 'noise',
    label: 'Noise',
    hint: 'Households acting for reasons the model does not see',
    min: 0,
    max: 0.15,
    step: 0.005,
  },
];

const SCENARIOS = {
  wellManaged: {
    compensationFairness: 0.8,
    engagementIntensity: 0.8,
    grievanceResolutionRate: 0.9,
    rumorPropagation: 0.1,
  },
  delayed: {
    compensationFairness: 0.2,
    engagementIntensity: 0.5,
    grievanceResolutionRate: 0.5,
    rumorPropagation: 0.4,
  },
  collapsed: {
    compensationFairness: 0.2,
    engagementIntensity: 0.2,
    grievanceResolutionRate: 0.05,
    rumorPropagation: 0.8,
  },
  knifeEdge: {
    compensationFairness: 0.35,
    engagementIntensity: 0.5,
    grievanceResolutionRate: 0.5,
    rumorPropagation: 0.3,
  },
};

// --- State --------------------------------------------------------------

const params = { ...DEFAULT_PARAMS };

/**
 * The plain rectangle the page opens on.
 *
 * Kept as the default deliberately. It has no scale and no geography, which
 * makes it the control case: anything the imported footprint does differently is
 * the shape of the project talking, not the model.
 */
function rectangleRaster() {
  return {
    mask: Array.from({ length: RECTANGLE_SIDE }, () => Array(RECTANGLE_SIDE).fill(true)),
    width: RECTANGLE_SIDE,
    height: RECTANGLE_SIDE,
    cellMetres: null,
    households: RECTANGLE_SIDE * RECTANGLE_SIDE,
    areaHectares: null,
  };
}

let raster = rectangleRaster();
/** The imported polygons, kept so the cell size can be changed without the file. */
let polygons = null;
let footprintName = '';

let grid = seedGrid();
let history = [];
let month = 0;
let timer = null;

const el = {
  grid: document.getElementById('grid'),
  chart: document.getElementById('chart'),
  legend: document.getElementById('legend'),
  exposure: document.getElementById('exposure'),
  sliders: document.getElementById('sliders'),
  scenario: document.getElementById('scenario'),
  month: document.getElementById('month'),
  play: document.getElementById('play'),
  step: document.getElementById('step'),
  reset: document.getElementById('reset'),
  tableBody: document.getElementById('table-body'),
  tooltip: document.getElementById('tooltip'),
  file: document.getElementById('footprint-file'),
  cellSize: document.getElementById('cell-size'),
  summary: document.getElementById('footprint-summary'),
  clearFootprint: document.getElementById('clear-footprint'),
};

function colourOf(state) {
  return getComputedStyle(document.documentElement)
    .getPropertyValue(STATE_STYLE[state].varName)
    .trim();
}

function seedGrid() {
  return gridFromMask(
    raster.mask,
    () => STATES[Math.floor(Math.random() * STATES.length)],
    OUTSIDE,
  );
}

/** Shares of each position, as a percentage of households — not of the raster. */
function shares(g) {
  const counts = countStates(g);
  const total = Math.max(counts.households, 1);
  return Object.fromEntries(STATES.map((s) => [s, (100 * counts[s]) / total]));
}

// --- Rendering ----------------------------------------------------------

/**
 * Sizes the canvas to the grid.
 *
 * An imported footprint is rarely square, and stretching it to a fixed square
 * canvas would distort the very shape the import exists to preserve. The canvas
 * takes the aspect ratio of the raster, and CSS scales it down to the column
 * width from there.
 */
function resizeCanvas() {
  const scale = Math.max(1, Math.floor(CANVAS_TARGET / Math.max(raster.width, raster.height)));
  el.grid.width = raster.width * scale;
  el.grid.height = raster.height * scale;
}

function drawGrid() {
  const ctx = el.grid.getContext('2d');
  const cellW = el.grid.width / raster.width;
  const cellH = el.grid.height / raster.height;
  const background = getComputedStyle(document.documentElement)
    .getPropertyValue('--plane')
    .trim();

  ctx.fillStyle = background;
  ctx.fillRect(0, 0, el.grid.width, el.grid.height);

  for (let y = 0; y < raster.height; y += 1) {
    for (let x = 0; x < raster.width; x += 1) {
      // Land outside the footprint keeps the page background, so the silhouette
      // of the project reads as a shape rather than as a fourth position.
      if (grid[y][x] === OUTSIDE) {
        continue;
      }
      ctx.fillStyle = colourOf(grid[y][x]);
      ctx.fillRect(x * cellW, y * cellH, Math.ceil(cellW), Math.ceil(cellH));
    }
  }
}

function drawChart(hoverIndex = null) {
  const ctx = el.chart.getContext('2d');
  const { width, height } = el.chart;
  const pad = { top: 14, right: 52, bottom: 26, left: 12 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const styles = getComputedStyle(document.documentElement);

  ctx.clearRect(0, 0, width, height);

  // Recessive gridlines at 0, 25, 50, 75, 100 %.
  ctx.strokeStyle = styles.getPropertyValue('--gridline').trim();
  ctx.fillStyle = styles.getPropertyValue('--muted').trim();
  ctx.lineWidth = 1;
  ctx.font = '11px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  for (const pct of [0, 25, 50, 75, 100]) {
    const y = pad.top + plotH * (1 - pct / 100);
    ctx.beginPath();
    ctx.moveTo(pad.left, Math.round(y) + 0.5);
    ctx.lineTo(pad.left + plotW, Math.round(y) + 0.5);
    ctx.stroke();
    ctx.fillText(`${pct}%`, pad.left + plotW + 8, y);
  }

  if (history.length < 2) return;

  const span = Math.max(history.length - 1, 1);
  const xAt = (i) => pad.left + (plotW * i) / span;

  // Stacked areas, drawn top-down so the 2px surface gap between segments is
  // cut by the band drawn after it.
  const surface = styles.getPropertyValue('--surface-1').trim();
  let baseline = history.map(() => 0);
  for (const state of STACK_ORDER) {
    const upper = history.map((h, i) => baseline[i] + h[state]);
    ctx.beginPath();
    ctx.moveTo(xAt(0), pad.top + plotH * (1 - upper[0] / 100));
    upper.forEach((v, i) => ctx.lineTo(xAt(i), pad.top + plotH * (1 - v / 100)));
    for (let i = history.length - 1; i >= 0; i -= 1) {
      ctx.lineTo(xAt(i), pad.top + plotH * (1 - baseline[i] / 100));
    }
    ctx.closePath();
    ctx.fillStyle = colourOf(state);
    ctx.fill();

    // 2px separator in the surface colour along the top edge of the band.
    ctx.beginPath();
    upper.forEach((v, i) => {
      const y = pad.top + plotH * (1 - v / 100);
      if (i === 0) ctx.moveTo(xAt(i), y);
      else ctx.lineTo(xAt(i), y);
    });
    ctx.strokeStyle = surface;
    ctx.lineWidth = 2;
    ctx.stroke();

    baseline = upper;
  }

  // Crosshair
  if (hoverIndex !== null && history[hoverIndex]) {
    const x = xAt(hoverIndex);
    ctx.beginPath();
    ctx.moveTo(Math.round(x) + 0.5, pad.top);
    ctx.lineTo(Math.round(x) + 0.5, pad.top + plotH);
    ctx.strokeStyle = styles.getPropertyValue('--text-secondary').trim();
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  ctx.fillStyle = styles.getPropertyValue('--muted').trim();
  ctx.textAlign = 'left';
  ctx.fillText('month 0', pad.left, height - 12);
  ctx.textAlign = 'right';
  ctx.fillText(`month ${history.length - 1}`, pad.left + plotW, height - 12);
}

function drawLegend() {
  const current = history[history.length - 1] ?? shares(grid);
  el.legend.innerHTML = STACK_ORDER.map(
    (state) => `
      <span class="legend-item">
        <span class="swatch" style="background: var(${STATE_STYLE[state].varName})"></span>
        ${STATE_STYLE[state].label}
        <span class="legend-value">${current[state].toFixed(1)}%</span>
      </span>`,
  ).join('');
}

/**
 * The headline measurement: how opposition on the perimeter compares with
 * opposition inside.
 *
 * The claim the model is built to test is that the two differ. Reporting a
 * single grid-wide percentage averages exactly the effect being looked for away.
 */
function drawExposure() {
  const { boundary, interior } = countStatesByExposure(grid);
  const pct = (bucket) => (bucket.households === 0 ? null : (100 * bucket[OPPOSED]) / bucket.households);
  const onEdge = pct(boundary);
  const inside = pct(interior);
  const show = (value) => (value === null ? '—' : `${value.toFixed(1)}%`);

  let gap = 'no interior to compare with';
  if (onEdge !== null && inside !== null) {
    const delta = onEdge - inside;
    const direction = delta >= 0 ? 'higher' : 'lower';
    gap = `${Math.abs(delta).toFixed(1)} points ${direction} on the perimeter`;
  }

  el.exposure.innerHTML = `
    <div class="stat">
      <span class="stat-label">Opposed, on the perimeter</span>
      <span class="stat-value">${show(onEdge)}</span>
      <span class="stat-note">${boundary.households.toLocaleString()} households</span>
    </div>
    <div class="stat">
      <span class="stat-label">Opposed, in the interior</span>
      <span class="stat-value">${show(inside)}</span>
      <span class="stat-note">${interior.households.toLocaleString()} households</span>
    </div>
    <div class="stat">
      <span class="stat-label">Edge effect</span>
      <span class="stat-value">${gap}</span>
    </div>`;
}

function drawTable() {
  // Most recent first, capped so the DOM stays small.
  el.tableBody.innerHTML = history
    .map(
      (h, i) => `<tr><td>${i}</td><td>${h[SUPPORTER].toFixed(1)}</td>
        <td>${h[UNDECIDED].toFixed(1)}</td><td>${h[OPPOSED].toFixed(1)}</td></tr>`,
    )
    .reverse()
    .slice(0, 120)
    .join('');
}

function drawSummary(message = null, isError = false) {
  el.summary.className = isError ? 'note error' : 'note';
  if (message !== null) {
    el.summary.textContent = message;
    return;
  }
  if (polygons === null) {
    el.summary.textContent = `Plain rectangle, ${RECTANGLE_SIDE} × ${RECTANGLE_SIDE} households, no scale. Import a footprint to give it geography.`;
    return;
  }
  const cell = Math.round(raster.cellMetres);
  el.summary.textContent =
    `${footprintName}: ${raster.households.toLocaleString()} households on ` +
    `${raster.areaHectares.toFixed(1)} ha, at ${cell} m per cell ` +
    `(${raster.width} × ${raster.height} cells).`;
}

function render() {
  el.month.textContent = String(month);
  drawGrid();
  drawChart();
  drawLegend();
  drawExposure();
  drawTable();
}

// --- Simulation loop ----------------------------------------------------

function advance() {
  grid = stepGeneration(grid, params);
  month += 1;
  history.push(shares(grid));
  render();
}

function setPlaying(on) {
  if (on && timer === null) {
    timer = setInterval(advance, MS_PER_GENERATION);
    el.play.textContent = 'Pause';
  } else if (!on && timer !== null) {
    clearInterval(timer);
    timer = null;
    el.play.textContent = 'Play';
  }
}

function reset() {
  setPlaying(false);
  resizeCanvas();
  grid = seedGrid();
  month = 0;
  history = [shares(grid)];
  render();
  drawSummary();
}

// --- Importing a footprint ----------------------------------------------

/**
 * The chosen cell size, in metres.
 *
 * Falls back to the default rather than trusting the markup: an empty or
 * unparseable value would reach `rasterizeFootprint` as zero and turn a valid
 * footprint into an error message about the cell size, which points the user at
 * the wrong thing entirely.
 */
function cellMetres() {
  const chosen = Number(el.cellSize.value);
  return Number.isFinite(chosen) && chosen > 0 ? chosen : DEFAULT_CELL_METRES;
}

/**
 * Adopts a footprint, but only once it has produced a raster.
 *
 * Rasterising can fail on a legitimately parsed polygon — a corridor too long to
 * resolve is the real case. Assigning the polygons first and rasterising after
 * would leave the page insisting a footprint is loaded while still running the
 * previous grid, and the next unrelated change to the cell size would silently
 * adopt it. Nothing is committed until there is something to show.
 *
 * @param {object[]} parsed - polygons from `parseFootprint`
 * @param {string} name - what to call the footprint on screen
 */
function adoptFootprint(parsed, name) {
  const next = rasterizeFootprint(parsed, cellMetres());
  raster = next;
  polygons = parsed;
  footprintName = name;
  el.clearFootprint.hidden = false;
  reset();
}

/**
 * Reads a dropped file, whatever of the three formats it turns out to be.
 *
 * The format is decided by the first two bytes, not by the extension: a KMZ is a
 * ZIP and starts with `PK`, and anything else is text. Trusting the extension
 * would break on the very common case of a `.kmz` that a user renamed, or a file
 * saved from a browser with no extension at all.
 */
async function importFootprint(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  const text = isZip ? await readKmz(bytes) : new TextDecoder('utf-8').decode(bytes);
  adoptFootprint(parseFootprint(text), file.name);
}

el.file.addEventListener('change', async () => {
  const [file] = el.file.files;
  if (!file) return;
  setPlaying(false);
  try {
    await importFootprint(file);
  } catch (error) {
    // Every failure path in the import chain throws with a message written for
    // the person holding the file, so it is shown as-is rather than replaced by
    // a generic one.
    drawSummary(error.message, true);
  }
});

el.cellSize.addEventListener('change', () => {
  if (polygons === null) return; // the rectangle has no scale to change
  setPlaying(false);
  try {
    adoptFootprint(polygons, footprintName);
  } catch (error) {
    drawSummary(error.message, true);
  }
});

el.clearFootprint.addEventListener('click', () => {
  polygons = null;
  footprintName = '';
  raster = rectangleRaster();
  el.file.value = '';
  el.clearFootprint.hidden = true;
  reset();
});

// --- Controls -----------------------------------------------------------

function buildSliders() {
  el.sliders.innerHTML = SLIDERS.map(
    (s) => `
      <div class="slider">
        <div class="slider-head">
          <label for="s-${s.key}">${s.label}</label>
          <output id="o-${s.key}"></output>
        </div>
        <input type="range" id="s-${s.key}" min="${s.min}" max="${s.max}" step="${s.step}" />
        <p class="hint">${s.hint}</p>
      </div>`,
  ).join('');

  for (const s of SLIDERS) {
    const input = document.getElementById(`s-${s.key}`);
    input.value = params[s.key];
    document.getElementById(`o-${s.key}`).textContent = Number(params[s.key]).toFixed(2);
    input.addEventListener('input', () => {
      params[s.key] = Number(input.value);
      document.getElementById(`o-${s.key}`).textContent = Number(input.value).toFixed(2);
      el.scenario.value = 'custom';
    });
  }
}

function applyScenario(name) {
  const preset = SCENARIOS[name];
  if (!preset) return;
  Object.assign(params, preset);
  for (const s of SLIDERS) {
    const input = document.getElementById(`s-${s.key}`);
    input.value = params[s.key];
    document.getElementById(`o-${s.key}`).textContent = Number(params[s.key]).toFixed(2);
  }
}

// --- Hover --------------------------------------------------------------

function showTooltip(event, html) {
  el.tooltip.innerHTML = html;
  el.tooltip.style.opacity = '1';
  el.tooltip.style.left = `${event.clientX + 14}px`;
  el.tooltip.style.top = `${event.clientY + 14}px`;
}

function hideTooltip() {
  el.tooltip.style.opacity = '0';
}

el.grid.addEventListener('mousemove', (event) => {
  const rect = el.grid.getBoundingClientRect();
  const x = Math.floor(((event.clientX - rect.left) / rect.width) * raster.width);
  const y = Math.floor(((event.clientY - rect.top) / rect.height) * raster.height);
  if (x < 0 || y < 0 || x >= raster.width || y >= raster.height) return hideTooltip();

  if (grid[y][x] === OUTSIDE) {
    return showTooltip(event, 'Outside the project footprint');
  }
  const scale = raster.cellMetres === null ? '' : `<br>${Math.round(raster.cellMetres)} m cell`;
  const edge = isBoundaryHousehold(grid, x, y) ? '<br>on the footprint boundary' : '';
  showTooltip(event, `Household (${x}, ${y})<br>${STATE_STYLE[grid[y][x]].label}${edge}${scale}`);
});
el.grid.addEventListener('mouseleave', hideTooltip);

el.chart.addEventListener('mousemove', (event) => {
  if (history.length < 2) return;
  const rect = el.chart.getBoundingClientRect();
  const pad = { left: 12, right: 52 };
  const scale = el.chart.width / rect.width;
  const px = (event.clientX - rect.left) * scale;
  const plotW = el.chart.width - pad.left - pad.right;
  const ratio = (px - pad.left) / plotW;
  const i = Math.round(ratio * (history.length - 1));
  if (i < 0 || i >= history.length) return hideTooltip();
  const h = history[i];
  showTooltip(
    event,
    `Month ${i}<br>Supporter ${h[SUPPORTER].toFixed(1)}%<br>` +
      `Undecided ${h[UNDECIDED].toFixed(1)}%<br>Opposed ${h[OPPOSED].toFixed(1)}%`,
  );
  drawChart(i);
});
el.chart.addEventListener('mouseleave', () => {
  hideTooltip();
  drawChart();
});

el.play.addEventListener('click', () => setPlaying(timer === null));
el.step.addEventListener('click', () => {
  setPlaying(false);
  advance();
});
el.reset.addEventListener('click', reset);
el.scenario.addEventListener('change', () => applyScenario(el.scenario.value));

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', render);

buildSliders();
reset();
