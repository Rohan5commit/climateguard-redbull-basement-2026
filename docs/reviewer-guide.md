# ClimateGuard Reviewer Guide

## Fastest Way To Check The Project

```bash
npm install
cp .env.example .env.local
npm run reviewer:check
```

That command starts the app locally if needed, validates the `POST /api/risk` route against three representative addresses, and verifies the main UI flow in a real browser session.

## Manual Check

1. Run `npm run dev`
2. Open `http://localhost:3000`
3. Test:
   - `1100 S Ocean Dr, Miami Beach, FL 33139`
   - `1411 Clark Rd, Paradise, CA 95969`
   - `1000 Bagby St, Houston, TX 77002`
4. Confirm that each run returns:
   - A 5-year score
   - A top hazard
   - A plain-language advisory
   - A mitigation checklist
   - Assistance links
   - Data source status

## Notes

- The app works without an AI API key by falling back to deterministic advisory text.
- Reviewer-facing validation output is in `data/validation-output.json`.
- Current demo screenshots are in `docs/demo-screenshots/`.
