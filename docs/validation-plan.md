# ClimateGuard Validation Plan

## Goal

Validate that ClimateGuard returns complete, credible, and actionable outputs for high-risk U.S. locations before judging.

## Test Dataset

- Source file: `data/test-addresses.csv`
- Coverage: 15 addresses across CA, FL, TX, LA, NY
- Hazard mix: coastal flood, inland flood, wildfire, heat, and storm exposure

## Expected Output Fields

1. `inputAddress`
2. `resolvedAddress`
3. `location.lat`
4. `location.lon`
5. `location.tractFips`
6. `location.countyFips`
7. `fiveYearRiskScore`
8. `riskLevel`
9. `breakdown` (`flood`, `wildfire`, `heat`, `severeWeather`)
10. `topHazard`
11. `activeAlerts`
12. `actions`
13. `confidence`
14. `dataSources`
15. `generatedAt`

## Address-by-Address Expectations

| Label | Expected dominant risk |
| --- | --- |
| CA-Coastal-01 | Flood |
| CA-Wildfire-02 | Wildfire |
| CA-Heat-03 | Heat or wildfire |
| FL-Coastal-04 | Flood |
| FL-LowElevation-05 | Flood |
| FL-GulfCoast-06 | Flood |
| TX-UrbanFlood-07 | Flood or severe weather |
| TX-Coastal-08 | Flood |
| TX-HeatDrought-09 | Heat |
| LA-DeltaFlood-10 | Flood |
| LA-Hurricane-11 | Flood or severe weather |
| LA-InlandFlood-12 | Flood or heat |
| NY-Coastal-13 | Flood |
| NY-Surge-14 | Flood |
| NY-Rockaway-15 | Flood |

## Test Procedure

1. Run all 15 addresses sequentially in one session.
2. Confirm every address returns a score, top hazard, actions, and source data.
3. Compare `topHazard` against the expected dominant risk category.
4. Check that each result contains at least 3 concrete mitigation actions.
5. Inspect whether high-risk showcase addresses produce believable levels for demo use.

## Pass Criteria

- Completion: 100% of addresses return without error.
- Dominant hazard relevance: >= 70% expected-hazard match rate.
- Usability: 100% of successful responses include at least 3 actions.
- Demo credibility: Miami Beach, Paradise, Houston, and Galveston should no longer return obviously low scores.
