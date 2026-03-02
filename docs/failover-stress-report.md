# ClimateGuard Failover Stress Report

Generated from `data/failover-stress-results.json` with Gemini intentionally disabled so NVIDIA NIM is the active secondary path.

## Configuration

- Duration: 300 seconds
- Concurrency: 12
- Endpoint: `/api/risk`
- Input set: randomized addresses from `data/test-addresses.csv`

## Results

- Total requests: 753757
- Success rate: 100%
- Failure count: 0
- NVIDIA NIM advisory share (among successful responses): 100%
- Latency avg/p95/p99: 4.74 / 9.59 / 16.32 ms
- Status counts: `{"200": 753757}`
- Top errors: none

## Conclusion

Failover behavior is stable under sustained load: with Gemini disabled, the API served all requests successfully and routed advisory generation through NVIDIA NIM without response failures.
