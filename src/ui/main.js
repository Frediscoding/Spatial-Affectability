/**
 * Spatial Affectability — browser front end.
 *
 * The engine knows nothing about this file: it is pure, and everything here is
 * display and input. All the model logic lives in ../model/engine.js.
 */

import {
  SUPPORTER,
  OPPOSED,
  UNDECIDED,
  STATES,
  DEFAULT_PARAMS,
  stepGeneration,
} from '../model/engine.js';

const GRID_SIZE = 60;
const MS_PER_GENERATION = 140;

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
let grid = seedGrid();
let history = [];
let month = 0;
let timer = null;

const el = {
  grid: document.getElementById('grid'),
  chart: document.getElementById('chart'),
  legend: document.getElementById('legend'),
  sliders: document.getElementById('sliders'),
  scenario: document.getElementById('scenario'),
  month: document.getElementById('month'),
  play: document.getElementById('play'),
  step: document.getElementById('step'),
  reset: document.getElementById('reset'),
  tableBody: document.getElementById('table-body'),
  tooltip: document.getElementById('tooltip'),
};

function colourOf(state) {
  return getComputedStyle(document.documentElement)
    .getPropertyValue(STATE_STYLE[state].varName)
    .trim();
}

function seedGrid() {
  return Array.from({ length: GRID_SIZE }, () =>
    Array.from({ length: GRID_SIZE }, () => STATES[Math.floor(Math.random() * STATES.length)]),
  );
}

function shares(g) {
  const counts = { [SUPPORTER]: 0, [OPPOSED]: 0, [UNDECIDED]: 0 };
  for (const row of g) {
    for (const state of row) counts[state] += 1;
  }
  const total = GRID_SIZE * GRID_SIZE;
  return Object.fromEntries(STATES.map((s) => [s, (100 * counts[s]) / total]));
}

// --- Rendering ----------------------------------------------------------

function drawGrid() {
  const ctx = el.grid.getContext('2d');
  const cell = el.grid.width / GRID_SIZE;
  for (let y = 0; y < GRID_SIZE; y += 1) {
    for (let x = 0; x < GRID_SIZE; x += 1) {
      ctx.fillStyle = colourOf(grid[y][x]);
      ctx.fillRect(x * cell, y * cell, cell, cell);
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

function render() {
  el.month.textContent = String(month);
  drawGrid();
  drawChart();
  drawLegend();
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
  grid = seedGrid();
  month = 0;
  history = [shares(grid)];
  render();
}

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
  const x = Math.floor(((event.clientX - rect.left) / rect.width) * GRID_SIZE);
  const y = Math.floor(((event.clientY - rect.top) / rect.height) * GRID_SIZE);
  if (x < 0 || y < 0 || x >= GRID_SIZE || y >= GRID_SIZE) return hideTooltip();
  const edge = Math.min(x, y, GRID_SIZE - 1 - x, GRID_SIZE - 1 - y) === 0;
  showTooltip(
    event,
    `Household (${x}, ${y})<br>${STATE_STYLE[grid[y][x]].label}${edge ? '<br>on the footprint boundary' : ''}`,
  );
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
