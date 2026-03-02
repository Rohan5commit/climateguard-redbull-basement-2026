# ClimateGuard - Red Bull Basement 2026 MVP

ClimateGuard is a full-stack Next.js MVP for **Red Bull Basement 2026**.
It gives homeowners and renters a plain-language **5-year climate risk outlook** from a single U.S. address.

## Why this project is competition-ready

- Solves a high-stakes household problem: climate risk is hard to interpret quickly.
- Uses AI to translate risk data into concise action guidance.
- Is easy to explain and demo in 60 seconds.
- Produces measurable outputs: risk score, hazard breakdown, actions, and source confidence.

## MVP capabilities

- Address/ZIP input and hyperlocal geocoding.
- Composite risk scoring (0-100) with hazard breakdown:
  - Flood
  - Wildfire
  - Severe weather
- AI advisory generation:
  - Primary: Gemini
  - Backup (optional): NVIDIA NIM
- Assistance program links (federal + selected state resources).
- Data-source transparency (`live`, `fallback`, `unavailable`).
- Validation package with 15 high-risk U.S. addresses.

## Tech stack

- Next.js 16 (App Router, TypeScript)
- React 19
- Gemini API integration for advisory output
- `zod` for API input validation

## Free data sources used

- OSM Nominatim (OpenStreetMap geocoding)
- FEMA OpenFEMA datasets
- NOAA/NWS alerts

## Quick start

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open: `http://localhost:3000`

## Environment variables

Set this in `.env.local`:

```bash
GEMINI_API_KEY=
GEMINI_MODEL=gemini-2.0-flash

# Optional backup if Gemini is unavailable
NVIDIA_NIM_API_KEY=
NVIDIA_NIM_BASE_URL=https://integrate.api.nvidia.com/v1
NVIDIA_NIM_MODEL=meta/llama-3.3-70b-instruct
```

`GEMINI_API_KEY` is the only required key. Data retrieval uses free public sources.
`NVIDIA_NIM_API_KEY` is optional and used only as advisory fallback.
Default fallback model is `meta/llama-3.3-70b-instruct` based on the benchmark in `docs/nim-model-benchmark.md`.

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
- `advisory`
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
2. Add `GEMINI_API_KEY` (and optionally `NVIDIA_NIM_API_KEY`) in project settings.
3. Deploy.

## Notes

- ClimateGuard is documented here as a strict free-data stack: OSM Nominatim + FEMA OpenFEMA + NOAA/NWS alerts.
- This MVP is for early warning and action planning, not legal/insurance underwriting decisions.
