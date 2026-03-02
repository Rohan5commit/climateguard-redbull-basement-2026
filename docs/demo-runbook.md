# ClimateGuard Live Demo Runbook (Under 60 Seconds)

## Pre-Demo Setup (complete before timer starts)

1. Set `GEMINI_API_KEY` in `.env.local` (only required key).
2. In terminal: `npm run dev`
3. Open app at `http://localhost:3000`
4. Keep `data/test-addresses.csv` open for copy/paste
5. Prepare two addresses:
   - FL-Coastal-04 (`1100 S Ocean Dr, Miami Beach, FL 33139`)
   - CA-Wildfire-02 (`15300 Skyway, Magalia, CA 95954`)

Data sources in demo mode are free/public: OSM Nominatim, FEMA OpenFEMA, NOAA/NWS alerts.

## 60-Second Live Sequence

| Time | Action | Talk Track |
| --- | --- | --- |
| 0:00-0:08 | Paste FL-Coastal-04 and submit | "One address in. ClimateGuard returns household risk in seconds." |
| 0:08-0:20 | Show overall score, top hazard, active alerts | "This home is surge-exposed with active coastal risk right now." |
| 0:20-0:32 | Point to recommended actions | "It does not stop at risk; it gives immediate actions in priority order." |
| 0:32-0:42 | Replace with CA-Wildfire-02 and submit | "Now same flow for a different hazard profile." |
| 0:42-0:54 | Show hazard shift and updated checklist | "The engine adapts by location: wildfire and heat actions replace flood guidance." |
| 0:54-1:00 | Close | "ClimateGuard turns climate data into a 60-second decision tool." |

## Fallback (if internet/API is unstable)

1. Use cached/sample output for the same two addresses.
2. Keep timing and narrative identical.
3. State clearly: "This is cached output; model behavior is unchanged."
