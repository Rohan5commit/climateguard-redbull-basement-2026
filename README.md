# ClimateGuard - Red Bull Basement 2026 MVP

ClimateGuard is a full-stack Next.js MVP for **Red Bull Basement 2026**.
It gives homeowners and renters a plain-language **5-year climate risk outlook** from a single U.S. address.

## Why this project is competition-ready

- Solves an emotional, high-stakes problem: households often learn risk too late.
- Uses AI at the core: risk data is translated into concise action guidance.
- Is easy to explain and demo in 60 seconds.
- Includes measurable outputs: risk score, hazard breakdown, actions, and source confidence.

## MVP capabilities

- Address/ZIP input and hyperlocal geocoding.
- Composite risk scoring (0-100) with hazard breakdown:
  - Flood
  - Wildfire
  - Severe weather
- AI advisory layer:
  - Primary: Azure OpenAI
  - Fallback: OpenAI API
  - Final fallback: deterministic template when no keys are configured
- Assistance program links (federal + selected state resources).
- Data-source transparency (`live`, `fallback`, `unavailable`).
- Validation package with 15 high-risk U.S. addresses.

## Tech stack

- Next.js 16 (App Router, TypeScript)
- React 19
- `openai` SDK (Azure/OpenAI support)
- `zod` for API input validation

## Data sources used

- Azure Maps Geocoding (primary, if configured)
- OpenStreetMap Nominatim (fallback geocoder)
- FEMA Open Data - Disaster Declarations
- NOAA/NWS Active Alerts API
- First Street Risk API (optional enrichment if key is configured)

## Quick start

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open: `http://localhost:3000`

## Environment variables

Set these in `.env.local`:

```bash
# Azure Maps geocoding
AZURE_MAPS_KEY=

# Azure OpenAI (recommended)
AZURE_OPENAI_ENDPOINT=
AZURE_OPENAI_API_KEY=
AZURE_OPENAI_DEPLOYMENT=
AZURE_OPENAI_API_VERSION=2024-10-21

# Optional fallback if Azure OpenAI is not configured
OPENAI_API_KEY=

# Optional property-level risk enrichment
FIRST_STREET_API_KEY=
FIRST_STREET_API_BASE=https://api.firststreet.org/v1
```

## API

### `POST /api/risk`

Request body:

```json
{
  "address": "1100 S Ocean Dr, Miami Beach, FL 33139"
}
```

Response includes:

- `fiveYearRiskScore` (0-100)
- `riskLevel` (`Low|Moderate|High|Severe`)
- `breakdown` (flood/wildfire/severeWeather)
- `advisory` (AI-generated or fallback)
- `actions` (prioritized mitigation steps)
- `assistancePrograms`
- `dataSources`

## Validation workflow

1. Run the app (`npm run dev`)
2. Run:

```bash
npm run validate:addresses
```

This reads `data/test-addresses.csv` and writes `data/validation-output.json`.

## Submission assets included

- `docs/pitch-script.md`
- `docs/problem-story.md`
- `docs/judges-one-pager.md`
- `docs/validation-plan.md`
- `docs/demo-runbook.md`
- `data/test-addresses.csv`

## Build and quality checks

```bash
npm run lint
npm run build
```

## Deploy

Recommended: Vercel

1. Import this repo into Vercel.
2. Add the same environment variables in project settings.
3. Deploy.

## Notes

- The app runs without keys using fallbacks, but quality and confidence are higher with Azure Maps + Azure OpenAI + First Street configured.
- This MVP is for early warning and action planning, not legal/insurance underwriting decisions.
