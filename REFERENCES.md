# Spatial Affectability — Scientific grounding

> Literature supporting the model. Organised by the function each reference serves in the simulation,
> not alphabetically, so that each modelling choice can be traced back to published work.

**Note on redistribution:** this file contains citations and links only. Publisher-copyrighted PDFs
(Elsevier, ASCE, Springer) must not be committed to a public repository. Open-access items are marked
`[OA]` and may be linked freely.

---

## 1. Behavioural categories — grounding the discrete states

### Thomson, I., & Boutilier, R. G. (2011). *The social licence to operate.*
In P. Darling (Ed.), *SME Mining Engineering Handbook* (3rd ed.). Society for Mining, Metallurgy and Exploration.

The canonical model of community response to a project, structured as a four-level hierarchy:

| Level | Community position |
|---|---|
| Withheld / withdrawn | No support. The project is seen as illegitimate and cannot proceed |
| Acceptance | Not actively opposed |
| Approval | Viewed positively |
| Psychological identification | Co-ownership, active support |

Movement between levels is gated by three successive conditions: **legitimacy** lifts a community from
withholding to acceptance, **credibility** from acceptance to approval, **trust** from approval to
co-identification.

**Why it matters here:** it validates both the use of discrete states and the idea that transitions are
threshold-gated rather than continuous. It also justifies extending the model from 3 to 4 states if the
simulation needs finer resolution. A companion methodological paper, *Modelling and Measuring the SLO*,
is available on socialicense.com `[OA]`.

### Zhang et al. (2021). *Agent-Based Simulation Model for Investigating the Evolution of Social Risk in Infrastructure Projects in China: A Social Network Perspective.* Sustainable Cities and Society.

Simulates the general public in **five behavioural states**: appeal, pussyfoot, probably protest, protest,
withdraw, propagated over a social network.

**Why it matters here:** closest published precedent to this project. It establishes that agent-based
modelling of affected-community behaviour on infrastructure projects is an accepted method, and offers an
alternative state vocabulary should the three-state model prove too coarse.

---

## 2. Transition dynamics — grounding the update rule and the tipping point

### Granovetter, M. (1978). *Threshold Models of Collective Behavior.* American Journal of Sociology, 83(6), 1420-1443.

Each individual holds a **threshold**: the proportion of their network that must have adopted a behaviour
before they adopt it themselves. Originally formulated to explain the onset of protests and riots.

**Why it matters here:** the theoretical foundation of the phase transition. It explains why a small change
in a parameter can flip an entire population, and why the distribution of thresholds matters more than the
average sentiment.

### Schelling, T. C. (1971). *Dynamic Models of Segregation.* Journal of Mathematical Sociology, 1(2), 143-186.

The methodological ancestor: the first cellular automaton applied to a social question. Shows that weak
individual preferences produce strong collective segregation.

**Why it matters here:** pre-empts the objection that will come at the showcase, namely whether a grid can
legitimately represent a society. Schelling is the standard answer, and the standard caveat: these models
explain mechanisms, they do not predict outcomes.

### Nowak, M. A., & May, R. M. (1992). *Evolutionary games and spatial chaos.* Nature, 359, 826-829.

The direct source model. Spatial prisoner's dilemma on a lattice with imitate-the-best-neighbour updating.

### Ye, M. et al. (2020). *A network-based microfoundation of Granovetter's threshold model for social tipping.* Scientific Reports, 10, 10717. `[OA]`

Connects individual thresholds to neighbourhood structure explicitly. Available on arXiv (1911.04126) and
via Nature Scientific Reports under open access.

**Why it matters here:** the most directly reusable modern bridge between the sociological theory and the
lattice implementation.

---

## 3. Domain content — grounding the parameters

### Cernea, M. M. (1997). *The risks and reconstruction model for resettling displaced populations.* World Development, 25(10), 1569-1587.

Built on two decades of empirical resettlement data. Identifies **eight impoverishment risks**:

1. Landlessness
2. Joblessness
3. Homelessness
4. Marginalisation
5. Increased morbidity and mortality
6. Food insecurity
7. Loss of access to common property resources
8. **Social disarticulation** — disintegration of community structures, social networks and ties

**Why it matters here:** risk 8 is the strongest theoretical bridge to the model. Social disarticulation is
precisely what the `conflictCost` parameter represents. The other seven give an empirical basis for
calibrating payoffs instead of setting them arbitrarily. A UN background paper by Cernea covering the same
model is freely downloadable `[OA]`.

### IFC Performance Standard 5 — Land Acquisition and Involuntary Resettlement. `[OA]`
### IFC Performance Standard 1 — Assessment and Management of Environmental and Social Risks and Impacts. `[OA]`

PS1 covers stakeholder engagement and grievance mechanisms, PS5 covers compensation and livelihood
restoration. Both are freely published by IFC and map directly onto the simulation parameters. Both are
currently under revision, the first update in more than a decade.

---

## 4. The gap this project addresses

### *Incorporating Social Acceptance into Sustainable Power System Planning: A Systematic Analysis of Modelling Approaches and Empirical Outcomes.* Sustainability, MDPI. `[OA]`

Systematic review finding that **93% of modelling studies treat social acceptance as a static parametric
input**, while **46.9% of empirical studies document categorical, irreversible project outcomes**.

**Why it matters here:** this is the one-sentence justification for the whole project. Nearly all models
treat social acceptance as a constant to be set. The empirical record shows it behaves as a dynamic that
flips. This simulation treats it as a dynamic.

---

## 5. How to cite this in the showcase

Suggested framing, three sentences:

> Social acceptance of infrastructure projects is usually modelled as a fixed input. The empirical
> literature says otherwise: communities move between discrete positions (Thomson & Boutilier, 2011),
> transitions are threshold-driven (Granovetter, 1978), and the loss of community cohesion is a documented
> impoverishment risk in its own right (Cernea, 1997). This simulation puts those three findings on a
> lattice and lets you watch the tipping point.
