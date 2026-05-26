# VOL Demo Data

This folder contains the active synthetic demo data layer for VOL Health.

## Sources

The files in `data/source` were copied from the parsed synthetic JSON datasets stored in OneDrive under:

`C:\Users\hudso\OneDrive\VOL Health\Hud's Notes\Mock Datasets`

Current source files:

- `parsed-maple-glen.json`
- `parsed-cedar-ridge.json`
- `parsed-willow-creek.json`
- `parsed-river-bend.json`
- `parsed-oak-hollow.json`
- `parsed-keel-place.json`

## Normalized Output

`demo-communities.json` is the clean reusable data source intended to support Daily rEDi, Data Demo, weekly trend tables, and future Stability Map context.

Each normalized community keeps:

- current VI and WSI readiness scores
- weekly trend rows
- staffing, resident demand, leadership, care coordination, family communication, and economic signal groups
- operational focus, watch item, consequence, priority actions, and top-five leadership queue
- the original parsed object under `rawSource`

The latest available weekly signal row is used as the current operating snapshot for each community. Fields that are not direct source fields, such as `stabilityTier`, `watchItem`, `operationalConsequence`, `priorityActions`, `top5Queue`, and `rEDiContextSummary`, are derived from the source signals and listed in each record's `normalizationNotes.inferredFields`.
