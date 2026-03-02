import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";

const BASE_URL = process.env.CLIMATEGUARD_BASE_URL ?? "http://localhost:3000";
const INPUT_CSV = resolve("data/test-addresses.csv");
const OUTPUT_JSON = resolve("data/stress-test-results.json");
const OUTPUT_MD = resolve("docs/stress-test-report.md");

const SCENARIOS = [
  {
    id: "warmup",
    description: "Warmup and initial correctness scan",
    requests: 80,
    concurrency: 4,
    timeoutMs: 30000,
  },
  {
    id: "load-medium",
    description: "Medium sustained concurrent load",
    requests: 500,
    concurrency: 10,
    timeoutMs: 30000,
  },
  {
    id: "load-high",
    description: "High load burst",
    requests: 1200,
    concurrency: 25,
    timeoutMs: 35000,
  },
  {
    id: "soak-12m",
    description: "Long soak run for stability under continuous pressure",
    durationSec: 720,
    concurrency: 12,
    timeoutMs: 35000,
  },
];

function parseCsv(csvText) {
  const [headerLine, ...rowLines] = csvText.trim().split(/\r?\n/);
  const headers = headerLine.split(",").map((header) => header.trim());

  return rowLines
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(",");
      const row = {};
      headers.forEach((header, index) => {
        row[header] = (parts[index] ?? "").trim();
      });
      return row;
    });
}

function percentile(sortedValues, p) {
  if (sortedValues.length === 0) {
    return 0;
  }

  const rank = (p / 100) * (sortedValues.length - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);

  if (lower === upper) {
    return sortedValues[lower];
  }

  const weight = rank - lower;
  return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
}

function summarizeLatencies(latenciesMs) {
  if (latenciesMs.length === 0) {
    return {
      min: 0,
      avg: 0,
      p50: 0,
      p90: 0,
      p95: 0,
      p99: 0,
      max: 0,
    };
  }

  const sorted = [...latenciesMs].sort((a, b) => a - b);
  const total = latenciesMs.reduce((sum, value) => sum + value, 0);

  return {
    min: Number(sorted[0].toFixed(2)),
    avg: Number((total / latenciesMs.length).toFixed(2)),
    p50: Number(percentile(sorted, 50).toFixed(2)),
    p90: Number(percentile(sorted, 90).toFixed(2)),
    p95: Number(percentile(sorted, 95).toFixed(2)),
    p99: Number(percentile(sorted, 99).toFixed(2)),
    max: Number(sorted[sorted.length - 1].toFixed(2)),
  };
}

function buildAddress(row) {
  return `${row.address}, ${row.city}, ${row.state} ${row.zip}`;
}

function pickRandomAddress(rows) {
  const index = Math.floor(Math.random() * rows.length);
  return rows[index];
}

function findAdvisorySource(dataSources) {
  if (!Array.isArray(dataSources)) {
    return null;
  }

  const match = dataSources.find(
    (source) => source && typeof source.name === "string" && source.name.includes("Advisory"),
  );

  return match ?? null;
}

function validatePayload(payload) {
  const issues = [];

  if (!payload || typeof payload !== "object") {
    return {
      valid: false,
      issues: ["payload_not_object"],
    };
  }

  if (typeof payload.fiveYearRiskScore !== "number") {
    issues.push("missing_or_invalid_fiveYearRiskScore");
  }

  if (!["Low", "Moderate", "High", "Severe"].includes(payload.riskLevel)) {
    issues.push("missing_or_invalid_riskLevel");
  }

  if (!payload.breakdown || typeof payload.breakdown !== "object") {
    issues.push("missing_breakdown");
  } else {
    for (const key of ["flood", "wildfire", "severeWeather"]) {
      if (typeof payload.breakdown[key] !== "number") {
        issues.push(`invalid_breakdown_${key}`);
      }
    }
  }

  if (!Array.isArray(payload.actions) || payload.actions.length === 0) {
    issues.push("missing_actions");
  }

  if (!Array.isArray(payload.dataSources) || payload.dataSources.length === 0) {
    issues.push("missing_dataSources");
  }

  if (typeof payload.advisory !== "string" || payload.advisory.trim().length < 20) {
    issues.push("advisory_too_short_or_missing");
  }

  return {
    valid: issues.length === 0,
    issues,
  };
}

async function runRequest({ baseUrl, addressRow, timeoutMs }) {
  const address = buildAddress(addressRow);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const start = performance.now();

  try {
    const response = await fetch(`${baseUrl}/api/risk`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ address }),
      signal: controller.signal,
    });

    const elapsedMs = Number((performance.now() - start).toFixed(2));
    let payload = null;

    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    const advisorySource = findAdvisorySource(payload?.dataSources);
    const schema = response.ok ? validatePayload(payload) : { valid: false, issues: [] };

    return {
      ok: response.ok,
      status: response.status,
      elapsedMs,
      address,
      schemaValid: schema.valid,
      schemaIssues: schema.issues,
      riskLevel: payload?.riskLevel ?? null,
      advisorySourceName: advisorySource?.name ?? null,
      advisorySourceNote: advisorySource?.note ?? null,
      error: response.ok ? null : payload?.error ?? `http_${response.status}`,
    };
  } catch (error) {
    const elapsedMs = Number((performance.now() - start).toFixed(2));
    const errorMessage =
      error instanceof Error
        ? error.name === "AbortError"
          ? `timeout_after_${timeoutMs}ms`
          : error.message
        : "unknown_request_failure";

    return {
      ok: false,
      status: "network_error",
      elapsedMs,
      address,
      schemaValid: false,
      schemaIssues: [],
      riskLevel: null,
      advisorySourceName: null,
      advisorySourceNote: null,
      error: errorMessage,
    };
  } finally {
    clearTimeout(timer);
  }
}

function summarizeScenario(scenario, records, durationMs) {
  const total = records.length;
  const successes = records.filter((record) => record.ok).length;
  const successRate = total > 0 ? Number(((successes / total) * 100).toFixed(6)) : 0;

  const statusCounts = {};
  const errorCounts = {};
  const advisorySourceCounts = {};
  const riskLevelCounts = {};
  const schemaIssueCounts = {};

  for (const record of records) {
    const statusKey = String(record.status);
    statusCounts[statusKey] = (statusCounts[statusKey] ?? 0) + 1;

    if (record.error) {
      errorCounts[record.error] = (errorCounts[record.error] ?? 0) + 1;
    }

    if (record.advisorySourceName) {
      advisorySourceCounts[record.advisorySourceName] =
        (advisorySourceCounts[record.advisorySourceName] ?? 0) + 1;
    }

    if (record.riskLevel) {
      riskLevelCounts[record.riskLevel] = (riskLevelCounts[record.riskLevel] ?? 0) + 1;
    }

    for (const issue of record.schemaIssues) {
      schemaIssueCounts[issue] = (schemaIssueCounts[issue] ?? 0) + 1;
    }
  }

  const latencies = records.map((record) => record.elapsedMs);
  const schemaValidCount = records.filter((record) => record.ok && record.schemaValid).length;
  const schemaValidRate = successes > 0 ? Number(((schemaValidCount / successes) * 100).toFixed(6)) : 0;

  return {
    scenario,
    durationMs: Number(durationMs.toFixed(2)),
    requests: total,
    successes,
    successRate,
    schemaValidCount,
    schemaValidRate,
    throughputRps: Number((total / (durationMs / 1000)).toFixed(2)),
    latencyMs: summarizeLatencies(latencies),
    statusCounts,
    advisorySourceCounts,
    riskLevelCounts,
    topErrors: Object.entries(errorCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([error, count]) => ({ error, count })),
    topSchemaIssues: Object.entries(schemaIssueCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([issue, count]) => ({ issue, count })),
    latenciesMsRaw: latencies,
  };
}

async function runScenario({ baseUrl, scenario, addressRows }) {
  const records = [];
  const startMs = performance.now();
  const endByTime = scenario.durationSec
    ? Date.now() + scenario.durationSec * 1000
    : null;

  let launched = 0;

  async function worker() {
    while (true) {
      if (scenario.requests && launched >= scenario.requests) {
        break;
      }

      if (endByTime && Date.now() >= endByTime) {
        break;
      }

      launched += 1;
      const addressRow = pickRandomAddress(addressRows);
      const record = await runRequest({
        baseUrl,
        addressRow,
        timeoutMs: scenario.timeoutMs,
      });
      records.push(record);
    }
  }

  const workers = Array.from({ length: scenario.concurrency }, () => worker());
  await Promise.all(workers);

  const durationMs = performance.now() - startMs;
  return summarizeScenario(scenario, records, durationMs);
}

function buildMarkdownReport({ generatedAt, baseUrl, aggregate, scenarios }) {
  const lines = [];
  lines.push("# ClimateGuard Stress Test Report");
  lines.push("");
  lines.push(`Generated: ${generatedAt}`);
  lines.push(`Base URL: ${baseUrl}`);
  lines.push("");
  lines.push("## Aggregate Summary");
  lines.push("");
  lines.push(`- Total requests: ${aggregate.requests}`);
  lines.push(`- Success rate: ${aggregate.successRate}%`);
  lines.push(`- Schema-valid success rate: ${aggregate.schemaValidRate}%`);
  lines.push(`- Total duration: ${aggregate.durationSec}s`);
  lines.push(`- Aggregate throughput: ${aggregate.throughputRps} req/s`);
  lines.push(`- Latency avg/p95/p99: ${aggregate.latency.avg} / ${aggregate.latency.p95} / ${aggregate.latency.p99} ms`);
  lines.push("");
  lines.push("## Scenario Results");
  lines.push("");
  lines.push("| Scenario | Requests | Success % | Schema % | Throughput req/s | Avg ms | P95 ms | P99 ms |");
  lines.push("|---|---:|---:|---:|---:|---:|---:|---:|");

  for (const scenario of scenarios) {
    lines.push(
      `| ${scenario.scenario.id} | ${scenario.requests} | ${scenario.successRate} | ${scenario.schemaValidRate} | ${scenario.throughputRps} | ${scenario.latencyMs.avg} | ${scenario.latencyMs.p95} | ${scenario.latencyMs.p99} |`,
    );
  }

  lines.push("");
  lines.push("## Advisory Source Distribution");
  lines.push("");

  const advisoryCounts = {};
  for (const scenario of scenarios) {
    for (const [source, count] of Object.entries(scenario.advisorySourceCounts)) {
      advisoryCounts[source] = (advisoryCounts[source] ?? 0) + count;
    }
  }

  for (const [source, count] of Object.entries(advisoryCounts).sort((a, b) => b[1] - a[1])) {
    lines.push(`- ${source}: ${count}`);
  }

  lines.push("");
  lines.push("## Error Hotspots");
  lines.push("");

  const errorCounts = {};
  for (const scenario of scenarios) {
    for (const item of scenario.topErrors) {
      errorCounts[item.error] = (errorCounts[item.error] ?? 0) + item.count;
    }
  }

  if (Object.keys(errorCounts).length === 0) {
    lines.push("- None");
  } else {
    for (const [error, count] of Object.entries(errorCounts).sort((a, b) => b[1] - a[1])) {
      lines.push(`- ${error}: ${count}`);
    }
  }

  lines.push("");
  lines.push("## Notes");
  lines.push("");
  lines.push("- This test uses live external dependencies (OSM/FEMA/NOAA + AI providers). Results include real network effects.");
  lines.push("- Zero 5xx and high schema-valid rates are the primary release gate for competition demo reliability.");

  return lines.join("\n");
}

function aggregateScenarios(summaries) {
  const requests = summaries.reduce((sum, item) => sum + item.requests, 0);
  const successes = summaries.reduce((sum, item) => sum + item.successes, 0);
  const schemaValidCount = summaries.reduce((sum, item) => sum + item.schemaValidCount, 0);
  const durationSec = Number(
    (summaries.reduce((sum, item) => sum + item.durationMs, 0) / 1000).toFixed(2),
  );

  const latencyValues = summaries.flatMap((summary) => summary.latenciesMsRaw);

  return {
    requests,
    successes,
    successRate: requests > 0 ? Number(((successes / requests) * 100).toFixed(6)) : 0,
    schemaValidCount,
    schemaValidRate: successes > 0 ? Number(((schemaValidCount / successes) * 100).toFixed(6)) : 0,
    durationSec,
    throughputRps: durationSec > 0 ? Number((requests / durationSec).toFixed(2)) : 0,
    latency: summarizeLatencies(latencyValues),
  };
}

async function main() {
  const csvText = await readFile(INPUT_CSV, "utf8");
  const addressRows = parseCsv(csvText);

  if (addressRows.length === 0) {
    throw new Error("No addresses available for stress test.");
  }

  const summaries = [];

  for (const scenario of SCENARIOS) {
    const summary = await runScenario({
      baseUrl: BASE_URL,
      scenario,
      addressRows,
    });
    summaries.push(summary);
    process.stdout.write(
      `[${scenario.id}] requests=${summary.requests} successRate=${summary.successRate}% p95=${summary.latencyMs.p95}ms\n`,
    );
  }

  const generatedAt = new Date().toISOString();
  const aggregate = aggregateScenarios(summaries);

  const payload = {
    generatedAt,
    baseUrl: BASE_URL,
    scenarios: summaries.map((summary) => ({
      ...summary,
      latenciesMsRaw: undefined,
    })),
    aggregate,
  };

  await mkdir(resolve("data"), { recursive: true });
  await mkdir(resolve("docs"), { recursive: true });
  await writeFile(OUTPUT_JSON, JSON.stringify(payload, null, 2), "utf8");

  const report = buildMarkdownReport({
    generatedAt,
    baseUrl: BASE_URL,
    aggregate,
    scenarios: summaries,
  });
  await writeFile(OUTPUT_MD, report, "utf8");

  process.stdout.write(`Stress JSON report: ${OUTPUT_JSON}\n`);
  process.stdout.write(`Stress markdown report: ${OUTPUT_MD}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
