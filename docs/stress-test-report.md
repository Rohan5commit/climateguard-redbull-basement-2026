# ClimateGuard Stress Test Report

Generated: 2026-03-22T09:54:53.914Z
Base URL: http://localhost:3000
Profile: smoke

## Aggregate Summary

- Total requests: 13388
- Success rate: 100%
- Schema-valid success rate: 100%
- Total duration: 31.55s
- Aggregate throughput: 424.34 req/s
- Latency avg/p95/p99: 8.41 / 11.68 / 17.9 ms

## Scenario Results

| Scenario | Requests | Success % | Schema % | Throughput req/s | Avg ms | P95 ms | P99 ms |
|---|---:|---:|---:|---:|---:|---:|---:|
| warmup | 12 | 100 | 100 | 1.81 | 988.53 | 2420.16 | 2448.53 |
| load-medium | 24 | 100 | 100 | 7.87 | 470.89 | 2098.88 | 2822.63 |
| load-high | 36 | 100 | 100 | 19.27 | 275.56 | 1838.45 | 1861.23 |
| soak-20s | 13316 | 100 | 100 | 665.72 | 5.97 | 11.35 | 17.15 |

## Advisory Source Distribution

- AI Advisory: 13388

## Error Hotspots

- None

## Notes

- This test uses live external dependencies (Census/FEMA/NOAA plus any configured AI providers). Results include real network effects.
- No external AI key was active in this run, so deterministic advisory templates handled responses.
- Zero 5xx and high schema-valid rates are the primary release gate for competition demo reliability.