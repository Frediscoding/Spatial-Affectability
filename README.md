# Spatial Affectability

### A spatial simulation for Stakeholder Engagement Plans

An interactive simulation showing how support and opposition to an infrastructure project spread through an affected community, and how compensation fairness, stakeholder engagement and grievance handling change the outcome.

**[Run it in your browser →](https://frediscoding.github.io/Spatial-Affectability/)**

> **Status: complete and running.** Engine, tests, interface, footprint import and
> explanatory panel are all in place; 117 tests passing. Built during the
> [Vibe Coding Studio](https://philomathlearning.com) (Philomath, Phillip Compeau, Carnegie Mellon University).

---

## Why this project

Infrastructure projects financed by international lenders (World Bank, AFD, AfDB, IFC) require a Stakeholder Engagement Plan and a Grievance Redress Mechanism. Practitioners know that social acceptability is not the sum of individual opinions: it is a **contagion phenomenon**. One badly handled household can flip an entire neighbourhood.

A systematic review of modelling studies found that **93% treat social acceptance as a static parametric input**, while nearly half of empirical studies document categorical, irreversible project outcomes. Almost every model treats acceptance as a constant to be set. The empirical record shows it behaves as a dynamic that flips.

This simulation treats it as a dynamic. It is deliberately **not predictive**. It is a thinking tool: it shows which levers produce non-linear effects, and where the tipping points are.

---

## The model

A direct adaptation of the **spatial prisoner's dilemma** (Nowak & May, 1992).

A 2D grid where each cell is one **affected household**, in one of three states:

| State | Meaning |
|---|---|
| `SUPPORTER` | Accepts the project, engages with the process |
| `OPPOSED` | Actively opposes the project |
| `UNDECIDED` | Waiting, not yet committed |

Each household scores its interaction with its eight neighbours and with the project itself, then adopts the state of whichever neighbour scored highest. Opposition coheres faster than support, which is the empirically interesting asymmetry.

**Grid edges are fixed, not wrapped into a torus.** This is a deliberate design decision. A torus would be simpler to implement but would erase **edge effects along the project footprint**, where households at the boundary of the affected area behave differently from those at the centre. That asymmetry is real in resettlement contexts and must survive into the model.

A household is on the perimeter when it has fewer than eight neighbours — because it is on the edge of the grid, or because it borders land outside the footprint. The simulation reports opposition on the perimeter and in the interior separately, since a single grid-wide percentage averages away exactly the effect being looked for.

### Parameters

| Parameter | Real-world meaning |
|---|---|
| `compensationFairness` | How fair and timely the compensation is perceived to be |
| `engagementIntensity` | Frequency and quality of consultation and information disclosure |
| `grievanceResolutionRate` | Share of grievances resolved within the committed timeframe |
| `rumorPropagation` | Speed at which unverified information spreads |
| `conflictCost` | Social cost of disagreeing with a neighbour |
| `noise` | Random conversion rate |

### What to look for

- **Opposition pockets** surviving even under high compensation, protected by internal solidarity
- **Edge effects** along the project footprint: opposition on the perimeter behaving differently from opposition inside
- **Phase transition**: a threshold below which the whole grid flips to opposition
- **Grievance backlog spiral**: unresolved grievances feeding rumour propagation in a self-reinforcing loop

---

## Importing a project footprint

The simulation opens on a plain 60 × 60 rectangle. That rectangle has no scale and no geography, which is what makes it useful: it is the control case.

You can then import the real outline of a project — **`.kmz`, `.kml` or `.geojson`**, the formats Google Earth and any GIS export — and the simulation runs **inside the polygon**. Cells outside it are not households: they have no position, they never update, and they are excluded from every percentage on screen. The perimeter of the polygon becomes the edge of the affected area.

This is the same fixed-edge rule as before, generalised. A household on the lip of a concavity in the footprint has fewer neighbours in exactly the way a corner household does, so the edge effects follow the real shape of the project instead of an arbitrary rectangle. Two consequences worth watching for:

- a **narrow waist** in the footprint nearly separates two parts of the community, and they can tip independently;
- a **hole** — a parcel not being acquired — creates an interior perimeter, with the same volatility as the outer one.

**You choose the cell size in metres, not the size of the grid.** The grid is derived from it. A cell then stands for a fixed area of ground whatever the project, so two footprints can be compared; with a fixed grid stretched over the bounding box, a cell would mean twenty metres on one project and two kilometres on another. A cell counts as inside the footprint when its centre is.

`examples/synthetic-footprint.kml` is an invented outline for trying this without a GIS. It has a concavity, a narrow waist and a hole.

`examples/skull-footprint.kml` is the same idea drawn as a skull, and it exercises the import harder: two disjoint polygons, several holes in one of them, and enough concavity to put 34% of the households on a perimeter, against 28% for the outline above. It reads as a face at 50 m per cell.

The reader has no dependencies: a `.kmz` is a ZIP, and `DecompressionStream` is part of the platform.

---

## Running it locally

Node 22 or later. There are no dependencies to install — the project uses only the standard library, in the browser and in Node.

```sh
npm start          # serves http://localhost:8000
npm test           # 117 tests, no test framework
```

Opening `index.html` straight from the file system will not work: browsers refuse to load ES modules over `file://`, which is what `serve.mjs` exists to solve.

---

## Roadmap

- [x] Phase 1 — Core engine: `computeNeighbourPayoff`, `computeCellPayoff`, `stepGeneration` as pure functions
- [x] Phase 2 — Unit tests, with explicit coverage of fixed-edge neighbour counts
- [x] Phase 3 — Canvas rendering, playback controls, live parameter sliders, state time-series
- [x] Phase 4 — Preset scenarios, footprint import, perimeter-versus-interior statistics
- [x] Phase 5 — Explanatory panel and deployment

---

## Data

**All data is synthetic.** No real project, community, or field data is used anywhere in this repository, and none is ever uploaded: an imported footprint is read in the browser and never leaves it.

---

## Scientific grounding

Full annotated bibliography in [`REFERENCES.md`](REFERENCES.md). In short:

- **States** — Thomson & Boutilier (2011), four-level social licence to operate; Zhang et al. (2021), agent-based model of social risk on infrastructure projects
- **Dynamics** — Granovetter (1978), threshold models of collective behaviour; Schelling (1971), dynamic models of segregation; Nowak & May (1992), the source model
- **Parameters** — Cernea (1997), impoverishment risks and reconstruction, in particular social disarticulation; IFC Performance Standards 1 and 5

---

## License

MIT. See [`LICENSE`](LICENSE).
