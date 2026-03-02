# ClimateGuard Stress Test Report

Generated: 2026-03-02T11:35:00.214Z
Base URL: http://localhost:3000

## Aggregate Summary

- Total requests: 1372719
- Success rate: 100%
- Schema-valid success rate: 100%
- Total duration: 751.23s
- Aggregate throughput: 1827.3 req/s
- Latency avg/p95/p99: 6.35 / 13.4 / 26.38 ms

## Scenario Results

| Scenario | Requests | Success % | Schema % | Throughput req/s | Avg ms | P95 ms | P99 ms |
|---|---:|---:|---:|---:|---:|---:|---:|
| warmup | 80 | 100 | 100 | 2.69 | 1482.31 | 5513.18 | 14227.82 |
| load-medium | 500 | 100 | 100 | 900.75 | 10.84 | 21.15 | 27.08 |
| load-high | 1200 | 100 | 100 | 1396.65 | 17.63 | 30.85 | 56.55 |
| soak-12m | 1370939 | 100 | 100 | 1903.8 | 6.25 | 13.31 | 26.28 |

## Advisory Source Distribution

- NVIDIA NIM Advisory: 1372719

## Error Hotspots

- None

## Notes

- This test uses live external dependencies (OSM/FEMA/NOAA + AI providers). Results include real network effects.
- Zero 5xx and high schema-valid rates are the primary release gate for competition demo reliability.