# ClimateGuard Live Demo Runbook

## Pre-Demo Setup

1. Run `npm run dev`
2. Open `http://localhost:3000`
3. Optional: set an Azure OpenAI, Gemini, or NVIDIA NIM key in `.env.local` for model-generated advisories.
4. Prepare these addresses:
   - `1100 S Ocean Dr, Miami Beach, FL 33139`
   - `1411 Clark Rd, Paradise, CA 95969`
   - `1000 Bagby St, Houston, TX 77002`

## 60-Second Demo Flow

| Time | Action | Talk track |
| --- | --- | --- |
| 0:00-0:08 | Paste Miami Beach and submit | "One address in, and ClimateGuard turns public climate data into a five-year household risk outlook." |
| 0:08-0:20 | Show score, top hazard, and active alerts | "This location is lifted by flood and hurricane pressure, not just a generic weather alert." |
| 0:20-0:32 | Show actions and assistance links | "It does not stop at risk. It tells the resident what to do next and where to look for support." |
| 0:32-0:44 | Switch to Paradise and submit | "Now the same flow pivots to a different risk profile." |
| 0:44-0:54 | Show wildfire-led result | "The top hazard changes, the checklist changes, and the explanation changes with it." |
| 0:54-1:00 | Close | "ClimateGuard is the fastest path from public climate data to household readiness." |

## Fallback

If live internet or an AI provider is unstable:

1. Keep the same three addresses ready.
2. Use the app anyway; the scoring path still works with public data.
3. If the advisory provider is unavailable, call out that the deterministic advisory template fallback is active.
