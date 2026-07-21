# Spatial Affectability

### A spatial simulation for Stakeholder Engagement Plans

An interactive simulation showing how support and opposition to an infrastructure project spread through an affected community, and how compensation fairness, stakeholder engagement and grievance handling change the outcome.

> **Status: work in progress.** Core engine under construction. Built during the
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
- **Edge effects** concentrating opposition along the project footprint
- **Phase transition**: a threshold below which the whole grid flips to opposition
- **Grievance backlog spiral**: unresolved grievances feeding rumour propagation in a self-reinforcing loop

---

## Roadmap

- [ ] Phase 1 — Core engine: `computeNeighbourPayoff`, `computeCellPayoff`, `stepGeneration` as pure functions
- [ ] Phase 2 — Unit tests, with explicit coverage of fixed-edge neighbour counts
- [ ] Phase 3 — Canvas rendering, playback controls, live parameter sliders, state time-series
- [ ] Phase 4 — Preset scenarios, explanatory panel, deployment

---

## Data

**All data is synthetic.** No real project, community, or field data is used anywhere in this repository.

---

## Scientific grounding

Full annotated bibliography in [`REFERENCES.md`](REFERENCES.md). In short:

- **States** — Thomson & Boutilier (2011), four-level social licence to operate; Zhang et al. (2021), agent-based model of social risk on infrastructure projects
- **Dynamics** — Granovetter (1978), threshold models of collective behaviour; Schelling (1971), dynamic models of segregation; Nowak & May (1992), the source model
- **Parameters** — Cernea (1997), impoverishment risks and reconstruction, in particular social disarticulation; IFC Performance Standards 1 and 5

---

## License

MIT. See [`LICENSE`](LICENSE).
