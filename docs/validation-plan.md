# ClimateGuard Validation Plan

## Goal

Validate that ClimateGuard returns consistent, credible, and actionable risk outputs for high-risk US locations before live judging.

## Test Dataset

- Source file: `data/test-addresses.csv`
- Coverage: 15 addresses across CA, FL, TX, LA, NY
- Mix: coastal flood/surge, inland flood, wildfire, and extreme heat

## Expected Output Fields (per address)

1. `input_address` (raw string submitted)
2. `normalized_address` (standardized postal format)
3. `latitude`
4. `longitude`
5. `overall_risk_score` (0-100)
6. `overall_risk_level` (`Low` | `Moderate` | `High` | `Severe`)
7. `hazard_breakdown` (flood, surge, wildfire, heat, wind)
8. `top_hazard` (highest contributing hazard)
9. `active_alerts` (NWS/agency alert count + titles)
10. `next_24h_summary` (1-2 sentence plain-language summary)
11. `recommended_actions` (3 prioritized actions)
12. `confidence` (data freshness + confidence label)
13. `last_updated_utc`

## Address-by-Address Expectations

| Label | Expected dominant risk |
| --- | --- |
| CA-Coastal-01 | Coastal flood/erosion |
| CA-Wildfire-02 | Wildfire exposure |
| CA-Heat-03 | Extreme heat |
| FL-Coastal-04 | Storm surge + hurricane wind |
| FL-LowElevation-05 | Surge/tidal flooding |
| FL-GulfCoast-06 | Hurricane + flood |
| TX-UrbanFlood-07 | Heavy rain/urban flooding |
| TX-Coastal-08 | Surge + hurricane wind |
| TX-HeatDrought-09 | Extreme heat + drought stress |
| LA-DeltaFlood-10 | River/coastal flooding |
| LA-Hurricane-11 | Hurricane wind + flood |
| LA-InlandFlood-12 | Flash flood + heat |
| NY-Coastal-13 | Coastal storm surge |
| NY-Surge-14 | Surge + heavy rain |
| NY-Rockaway-15 | Coastal flood + wind |

## Test Procedure

1. Run all 15 addresses sequentially in one session.
2. Re-run 5 random addresses after 30 minutes to check score stability.
3. Compare top hazard against each address `risk_profile` expectation.
4. Verify all required fields are present and non-empty.
5. Check that recommended actions are hazard-specific (not generic).

## Pass/Fail Criteria

- Pass completeness: 100% of addresses return all required fields.
- Pass relevance: >= 13/15 addresses match expected dominant risk category.
- Pass consistency: re-run score delta <= 10 points when no major alert change occurs.
- Pass usability: each result includes at least 3 concrete action steps.
- Fail trigger: any crash, blank output, or non-actionable recommendations.

## Demo Readiness Exit Criteria

ClimateGuard is demo-ready when all pass criteria are met in one clean run and one re-run sample check.
