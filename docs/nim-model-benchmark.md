# NVIDIA NIM Chat Model Benchmark

Generated: 2026-03-02T10:13:22.004Z

## Scope

- Script: `scripts/benchmark-nim-models.mjs`
- Raw output: `data/nim-benchmark-results.json`
- Endpoint discovery: `GET /v1/models`
- Tested models: exactly 10 likely top-tier instruct/chat models selected from available catalog
- Prompts per model (3):
  1. Structured JSON instruction-following
  2. Concise risk advisory writing quality
  3. Simple reasoning/consistency

## Scoring

- Success Rate (%) = successful responses / 3 prompts
- Mean Latency (ms) = average response latency across 3 prompts
- Parseability/Compliance Score (0-100) = instruction adherence and output-format compliance checks
- Simple Task Correctness Score (0-100) = objective correctness on deterministic tasks
- Overall Weighted Score (0-100):
  - Success Rate: 30%
  - Parseability/Compliance: 25%
  - Simple Task Correctness: 30%
  - Latency Score (normalized inverse latency): 15%

## Ranked Results

| Rank | Model | Success Rate % | Mean Latency (ms) | Parseability/Compliance | Task Correctness | Overall |
|---|---|---:|---:|---:|---:|---:|
| 1 | `meta/llama-3.3-70b-instruct` | 100 | 616.09 | 90.48 | 100.00 | 94.41 |
| 2 | `qwen/qwen2.5-coder-32b-instruct` | 100 | 956.97 | 95.24 | 100.00 | 93.48 |
| 3 | `meta/llama-3.1-70b-instruct` | 100 | 770.63 | 95.24 | 50.00 | 79.64 |
| 4 | `meta/llama-3.1-8b-instruct` | 100 | 583.49 | 90.48 | 50.00 | 79.61 |
| 5 | `mistralai/mixtral-8x22b-instruct-v0.1` | 100 | 895.77 | 90.48 | 50.00 | 77.67 |
| 6 | `deepseek-ai/deepseek-r1-distill-llama-8b` | 100 | 2515.95 | 23.81 | 0.00 | 35.95 |
| 7 | `nvidia/llama-3.1-nemotron-70b-instruct` | 0 | 97.97 | 0.00 | 0.00 | 15.00 |
| 8 | `mistralai/mistral-large` | 0 | 112.80 | 0.00 | 0.00 | 14.91 |
| 9 | `meta/llama-3.1-405b-instruct` | 0 | 136.48 | 0.00 | 0.00 | 14.76 |
| 10 | `google/gemma-2-27b-it` | 0 | 282.54 | 0.00 | 0.00 | 13.86 |

## Reliability Notes

- `meta/llama-3.1-405b-instruct`, `nvidia/llama-3.1-nemotron-70b-instruct`, and `mistralai/mistral-large` returned HTTP 404 for all prompts in this account context (`Function ... not found`), despite appearing in `/v1/models`.
- `google/gemma-2-27b-it` returned HTTP 400 (`System role not supported`) for all prompts with this prompt format.
- `deepseek-ai/deepseek-r1-distill-llama-8b` responded successfully but often emitted long reasoning traces instead of required strict formats, which reduced compliance and correctness.

## Recommendation

Use `meta/llama-3.3-70b-instruct` as the NVIDIA secondary default.

Why this model is the best balance here:

- Highest overall weighted score (94.41) while maintaining 100% request success.
- Strong capability profile: 90.48 compliance and 100.00 deterministic correctness.
- Fast enough for secondary usage: 616.09 ms mean latency, materially faster than the next top-capability option (`qwen/qwen2.5-coder-32b-instruct` at 956.97 ms).
