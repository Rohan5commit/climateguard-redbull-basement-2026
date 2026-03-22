# ClimateGuard Judges One-Pager

## What ClimateGuard Does

ClimateGuard converts public U.S. climate-risk data into one household decision tool: enter an address, get a five-year score, top hazard, active alerts, and immediate actions.

## Deployment Architecture

- **Production AI path:** Azure OpenAI (`gpt-4o`)
- **Demo fallback:** Gemini
- **Failover:** NVIDIA NIM
- **Core data stack:** U.S. Census Geocoder + FEMA National Risk Index + FEMA disaster history + NOAA/NWS alerts

## Why This Idea Wins

### 1) Problem Urgency

- Families rarely get one clear answer about their real climate exposure before insurance or disaster forces a decision.
- Existing tools are fragmented across maps, alerts, and specialist terminology.
- ClimateGuard compresses that confusion into one address-first workflow.

### 2) Differentiation

- Address-first UX instead of expert-only map layers.
- Combines tract-level exposure, county-level climate pressure, and live alerts in one score.
- Converts risk into action steps and assistance links, not just a visualization.

### 3) Sponsor Fit

- Azure OpenAI is already supported as the production advisory path.
- The scoring architecture is lightweight, explainable, and fit for AMD-backed cloud scaling.
- It is easy to demo live in under one minute, which matters for Red Bull judging.

### 4) Feasibility

- Built on available public data.
- One API route, one UI, one demo loop.
- Validation set already prepared across high-risk U.S. regions.

### 5) Social Value

- Helps renters and homeowners act earlier.
- Makes climate preparedness easier to understand for non-experts.
- Surfaces assistance pathways alongside risk, which improves practical resilience.

## What Judges Should Remember

ClimateGuard is not another climate dashboard. It is a household decision engine built for the minute before action.
