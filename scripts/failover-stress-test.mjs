import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";

const BASE_URL = process.env.CLIMATEGUARD_BASE_URL ?? "http://localhost:3000";
const INPUT_CSV = resolve("data/test-addresses.csv");
const OUTPUT_JSON = resolve("data/failover-stress-results.json");
const DURATION_SEC = Number(process.env.FAILOVER_STRESS_DURATION_SEC ?? "300");
const CONCURRENCY = Number(process.env.FAILOVER_STRESS_CONCURRENCY ?? "12");
const TIMEOUT_MS = Number(process.env.FAILOVER_STRESS_TIMEOUT_MS ?? "35000");

function parseCsv(csvText) {
  const [headerLine, ...rowLines] = csvText.trim().split(/\r?\n/);
  const headers = headerLine.split(",").map((header) => header.trim());
  return rowLines
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const values = line.split(",");
      const row = {};
      headers.forEach((header, index) => {
        row[header] = (values[index] ?? "").trim();
      });
      return row;
    });
}

function randomAddress(rows) {
  const item = rows[Math.floor(Math.random() * rows.length)];
  return `${item.address}, ${item.city}, ${item.state} ${item.zip}`;
}

async function sendRiskRequest(address) {
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const startedAt = performance.now();

  try {
    const response = await fetch(`${BASE_URL}/api/risk`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ address }),
      signal: controller.signal,
    });

    const elapsedMs = Number((performance.now() - startedAt).toFixed(2));
    let payload = null;

    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    const advisorySource = Array.isArray(payload?.dataSources)
      ? payload.dataSources.find((source) => source?.name?.includes?.("Advisory"))
      : null;

    return {
      ok: response.ok,
      status: response.status,
      elapsedMs,
      advisorySourceName: advisorySource?.name ?? null,
      advisorySourceNote: advisorySource?.note ?? null,
      error: response.ok ? null : payload?.error ?? `http_${response.status}`,
    };
  } catch (error) {
    const elapsedMs = Number((performance.now() - startedAt).toFixed(2));
    return {
      ok: false,
      status: "network_error",
      elapsedMs,
      advisorySourceName: null,
      advisorySourceNote: null,
      error: error instanceof Error ? error.message : "unknown_error",
    };
  } finally {
    clearTimeout(timeoutHandle);
  }
}

function percentile(values, p) {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor((p / 100) * sorted.length)));
  return sorted[index];
}

async function main() {
  const rows = parseCsv(await readFile(INPUT_CSV, "utf8"));

  const endAt = Date.now() + DURATION_SEC * 1000;
  const records = [];

  async function worker() {
    while (Date.now() < endAt) {
      const address = randomAddress(rows);
      records.push(await sendRiskRequest(address));
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  const total = records.length;
  const okCount = records.filter((record) => record.ok).length;
  const failCount = total - okCount;
  const latency = records.map((record) => record.elapsedMs);

  const sourceCounts = {};
  const statusCounts = {};
  const errorCounts = {};

  for (const record of records) {
    const statusKey = String(record.status);
    statusCounts[statusKey] = (statusCounts[statusKey] ?? 0) + 1;

    if (record.advisorySourceName) {
      sourceCounts[record.advisorySourceName] = (sourceCounts[record.advisorySourceName] ?? 0) + 1;
    }

    if (record.error) {
      errorCounts[record.error] = (errorCounts[record.error] ?? 0) + 1;
    }
  }

  const nimCount = sourceCounts["NVIDIA NIM Advisory"] ?? 0;
  const nimShare = okCount > 0 ? Number(((nimCount / okCount) * 100).toFixed(2)) : 0;
  const maxLatency = latency.reduce(
    (currentMax, value) => (value > currentMax ? value : currentMax),
    0,
  );

  const result = {
    generatedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    durationSec: DURATION_SEC,
    concurrency: CONCURRENCY,
    timeoutMs: TIMEOUT_MS,
    total,
    okCount,
    failCount,
    successRate: total > 0 ? Number(((okCount / total) * 100).toFixed(4)) : 0,
    nimSharePercentAmongSuccesses: nimShare,
    latencyMs: {
      avg: latency.length > 0 ? Number((latency.reduce((sum, value) => sum + value, 0) / latency.length).toFixed(2)) : 0,
      p95: Number(percentile(latency, 95).toFixed(2)),
      p99: Number(percentile(latency, 99).toFixed(2)),
      max: Number(maxLatency.toFixed(2)),
    },
    statusCounts,
    sourceCounts,
    topErrors: Object.entries(errorCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([error, count]) => ({ error, count })),
  };

  await writeFile(OUTPUT_JSON, JSON.stringify(result, null, 2), "utf8");

  process.stdout.write(`Failover stress JSON report: ${OUTPUT_JSON}\n`);
  process.stdout.write(JSON.stringify({
    total: result.total,
    successRate: result.successRate,
    nimSharePercentAmongSuccesses: result.nimSharePercentAmongSuccesses,
    p95: result.latencyMs.p95,
    p99: result.latencyMs.p99,
  }) + "\n");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
